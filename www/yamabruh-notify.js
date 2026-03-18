// ── YAMA-BRUH Notification Engine (YM2413 Extended) ───────────────────
// Drop-in FM synth ringtone player for any site.
// Full YM2413 OPLL: waveforms, tremolo, chip vibrato, KSR, KSL, mod level.
// No WASM, no dependencies, no UI — just sound.
//
// Usage:
//   <script src="yamabruh-notify.js"></script>
//   <script>
//     const yb = new YamaBruhNotify();
//     yb.play('user-abc123');
//     yb.play('order-456', { preset: 88, bpm: 160, volume: 0.5 });
//     yb.stop();
//   </script>

// [cr, mr, mi, atk, dec, sus, rel, fb, c_wave, m_wave, trem, chip_vib, ksr, ksl, mod_lvl, eg_type, m_atk, m_dec, m_sus, m_rel, m_eg_type]
const YAMABRUH_PRESETS = [
  [1, 3, 0.515, 0.005, 1.8, 0.3, 0.6, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 1.0, 0.708, 0.5, 1], // Piano 1
  [1, 3, 0.942, 0.005, 2.0, 0.3, 0.6, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 1.2, 0.708, 0.5, 1], // Piano 2
  [1, 3, 1.582, 0.04, 1.5, 0.3, 0.5, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.9, 0.708, 0.4, 1], // Honky-Tonk Piano
  [1, 1, 0.334, 0.001, 1.0, 0.4, 0.4, 0.393, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.001, 0.8, 0.708, 0.4, 1], // Electric Piano 1
  [1, 1, 0.793, 0.001, 1.0, 0.4, 0.4, 0.785, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.001, 0.8, 0.708, 0.4, 1], // Electric Piano 2
  [1, 3, 3.157, 0.04, 0.5, 0.08, 0.15, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.5, 0.99, 1], // Harpsichord 1
  [1, 3, 9.699, 0.04, 0.4, 0.08, 0.15, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.5, 0.99, 1], // Harpsichord 2
  [1, 3, 9.699, 0.04, 0.5, 0.08, 0.15, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.5, 0.99, 1], // Harpsichord 3
  [1, 3, 5.299, 0.04, 0.1, 0.006, 0.15, 0, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.003, 0.99, 0.708, 0.3, 0], // Honky-Tonk Clavi
  [1, 7, 3.157, 0.001, 1.5, 0.05, 0.8, 0, 0, 0, 0.5, 0, 0.3, 1.5, 1, 1, 0.12, 1.0, 0.3, 0.8, 1], // Glass Celesta
  [1, 3, 0.281, 0.2, 0.4, 1, 0.2, 0.393, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.04, 0.3, 1, 0.99, 0], // Reed Organ
  [1, 0.5, 0.055, 0.35, 0.5, 1, 0.2, 0, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.99, 1, 0.99, 0], // Pipe Organ 1
  [1, 3, 0.258, 0.2, 0.4, 1, 0.2, 0.393, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.04, 0.3, 1, 0.99, 0], // Pipe Organ 2
  [1, 1, 0.365, 0.12, 0.5, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.12, 0.99, 1, 0.99, 0], // Electronic Organ 1
  [1, 3, 0.258, 0.2, 0.4, 1, 0.2, 0.393, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.04, 0.3, 1, 0.99, 0], // Electronic Organ 2
  [1, 3, 2.235, 0.001, 0.3, 0.708, 0.15, 0.393, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.2, 0.5, 0.15, 0], // Jazz Organ
  [1, 3, 2.05, 0.35, 0.5, 1, 0.2, 0.785, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.07, 0.99, 1, 0.1, 0], // Accordion
  [1, 7, 0.561, 0.001, 1.5, 0.1, 0.8, 0.785, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.001, 0.8, 0.4, 0.6, 1], // Vibraphone
  [2, 0.5, 12.566, 0.001, 0.6, 0.02, 0.8, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.1, 0.6, 1], // Marimba 1
  [2, 0.5, 12.566, 0.001, 0.6, 0.02, 0.8, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.1, 0.6, 1], // Marimba 2
  [1, 1, 1.12, 0.1, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.07, 0.18, 0.708, 0.99, 0], // Trumpet
  [1, 1, 1.12, 0.1, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.2, 0.15, 0.501, 0.3, 0], // Mute Trumpet
  [0.5, 0.5, 1.451, 0.12, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1, 0.18, 0.708, 0.99, 0], // Trombone
  [0.5, 0.5, 1.451, 0.12, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1, 0.18, 0.708, 0.99, 0], // Soft Trombone
  [1, 1, 1.027, 0.35, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1.8, 0.18, 0.708, 0.99, 0], // Horn
  [1, 1, 0.667, 0.6, 0.3, 1, 0.2, 0, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1.8, 0.18, 0.708, 0.99, 0], // Alpenhorn
  [0.5, 0.5, 1.725, 0.35, 0.18, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1, 0.18, 0.708, 0.99, 0], // Tuba
  [1, 1, 1.12, 0.6, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1, 0.18, 0.708, 0.99, 0], // Brass Ensemble 1
  [1, 1, 1.12, 0.12, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.07, 0.18, 0.708, 0.99, 0], // Brass Ensemble 2
  [0.5, 0.5, 1.725, 0.35, 0.18, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1, 0.18, 0.708, 0.99, 0], // Brass Ensemble 3
  [1, 1, 3.752, 0.1, 0.3, 0.7, 0.25, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.04, 0.2, 0.5, 0.2, 1], // Flute
  [1, 6, 0.793, 0.15, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.003, 0.3, 0.7, 0.2, 0], // Panflute
  [4, 4, 0.199, 0.1, 0.2, 1, 0.15, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.35, 0.2, 0.708, 0.15, 0], // Piccolo
  [1, 2, 0.942, 0.2, 0.3, 0.8, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 0, 0.003, 0.99, 1, 0.99, 0], // Clarinet
  [0.5, 1, 1.027, 0.15, 0.4, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.07, 0.99, 1, 0.99, 0], // Bass Clarinet
  [2, 1, 1.88, 0.15, 0.3, 0.8, 0.2, 0.393, 0, 0, 0, 0, 0.3, 1, 1, 0, 0.003, 0.99, 1, 0.2, 0], // Oboe
  [1, 0.5, 1.88, 0.2, 0.4, 1, 0.2, 0.393, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.003, 0.99, 1, 0.3, 0], // Bassoon
  [1, 0.5, 1.451, 0.12, 0.4, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.01, 0.99, 1, 0.99, 0], // Saxophone
  [1, 0.5, 8.896, 1.8, 0.5, 1, 0.2, 0.196, 0, 0, 0.5, 0, 0.3, 1.5, 1, 0, 0.001, 0.99, 1, 0.99, 0], // Bagpipe
  [1, 0.5, 1.88, 0.2, 0.4, 1, 0.2, 0.393, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.003, 0.99, 1, 0.3, 0], // Woodwinds
  [1, 1, 0.942, 0.2, 0.4, 0.85, 0.4, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 0, 0.005, 0.99, 1, 0.99, 0], // Violin 1
  [1, 1, 1.331, 0.6, 0.4, 1, 0.4, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.04, 0.99, 1, 0.99, 0], // Violin 2
  [1, 0.5, 1.027, 0.5, 0.4, 1, 0.5, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.04, 0.99, 1, 0.99, 0], // Cello
  [1, 0.5, 1.027, 1.8, 0.4, 1, 0.6, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.04, 0.99, 1, 0.99, 0], // Strings
  [0.5, 0.5, 2.05, 0.003, 0.6, 0.5, 0.2, 0.196, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.501, 0.3, 1], // Electric Bass
  [0.5, 0.5, 7.485, 0.001, 0.5, 0.2, 0.15, 0.393, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.003, 0.2, 0.251, 0.3, 1], // Slap Bass
  [0.5, 0.5, 2.05, 0.07, 0.5, 0.5, 0.2, 0.196, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.01, 0.3, 0.6, 0.2, 1], // Wood Bass
  [0.5, 0.5, 3.157, 0.001, 0.4, 0.35, 0.2, 0.393, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.01, 0.18, 0.501, 0.99, 1], // Synth Bass
  [1, 3, 2.05, 0.001, 0.6, 0.2, 0.3, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.3, 0.35, 1], // Banjo
  [1, 3, 1.582, 0.001, 0.5, 0.2, 0.25, 0.393, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.25, 0.4, 0.3, 1], // Mandolin
  [1, 0.5, 8.16, 0.003, 0.8, 0.2, 0.3, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.126, 0.3, 1], // Classic Guitar
  [1, 3, 0.515, 0.003, 0.7, 0.25, 0.3, 0, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.5, 0.35, 1], // Jazz Guitar
  [1, 3, 9.699, 0.001, 0.8, 0.15, 0.3, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.2, 0.178, 0.3, 1], // Folk Guitar
  [1, 3, 1.451, 0.001, 1.0, 0.3, 0.3, 0.785, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.001, 0.99, 1, 0.99, 1], // Hawaiian Guitar
  [2, 1, 5.777, 0.004, 0.5, 0.3, 0.25, 0.393, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.99, 1, 0.99, 1], // Ukulele
  [1, 3, 3.157, 0.002, 0.7, 0.15, 0.3, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.355, 0.3, 1], // Koto
  [1, 3, 12.566, 0.001, 0.4, 0.05, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.003, 0.2, 0.089, 0.2, 1], // Shamisen
  [1, 0.5, 1.221, 0.001, 1.0, 0.3, 0.4, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.99, 1, 0.99, 1], // Harp
  [1, 3, 1.582, 0.15, 0.4, 1, 0.15, 0.393, 0, 0, 0.5, 0, 0.3, 1.5, 1, 0, 0.35, 0.3, 1, 0.2, 0], // Harmonica
  [2, 9, 3.441, 0.001, 1.5, 0.02, 0.8, 0.196, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.001, 0.5, 0.05, 0.6, 1], // Music Box
  [3, 1, 1.027, 0.001, 0.5, 0.3, 0.3, 12.566, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1.8, 0.3, 1, 0.99, 0], // Brass & Marimba
  [1, 3, 9.699, 0.003, 0.4, 0.08, 0.2, 0, 0, 1, 0, 0, 0.3, 1, 1, 1, 0.001, 0.3, 0.5, 0.99, 1], // Flute & Harpsichord
  [2, 1, 1.88, 0.2, 0.3, 0.708, 0.2, 0.393, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.003, 0.99, 1, 0.5, 0], // Oboe & Vibraphone
  [1, 0.5, 1.221, 0.001, 0.8, 0.4, 0.3, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.99, 1, 0.99, 1], // Clarinet & Harp
  [0.5, 3, 5.299, 0.01, 0.5, 0.2, 0.2, 0, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.04, 0.3, 0.3, 0.99, 0], // Violin & Steel Drum
  [5, 0.5, 0.793, 0.35, 0.5, 0.7, 0.3, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 1, 0.001, 0.3, 0.708, 0.99, 1], // Handsaw
  [1, 1, 1.725, 0.15, 0.4, 0.7, 0.25, 0, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.18, 0.251, 0.2, 0], // Synth Brass
  [1, 1, 4.861, 0.001, 0.3, 0.6, 0.4, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.12, 0.2, 0.3, 0.3, 1], // Metallic Synth
  [1, 1, 0.055, 0.12, 0.99, 1, 0.2, 0, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 99, 0.00005, 0.006, 0.2, 0], // Sine Wave
  [1, 0.5, 0.793, 3, 0.3, 0.3, 0.4, 0, 0, 0, 0.5, 0, 0.3, 1.5, 1, 0, 0.001, 0.99, 1, 0.99, 0], // Reverse
  [3, 1, 3.157, 0.6, 0.4, 0.6, 0.3, 0, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.2, 0.3, 0.5, 0.3, 0], // Human Voice 1
  [1, 2, 1.725, 0.6, 0.4, 0.6, 0.3, 0, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.99, 1, 0.99, 0], // Human Voice 2
  [4, 1, 1.221, 0.35, 0.4, 0.6, 0.2, 0.785, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.2, 0.5, 0.99, 0], // Human Voice 3
  [1, 2, 0.793, 1, 0.5, 1, 0.3, 0, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.3, 1, 0.3, 0], // Whisper
  [4, 6, 0.793, 0.35, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.003, 0.3, 0.7, 0.2, 0], // Whistle
  [1, 0.5, 12.566, 1, 0.3, 0.5, 0.3, 0, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 3, 0.99, 1, 0.2, 0], // Gurgle
  [1, 0.5, 1.582, 0.04, 0.2, 0.6, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.99, 1, 0.99, 1], // Bubble
  [1, 3, 0.055, 0.04, 0.15, 0.1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.1, 0.1, 0.15, 1], // Raindrop
  [1, 1, 2.436, 0.001, 0.15, 0.01, 0.1, 0.393, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.6, 0.99, 0.1, 0.1, 0], // Popcorn
  [1, 0.5, 3.157, 0.001, 0.15, 0.01, 0.1, 0.393, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 1, 0.2, 0.1, 0.1, 0], // Drip
  [4, 1, 1.221, 0.35, 0.4, 0.5, 0.2, 0.785, 0, 1, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.2, 0.5, 0.99, 0], // Dog Pianist
  [1, 1, 4.861, 0.001, 0.3, 0.6, 0.2, 0.393, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.2, 0.2, 0.5, 0.2, 0], // Duck
  [4, 8, 2.895, 0.12, 0.3, 0.4, 0.2, 0.196, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.07, 0.99, 0.708, 0.3, 0], // Baby Doll
  [1, 2, 2.895, 0.001, 1.5, 0.05, 0.8, 0, 1, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.8, 0.3, 0.6, 1], // Telephone Bell
  [1, 1, 1.027, 0.12, 0.3, 1, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.12, 0.18, 0.708, 0.99, 0], // Emergency Alarm
  [8, 0.5, 2.656, 0.005, 0.4, 0.5, 0.2, 0.196, 0, 0, 0.5, 0, 0.3, 1.5, 1, 1, 0.001, 0.3, 0.251, 0.99, 1], // Leaf Spring
  [1, 2, 2.895, 0.12, 0.5, 0.3, 0.3, 0, 1, 0, 0, 0, 0.3, 1.5, 1, 0, 0.07, 0.99, 0.708, 0.3, 0], // Comet
  [1, 3, 12.566, 1, 0.3, 1, 0.3, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 5, 0.3, 1, 0.99, 1], // Fireworks
  [1, 2, 2.895, 0.12, 1.5, 0.02, 0.8, 0, 1, 0, 0, 0, 0.3, 1.5, 1, 1, 0.07, 0.8, 0.1, 0.6, 1], // Crystal
  [1, 2, 1.725, 0.6, 0.6, 0.3, 0.5, 0, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.99, 1, 0.99, 0], // Ghost
  [1, 3, 3.157, 0.001, 2.0, 0.02, 0.8, 0, 0, 0, 0, 0, 0.3, 1, 1, 1, 5, 0.5, 0.05, 0.8, 1], // Hand Bell
  [1, 2, 2.895, 0.001, 2.0, 0.02, 1.0, 0, 1, 0, 0, 0, 0.3, 1.5, 1, 1, 0.07, 0.8, 0.05, 0.8, 1], // Chimes
  [1, 2, 8.16, 0.001, 2.0, 0.02, 1.0, 0, 1, 0, 0, 0, 0.3, 1.5, 1, 1, 0.07, 0.8, 0.05, 0.8, 1], // Bell
  [0.5, 3, 5.299, 0.001, 0.7, 0.05, 0.3, 0, 0, 0, 0.5, 0, 0.3, 1, 1, 1, 0.04, 0.3, 0.1, 0.3, 1], // Steel Drum
  [1, 5, 0.472, 0.001, 0.4, 0.3, 0.2, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.2, 0.5, 0.2, 1], // Cowbell
  [1, 1, 3.157, 0.001, 0.15, 0.05, 0.1, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.08, 0.1, 0.1, 1], // Synth Tom 1
  [0.5, 0.5, 3.157, 0.001, 0.15, 0.03, 0.1, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.08, 0.05, 0.1, 1], // Synth Tom 2
  [3, 1, 12.566, 0.005, 0.12, 0.05, 0.08, 0.785, 0, 1, 0.5, 0, 0.3, 1.5, 1, 1, 0.001, 0.06, 0.1, 0.08, 1], // Snare Drum
  [1, 4, 12.566, 0.001, 0.05, 0.1, 0.06, 0.785, 0, 0, 0, 0, 0.3, 1, 1, 1, 0.001, 0.08, 0.3, 0.06, 1], // Machine Gun
  [0.5, 2, 10.573, 3, 0.3, 0.3, 0.4, 0.785, 0, 0, 0, 0, 0.3, 1.5, 1, 0, 0.001, 0.3, 1, 0.99, 0], // Wave
];

// ── YM2413 Waveform Types ──────────────────────────────────────────────
// 23-bit LFSR state for offline noise generation
let _notifyLfsr = 1;
function _notifyNoise() {
  const bit = ((_notifyLfsr >> 0) ^ (_notifyLfsr >> 14)) & 1;
  _notifyLfsr = ((_notifyLfsr >> 1) | (bit << 22)) & 0x7FFFFF;
  return (_notifyLfsr & 1) ? 1 : -1;
}

function _ym2413Wave(phase, type) {
  switch (type) {
    case 1: { const s = Math.sin(phase); return s > 0 ? s : 0; }
    case 2: return Math.abs(Math.sin(phase));
    case 3: {
      const TAU = 6.28318530717959;
      let p = phase % TAU;
      if (p < 0) p += TAU;
      return p < 1.5707963 ? Math.sin(p) : 0;
    }
    case 4: return _notifyNoise(); // pure noise
    case 5: return (Math.sin(phase) + _notifyNoise()) * 0.5; // tone + noise
    default: return Math.sin(phase);
  }
}

class YamaBruhNotify {
  constructor(config = {}) {
    this.sampleRate = config.sampleRate || 44100;
    this.preset = config.preset ?? 88;
    this.bpm = config.bpm || 140;
    this.volume = config.volume ?? 0.8;
    this.seed = config.seed || null;
    this.ctx = null;
    this._source = null;
  }

  _ensureCtx() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  _rng(seed) {
    let s = seed || 1;
    return {
      next() {
        s ^= s << 13;
        s = (s >>> 17) | (s << 15);
        s ^= s << 5;
        s >>>= 0;
        if (s === 0) s = 1;
        return s;
      },
      range(n) { return this.next() % n; },
    };
  }

  _getPreset(index) {
    const i = Math.max(0, Math.min(99, index));
    return YAMABRUH_PRESETS[i] || YAMABRUH_PRESETS[0];
  }

  _midiToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  _renderNote(freq, duration, preset, buf, offset, velocity) {
    const sr = this.sampleRate;
    const TAU = 6.28318530717959;

    // Base params
    const cr = preset[0], mr = preset[1], mi = preset[2];
    const atkBase = preset[3], decBase = preset[4], sustain = preset[5];
    const relBase = preset[6], feedback = preset[7];
    // YM2413 extended
    const cWave = (preset[8] || 0) | 0;
    const mWave = (preset[9] || 0) | 0;
    const tremDepth = preset[10] || 0;
    const chipVib = preset[11] || 0;
    const ksr = preset[12] || 0;
    const ksl = preset[13] || 0;
    const modLevel = preset[14] !== undefined ? preset[14] : 1;
    const egType = preset[15] || 0;
    // Modulator envelope (indices 16-20), defaults to carrier if absent
    const mAtkBase = preset[16] !== undefined ? preset[16] : atkBase;
    const mDecBase = preset[17] !== undefined ? preset[17] : decBase;
    const mSustain = preset[18] !== undefined ? preset[18] : sustain;
    const mRelBase = preset[19] !== undefined ? preset[19] : relBase;
    const mEgType = preset[20] !== undefined ? preset[20] : egType;

    // KSR: scale envelope times with pitch
    let attack = atkBase, decay = decBase, release = relBase;
    let mAttack = mAtkBase, mDecay = mDecBase, mRelease = mRelBase;
    if (ksr > 0) {
      const octave = Math.log2(freq / 440);
      const ksrFactor = Math.pow(2, -ksr * octave);
      attack *= ksrFactor;
      decay *= ksrFactor;
      release *= ksrFactor;
      mAttack *= ksrFactor;
      mDecay *= ksrFactor;
      mRelease *= ksrFactor;
    }

    // KSL: volume attenuation above A4
    let kslAtten = 1;
    if (ksl > 0) {
      const octave = Math.log2(freq / 440);
      if (octave > 0) kslAtten = Math.pow(10, -ksl * octave / 20);
    }

    const carrierFreq = freq * cr;
    const modFreq = freq * mr;
    const totalSamples = Math.floor((duration + release) * sr);
    const noteSamples = Math.floor(duration * sr);
    const attackSamples = Math.floor(attack * sr);
    const decaySamples = Math.floor(decay * sr);
    const mAttackSamples = Math.floor(mAttack * sr);
    const mDecaySamples = Math.floor(mDecay * sr);

    let carrierPhase = 0, modPhase = 0, prevMod = 0;
    const available = buf.length - offset;
    const count = Math.min(totalSamples, available);

    for (let i = 0; i < count; i++) {
      const t = i / sr;

      // ── Modulator ADSR envelope ──
      let mEnv;
      if (i < mAttackSamples) {
        mEnv = i / (mAttackSamples || 1);
      } else if (i < mAttackSamples + mDecaySamples) {
        const dt = (i - mAttackSamples) / (mDecaySamples || 1);
        mEnv = 1 - (1 - mSustain) * dt;
      } else if (i < noteSamples) {
        if (mEgType > 0.5) {
          const elapsed = (i - mAttackSamples - mDecaySamples) / sr;
          mEnv = mSustain * Math.pow(0.5, elapsed / (mDecBase * 2 + 0.01));
          if (mEnv < 0.001) mEnv = 0;
        } else {
          mEnv = mSustain;
        }
      } else {
        const relMax = Math.max(mRelease * sr, 1);
        const dt = (i - noteSamples) / relMax;
        mEnv = Math.max(mSustain * (1 - dt), 0);
      }

      // ── Carrier ADSR envelope ──
      let env;
      if (i < attackSamples) {
        env = i / (attackSamples || 1);
      } else if (i < attackSamples + decaySamples) {
        const dt = (i - attackSamples) / (decaySamples || 1);
        env = 1 - (1 - sustain) * dt;
      } else if (i < noteSamples) {
        if (egType > 0.5) {
          const elapsed = (i - attackSamples - decaySamples) / sr;
          env = sustain * Math.pow(0.5, elapsed / (decBase * 2 + 0.01));
          if (env < 0.001) env = 0;
        } else {
          env = sustain;
        }
      } else {
        const relMax = Math.max(release * sr, 1);
        const dt = (i - noteSamples) / relMax;
        env = Math.max(sustain * (1 - dt), 0);
      }

      // YM2413 Tremolo at 3.7Hz
      const trem = tremDepth > 0 ? 1 - tremDepth * (1 + Math.sin(TAU * 3.7 * t)) * 0.5 : 1;

      // YM2413 Chip vibrato at 6.4Hz
      const vibMod = chipVib > 0 ? chipVib * Math.sin(TAU * 6.4 * t) : 0;
      const freqMult = 1 + vibMod;

      // 2-op FM with YM2413 waveforms — feedback pre-envelope (hardware-accurate)
      const modRaw = _ym2413Wave(modPhase + feedback * prevMod, mWave);
      prevMod = modRaw; // feedback stays alive regardless of mod envelope
      const modSignal = modRaw * modLevel * mEnv; // envelope only scales output to carrier
      buf[offset + i] += _ym2413Wave(carrierPhase + mi * modSignal, cWave) * env * velocity * 0.45 * trem * kslAtten;

      carrierPhase += TAU * carrierFreq * freqMult / sr;
      modPhase += TAU * modFreq * freqMult / sr;
      if (carrierPhase > TAU) carrierPhase -= TAU;
      if (modPhase > TAU) modPhase -= TAU;
    }

    return count;
  }

  _generateSequence(seed) {
    const rng = this._rng(seed);
    const numNotes = 3 + (seed % 3);
    const movements = [0, 2, -2, 3, -3, 4, -4, 6, -6];
    const durations = [0.125, 0.25, 0.5, 1.0, 2.0];
    const octaveOffset = rng.range(3) * 12;
    let currentNote = 54 + octaveOffset;
    const notes = [];

    for (let i = 0; i < numNotes; i++) {
      currentNote += movements[rng.range(9)];
      if (currentNote < 42) currentNote += 12;
      if (currentNote > 84) currentNote -= 12;
      notes.push({ note: currentNote, dur: durations[rng.range(5)] });
    }
    return notes;
  }

  /**
   * Play a ringtone from a seed string.
   * @param {string} seedStr - Any string (user ID, event name, etc.)
   * @param {object} opts - Optional overrides: { preset, bpm, volume, onDone }
   * @returns {AudioBufferSourceNode} The playing source node
   */
  play(seedStr, opts = {}) {
    const ctx = this._ensureCtx();
    const preset = this._getPreset(opts.preset ?? this.preset);
    const bpm = opts.bpm || this.bpm;
    const volume = opts.volume ?? this.volume;
    const beatDuration = 60 / bpm;

    if (seedStr === undefined || seedStr === null || seedStr === '') {
      seedStr = 'auto-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    }

    const raw = this.seed ? this.seed + ':' + String(seedStr) : String(seedStr);
    const seed = this._hash(raw);
    const sequence = this._generateSequence(seed);

    let totalBeats = 0;
    for (const n of sequence) totalBeats += n.dur;
    const maxRelease = preset[6];
    const totalSamples = Math.ceil((totalBeats * beatDuration + maxRelease) * this.sampleRate);

    const buf = new Float32Array(totalSamples);
    let offset = 0;
    for (const n of sequence) {
      const freq = this._midiToFreq(n.note);
      const durSecs = n.dur * beatDuration;
      this._renderNote(freq, durSecs, preset, buf, offset, volume);
      offset += Math.floor(durSecs * this.sampleRate);
    }

    const audioBuffer = ctx.createBuffer(1, buf.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(buf);

    this.stop();

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.start();
    this._source = source;

    source.onended = () => {
      if (this._source === source) this._source = null;
      if (opts.onDone) opts.onDone();
    };

    return source;
  }

  /** Stop current ringtone */
  stop() {
    if (this._source) {
      try { this._source.stop(); } catch (_) {}
      this._source = null;
    }
  }

  /** Update default config */
  configure(config) {
    if (config.preset !== undefined) this.preset = config.preset;
    if (config.bpm !== undefined) this.bpm = config.bpm;
    if (config.volume !== undefined) this.volume = config.volume;
    if (config.sampleRate !== undefined) this.sampleRate = config.sampleRate;
  }

  /** List available preset names */
  static get PRESET_NAMES() {
    return [
      'Piano 1','Piano 2','Honky-Tonk Piano','Electric Piano 1','Electric Piano 2',
      'Harpsichord 1','Harpsichord 2','Harpsichord 3','Honky-Tonk Clavi','Glass Celesta',
      'Reed Organ','Pipe Organ 1','Pipe Organ 2','Electronic Organ 1','Electronic Organ 2',
      'Jazz Organ','Accordion','Vibraphone','Marimba 1','Marimba 2',
      'Trumpet','Mute Trumpet','Trombone','Soft Trombone','Horn',
      'Alpenhorn','Tuba','Brass Ensemble 1','Brass Ensemble 2','Brass Ensemble 3',
      'Flute','Panflute','Piccolo','Clarinet','Bass Clarinet',
      'Oboe','Bassoon','Saxophone','Bagpipe','Woodwinds',
      'Violin 1','Violin 2','Cello','Strings','Electric Bass',
      'Slap Bass','Wood Bass','Synth Bass','Banjo','Mandolin',
      'Classic Guitar','Jazz Guitar','Folk Guitar','Hawaiian Guitar','Ukulele',
      'Koto','Shamisen','Harp','Harmonica','Music Box',
      'Brass & Marimba','Flute & Harpsichord','Oboe & Vibraphone','Clarinet & Harp','Violin & Steel Drum',
      'Handsaw','Synth Brass','Metallic Synth','Sine Wave','Reverse',
      'Human Voice 1','Human Voice 2','Human Voice 3','Whisper','Whistle',
      'Gurgle','Bubble','Raindrop','Popcorn','Drip',
      'Dog Pianist','Duck','Baby Doll','Telephone Bell','Emergency Alarm',
      'Leaf Spring','Comet','Fireworks','Crystal','Ghost',
      'Hand Bell','Chimes','Bell','Steel Drum','Cowbell',
      'Synth Tom 1','Synth Tom 2','Snare Drum','Machine Gun','Wave',
    ];
  }
}

// Auto-expose globally
if (typeof window !== 'undefined') window.YamaBruhNotify = YamaBruhNotify;
