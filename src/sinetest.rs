// Bare minimum cpal sine wave test.
// If this dies after a few seconds, it's a cpal/WASAPI issue.
// If this runs forever, something in our synth engine kills it.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

fn main() {
    let host = cpal::default_host();
    let device = host.default_output_device().expect("no output device");
    let config = device.default_output_config().expect("no output config");
    let sample_rate = config.sample_rate().0 as f32;
    let channels = config.channels() as usize;

    eprintln!("=== BARE SINE TEST ===");
    eprintln!("Device: {}", device.name().unwrap_or("?".into()));
    eprintln!("Rate: {}  Channels: {}", sample_rate, channels);
    eprintln!("Press Ctrl+C to stop. Audio should play forever.");
    eprintln!();

    let sample_count = Arc::new(AtomicU64::new(0));
    let sample_count_audio = Arc::clone(&sample_count);

    let mut phase: f32 = 0.0;
    let freq: f32 = 440.0;
    let tau: f32 = 6.283185307;

    let stream = device.build_output_stream(
        &config.into(),
        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
            let inc = freq * tau / sample_rate;
            for frame in data.chunks_mut(channels) {
                let sample = libm::sinf(phase) * 0.2;
                phase += inc;
                if phase > tau { phase -= tau; }
                for ch in frame.iter_mut() {
                    *ch = sample;
                }
            }
            sample_count_audio.fetch_add((data.len() / channels) as u64, Ordering::Relaxed);
        },
        |err| eprintln!("[ERROR] {}", err),
        None,
    ).expect("failed to build stream");

    stream.play().expect("failed to play");

    // Keep alive — just print health every second
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let sc = sample_count.load(Ordering::Relaxed);
        let secs = sc as f32 / sample_rate;
        eprint!("\r[{:.1}s] samples: {}   ", secs, sc);
        let _ = std::io::Write::flush(&mut std::io::stderr());
    }
}
