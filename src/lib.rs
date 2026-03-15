#![no_std]

use core::panic::PanicInfo;
use libm::{powf, sinf};

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    loop {}
}

const TWO_PI: f32 = 6.28318530717959;
const MAX_SAMPLES: usize = 441000; // 10s @ 44100
const MAX_NOTES: usize = 10;

static mut SAMPLE_BUF: [f32; MAX_SAMPLES] = [0.0; MAX_SAMPLES];
static mut SAMPLE_LEN: u32 = 0;
static mut NOTE_BUF: [f32; MAX_NOTES * 2] = [0.0; MAX_NOTES * 2];
static mut NOTE_COUNT: u32 = 0;
static mut CUSTOM_PRESET: [f32; 8] = [1.0, 1.0, 2.0, 0.01, 0.3, 0.3, 0.2, 0.0];
static mut INPUT_BUF: [u8; 1024] = [0; 1024];

// ── PRNG ──────────────────────────────────────────────────────────────
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Self {
        Self(if seed == 0 { 1 } else { seed })
    }
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
    fn range(&mut self, n: u32) -> u32 {
        self.next() % n
    }
}

// ── Helpers ───────────────────────────────────────────────────────────
fn midi_to_freq(note: f32) -> f32 {
    440.0 * powf(2.0, (note - 69.0) / 12.0)
}

// ── 99 Presets ────────────────────────────────────────────────────────
// [carrier_ratio, mod_ratio, mod_index, attack, decay, sustain, release, feedback]
// Categories: 0=Piano 1=Organ 2=Brass 3=Strings 4=Bass 5=Lead 6=Bell 7=Reed 8=SFX 9=Retro
fn get_preset_data(index: u32) -> [f32; 8] {
    let cat = index / 10;
    let v = (index % 10) as f32 / 9.0;
    match cat {
        // Piano / E.Piano — fast attack, moderate decay, low-mid mod index
        0 => [
            1.0 + v * 0.5,
            1.0 + v * 3.0,
            2.0 + v * 3.0,
            0.001,
            0.3 + v * 0.5,
            0.1 + v * 0.15,
            0.2 + v * 0.3,
            v * 0.08,
        ],
        // Organ — sustained, integer ratios, drawbar feel
        1 => [
            1.0,
            1.0 + (v * 4.0) as u32 as f32,
            0.8 + v * 2.5,
            0.005,
            0.05,
            0.85 - v * 0.15,
            0.08,
            0.1 + v * 0.25,
        ],
        // Brass — slow attack ramp, high mod index, beefy
        2 => [
            1.0,
            1.0 + v * 1.0,
            3.0 + v * 5.0,
            0.03 + v * 0.08,
            0.2 + v * 0.3,
            0.45 + v * 0.35,
            0.2 + v * 0.4,
            0.15 + v * 0.2,
        ],
        // Strings / Pad — very slow attack, low mod, lush sustain
        3 => [
            1.0,
            2.0 + v * 2.0,
            0.5 + v * 2.0,
            0.12 + v * 0.4,
            0.5 + v * 1.0,
            0.6 + v * 0.3,
            0.6 + v * 1.5,
            v * 0.08,
        ],
        // Bass — sub frequencies, fast decay, punchy
        4 => [
            0.5 + v * 0.5,
            1.0 + v * 2.0,
            3.0 + v * 5.0,
            0.001,
            0.15 + v * 0.25,
            0.1 + v * 0.25,
            0.08 + v * 0.15,
            0.2 + v * 0.35,
        ],
        // Lead — singing, sustained, bright
        5 => [
            1.0 + v * 0.5,
            1.0 + v * 3.0,
            2.0 + v * 6.0,
            0.01 + v * 0.04,
            0.1 + v * 0.15,
            0.55 + v * 0.35,
            0.25 + v * 0.4,
            0.1 + v * 0.3,
        ],
        // Bell / Mallet — inharmonic ratios, no sustain, long release
        6 => [
            1.0,
            1.41 + v * 5.6,
            2.5 + v * 8.0,
            0.001,
            1.0 + v * 2.5,
            0.0,
            0.8 + v * 2.5,
            v * 0.04,
        ],
        // Reed / Pipe — integer ratios, moderate mod, airy
        7 => [
            1.0,
            1.0 + (v * 3.0) as u32 as f32,
            1.5 + v * 3.5,
            0.02 + v * 0.04,
            0.08 + v * 0.12,
            0.6 + v * 0.3,
            0.15 + v * 0.25,
            0.2 + v * 0.35,
        ],
        // SFX — wild parameters, experimental
        8 => [
            0.5 + v * 3.5,
            0.25 + v * 7.75,
            4.0 + v * 8.0,
            v * 0.5,
            v * 2.0,
            v * 0.5,
            0.5 + v * 3.5,
            0.3 + v * 0.7,
        ],
        // Retro / Digital — chiptune vibes, harsh, clicky
        _ => [
            1.0 + v * 2.0,
            2.0 + v * 4.0,
            1.0 + v * 4.0,
            0.001,
            0.05 + v * 0.1,
            0.2 + v * 0.3,
            0.05 + v * 0.1,
            0.3 + v * 0.5,
        ],
    }
}

// ── FM Synthesis Core ─────────────────────────────────────────────────
fn render_fm_note(
    freq: f32,
    duration: f32,
    preset: &[f32; 8],
    sample_rate: f32,
    buf: &mut [f32],
    offset: usize,
    velocity: f32,
) -> usize {
    let cr = preset[0];
    let mr = preset[1];
    let mi = preset[2];
    let attack = preset[3];
    let decay = preset[4];
    let sustain = preset[5];
    let release = preset[6];
    let feedback = preset[7];

    let carrier_freq = freq * cr;
    let mod_freq = freq * mr;

    let total_samples = ((duration + release) * sample_rate) as usize;
    let note_samples = (duration * sample_rate) as usize;
    let attack_samples = (attack * sample_rate) as usize;
    let decay_samples = (decay * sample_rate) as usize;

    let mut carrier_phase: f32 = 0.0;
    let mut mod_phase: f32 = 0.0;
    let mut prev_mod: f32 = 0.0;

    let available = if offset < buf.len() {
        buf.len() - offset
    } else {
        return 0;
    };
    let count = if total_samples < available {
        total_samples
    } else {
        available
    };

    let mut i = 0;
    while i < count {
        // ADSR envelope
        let env = if i < attack_samples {
            i as f32 / (if attack_samples > 0 { attack_samples } else { 1 }) as f32
        } else if i < attack_samples + decay_samples {
            let t = (i - attack_samples) as f32
                / (if decay_samples > 0 { decay_samples } else { 1 }) as f32;
            1.0 - (1.0 - sustain) * t
        } else if i < note_samples {
            sustain
        } else {
            let rel_max = if release * sample_rate > 1.0 {
                release * sample_rate
            } else {
                1.0
            };
            let t = (i - note_samples) as f32 / rel_max;
            let r = sustain * (1.0 - t);
            if r > 0.0 { r } else { 0.0 }
        };

        // 2-op FM
        let mod_signal = sinf(mod_phase + feedback * prev_mod);
        prev_mod = mod_signal;
        let carrier_signal = sinf(carrier_phase + mi * mod_signal);

        buf[offset + i] += carrier_signal * env * velocity * 0.45;

        carrier_phase += TWO_PI * carrier_freq / sample_rate;
        mod_phase += TWO_PI * mod_freq / sample_rate;

        if carrier_phase > TWO_PI {
            carrier_phase -= TWO_PI;
        }
        if mod_phase > TWO_PI {
            mod_phase -= TWO_PI;
        }

        i += 1;
    }

    count
}

// ── Exported API ──────────────────────────────────────────────────────

#[no_mangle]
pub extern "C" fn get_sample_buffer_ptr() -> *const f32 {
    unsafe { SAMPLE_BUF.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_note_buffer_ptr() -> *const f32 {
    unsafe { NOTE_BUF.as_ptr() }
}

#[no_mangle]
pub extern "C" fn get_input_buffer_ptr() -> *mut u8 {
    unsafe { INPUT_BUF.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn get_sample_len() -> u32 {
    unsafe { SAMPLE_LEN }
}

#[no_mangle]
pub extern "C" fn get_note_count() -> u32 {
    unsafe { NOTE_COUNT }
}

#[no_mangle]
pub extern "C" fn get_preset_param(preset: u32, param: u32) -> f32 {
    let idx = if preset > 98 { 98 } else { preset };
    let pidx = if param > 7 { 7 } else { param };
    let p = get_preset_data(idx);
    p[pidx as usize]
}

#[no_mangle]
pub extern "C" fn set_custom_param(param: u32, value: f32) {
    let pidx = if param > 7 { 7 } else { param };
    unsafe {
        CUSTOM_PRESET[pidx as usize] = value;
    }
}

/// Hash a string in INPUT_BUF to a u32 seed (djb2)
#[no_mangle]
pub extern "C" fn hash_input(len: u32) -> u32 {
    let n = if len > 1024 { 1024 } else { len };
    let mut hash: u32 = 5381;
    unsafe {
        let mut i: u32 = 0;
        while i < n {
            let c = INPUT_BUF[i as usize] as u32;
            hash = (hash.wrapping_shl(5).wrapping_add(hash)).wrapping_add(c);
            i += 1;
        }
    }
    hash
}

/// Generate a note sequence from seed. Returns note count.
/// Writes pairs of [midi_note, duration_beats] into NOTE_BUF.
#[no_mangle]
pub extern "C" fn generate_sequence(seed: u32, num_notes: u32) -> u32 {
    let n = if num_notes > MAX_NOTES as u32 {
        MAX_NOTES as u32
    } else if num_notes < 3 {
        3
    } else {
        num_notes
    };

    let mut rng = Rng::new(seed);

    // Start on F# in a random octave (F#3=54, F#4=66, F#5=78)
    let octave_offset = rng.range(3) * 12;
    let mut current_note: i32 = 54 + octave_offset as i32;

    // Relative movements: 0, ±2, ±3, ±4, ±6
    let movements: [i32; 9] = [0, 2, -2, 3, -3, 4, -4, 6, -6];
    // Duration options in beats
    let durations: [f32; 5] = [0.125, 0.25, 0.5, 1.0, 2.0];

    unsafe {
        let mut i: u32 = 0;
        while i < n {
            let mv = movements[rng.range(9) as usize];
            current_note += mv;

            // Clamp to reasonable MIDI range
            if current_note < 42 {
                current_note += 12;
            }
            if current_note > 84 {
                current_note -= 12;
            }

            let dur = durations[rng.range(5) as usize];

            NOTE_BUF[(i * 2) as usize] = current_note as f32;
            NOTE_BUF[(i * 2 + 1) as usize] = dur;
            i += 1;
        }
        NOTE_COUNT = n;
    }
    n
}

/// Render a complete ringtone into SAMPLE_BUF. Returns sample count.
#[no_mangle]
pub extern "C" fn render_ringtone(
    seed: u32,
    preset_idx: u32,
    bpm: f32,
    sample_rate: f32,
) -> u32 {
    // Generate 3-5 notes from seed
    let num_notes = 3 + (seed % 3);
    generate_sequence(seed, num_notes);

    let pidx = if preset_idx > 98 { 98 } else { preset_idx };
    let preset = get_preset_data(pidx);
    let beat_duration = 60.0 / bpm;

    unsafe {
        // Clear buffer
        let mut j = 0;
        while j < MAX_SAMPLES {
            SAMPLE_BUF[j] = 0.0;
            j += 1;
        }

        let mut offset: usize = 0;
        let mut i: u32 = 0;
        while i < NOTE_COUNT {
            let midi_note = NOTE_BUF[(i * 2) as usize];
            let duration_beats = NOTE_BUF[(i * 2 + 1) as usize];
            let freq = midi_to_freq(midi_note);
            let duration_secs = duration_beats * beat_duration;

            render_fm_note(
                freq,
                duration_secs,
                &preset,
                sample_rate,
                &mut SAMPLE_BUF,
                offset,
                0.8,
            );
            offset += (duration_secs * sample_rate) as usize;
            i += 1;
        }

        // Include release tail
        let total = offset as f32 + preset[6] * sample_rate;
        SAMPLE_LEN = if (total as u32) < MAX_SAMPLES as u32 {
            total as u32
        } else {
            MAX_SAMPLES as u32
        };
        SAMPLE_LEN
    }
}

/// Render a single note. Returns sample count.
#[no_mangle]
pub extern "C" fn render_note(
    freq: f32,
    duration: f32,
    preset_idx: u32,
    sample_rate: f32,
    velocity: f32,
) -> u32 {
    let preset = if preset_idx >= 200 {
        unsafe { CUSTOM_PRESET }
    } else {
        let idx = if preset_idx > 98 { 98 } else { preset_idx };
        get_preset_data(idx)
    };

    unsafe {
        let mut j = 0;
        while j < MAX_SAMPLES {
            SAMPLE_BUF[j] = 0.0;
            j += 1;
        }
        let count = render_fm_note(freq, duration, &preset, sample_rate, &mut SAMPLE_BUF, 0, velocity);
        SAMPLE_LEN = count as u32;
        count as u32
    }
}
