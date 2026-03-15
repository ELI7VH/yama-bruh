// Engine + cpal test — NO crossterm, NO MIDI, NO raw mode.
// Isolates whether the engine DSP itself kills the stream.
// Auto-plays a note every 2 seconds to keep audio active.

use std::sync::atomic::{AtomicU64, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use std::io::Write;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use yama_bruh::get_preset_data;

const TAU: f32 = 6.283185307179586;
const MAX_VOICES: usize = 16;

#[derive(Clone)]
struct Voice {
    note: i32, freq: f32, velocity: f32,
    cp: f32, mp: f32, pm: f32,
    es: u8, el: f32, et: f32, rl: f32,
    age: f32, p: [f32; 8],
}

// Minimal ring buffer
const RING_SIZE: usize = 64;
const RING_MASK: usize = RING_SIZE - 1;

#[derive(Clone, Copy)]
struct Cmd { tag: u8, note: i32, vel: f32, preset: u32 }

struct Ring {
    slots: [Cmd; RING_SIZE],
    head: AtomicUsize,
    tail: AtomicUsize,
}

impl Ring {
    fn new() -> Self {
        Ring {
            slots: [Cmd { tag: 0, note: 0, vel: 0.0, preset: 0 }; RING_SIZE],
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }
    fn push(&self, cmd: Cmd) {
        let head = self.head.load(Ordering::Relaxed);
        let next = (head + 1) & RING_MASK;
        if next == self.tail.load(Ordering::Acquire) { return; }
        let ptr = &self.slots[head] as *const Cmd as *mut Cmd;
        unsafe { ptr.write(cmd); }
        self.head.store(next, Ordering::Release);
    }
    fn pop(&self) -> Option<Cmd> {
        let tail = self.tail.load(Ordering::Relaxed);
        if tail == self.head.load(Ordering::Acquire) { return None; }
        let cmd = unsafe { std::ptr::read(&self.slots[tail]) };
        self.tail.store((tail + 1) & RING_MASK, Ordering::Release);
        Some(cmd)
    }
}

const NONE_VOICE: Option<Voice> = None;

struct Engine {
    voices: [Option<Voice>; MAX_VOICES],
    total_samples: u64,
    sr: f32,
    ring: Arc<Ring>,
    sample_count: Arc<AtomicU64>,
    callback_count: Arc<AtomicU64>,
    peak: f32,
}

impl Engine {
    fn new(sr: f32, ring: Arc<Ring>, sc: Arc<AtomicU64>, cc: Arc<AtomicU64>) -> Self {
        Engine {
            voices: [NONE_VOICE; MAX_VOICES],
            total_samples: 0, sr, ring,
            sample_count: sc, callback_count: cc,
            peak: 0.0,
        }
    }

    fn process(&mut self, data: &mut [f32], channels: usize) {
        // Drain commands
        while let Some(cmd) = self.ring.pop() {
            match cmd.tag {
                1 => { // NoteOn
                    let freq = 440.0 * libm::powf(2.0, (cmd.note as f32 - 69.0) / 12.0);
                    let preset = get_preset_data(cmd.preset);
                    // Find empty slot
                    for slot in &mut self.voices {
                        if slot.is_none() {
                            *slot = Some(Voice {
                                note: cmd.note, freq, velocity: cmd.vel,
                                cp: 0.0, mp: 0.0, pm: 0.0,
                                es: 0, el: 0.0, et: 0.0, rl: 0.0,
                                age: 0.0, p: preset,
                            });
                            break;
                        }
                    }
                }
                2 => { // NoteOff
                    for slot in &mut self.voices {
                        if let Some(ref mut v) = slot {
                            if v.note == cmd.note && v.es < 3 {
                                v.es = 3; v.et = 0.0; v.rl = v.el;
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        let sr = self.sr;
        let dt = 1.0 / sr;

        for frame in data.chunks_mut(channels) {
            let mut s: f32 = 0.0;

            for i in 0..MAX_VOICES {
                let alive = if let Some(ref mut v) = self.voices[i] {
                    let p = v.p;
                    v.age += dt;
                    if v.age > 10.0 { false }
                    else {
                        v.et += dt;
                        let env = match v.es {
                            0 => {
                                let e = if p[3] > 0.0001 { v.et / p[3] } else { 1.0 };
                                if e >= 1.0 { v.es = 1; v.et = 0.0; v.el = 1.0; 1.0 }
                                else { v.el = e; e }
                            }
                            1 => {
                                let t = if p[4] > 0.0001 { v.et / p[4] } else { 1.0 };
                                let e = if t >= 1.0 { v.es = 2; p[5] } else { 1.0 - (1.0 - p[5]) * t };
                                v.el = e; e
                            }
                            2 => { v.el = p[5]; p[5] }
                            _ => {
                                let t = if p[6] > 0.0001 { v.et / p[6] } else { 1.0 };
                                if t >= 1.0 { -1.0 } // signal dead
                                else { v.rl * (1.0 - t) }
                            }
                        };
                        if env < 0.0 { false }
                        else {
                            let ms = libm::sinf(v.mp + p[7] * v.pm);
                            v.pm = ms;
                            let sample = libm::sinf(v.cp + p[2] * ms) * env * v.velocity * 0.35;
                            if sample.is_nan() || !v.cp.is_finite() { false }
                            else {
                                s += sample;
                                v.cp += TAU * v.freq * p[0] / sr;
                                v.mp += TAU * v.freq * p[1] / sr;
                                if v.cp > TAU { v.cp -= TAU; }
                                if v.mp > TAU { v.mp -= TAU; }
                                true
                            }
                        }
                    }
                } else { true };
                if !alive && self.voices[i].is_some() {
                    self.voices[i] = None;
                }
            }

            s = s.clamp(-0.95, 0.95);
            if s.abs() > self.peak { self.peak = s.abs(); }
            self.total_samples += 1;
            for ch in frame.iter_mut() { *ch = s; }
        }

        self.sample_count.store(self.total_samples, Ordering::Relaxed);
        self.callback_count.fetch_add(1, Ordering::Relaxed);
    }
}

fn main() {
    let host = cpal::default_host();
    let device = host.default_output_device().expect("no output device");
    let config = device.default_output_config().expect("no output config");
    let sr = config.sample_rate().0 as f32;
    let ch = config.channels() as usize;

    eprintln!("=== ENGINE TEST (no crossterm, no MIDI) ===");
    eprintln!("Device: {}  Rate: {}  Ch: {}", device.name().unwrap_or("?".into()), sr, ch);
    eprintln!("Auto-plays notes. Should run forever. Ctrl+C to stop.\n");

    let ring = Arc::new(Ring::new());
    let sc = Arc::new(AtomicU64::new(0));
    let cc = Arc::new(AtomicU64::new(0));

    let ring_audio = Arc::clone(&ring);
    let sc_audio = Arc::clone(&sc);
    let cc_audio = Arc::clone(&cc);
    let mut engine = Engine::new(sr, ring_audio, sc_audio, cc_audio);

    let stream = device.build_output_stream(
        &config.into(),
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            engine.process(data, ch);
        },
        |err| eprintln!("[ERROR] {}", err),
        None,
    ).expect("build stream");

    stream.play().expect("play");

    let notes = [60, 64, 67, 72, 67, 64]; // C major arpeggio
    let mut note_idx = 0;
    let mut last_note: i32 = -1;

    loop {
        // Play a note
        if last_note >= 0 {
            ring.push(Cmd { tag: 2, note: last_note, vel: 0.0, preset: 0 });
        }
        let note = notes[note_idx % notes.len()];
        ring.push(Cmd { tag: 1, note, vel: 0.7, preset: 0 });
        last_note = note;
        note_idx += 1;

        std::thread::sleep(std::time::Duration::from_millis(500));

        let samples = sc.load(Ordering::Relaxed);
        let callbacks = cc.load(Ordering::Relaxed);
        let secs = samples as f32 / sr;
        eprint!("\r[{:.1}s] samples:{} callbacks:{} note:{}   ", secs, samples, callbacks, note);
        let _ = std::io::stderr().flush();
    }
}
