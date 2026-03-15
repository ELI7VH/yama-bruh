# YAMA-BRUH

WebAssembly 2-op FM synth ringtone generator. Generates deterministic 3-5 tone ringtones from unique IDs using a seeded PRNG and FM synthesis — 99 presets inspired by 90s Yamaha keyboards.

**[Synth Demo →](https://yama-bruh.lucianlabs.ca/)** · **[Ringtones Demo →](https://yama-bruh.lucianlabs.ca/ringtones.html)**

## Notification Engine

Drop-in ringtone player for any site. Pure JS, no WASM, no dependencies.

```html
<script src="https://yama-bruh.lucianlabs.ca/yamabruh-notify.js"></script>
<script>
  const notify = new YamaBruhNotify({
    seed: 'my-app.example.com',  // deterministic per-app ringtones
    preset: 88,                   // Telephone (0-98)
  });

  // Play a deterministic ringtone from any ID
  notify.play('user-abc123');

  // Play a random one-off ringtone
  notify.play();

  // Override defaults per-call
  notify.play('order-456', { preset: 60, bpm: 160, volume: 0.5 });
</script>
```

Same seed + same ID = same ringtone every time, across all devices.

## The Prompt

> make me a web assembly plugin. the purpose is to generate a 3-5 tone ringtone from a random seed. this will be used to generate ringtones based on unique ids.
> loose spec:
> should follow a pentatonic with accidentals. key: F#m
> randomize the duration of the notes between 1/8,1/4,1/2,1,2 beats.
> should follow a relative +- 0,2,3,4,6 semitone pattern
> it should be a simple 2 op fm synth with 99 presets - think 90s yamaha keyboards, as well, the user can send a config schema of floats to customize it - this is the sound used to generate the following: a web ui that shows 5 randomized on load unique ids with a button which fires the ringtone, as well as 5 text fields (localstorage) that the user can test. the ui should have a keypad like on those vintage keyboard and an LCD showing the current preset, allow the user to connect a midi device to play the selected sound.
> make the ui look weathered as though its made of the cheap plastic that's been moved around for 30 years. use glsl on the entire page to add texture and responsiveness.
> pressing the keys should use the plugin to generate sfx feedback for the user.

## Architecture

- **WASM Core** (Rust → `yama_bruh.wasm`, 7.5KB): Seeded PRNG, F#m pentatonic sequence generation, 2-op FM synthesis with 99 presets, audio buffer rendering
- **Standalone Notify Engine** (`yamabruh-notify.js`): Pure JS FM synth, no WASM dependency, all 99 presets embedded, drop-in `<script>` tag
- **Web Audio API**: Real-time FM synth for keyboard/MIDI playback with low latency
- **GLSL Shader**: Full-page WebGL shader generating weathered plastic texture with mouse-responsive specular highlights and key-press flash
- **Web MIDI API**: Connect any MIDI controller to play through the selected preset
- **Native Binary** (Rust/cpal): Standalone audio engine with WASAPI output, crossterm TUI on separate thread

## Preset Categories

| Range | Category |
|-------|----------|
| 01-10 | Piano / Electric Piano |
| 11-20 | Organ |
| 21-30 | Brass |
| 31-40 | Strings / Pad |
| 41-50 | Bass |
| 51-60 | Lead |
| 61-70 | Bell / Mallet |
| 71-80 | Reed / Pipe |
| 81-90 | SFX |
| 91-99 | Retro / Digital |

## Build

```bash
# Requires: rustup target add wasm32-unknown-unknown
./build.sh
# Serve www/ with any static server
```

## Custom Preset Config

Send a config object to `synth.setCustomParams()`:

```js
synth.setCustomParams({
  carrierRatio: 1.0,  // Carrier frequency multiplier
  modRatio: 2.0,      // Modulator frequency ratio
  modIndex: 3.5,      // FM modulation depth
  attack: 0.01,       // Attack time (seconds)
  decay: 0.3,         // Decay time (seconds)
  sustain: 0.4,       // Sustain level (0-1)
  release: 0.2,       // Release time (seconds)
  feedback: 0.1,      // Modulator self-feedback (0-1)
});
```
