// ── YAMA-BRUH Synth Engine ────────────────────────────────────────────
// AudioWorklet-based FM synth for minimal latency

const SAMPLE_RATE = 44100;
const BPM = 140;

const PRESET_NAMES = [
  'Grand Piano','Bright Piano','Honky-Tonk','E.Piano 1','E.Piano 2',
  'Clav','Harpsichord','DX Piano','Stage Piano','Vintage Keys',
  'Jazz Organ','Rock Organ','Church Organ','Reed Organ','Pipe Organ',
  'Drawbar 1','Drawbar 2','Perc Organ','Rotary Organ','Full Organ',
  'Trumpet','Trombone','French Horn','Brass Sect','Synth Brass 1',
  'Synth Brass 2','Mute Trumpet','Brass Pad','Power Brass','Fanfare',
  'Strings','Slow Strings','Syn Strings 1','Syn Strings 2','Warm Pad',
  'Choir Pad','Atmosphere','Brightness Pad','Sweep Pad','Ice Pad',
  'Finger Bass','Pick Bass','Slap Bass','Fretless','Synth Bass 1',
  'Synth Bass 2','Acid Bass','Rubber Bass','Sub Bass','Wobble Bass',
  'Square Lead','Saw Lead','Sync Lead','Calliope','Chiffer',
  'Charang','Solo Vox','Fifth Lead','Bass+Lead','Poly Lead',
  'Tubular Bell','Glockenspiel','Music Box','Vibraphone','Marimba',
  'Xylophone','Steel Drums','Crystal','Kalimba','Tinkle Bell',
  'Harmonica','Accordion','Clarinet','Oboe','Bassoon',
  'Flute','Recorder','Pan Flute','Bottle','Shakuhachi',
  'Rain','Soundtrack','Sci-Fi','Atmosphere 2','Goblin',
  'Echo Drop','Star Theme','Sitar','Telephone','Helicopter',
  'Chiptune 1','Chiptune 2','Chiptune 3','Retro Beep','Bit Crush',
  'Arcade','Game Over','Power Up','Digital Vox'
];

class YamaBruhSynth {
  constructor() {
    this.ctx = null;
    this.wasm = null;
    this.wasmMemory = null;
    this.workletNode = null;
    this.currentPreset = 0;
    this.ready = false;
    this._presetCache = new Map();
  }

  async init() {
    this.ctx = new AudioContext({
      sampleRate: SAMPLE_RATE,
      latencyHint: 'interactive',
    });

    // Load WASM (for ringtone rendering + preset params)
    const response = await fetch('yama_bruh.wasm');
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, {
      env: { memory: new WebAssembly.Memory({ initial: 32 }) }
    });
    this.wasm = result.instance.exports;
    this.wasmMemory = this.wasm.memory;

    // Load AudioWorklet
    await this.ctx.audioWorklet.addModule('synth-worklet.js');
    this.workletNode = new AudioWorkletNode(this.ctx, 'yambruh-synth', {
      outputChannelCount: [1],
    });
    this.workletNode.connect(this.ctx.destination);

    // Send initial preset to worklet
    this._sendPreset();

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

  hashString(str) {
    const inputPtr = this.wasm.get_input_buffer_ptr();
    const inputView = new Uint8Array(this.wasmMemory.buffer, inputPtr, 1024);
    const encoded = new TextEncoder().encode(str);
    inputView.set(encoded.slice(0, 1024));
    return this.wasm.hash_input(Math.min(encoded.length, 1024));
  }

  getPresetParams(index) {
    if (this._presetCache.has(index)) return this._presetCache.get(index);
    const params = [
      this.wasm.get_preset_param(index, 0),
      this.wasm.get_preset_param(index, 1),
      this.wasm.get_preset_param(index, 2),
      this.wasm.get_preset_param(index, 3),
      this.wasm.get_preset_param(index, 4),
      this.wasm.get_preset_param(index, 5),
      this.wasm.get_preset_param(index, 6),
      this.wasm.get_preset_param(index, 7),
    ];
    this._presetCache.set(index, params);
    return params;
  }

  _sendPreset() {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: 'preset',
      params: this.getPresetParams(this.currentPreset),
    });
  }

  // Play ringtone from seed (uses WASM buffer — not latency critical)
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

  // Play note via AudioWorklet — minimal latency
  playNote(midiNote, velocity = 0.8) {
    this.ensureContext();
    if (!this.workletNode) return midiNote;

    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    this.workletNode.port.postMessage({
      type: 'noteOn',
      note: midiNote,
      freq: freq,
      velocity: velocity,
      preset: this.getPresetParams(this.currentPreset),
    });
    return midiNote;
  }

  stopNote(noteId) {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: 'noteOff',
      note: noteId,
    });
  }

  // Keypad click — fire and forget via worklet
  playClick() {
    this.ensureContext();
    if (!this.workletNode) return;
    const p = this.getPresetParams(this.currentPreset);
    this.workletNode.port.postMessage({
      type: 'noteOn',
      note: -1,
      freq: 1200 * p[0],
      velocity: 0.15,
      preset: [1, 1, 0.5, 0.001, 0.03, 0, 0.02, 0],
    });
    setTimeout(() => {
      this.workletNode.port.postMessage({ type: 'noteOff', note: -1 });
    }, 40);
  }

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
