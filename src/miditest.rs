// Engine + MIDI test — NO crossterm.
// Tests if midir COM init conflicts with cpal WASAPI.

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::io::Write;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use midir::{MidiInput, Ignore};
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

const RING_SIZE: usize = 64;
const RING_MASK: usize = RING_SIZE - 1;
#[derive(Clone, Copy)]
struct Cmd { tag: u8, data: [u8; 3], vel: f32, preset: u32 }
struct Ring {
    slots: [Cmd; RING_SIZE],
    head: AtomicUsize, tail: AtomicUsize,
}
impl Ring {
    fn new() -> Self {
        Ring {
            slots: [Cmd { tag: 0, data: [0;3], vel: 0.0, preset: 0 }; RING_SIZE],
            head: AtomicUsize::new(0), tail: AtomicUsize::new(0),
        }
    }
    fn push(&self, cmd: Cmd) {
        let h = self.head.load(Ordering::Relaxed);
        let n = (h + 1) & RING_MASK;
        if n == self.tail.load(Ordering::Acquire) { return; }
        let ptr = &self.slots[h] as *const Cmd as *mut Cmd;
        unsafe { ptr.write(cmd); }
        self.head.store(n, Ordering::Release);
    }
    fn pop(&self) -> Option<Cmd> {
        let t = self.tail.load(Ordering::Relaxed);
        if t == self.head.load(Ordering::Acquire) { return None; }
        let cmd = unsafe { std::ptr::read(&self.slots[t]) };
        self.tail.store((t + 1) & RING_MASK, Ordering::Release);
        Some(cmd)
    }
}

const NONE_VOICE: Option<Voice> = None;

struct Engine {
    voices: [Option<Voice>; MAX_VOICES],
    total_samples: u64,
    sr: f32,
    ring: Arc<Ring>,
    sc: Arc<AtomicU64>,
    cc: Arc<AtomicU64>,
}

impl Engine {
    fn new(sr: f32, ring: Arc<Ring>, sc: Arc<AtomicU64>, cc: Arc<AtomicU64>) -> Self {
        Engine { voices: [NONE_VOICE; MAX_VOICES], total_samples: 0, sr, ring, sc, cc }
    }
    fn process(&mut self, data: &mut [f32], channels: usize) {
        while let Some(cmd) = self.ring.pop() {
            match cmd.tag {
                1 => { // NoteOn
                    let note = cmd.data[0] as i32;
                    let freq = 440.0 * libm::powf(2.0, (note as f32 - 69.0) / 12.0);
                    let preset = get_preset_data(cmd.preset);
                    for slot in &mut self.voices {
                        if slot.is_none() {
                            *slot = Some(Voice {
                                note, freq, velocity: cmd.vel,
                                cp: 0.0, mp: 0.0, pm: 0.0,
                                es: 0, el: 0.0, et: 0.0, rl: 0.0,
                                age: 0.0, p: preset,
                            });
                            break;
                        }
                    }
                }
                2 => { // NoteOff
                    let note = cmd.data[0] as i32;
                    for slot in &mut self.voices {
                        if let Some(ref mut v) = slot {
                            if v.note == note && v.es < 3 { v.es = 3; v.et = 0.0; v.rl = v.el; }
                        }
                    }
                }
                3 => { // MIDI raw
                    let d = cmd.data;
                    let status = d[0] & 0xf0;
                    let note = d[1];
                    let vel = d[2];
                    if status == 0x90 && vel > 0 {
                        let freq = 440.0 * libm::powf(2.0, (note as f32 - 69.0) / 12.0);
                        let preset = get_preset_data(0);
                        for slot in &mut self.voices {
                            if slot.is_none() {
                                *slot = Some(Voice {
                                    note: note as i32, freq, velocity: vel as f32 / 127.0,
                                    cp: 0.0, mp: 0.0, pm: 0.0,
                                    es: 0, el: 0.0, et: 0.0, rl: 0.0,
                                    age: 0.0, p: preset,
                                });
                                break;
                            }
                        }
                    } else if status == 0x80 || (status == 0x90 && vel == 0) {
                        for slot in &mut self.voices {
                            if let Some(ref mut v) = slot {
                                if v.note == note as i32 && v.es < 3 { v.es = 3; v.et = 0.0; v.rl = v.el; }
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
                    v.age += dt; v.et += dt;
                    if v.age > 10.0 { false }
                    else {
                        let env = match v.es {
                            0 => { let e = if p[3]>0.0001 { v.et/p[3] } else { 1.0 }; if e>=1.0 { v.es=1; v.et=0.0; v.el=1.0; 1.0 } else { v.el=e; e } }
                            1 => { let t = if p[4]>0.0001 { v.et/p[4] } else { 1.0 }; let e = if t>=1.0 { v.es=2; p[5] } else { 1.0-(1.0-p[5])*t }; v.el=e; e }
                            2 => { v.el=p[5]; p[5] }
                            _ => { let t = if p[6]>0.0001 { v.et/p[6] } else { 1.0 }; if t>=1.0 { -1.0 } else { v.rl*(1.0-t) } }
                        };
                        if env < 0.0 { false }
                        else {
                            let ms = libm::sinf(v.mp + p[7]*v.pm); v.pm = ms;
                            let sample = libm::sinf(v.cp + p[2]*ms) * env * v.velocity * 0.35;
                            if sample.is_nan() || !v.cp.is_finite() { false }
                            else { s += sample; v.cp += TAU*v.freq*p[0]/sr; v.mp += TAU*v.freq*p[1]/sr; if v.cp>TAU { v.cp-=TAU; } if v.mp>TAU { v.mp-=TAU; } true }
                        }
                    }
                } else { true };
                if !alive && self.voices[i].is_some() { self.voices[i] = None; }
            }
            s = s.clamp(-0.95, 0.95);
            self.total_samples += 1;
            for ch in frame.iter_mut() { *ch = s; }
        }
        self.sc.store(self.total_samples, Ordering::Relaxed);
        self.cc.fetch_add(1, Ordering::Relaxed);
    }
}

fn main() {
    let host = cpal::default_host();
    let device = host.default_output_device().expect("no output device");
    let config = device.default_output_config().expect("no output config");
    let sr = config.sample_rate().0 as f32;
    let channels = config.channels() as usize;

    eprintln!("=== ENGINE + MIDI TEST (no crossterm) ===");
    eprintln!("Device: {}  Rate: {}  Ch: {}", device.name().unwrap_or("?".into()), sr, channels);

    let ring = Arc::new(Ring::new());
    let sc = Arc::new(AtomicU64::new(0));
    let cc = Arc::new(AtomicU64::new(0));

    let ring_a = Arc::clone(&ring);
    let sc_a = Arc::clone(&sc);
    let cc_a = Arc::clone(&cc);
    let mut engine = Engine::new(sr, ring_a, sc_a, cc_a);

    let stream = device.build_output_stream(
        &config.into(),
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| { engine.process(data, channels); },
        |err| eprintln!("[ERROR] {}", err),
        None,
    ).expect("build stream");
    stream.play().expect("play");

    // Connect MIDI
    let mut _midi_conns = Vec::new();
    let midi_count = Arc::new(AtomicU64::new(0));
    match MidiInput::new("miditest") {
        Ok(mut midi_in) => {
            midi_in.ignore(Ignore::Sysex | Ignore::Time | Ignore::ActiveSense);
            let ports = midi_in.ports();
            eprintln!("[MIDI] Found {} ports", ports.len());
            for port in &ports {
                let name = midi_in.port_name(port).unwrap_or("?".into());
                eprintln!("[MIDI] Connecting: {}", name);
                let ring_m = Arc::clone(&ring);
                let mc = Arc::clone(&midi_count);
                let mi = MidiInput::new("miditest").unwrap();
                match mi.connect(port, &name, move |_ts, data, _| {
                    let mut buf = [0u8; 3];
                    let len = data.len().min(3);
                    buf[..len].copy_from_slice(&data[..len]);
                    ring_m.push(Cmd { tag: 3, data: buf, vel: 0.0, preset: 0 });
                    mc.fetch_add(1, Ordering::Relaxed);
                }, ()) {
                    Ok(conn) => { eprintln!("[MIDI] Connected: {}", name); _midi_conns.push(conn); }
                    Err(e) => eprintln!("[MIDI] Failed: {}: {}", name, e),
                }
            }
        }
        Err(e) => eprintln!("[MIDI] Init failed: {}", e),
    }

    eprintln!("\nAuto-playing arpeggio + listening for MIDI. Ctrl+C to stop.\n");

    let notes = [60, 64, 67, 72, 67, 64];
    let mut ni = 0;
    let mut last: i32 = -1;

    loop {
        if last >= 0 { ring.push(Cmd { tag: 2, data: [last as u8, 0, 0], vel: 0.0, preset: 0 }); }
        let n = notes[ni % notes.len()];
        ring.push(Cmd { tag: 1, data: [n as u8, 0, 0], vel: 0.7, preset: 0 });
        last = n; ni += 1;

        std::thread::sleep(std::time::Duration::from_millis(500));
        let secs = sc.load(Ordering::Relaxed) as f32 / sr;
        let alive = if sc.load(Ordering::Relaxed) > 0 { "OK" } else { "DEAD" };
        eprint!("\r[{:.1}s] {} | cb:{} midi:{} note:{}   ",
            secs, alive, cc.load(Ordering::Relaxed), midi_count.load(Ordering::Relaxed), n);
        let _ = std::io::stderr().flush();
    }
}
