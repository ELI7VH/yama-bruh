# YAMA-BRUH

![YAMA-BRUH](https://lucianlabs.ca/blog/img/yama-bruh/nameplate.webp)

WebAssembly 2-op FM synth ringtone generator. Generates deterministic 3-5 tone ringtones from unique IDs using a seeded PRNG and FM synthesis — 99 presets inspired by 90s Yamaha keyboards, plus a full per-operator OPLL engine matching the YM2413 chip.

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

## Swift Package (iOS / macOS / watchOS)

Add via SPM for generative notification sounds in any Apple app:

```swift
// Package.swift
dependencies: [
    .package(url: "https://github.com/ELI7VH/yama-bruh", branch: "main"),
]
```

Two-tier seeding: **app seed** selects the timbre (which FM preset), **ID seed** selects the melody. Same app always sounds like the same instrument family.

```swift
import YamaBruh

// Generate a WAV from a task/message ID — deterministic
let wav = Ringtone.generate(from: "task-abc-123", appIdentifier: "ca.lucianlabs.groundcontrol")
try wav.write(to: fileURL)

// Numeric seeds for direct control
let wav = Ringtone.generate(seed: 42, appSeed: 99)

// Override the preset instead of deriving from app seed
let wav = Ringtone.generate(seed: 42, presetIndex: 88) // Telephone
```

### OPLL Engine (Per-Operator FM)

The package includes a full per-operator FM engine matching the Yamaha YM2413 (OPLL) chip: separate ADSR per operator, waveform select (sine / half-rectified sine), vibrato and tremolo LFOs, percussive envelope mode, and modulator self-feedback. All ringtone generation now renders through this engine.

```swift
// Use a specific OPLL preset (e.g. PSS-170 Ghost voice)
let ghost = OPLLPreset.fromRegisters([0xE2, 0x21, 0x17, 0x00, 0xF0, 0x54, 0x00, 0xF4])
let wav = Ringtone.generate(from: "notification-id", preset: ghost)

// Build a custom per-operator preset
let patch = OPLLPreset(
    modulator: OPLLOperator(mult: 2, attack: 0.001, decay: 0.5, sustainLevel: 0.3,
                            release: 1.0, waveform: 1, vibrato: true, tremolo: true, sustained: true),
    carrier: OPLLOperator(mult: 1, attack: 0.6, decay: 6.0, sustainLevel: 0.01,
                          release: 6.0, sustained: true),
    modDepth: 3.15,
    feedback: 0.0
)
let wav = Ringtone.generate(seed: 42, preset: patch)

// Convert raw YM2413 register dumps (8 bytes: R#00-R#07)
let humanVoice = OPLLPreset.fromRegisters([0xE1, 0x23, 0x10, 0x10, 0x77, 0x54, 0x93, 0xF4])
let wave = OPLLPreset.fromRegisters([0x22, 0x20, 0x02, 0x07, 0xFF, 0x21, 0x00, 0xF3])
let synthTom = OPLLPreset.fromRegisters([0x11, 0x01, 0x10, 0x07, 0xFA, 0xF7, 0xF0, 0x47])
```

Register data for PSS-170/PSS-270 voices captured by [plgDavid](https://github.com/plgDavid/misc/tree/master/OPLL%20Synth%20Patches) via logic analyzer on the YM2413 data bus.

For iOS notifications, write the WAV to `Library/Sounds/` and reference it via `UNNotificationSound(named:)`.

### API

| Type | Purpose |
|------|---------|
| `Ringtone.generate(seed:appSeed:presetIndex:bpm:sampleRate:)` | Generate WAV `Data` from numeric seeds |
| `Ringtone.generate(from:appIdentifier:presetIndex:bpm:sampleRate:)` | Generate from string identifiers (DJB2 hashed) |
| `Ringtone.generate(seed:appSeed:preset:bpm:sampleRate:)` | Generate with a specific `OPLLPreset` |
| `OPLLSynth.renderNote(freq:duration:preset:sampleRate:buffer:offset:velocity:)` | Render a single note with per-operator envelopes |
| `OPLLPreset.fromRegisters(_:)` | Convert raw YM2413 register bytes to a preset |
| `OPLLPreset(_ legacy:)` | Convert a legacy `FMPreset` to OPLL format |
| `FMSynth.renderNote(freq:duration:preset:sampleRate:buffer:offset:velocity:)` | Legacy: render a single FM note (shared ADSR) |
| `SequenceGenerator.generate(seed:)` | Get the deterministic note sequence for a seed |
| `SequenceGenerator.djb2Hash(_:)` | Hash a string to a UInt32 seed |
| `WavWriter.encode(samples:sampleRate:channels:)` | Encode a float buffer as 16-bit PCM WAV |
| `FMPresets.all` | All 99 legacy presets |
| `FMPresets.preset(at:)` | Get a legacy preset by index (clamped) |

### OPLL Operator Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| `mult` | 0.5, 1-15 | Frequency multiplier |
| `attack` | seconds | Attack time |
| `decay` | seconds | Decay time |
| `sustainLevel` | 0-1 | Sustain amplitude |
| `release` | seconds | Release time |
| `waveform` | 0-1 | 0=sine, 1=half-rectified sine |
| `vibrato` | bool | 6.4 Hz pitch LFO |
| `tremolo` | bool | 3.7 Hz amplitude LFO |
| `sustained` | bool | true=sustained envelope, false=percussive (auto-release) |

Top-level preset parameters: `modDepth` (radians of phase deviation), `feedback` (modulator self-feedback in radians).

## iOS App

The `app/` directory contains an iOS app and AUv3 Audio Unit instrument extension, both sharing the OPLL kernel:

- **Tone Generator**: seed-based ringtone creation with waveform preview and .m4r export
- **Preset Browser**: all 99 classic presets + PSS-170 bank (100 voices from register dumps)
- **Preset Editor**: per-operator ADSR, waveform, vibrato/tremolo, percussive mode toggles
- **AUv3 Instrument**: polyphonic FM synth playable in GarageBand, Logic, AUM
- **IAP**: Full Synth, AUv3, Bundle, plus add-on preset banks

Build with [XcodeGen](https://github.com/yonaskolb/XcodeGen): `cd app && xcodegen generate`

## Architecture

- **Swift Package** (`Sources/YamaBruh/`): OPLL-accurate FM engine, 99 legacy presets, seed-based sequence generation, WAV encoding. No dependencies. iOS 16+ / macOS 13+ / watchOS 9+.
- **iOS App** (`app/`): Two-target XcodeGen project (app + AUv3 extension), StoreKit 2 IAP, preset bank system with JSON-defined sellable packs.
- **WASM Core** (Rust → `yama_bruh.wasm`): Seeded PRNG, F#m pentatonic sequence generation, 2-op FM synthesis with 99 presets, audio buffer rendering
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
