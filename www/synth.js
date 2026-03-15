// ── YAMA-BRUH Synth Engine ────────────────────────────────────────────
// Web Audio FM synth + WASM ringtone renderer

const SAMPLE_RATE = 44100;
const BPM = 140;

const PRESET_NAMES = [
  // 00-09: Piano/Keys
  'Grand Piano','Bright Piano','Honky-Tonk','E.Piano 1','E.Piano 2',
  'Clav','Harpsichord','DX Piano','Stage Piano','Vintage Keys',
  // 10-19: Organ
  'Jazz Organ','Rock Organ','Church Organ','Reed Organ','Pipe Organ',
  'Drawbar 1','Drawbar 2','Perc Organ','Rotary Organ','Full Organ',
  // 20-29: Brass
  'Trumpet','Trombone','French Horn','Brass Sect','Synth Brass 1',
  'Synth Brass 2','Mute Trumpet','Brass Pad','Power Brass','Fanfare',
  // 30-39: Strings/Pad
  'Strings','Slow Strings','Syn Strings 1','Syn Strings 2','Warm Pad',
  'Choir Pad','Atmosphere','Brightness Pad','Sweep Pad','Ice Pad',
  // 40-49: Bass
  'Finger Bass','Pick Bass','Slap Bass','Fretless','Synth Bass 1',
  'Synth Bass 2','Acid Bass','Rubber Bass','Sub Bass','Wobble Bass',
  // 50-59: Lead
  'Square Lead','Saw Lead','Sync Lead','Calliope','Chiffer',
  'Charang','Solo Vox','Fifth Lead','Bass+Lead','Poly Lead',
  // 60-69: Bell/Mallet
  'Tubular Bell','Glockenspiel','Music Box','Vibraphone','Marimba',
  'Xylophone','Steel Drums','Crystal','Kalimba','Tinkle Bell',
  // 70-79: Reed/Pipe
  'Harmonica','Accordion','Clarinet','Oboe','Bassoon',
  'Flute','Recorder','Pan Flute','Bottle','Shakuhachi',
  // 80-89: SFX
  'Rain','Soundtrack','Sci-Fi','Atmosphere 2','Goblin',
  'Echo Drop','Star Theme','Sitar','Telephone','Helicopter',
  // 90-98: Retro/Digital
  'Chiptune 1','Chiptune 2','Chiptune 3','Retro Beep','Bit Crush',
  'Arcade','Game Over','Power Up','Digital Vox'
];

class YamaBruhSynth {
  constructor() {
    this.ctx = null;
    this.wasm = null;
    this.wasmMemory = null;
    this.currentPreset = 0;
    this.activeNotes = new Map();
    this.ready = false;
  }

  async init() {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Load WASM
    const response = await fetch('yama_bruh.wasm');
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      env: { memory: new WebAssembly.Memory({ initial: 32 }) }
    });
    this.wasm = result.instance.exports;
    this.wasmMemory = this.wasm.memory;
    this.ready = true;
  }

  ensureContext() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  getPresetName(index) {
    return PRESET_NAMES[index] || `Preset ${index + 1}`;
  }

  // Hash a string to a u32 seed via WASM
  hashString(str) {
    const inputPtr = this.wasm.get_input_buffer_ptr();
    const inputView = new Uint8Array(this.wasmMemory.buffer, inputPtr, 1024);
    const encoded = new TextEncoder().encode(str);
    inputView.set(encoded.slice(0, 1024));
    return this.wasm.hash_input(Math.min(encoded.length, 1024));
  }

  // Get preset parameters from WASM
  getPresetParams(index) {
    return {
      carrierRatio: this.wasm.get_preset_param(index, 0),
      modRatio: this.wasm.get_preset_param(index, 1),
      modIndex: this.wasm.get_preset_param(index, 2),
      attack: this.wasm.get_preset_param(index, 3),
      decay: this.wasm.get_preset_param(index, 4),
      sustain: this.wasm.get_preset_param(index, 5),
      release: this.wasm.get_preset_param(index, 6),
      feedback: this.wasm.get_preset_param(index, 7),
    };
  }

  // Play a ringtone from a seed string using WASM-rendered buffer
  playRingtone(seedStr, onDone) {
    this.ensureContext();
    const seed = this.hashString(seedStr);
    const sampleCount = this.wasm.render_ringtone(seed, this.currentPreset, BPM, SAMPLE_RATE);

    if (sampleCount === 0) return;

    const samplePtr = this.wasm.get_sample_buffer_ptr();
    const samples = new Float32Array(this.wasmMemory.buffer, samplePtr, sampleCount);

    const buffer = this.ctx.createBuffer(1, sampleCount, SAMPLE_RATE);
    buffer.getChannelData(0).set(samples);

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start();
    if (onDone) source.onended = onDone;

    return source;
  }

  // Play a single note using Web Audio API (real-time, low latency)
  playNote(midiNote, velocity = 0.8) {
    this.ensureContext();
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    const p = this.getPresetParams(this.currentPreset);

    const now = this.ctx.currentTime;
    const carrierFreq = freq * p.carrierRatio;
    const modFreq = freq * p.modRatio;

    // Modulator
    const mod = this.ctx.createOscillator();
    mod.frequency.value = modFreq;
    const modGain = this.ctx.createGain();
    modGain.gain.value = p.modIndex * modFreq;
    mod.connect(modGain);

    // Carrier
    const carrier = this.ctx.createOscillator();
    carrier.frequency.value = carrierFreq;
    modGain.connect(carrier.frequency);

    // Envelope
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(velocity * 0.4, now + p.attack);
    env.gain.linearRampToValueAtTime(velocity * 0.4 * p.sustain, now + p.attack + p.decay);

    carrier.connect(env);
    env.connect(this.ctx.destination);

    mod.start(now);
    carrier.start(now);

    const noteId = midiNote + '_' + Date.now();
    this.activeNotes.set(noteId, { carrier, mod, env, params: p });

    return noteId;
  }

  // Stop a playing note
  stopNote(noteId) {
    const note = this.activeNotes.get(noteId);
    if (!note) return;

    const now = this.ctx.currentTime;
    note.env.gain.cancelScheduledValues(now);
    note.env.gain.setValueAtTime(note.env.gain.value, now);
    note.env.gain.linearRampToValueAtTime(0, now + note.params.release);

    setTimeout(() => {
      try {
        note.carrier.stop();
        note.mod.stop();
      } catch (e) {}
      this.activeNotes.delete(noteId);
    }, note.params.release * 1000 + 50);
  }

  // Play a short click/beep for keypad feedback
  playClick() {
    this.ensureContext();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Use current preset for character but very short
    const p = this.getPresetParams(this.currentPreset);
    osc.frequency.value = 1200 * p.carrierRatio;
    osc.type = 'square';

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  // Set custom preset parameters
  setCustomParams(params) {
    const keys = ['carrierRatio','modRatio','modIndex','attack','decay','sustain','release','feedback'];
    keys.forEach((k, i) => {
      if (params[k] !== undefined) {
        this.wasm.set_custom_param(i, params[k]);
      }
    });
  }
}

window.synth = new YamaBruhSynth();
