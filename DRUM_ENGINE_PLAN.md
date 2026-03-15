# Drum Engine + Auto-Accompaniment Architecture

## Module Overview

```
www/
  drum-worklet.js   ← AudioWorklet for percussion synthesis (noise + FM)
  drums.js          ← Pattern sequencer, rhythm presets, tempo control
  accomp.js         ← Chord detection, bass line, chord voicing (future)
```

## Drum Engine (`drum-worklet.js`)

Separate AudioWorklet processor — runs parallel to `yambruh-synth`, mixed at output.

### Synthesis Method
PSS-170/470 drums are FM-based. Each drum sound = a short FM burst with specific params:

| Sound | Technique |
|-------|-----------|
| Kick | Low carrier (60Hz), fast pitch sweep down, short decay |
| Snare | Mid carrier (200Hz) + noise burst, short decay |
| Hi-hat closed | High FM (metal ratio ~7.0), very short decay |
| Hi-hat open | Same as closed, longer decay |
| Clap | Noise burst, multi-trigger envelope (3 rapid hits) |
| Tom high/low | Mid carrier, pitch sweep, medium decay |
| Rimshot | Short click + mid carrier |
| Cowbell | Inharmonic FM (ratio ~1.41), no sustain |
| Cymbal | Very high FM, noise-like, long decay |

### Message Protocol
```js
// Trigger a drum hit
{ type: 'drum', sound: 'kick', velocity: 0.8 }
{ type: 'drum', sound: 'snare', velocity: 0.7 }
{ type: 'drum', sound: 'hihat_c', velocity: 0.5 }

// Set tempo (for internal timing if needed)
{ type: 'tempo', bpm: 120 }
```

## Pattern Sequencer (`drums.js`)

Runs on main thread via `setInterval` / `requestAnimationFrame` with lookahead scheduling.

### Rhythm Presets (PSS-170 compatible)
16 patterns matching the original:
1. 8 Beat
2. 16 Beat
3. Rock
4. Disco
5. March
6. Swing
7. 12 Beat
8. Waltz
9. Bossa Nova
10. Country
11. Samba
12. Beat (variation)
13. Slow Rock
14. Shuffle
15. Reggae
16. Fill In (1-bar percussion break)

### Pattern Format
Each pattern = array of 16 steps (16th notes per bar):
```js
const PATTERN_8BEAT = {
  kick:    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
  hihat_c: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
}
```

### Tempo
31 BPM settings (60-180, matching PSS-170 range). Synchro Start available.

## Auto-Accompaniment (`accomp.js`) — Future

### Architecture
- Left-hand detection: notes below split point (default: B3/MIDI 59) → chord analysis
- Chord types: major, minor, 7th, dim, aug (matches PSS-170 chord vocabulary)
- Three modes (matching PSS-170):
  1. **Single Finger** — root note → major chord; root + black key left → minor
  2. **Auto Bass Chord** — detect 3-4 note chords, generate bass + rhythm
  3. **Auto Chord** — play your own bass, auto chord voicing on top

### Output
- Bass voice: uses current preset but octave-shifted
- Chord pads: sustained chord voicings through synth worklet
- Rhythm: drum pattern synced to chord changes

## Integration Points

- `drums.js` creates its own `AudioWorkletNode` from `drum-worklet.js`
- Both worklets connect to `ctx.destination` (or a shared gain node for mixing)
- `accomp.js` sends `noteOn`/`noteOff` through existing synth worklet for bass + chords
- Tempo shared between drums.js and accomp.js
- MIDI input split: notes ≥ split → melody (existing), notes < split → accomp chord detection

## UI Controls (for UI agent)
- Rhythm selector: row of buttons or dropdown (RHYTHM section)
- Start/Stop button
- Tempo +/- buttons (or slider)
- Synchro Start toggle
- Fill In button
- Accompaniment mode selector (OFF / SINGLE FINGER / AUTO BASS / AUTO CHORD)
- Accompaniment volume control
