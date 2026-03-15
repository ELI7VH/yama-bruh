// ── YAMA-BRUH Native Audio Test ──────────────────────────────────────
// Lock-free architecture: audio thread owns all state exclusively.
// Commands sent via lock-free ring buffer. ZERO I/O on audio thread.

use std::sync::atomic::{AtomicU64, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use std::io::Write;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossterm::{
    event::{self, Event, KeyCode, KeyEventKind},
    terminal,
};
use midir::{MidiInput, Ignore};

use yama_bruh::get_preset_data;

const TAU: f32 = 6.283185307179586;
const MAX_VOICES: usize = 16;
const MAX_DRUM_HITS: usize = 32;

// ── Lock-free trace log ring (audio thread writes, main thread reads) ──
const TRACE_RING_SIZE: usize = 1024;
const TRACE_RING_MASK: usize = TRACE_RING_SIZE - 1;

#[derive(Clone, Copy)]
#[repr(C)]
struct TraceEntry {
    tag: u8,           // event type
    sample_count: u64, // when it happened (in samples)
    i1: i32,           // context int (note, buffer size, etc)
    f1: f32,           // context float (sample value, peak, etc)
    f2: f32,           // extra float
}

impl TraceEntry {
    const fn empty() -> Self {
        TraceEntry { tag: 0, sample_count: 0, i1: 0, f1: 0.0, f2: 0.0 }
    }
}

// Tag constants
const T_CALLBACK: u8 = 1;    // audio callback fired: i1=buffer_size
const T_VOICE_ON: u8 = 2;    // voice created: i1=note, f1=freq
const T_VOICE_OFF: u8 = 3;   // voice released: i1=note
const T_VOICE_DEAD: u8 = 4;  // voice killed: i1=note, f1=age
const T_MIDI_IN: u8 = 5;     // MIDI received: i1=status|note|vel packed
const T_SAMPLE: u8 = 6;      // sample output (logged every N): f1=sample, f2=peak
const T_NAN: u8 = 7;         // NaN detected: i1=source(1=voice,2=drum,3=mix)
const T_CMD_DRAIN: u8 = 8;   // commands drained: i1=count
const T_ERROR: u8 = 9;       // cpal error callback fired

struct TraceRing {
    entries: [TraceEntry; TRACE_RING_SIZE],
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl TraceRing {
    fn new() -> Self {
        TraceRing {
            entries: [TraceEntry::empty(); TRACE_RING_SIZE],
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    fn push(&self, entry: TraceEntry) {
        let head = self.head.load(Ordering::Relaxed);
        let next = (head + 1) & TRACE_RING_MASK;
        // If full, just overwrite (drop oldest). Single producer so no CAS needed from audio thread.
        let ptr = &self.entries[head] as *const TraceEntry as *mut TraceEntry;
        unsafe { ptr.write(entry); }
        self.head.store(next, Ordering::Release);
    }

    fn pop(&self) -> Option<TraceEntry> {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        if tail == head { return None; }
        let entry = unsafe { std::ptr::read(&self.entries[tail]) };
        self.tail.store((tail + 1) & TRACE_RING_MASK, Ordering::Release);
        Some(entry)
    }
}

// ── Lock-free command ring buffer ────────────────────────────────────
// Fixed-size ring buffer with atomic head/tail. No mutexes anywhere.
const CMD_RING_SIZE: usize = 256;
const CMD_RING_MASK: usize = CMD_RING_SIZE - 1;

// All commands encoded as fixed-size slots to avoid heap allocation
#[derive(Clone, Copy)]
#[repr(C)]
struct CmdSlot {
    tag: u8,         // 0=empty, 1=NoteOn, 2=NoteOff, 3=MidiRaw, 4=SeqToggle, 5=SetPreset
    data: [u8; 3],   // MIDI bytes or packed data
    f1: f32,         // velocity or other float
    u1: u32,         // preset index or other u32
}

impl CmdSlot {
    const fn empty() -> Self {
        CmdSlot { tag: 0, data: [0; 3], f1: 0.0, u1: 0 }
    }
}

struct CmdRing {
    slots: [CmdSlot; CMD_RING_SIZE],
    head: AtomicUsize, // writer advances
    tail: AtomicUsize, // reader advances
}

impl CmdRing {
    fn new() -> Self {
        CmdRing {
            slots: [CmdSlot::empty(); CMD_RING_SIZE],
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    // Push a command. Returns false if ring is full (drop the command).
    // SAFETY: only safe if there's a single writer OR writers are externally synchronized.
    // We use a simple spin-free approach: multiple writers are OK since we use atomic CAS.
    fn push(&self, slot: CmdSlot) -> bool {
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);
        let next = (head + 1) & CMD_RING_MASK;
        if next == tail { return false; } // full

        // SAFETY: we're the only writer at this index (head hasn't advanced yet)
        // Multiple writers: we use CAS to claim the slot
        match self.head.compare_exchange(head, next, Ordering::AcqRel, Ordering::Relaxed) {
            Ok(_) => {
                // We claimed this slot, write to it
                let ptr = &self.slots[head] as *const CmdSlot as *mut CmdSlot;
                unsafe { ptr.write(slot); }
                true
            }
            Err(_) => false, // another writer beat us, drop this command (rare)
        }
    }

    // Pop a command. Only called from audio thread (single consumer).
    fn pop(&self) -> Option<CmdSlot> {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Acquire);
        if tail == head { return None; } // empty

        let slot = unsafe { std::ptr::read(&self.slots[tail]) };
        self.tail.store((tail + 1) & CMD_RING_MASK, Ordering::Release);
        Some(slot)
    }
}

// Helpers to create command slots
fn cmd_note_on(note: i32, vel: f32, preset: u32) -> CmdSlot {
    CmdSlot { tag: 1, data: [note as u8, 0, 0], f1: vel, u1: preset }
}
fn cmd_note_off(note: i32) -> CmdSlot {
    CmdSlot { tag: 2, data: [note as u8, 0, 0], f1: 0.0, u1: 0 }
}
fn cmd_midi_raw(bytes: [u8; 3], len: usize) -> CmdSlot {
    CmdSlot { tag: 3, data: bytes, f1: 0.0, u1: len as u32 }
}
fn cmd_seq_toggle() -> CmdSlot {
    CmdSlot { tag: 4, data: [0; 3], f1: 0.0, u1: 0 }
}
fn cmd_set_preset(p: u32) -> CmdSlot {
    CmdSlot { tag: 5, data: [0; 3], f1: 0.0, u1: p }
}

// ── Shared stats (atomics, no lock needed) ───────────────────────────
struct Stats {
    total_samples: AtomicU64,
    nan_count: AtomicU32,
    peak_bits: AtomicU32,
    voice_count: AtomicU32,
    drum_count: AtomicU32,
    active_channel: AtomicU32,
    current_preset: AtomicU32,
    seq_playing: AtomicU32,
}

impl Stats {
    fn new() -> Self {
        Stats {
            total_samples: AtomicU64::new(0),
            nan_count: AtomicU32::new(0),
            peak_bits: AtomicU32::new(0),
            voice_count: AtomicU32::new(0),
            drum_count: AtomicU32::new(0),
            active_channel: AtomicU32::new(0),
            current_preset: AtomicU32::new(0),
            seq_playing: AtomicU32::new(0),
        }
    }
    fn set_peak(&self, v: f32) {
        self.peak_bits.store(v.to_bits(), Ordering::Relaxed);
    }
    fn get_peak(&self) -> f32 {
        f32::from_bits(self.peak_bits.load(Ordering::Relaxed))
    }
}

// ── FM Synth Voice ───────────────────────────────────────────────────
#[derive(Clone)]
struct Voice {
    note: i32,
    freq: f32,
    velocity: f32,
    cp: f32, mp: f32, pm: f32,
    es: u8, el: f32, et: f32, rl: f32,
    age: f32,
    p: [f32; 8],
}

impl Voice {
    fn new(note: i32, freq: f32, vel: f32, preset: [f32; 8]) -> Self {
        Voice {
            note, freq, velocity: vel,
            cp: 0.0, mp: 0.0, pm: 0.0,
            es: 0, el: 0.0, et: 0.0, rl: 0.0,
            age: 0.0, p: preset,
        }
    }
}

// ── Drum Hit ─────────────────────────────────────────────────────────
#[derive(Clone)]
struct DrumHit {
    t: f32, vel: f32, cp: f32, mp: f32,
    carrier_freq: f32, mod_freq: f32, mod_index: f32,
    pitch_sweep: f32, pitch_decay: f32,
    decay: f32, noise_amt: f32, click_amt: f32,
}

fn make_drum(name: &str, vel: f32) -> Option<DrumHit> {
    let base = DrumHit {
        t: 0.0, vel, cp: 0.0, mp: 0.0,
        carrier_freq: 0.0, mod_freq: 0.0, mod_index: 0.0,
        pitch_sweep: 0.0, pitch_decay: 0.0,
        decay: 0.0, noise_amt: 0.0, click_amt: 0.0,
    };
    match name {
        "kick" => Some(DrumHit { carrier_freq: 60.0, mod_freq: 90.0, mod_index: 3.0,
            pitch_sweep: 160.0, pitch_decay: 0.015, decay: 0.25, click_amt: 0.3, ..base }),
        "snare" => Some(DrumHit { carrier_freq: 200.0, mod_freq: 340.0, mod_index: 2.5,
            pitch_sweep: 60.0, pitch_decay: 0.01, decay: 0.18, noise_amt: 0.6, click_amt: 0.15, ..base }),
        "hihat_c" => Some(DrumHit { carrier_freq: 800.0, mod_freq: 5600.0, mod_index: 4.0,
            decay: 0.04, noise_amt: 0.5, ..base }),
        "hihat_o" => Some(DrumHit { carrier_freq: 800.0, mod_freq: 5600.0, mod_index: 4.0,
            decay: 0.22, noise_amt: 0.5, ..base }),
        "clap" => Some(DrumHit { carrier_freq: 1200.0, mod_freq: 2400.0, mod_index: 1.5,
            decay: 0.2, noise_amt: 0.85, ..base }),
        "tom_hi" => Some(DrumHit { carrier_freq: 240.0, mod_freq: 360.0, mod_index: 2.0,
            pitch_sweep: 80.0, pitch_decay: 0.02, decay: 0.2, click_amt: 0.1, ..base }),
        "tom_lo" => Some(DrumHit { carrier_freq: 130.0, mod_freq: 195.0, mod_index: 2.0,
            pitch_sweep: 60.0, pitch_decay: 0.025, decay: 0.25, click_amt: 0.1, ..base }),
        "rimshot" => Some(DrumHit { carrier_freq: 500.0, mod_freq: 1600.0, mod_index: 2.0,
            pitch_sweep: 200.0, pitch_decay: 0.005, decay: 0.06, noise_amt: 0.2, click_amt: 0.5, ..base }),
        "cowbell" => Some(DrumHit { carrier_freq: 587.0, mod_freq: 829.0, mod_index: 1.8,
            decay: 0.12, click_amt: 0.1, ..base }),
        "cymbal" => Some(DrumHit { carrier_freq: 940.0, mod_freq: 6580.0, mod_index: 5.0,
            decay: 0.8, noise_amt: 0.4, ..base }),
        _ => None,
    }
}

// ── Patterns ─────────────────────────────────────────────────────────
const PATTERN_KICK:  [f32; 16] = [1.0,0.0,0.0,0.0, 0.0,0.0,0.0,0.0, 1.0,0.0,0.0,0.0, 0.0,0.0,0.0,0.0];
const PATTERN_SNARE: [f32; 16] = [0.0,0.0,0.0,0.0, 1.0,0.0,0.0,0.0, 0.0,0.0,0.0,0.0, 1.0,0.0,0.0,0.0];
const PATTERN_HIHAT: [f32; 16] = [1.0,0.0,1.0,0.0, 1.0,0.0,1.0,0.0, 1.0,0.0,1.0,0.0, 1.0,0.0,1.0,0.0];

// ── GM drum mapping ─────────────────────────────────────────────────
fn midi_drum(note: u8) -> Option<&'static str> {
    match note {
        35 | 36 => Some("kick"),
        38 | 40 => Some("snare"),
        42 | 44 => Some("hihat_c"),
        46 => Some("hihat_o"),
        39 => Some("clap"),
        48 | 50 => Some("tom_hi"),
        41 | 43 | 45 | 47 => Some("tom_lo"),
        37 => Some("rimshot"),
        56 => Some("cowbell"),
        49 | 51 | 52 | 57 => Some("cymbal"),
        _ => None,
    }
}

// ── Audio Engine (lives entirely on audio thread) ────────────────────
// RULE: ZERO allocations, ZERO I/O, ZERO locks in process_buffer.
struct Engine {
    voices: [Option<Voice>; MAX_VOICES],
    voice_count: usize,
    drum_hits: [Option<DrumHit>; MAX_DRUM_HITS],
    drum_count: usize,
    noise_seed: u32,
    comp1_env: f32,
    comp2_env: f32,
    seq_playing: bool,
    seq_step: usize,
    seq_samples_per_step: f32,
    seq_sample_counter: f32,
    total_samples: u64,
    nan_count: u32,
    peak: f32,
    current_preset: u32,
    channel_map: [u32; 16],
    active_channel: u8,
    ring: Arc<CmdRing>,
    trace: Arc<TraceRing>,
    stats: Arc<Stats>,
    sr: f32,
    trace_sample_counter: u64, // log a sample trace every N samples
}

const NONE_VOICE: Option<Voice> = None;
const NONE_DRUM: Option<DrumHit> = None;

impl Engine {
    fn new(sr: f32, ring: Arc<CmdRing>, trace: Arc<TraceRing>, stats: Arc<Stats>) -> Self {
        Engine {
            voices: [NONE_VOICE; MAX_VOICES],
            voice_count: 0,
            drum_hits: [NONE_DRUM; MAX_DRUM_HITS],
            drum_count: 0,
            noise_seed: 1,
            comp1_env: 0.0, comp2_env: 0.0,
            seq_playing: false, seq_step: 0,
            seq_samples_per_step: sr * 60.0 / 120.0 / 4.0,
            seq_sample_counter: 0.0,
            total_samples: 0, nan_count: 0, peak: 0.0,
            current_preset: 0,
            channel_map: [0; 16],
            active_channel: 0,
            ring, trace, stats, sr,
            trace_sample_counter: 0,
        }
    }

    fn add_voice(&mut self, v: Voice) {
        let note = v.note;
        let freq = v.freq;
        // Remove existing voice with same note
        for slot in &mut self.voices {
            if let Some(ref existing) = slot {
                if existing.note == note {
                    *slot = None;
                    self.voice_count -= 1;
                    break;
                }
            }
        }
        // Find empty slot
        for slot in &mut self.voices {
            if slot.is_none() {
                *slot = Some(v);
                self.voice_count += 1;
                self.trace.push(TraceEntry { tag: T_VOICE_ON, sample_count: self.total_samples, i1: note, f1: freq, f2: 0.0 });
                return;
            }
        }
        // Full — steal oldest
        let mut oldest_idx = 0;
        let mut oldest_age: f32 = 0.0;
        for (i, slot) in self.voices.iter().enumerate() {
            if let Some(ref voice) = slot {
                if voice.age > oldest_age { oldest_age = voice.age; oldest_idx = i; }
            }
        }
        self.voices[oldest_idx] = Some(v);
        self.trace.push(TraceEntry { tag: T_VOICE_ON, sample_count: self.total_samples, i1: note, f1: freq, f2: oldest_age });
    }

    fn add_drum(&mut self, h: DrumHit) {
        for slot in &mut self.drum_hits {
            if slot.is_none() {
                *slot = Some(h);
                self.drum_count += 1;
                return;
            }
        }
        // Full — steal slot 0
        self.drum_hits[0] = Some(h);
    }

    fn drain_commands(&mut self) {
        let mut cmd_count: i32 = 0;
        while let Some(slot) = self.ring.pop() {
            cmd_count += 1;
            match slot.tag {
                1 => { // NoteOn
                    let note = slot.data[0] as i32;
                    let vel = slot.f1;
                    let preset = slot.u1;
                    let freq = 440.0 * libm::powf(2.0, (note as f32 - 69.0) / 12.0);
                    let preset_data = get_preset_data(preset);
                    self.add_voice(Voice::new(note, freq, vel, preset_data));
                }
                2 => { // NoteOff
                    let note = slot.data[0] as i32;
                    self.trace.push(TraceEntry { tag: T_VOICE_OFF, sample_count: self.total_samples, i1: note, f1: 0.0, f2: 0.0 });
                    for v_slot in &mut self.voices {
                        if let Some(ref mut v) = v_slot {
                            if v.note == note && v.es < 3 {
                                v.es = 3; v.et = 0.0; v.rl = v.el;
                            }
                        }
                    }
                }
                3 => { // MidiRaw
                    let len = slot.u1 as usize;
                    // Pack MIDI bytes into i1 for trace
                    let packed = (slot.data[0] as i32) | ((slot.data[1] as i32) << 8) | ((slot.data[2] as i32) << 16);
                    self.trace.push(TraceEntry { tag: T_MIDI_IN, sample_count: self.total_samples, i1: packed, f1: len as f32, f2: 0.0 });
                    self.handle_midi(&slot.data[..len]);
                }
                4 => { // SeqToggle
                    self.seq_playing = !self.seq_playing;
                    if !self.seq_playing { self.seq_step = 0; self.seq_sample_counter = 0.0; }
                    self.stats.seq_playing.store(self.seq_playing as u32, Ordering::Relaxed);
                }
                5 => { // SetPreset
                    self.current_preset = slot.u1;
                    self.stats.current_preset.store(slot.u1, Ordering::Relaxed);
                }
                _ => {}
            }
        }
        if cmd_count > 0 {
            self.trace.push(TraceEntry { tag: T_CMD_DRAIN, sample_count: self.total_samples, i1: cmd_count, f1: 0.0, f2: 0.0 });
        }
    }

    fn handle_midi(&mut self, data: &[u8]) {
        if data.len() < 2 { return; }
        let cmd = data[0] & 0xf0;
        let ch = data[0] & 0x0f;
        let note = data[1];
        let vel = if data.len() > 2 { data[2] } else { 0 };

        if cmd == 0x90 && vel > 0 {
            let vel_f = vel as f32 / 127.0;
            if ch >= 12 {
                if let Some(sound) = midi_drum(note) {
                    if let Some(hit) = make_drum(sound, vel_f) {
                        self.add_drum(hit);
                    }
                }
            } else {
                let preset = self.channel_map[ch as usize];
                let freq = 440.0 * libm::powf(2.0, (note as f32 - 69.0) / 12.0);
                let preset_data = get_preset_data(preset);
                self.add_voice(Voice::new(note as i32, freq, vel_f, preset_data));
            }
            self.active_channel = ch;
            self.stats.active_channel.store(ch as u32, Ordering::Relaxed);
        } else if cmd == 0x80 || (cmd == 0x90 && vel == 0) {
            if ch < 12 {
                for v_slot in &mut self.voices {
                    if let Some(ref mut v) = v_slot {
                        if v.note == note as i32 && v.es < 3 {
                            v.es = 3; v.et = 0.0; v.rl = v.el;
                        }
                    }
                }
            }
        }
    }

    fn next_noise(&mut self) -> f32 {
        let mut s = self.noise_seed as i32;
        s ^= s << 13;
        s = ((s as u32) >> 17) as i32;
        s ^= s << 5;
        if s == 0 { s = 1; }
        self.noise_seed = s as u32;
        (self.noise_seed & 0x7fffffff) as f32 / 0x7fffffff as f32 * 2.0 - 1.0
    }

    // ZERO I/O, ZERO allocation, ZERO locks. Pure DSP + atomic stats.
    fn process_buffer(&mut self, data: &mut [f32], channels: usize) {
        // Trace: callback fired with buffer size
        self.trace.push(TraceEntry { tag: T_CALLBACK, sample_count: self.total_samples, i1: data.len() as i32, f1: 0.0, f2: 0.0 });

        self.drain_commands();
        let sr = self.sr;
        let dt = 1.0 / sr;

        for frame in data.chunks_mut(channels) {
            let mut s: f32 = 0.0;

            // Synth voices + drums — no sequencer, no compressor
            for i in 0..MAX_VOICES {
                let voice_alive = if let Some(ref mut v) = self.voices[i] {
                    let p = v.p;
                    let crf = v.freq * p[0];
                    let mrf = v.freq * p[1];
                    let mi = p[2];
                    let (atk, dec, sus, rel, fb) = (p[3], p[4], p[5], p[6], p[7]);

                    v.age += dt;
                    if v.age > 30.0 { false }
                    else {
                        v.et += dt;
                        let (env, dead) = match v.es {
                            0 => {
                                let e = if atk > 0.0001 { v.et / atk } else { 1.0 };
                                if e >= 1.0 { v.es = 1; v.et = 0.0; v.el = 1.0; (1.0f32, false) }
                                else { v.el = e; (e, false) }
                            }
                            1 => {
                                let t = if dec > 0.0001 { v.et / dec } else { 1.0 };
                                let e = if t >= 1.0 { v.es = 2; sus } else { 1.0 - (1.0 - sus) * t };
                                v.el = e; (e, false)
                            }
                            2 => { v.el = sus; (sus, false) }
                            _ => {
                                let t = if rel > 0.0001 { v.et / rel } else { 1.0 };
                                if t >= 1.0 { (0.0, true) }
                                else { (v.rl * (1.0 - t), false) }
                            }
                        };

                        if dead { false }
                        else {
                            let ms = libm::sinf(v.mp + fb * v.pm);
                            v.pm = ms;
                            let sample = libm::sinf(v.cp + mi * ms) * env * v.velocity * 0.35;

                            if sample.is_nan() || !v.cp.is_finite() || !v.mp.is_finite() {
                                self.nan_count += 1;
                                false
                            } else {
                                s += sample;
                                v.cp += TAU * crf / sr;
                                v.mp += TAU * mrf / sr;
                                if v.cp > TAU { v.cp -= TAU; }
                                if v.mp > TAU { v.mp -= TAU; }
                                true
                            }
                        }
                    }
                } else { true };
                if !voice_alive && self.voices[i].is_some() {
                    self.voices[i] = None;
                    self.voice_count -= 1;
                }
            }

            // Drum hits
            for i in 0..MAX_DRUM_HITS {
                let drum_alive = if let Some(ref h) = self.drum_hits[i] {
                    let env = libm::expf(-h.t / (h.decay * 0.4)) * h.vel;
                    if env < 0.001 { false }
                    else {
                        let sweep = h.pitch_sweep * libm::expf(-h.t / h.pitch_decay.max(0.001));
                        let c_freq = h.carrier_freq + sweep;
                        let m_freq = h.mod_freq + sweep * 0.5;
                        let modv = libm::sinf(h.mp) * h.mod_index;
                        let carrier = libm::sinf(h.cp + modv);
                        let noise_amt = h.noise_amt;
                        let click_amt = h.click_amt;
                        let vel = h.vel;
                        let t = h.t;
                        drop(h);

                        let noise = if noise_amt > 0.0 { self.next_noise() * noise_amt * env } else { 0.0 };
                        let click = if click_amt > 0.0 && t < 0.002 {
                            (1.0 - t / 0.002) * click_amt * vel
                        } else { 0.0 };

                        let ds = (carrier * env * (1.0 - noise_amt) + noise + click) * 0.5;
                        if ds.is_nan() { false }
                        else {
                            s += ds;
                            let h = self.drum_hits[i].as_mut().unwrap();
                            h.cp += TAU * c_freq / sr;
                            h.mp += TAU * m_freq / sr;
                            if h.cp > TAU { h.cp -= TAU; }
                            if h.mp > TAU { h.mp -= TAU; }
                            h.t += dt;
                            true
                        }
                    }
                } else { true };
                if !drum_alive && self.drum_hits[i].is_some() {
                    self.drum_hits[i] = None;
                    self.drum_count -= 1;
                }
            }

            // Soft knee limiter — tames peaks without pumping
            let abs_s = s.abs();
            if abs_s > 0.5 {
                let over = abs_s - 0.5;
                let gain = 0.5 + over / (1.0 + over * 2.0);
                s = s.signum() * gain;
            }
            s = s.clamp(-0.95, 0.95);
            self.total_samples += 1;
            if s.abs() > self.peak { self.peak = s.abs(); }

            // Trace sample every ~100ms
            self.trace_sample_counter += 1;
            if self.trace_sample_counter >= 4410 {
                self.trace_sample_counter = 0;
                self.trace.push(TraceEntry { tag: T_SAMPLE, sample_count: self.total_samples, i1: self.voice_count as i32, f1: s, f2: self.peak });
            }

            for ch in frame.iter_mut() { *ch = s; }
        }

        // Update stats atomically (no lock, no I/O)
        self.stats.total_samples.store(self.total_samples, Ordering::Relaxed);
        self.stats.nan_count.store(self.nan_count, Ordering::Relaxed);
        self.stats.set_peak(self.peak);
        let vc = self.voices.iter().filter(|v| v.is_some()).count();
        self.stats.voice_count.store(vc as u32, Ordering::Relaxed);
    }
}

// ── QWERTY mapping ──────────────────────────────────────────────────
fn key_to_midi(code: KeyCode) -> Option<i32> {
    match code {
        KeyCode::Char('a') => Some(54), KeyCode::Char('w') => Some(55),
        KeyCode::Char('s') => Some(56), KeyCode::Char('e') => Some(57),
        KeyCode::Char('d') => Some(58), KeyCode::Char('f') => Some(59),
        KeyCode::Char('t') => Some(60), KeyCode::Char('g') => Some(61),
        KeyCode::Char('y') => Some(62), KeyCode::Char('h') => Some(63),
        KeyCode::Char('u') => Some(64), KeyCode::Char('j') => Some(65),
        KeyCode::Char('k') => Some(66), KeyCode::Char('o') => Some(67),
        KeyCode::Char('l') => Some(68), KeyCode::Char('p') => Some(69),
        _ => None,
    }
}

fn main() {
    let host = cpal::default_host();
    let device = host.default_output_device().expect("no output device");
    let config = device.default_output_config().expect("no output config");
    let sample_rate = config.sample_rate().0 as f32;
    let channels = config.channels() as usize;

    println!("╔══════════════════════════════════════════════════════╗");
    println!("║  YAMA-BRUH Native Audio Test  (truly lock-free)     ║");
    println!("║  Audio: {:43}║", device.name().unwrap_or("?".into()));
    println!("║  Rate: {}Hz  Channels: {:28}║", sample_rate as u32, channels);
    println!("╠══════════════════════════════════════════════════════╣");
    println!("║  QWERTY keys = piano  |  SPACE = drums on/off       ║");
    println!("║  UP/DOWN = preset     |  Q = quit                   ║");
    println!("║  MIDI input: auto-connected (all ports)             ║");
    println!("║  Voice stealing: {} voices max                       ║", MAX_VOICES);
    println!("╚══════════════════════════════════════════════════════╝");

    let ring = Arc::new(CmdRing::new());
    let trace = Arc::new(TraceRing::new());
    let stats = Arc::new(Stats::new());

    // Engine lives on audio thread
    let ring_audio = Arc::clone(&ring);
    let trace_audio = Arc::clone(&trace);
    let stats_audio = Arc::clone(&stats);
    let mut engine = Engine::new(sample_rate, ring_audio, trace_audio, stats_audio);

    // Track callback health from outside
    let callback_count = Arc::new(AtomicU64::new(0));
    let callback_count_audio = Arc::clone(&callback_count);

    // Error flag for error callback
    let error_trace = Arc::clone(&trace);
    let error_samples = Arc::clone(&stats);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            device.build_output_stream(
                &config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    engine.process_buffer(data, channels);
                    callback_count_audio.fetch_add(1, Ordering::Relaxed);
                },
                move |err| {
                    let sc = error_samples.total_samples.load(Ordering::Relaxed);
                    error_trace.push(TraceEntry { tag: T_ERROR, sample_count: sc, i1: 0, f1: 0.0, f2: 0.0 });
                    eprintln!("\n[AUDIO ERROR] {}", err);
                },
                None,
            ).expect("failed to build stream")
        }
        _ => panic!("unsupported sample format"),
    };

    stream.play().expect("failed to play stream");

    // ── MIDI Input ──────────────────────────────────────────────────
    let mut _midi_connections = Vec::new();
    match MidiInput::new("yambruh-test") {
        Ok(mut midi_in) => {
            midi_in.ignore(Ignore::Sysex | Ignore::Time | Ignore::ActiveSense);
            let ports = midi_in.ports();
            if ports.is_empty() {
                eprintln!("[MIDI] No MIDI input ports found");
            }
            for port in &ports {
                let port_name = midi_in.port_name(port).unwrap_or("?".into());
                eprintln!("[MIDI] Connecting: {}", port_name);
                let ring_midi = Arc::clone(&ring);
                let mi = MidiInput::new("yambruh-test").unwrap();
                match mi.connect(port, &port_name, move |_ts, data, _| {
                    let mut buf = [0u8; 3];
                    let len = data.len().min(3);
                    buf[..len].copy_from_slice(&data[..len]);
                    ring_midi.push(cmd_midi_raw(buf, len));
                }, ()) {
                    Ok(conn) => {
                        eprintln!("[MIDI] Connected: {}", port_name);
                        _midi_connections.push(conn);
                    }
                    Err(e) => eprintln!("[MIDI] Failed: {}: {}", port_name, e),
                }
            }
        }
        Err(e) => eprintln!("[MIDI] Init failed: {}", e),
    }

    // ── Keyboard on SEPARATE THREAD (crossterm kills cpal on main thread) ──
    let quit_flag = Arc::new(AtomicU32::new(0));
    let quit_kb = Arc::clone(&quit_flag);
    let ring_kb = Arc::clone(&ring);

    std::thread::spawn(move || {
        terminal::enable_raw_mode().expect("failed to enable raw mode");
        let mut current_preset: u32 = 0;

        loop {
            if quit_kb.load(Ordering::Relaxed) != 0 { break; }
            if event::poll(std::time::Duration::from_millis(10)).unwrap_or(false) {
                if let Ok(Event::Key(key_event)) = event::read() {
                    if key_event.kind == KeyEventKind::Press {
                        match key_event.code {
                            KeyCode::Char('q') => {
                                quit_kb.store(1, Ordering::Relaxed);
                                break;
                            }
                            KeyCode::Char(' ') => {
                                ring_kb.push(cmd_seq_toggle());
                            }
                            KeyCode::Up => {
                                current_preset = (current_preset + 1).min(98);
                                ring_kb.push(cmd_set_preset(current_preset));
                            }
                            KeyCode::Down => {
                                current_preset = current_preset.saturating_sub(1);
                                ring_kb.push(cmd_set_preset(current_preset));
                            }
                            code => {
                                if let Some(note) = key_to_midi(code) {
                                    ring_kb.push(cmd_note_on(note, 0.7, current_preset));
                                }
                            }
                        }
                    } else if key_event.kind == KeyEventKind::Release {
                        if let Some(note) = key_to_midi(key_event.code) {
                            ring_kb.push(cmd_note_off(note));
                        }
                    }
                }
            }
        }
        terminal::disable_raw_mode().ok();
    });

    // ── Main thread: clean sleep loop (no crossterm!) ────────────────
    let mut last_callback_count: u64 = 0;
    let mut last_total_samples: u64 = 0;

    loop {
        if quit_flag.load(Ordering::Relaxed) != 0 { break; }

        std::thread::sleep(std::time::Duration::from_secs(5));

        let ts = stats.total_samples.load(Ordering::Relaxed);
        let cb = callback_count.load(Ordering::Relaxed);
        let secs = ts as f32 / sample_rate;
        let cb_delta = cb - last_callback_count;
        let ts_delta = ts - last_total_samples;
        last_callback_count = cb;
        last_total_samples = ts;
        let alive = if ts_delta > 0 { "OK" } else { "DEAD!" };

        let _ = write!(std::io::stderr(),
            "\n=== HEALTH {:.0}s | {} | cb:{} samp:{} v:{} d:{} pk:{:.3} nan:{} ===",
            secs, alive, cb_delta, ts_delta,
            stats.voice_count.load(Ordering::Relaxed),
            stats.drum_count.load(Ordering::Relaxed),
            stats.get_peak(),
            stats.nan_count.load(Ordering::Relaxed),
        );
        let _ = std::io::stderr().flush();
    }

    drop(stream);
    let secs = stats.total_samples.load(Ordering::Relaxed) as f32 / sample_rate;
    eprintln!("\n\nFinal: {:.1}s, {} NaN, peak: {:.4}",
        secs, stats.nan_count.load(Ordering::Relaxed), stats.get_peak());
}
