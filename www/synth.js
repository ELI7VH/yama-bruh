// ── YAMA-BRUH Synth Engine ────────────────────────────────────────────
// AudioWorklet-based FM synth for minimal latency

const SAMPLE_RATE = 44100;
const BPM = 140;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseNumberList(value) {
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite);
  }
  return String(value || '')
    .split(/[,\s]+/)
    .filter(s => s !== '')
    .map(Number)
    .filter(Number.isFinite);
}

const SEQ_MATH_PREAMBLE = 'const{sin,cos,abs,floor,ceil,round,min,max,pow,sqrt,log,exp,random}=Math;const PI=Math.PI;const TAU=2*Math.PI;function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}';

function compileSequenceAlgorithm(source) {
  const text = String(source || '').trim();
  if (!text) return null;
  try {
    const fn = new Function(`${SEQ_MATH_PREAMBLE}return (${text});`)();
    return typeof fn === 'function' ? fn : null;
  } catch (error) {
    console.error('[SEQ ALGO] Invalid algorithm:', error);
    return null;
  }
}

function compileSequenceSource(source) {
  const text = String(source || '').trim();
  if (!text) return null;
  try {
    const value = new Function(`${SEQ_MATH_PREAMBLE}return (${text});`)();
    return value && typeof value === 'object' ? value : null;
  } catch (error) {
    console.error('[SEQ SOURCE] Invalid sequence object:', error);
    return null;
  }
}

function normalizeSequenceDef(def) {
  if (!def || !def.enabled) return null;
  const config = typeof def.source === 'string'
    ? compileSequenceSource(def.source)
    : def;
  if (!config) return null;
  const algorithmValue = config.algorithm;
  const algorithm = typeof algorithmValue === 'string' ? algorithmValue.trim() : '';
  const algorithmFn = typeof algorithmValue === 'function'
    ? algorithmValue
    : compileSequenceAlgorithm(algorithm);
  const hasAlgorithm = typeof algorithmFn === 'function';
  const offsets = parseNumberList(config.offsets);
  const levels = parseNumberList(config.levels);
  if (!hasAlgorithm && !offsets.length) return null;
  const baseLength = Math.max(offsets.length, 1);
  const rawTimes = parseNumberList(config.times);
  const defaultTime = Number(config.t ?? config.time) || 1;
  const times = rawTimes.length ? rawTimes : [defaultTime];
  const stepLevels = Array.from({ length: baseLength }, (_, i) => clamp(levels[i] ?? levels[levels.length - 1] ?? 1, 0.01, 2));
  const stepTimes = Array.from({ length: baseLength }, (_, i) => clamp(times[i % times.length], 0.01, 8));
  return {
    enabled: true,
    name: String(def.name || config.name || ''),
    gated: !!config.gated,
    gate: clamp(Number(config.g ?? config.gate ?? 0.82), 0.05, 1.5),
    offsets,
    times: stepTimes,
    levels: stepLevels,
    defaultTime: clamp(defaultTime, 0.01, 8),
    initT: Number.isFinite(Number(config.t)) ? clamp(Number(config.t), 0.01, 8) : null,
    initG: Number.isFinite(Number(config.g)) ? clamp(Number(config.g), 0.05, 1.5) : null,
    initV: Number.isFinite(Number(config.v)) ? clamp(Number(config.v), 0.001, 2) : null,
    initN: Number.isFinite(Number(config.n)) ? Number(config.n) : null,
    initCents: Number.isFinite(Number(config.cents)) ? Number(config.cents) : 0,
    noteAlgo: typeof config.noteAlgo === 'function' ? config.noteAlgo.toString() : (typeof config.noteAlgo === 'string' ? config.noteAlgo.trim() : null),
    source: typeof def.source === 'string' ? def.source : '',
    algorithm: typeof algorithmValue === 'function' ? algorithmValue.toString() : algorithm,
    algorithmFn,
  };
}

const PRESET_NAMES = [
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
  'Synth Tom 1','Synth Tom 2','Snare Drum','Machine Gun','Wave'
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
    this.onMessage = null;
    this._sequenceDefs = new Map();
    this._activeSequences = new Map();
    this._noteEndListeners = new Map();
    this._sequenceCounter = 1;
    this.bpm = 120;
  }

  setBpm(bpm) {
    this.bpm = clamp(Number(bpm) || 120, 20, 400);
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

    // Listen for crash reports from worklet
    this.workletNode.port.onmessage = (e) => {
      if (e.data?.type === 'crash') {
        console.error('[SYNTH CRASH]', e.data.reason, e.data.detail, 'total:', e.data.count);
        const lcd = document.getElementById('lcd-info');
        if (lcd) lcd.textContent = 'AUDIO ERR: ' + e.data.reason;
      } else if (e.data?.type === 'health') {
        this._lastHealth = e.data;
      }
      if (this.onMessage) this.onMessage(e.data);
    };

    // Send initial preset to worklet
    this._sendPreset();

    // Health monitor — detect AudioContext suspension, worklet death
    this._healthLog = [];
    this._lastHealth = null;
    this._monitorId = setInterval(() => {
      const state = this.ctx.state;
      const now = performance.now();
      if (state !== 'running') {
        console.warn('[AUDIO HEALTH] Context state:', state, 'at', (now/1000).toFixed(1) + 's');
        const lcd = document.getElementById('lcd-info');
        if (lcd && state === 'suspended') lcd.textContent = 'AUDIO SUSPENDED';
        // Try to resume
        this.ctx.resume().then(() => {
          console.log('[AUDIO HEALTH] Resumed context');
        }).catch(() => {});
      }
      // Ping worklet for voice count
      if (this.workletNode) {
        this.workletNode.port.postMessage({ type: 'healthCheck' });
      }
    }, 3000);

    // Log state changes
    this.ctx.onstatechange = () => {
      console.warn('[AUDIO HEALTH] Context state changed to:', this.ctx.state);
      if (this.ctx.state === 'suspended') {
        const lcd = document.getElementById('lcd-info');
        if (lcd) lcd.textContent = 'AUDIO SUSPENDED';
      }
    };

    // Auto-resume on any user interaction
    const resumeHandler = () => {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          console.log('[AUDIO HEALTH] Resumed on interaction');
          const lcd = document.getElementById('lcd-info');
          if (lcd) lcd.textContent = 'READY';
        });
      }
    };
    document.addEventListener('pointerdown', resumeHandler);
    document.addEventListener('keydown', resumeHandler);

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
    // Use JS preset array (includes modulator envelope at indices 16-20)
    const idx = Math.max(0, Math.min(99, index));
    const params = (typeof YAMABRUH_PRESETS !== 'undefined' && YAMABRUH_PRESETS[idx])
      ? [...YAMABRUH_PRESETS[idx]]
      : [];
    // Fallback to WASM for base 16 params if JS array missing
    if (params.length === 0) {
      for (let pi = 0; pi < 16; pi++) {
        params.push(this.wasm.get_preset_param(index, pi));
      }
    }
    this._presetCache.set(index, params);
    return params;
  }

  setSequenceDef(index, def) {
    const normalized = normalizeSequenceDef(def);
    if (normalized) this._sequenceDefs.set(index, normalized);
    else this._sequenceDefs.delete(index);
  }

  getSequenceDef(index) {
    return this._sequenceDefs.get(index) || null;
  }

  onNoteEnded(noteId, callback) {
    if (typeof callback !== 'function') return;
    const listeners = this._noteEndListeners.get(noteId) || [];
    listeners.push(callback);
    this._noteEndListeners.set(noteId, listeners);
  }

  _emitNoteEnded(noteId) {
    const listeners = this._noteEndListeners.get(noteId);
    if (!listeners || !listeners.length) return;
    this._noteEndListeners.delete(noteId);
    listeners.forEach((listener) => {
      try { listener(); } catch (error) {}
    });
  }

  _sendPreset() {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: 'preset',
      params: this.getPresetParams(this.currentPreset),
    });
  }

  _postNoteOn(noteId, midiNote, velocity, preset, cents = 0, noteAlgo = null, sustain = false) {
    if (!this.workletNode) return noteId;
    const freq = 440 * Math.pow(2, (midiNote - 69 + cents / 100) / 12);
    const msg = { type: 'noteOn', note: noteId, freq, velocity, preset };
    if (noteAlgo) msg.noteAlgo = noteAlgo;
    if (sustain) msg.sustain = true;
    this.workletNode.port.postMessage(msg);
    return noteId;
  }

  _postNoteOff(noteId) {
    if (!this.workletNode) return;
    this.workletNode.port.postMessage({
      type: 'noteOff',
      note: noteId,
    });
  }

  _beatsToMs(beats) {
    return (60000 / this.bpm) * beats;
  }

  // Sound param names → 21-param array indices
  static SOUND_PARAM_MAP = {
    cRatio: 0, mRatio: 1, mDepth: 2,
    cAttack: 3, cDecay: 4, cSustain: 5, cRelease: 6,
    mFeedback: 7, cWave: 8, mWave: 9,
    tremolo: 10, vibrato: 11, ksr: 12, ksl: 13,
    modLevel: 14, cEgType: 15,
    mAttack: 16, mDecay: 17, mSustain: 18, mRelease: 19, mEgType: 20,
  };

  _applyAlgoPreset(basePreset, step) {
    if (!step || typeof step !== 'object') return basePreset;
    const map = YamaBruhSynth.SOUND_PARAM_MAP;
    let modified = null;
    for (const key in map) {
      const val = step[key];
      if (val !== undefined && Number.isFinite(Number(val))) {
        if (!modified) modified = (Array.isArray(basePreset) ? basePreset : []).slice();
        modified[map[key]] = Number(val);
      }
    }
    return modified || basePreset;
  }

  _playSequence(midiNote, velocity, presetIndex, preset, sequence) {
    const maxAlgorithmSteps = 128;
    const initialAlgorithmTime = sequence.defaultTime;
    const initialAlgorithmGate = sequence.gate;
    const token = `seq:${this._sequenceCounter++}`;
    const state = {
      token,
      released: false,
      stopped: false,
      cycle: 0,
      currentVoiceId: null,
      timers: new Set(),
      sequence,
      midiNote,
      velocity,
      preset,
    };
    this._activeSequences.set(token, state);

    const schedule = (fn, delayMs) => {
      const timer = setTimeout(() => {
        state.timers.delete(timer);
        fn();
      }, Math.max(0, delayMs));
      state.timers.add(timer);
    };

    const stopCurrentVoice = () => {
      if (state.currentVoiceId === null) return;
      this._postNoteOff(state.currentVoiceId);
      state.currentVoiceId = null;
    };

    const finishSequence = () => {
      if (state.stopped) return;
      state.stopped = true;
      stopCurrentVoice();
      state.timers.forEach((timer) => clearTimeout(timer));
      state.timers.clear();
      this._activeSequences.delete(token);
      this._emitNoteEnded(token);
    };

    const getAlgorithmFallbackTime = () => {
      return sequence.defaultTime;
    };

    const normalizeAlgorithmTime = (value, index) => {
      if (Number.isFinite(value)) return clamp(value, 0.01, 8);
      return getAlgorithmFallbackTime();
    };

    const normalizeAlgorithmGate = (value, fallback) => {
      if (Number.isFinite(value)) return clamp(value, 0.05, 1.5);
      return clamp(fallback ?? sequence.gate, 0.05, 1.5);
    };

    const startTime = performance.now();
    let lastStepTime = startTime;

    const runAlgorithmStep = (step) => {
      if (state.stopped) return;
      if (sequence.gated && state.released) { finishSequence(); return; }
      const now = performance.now();
      const dt = (now - lastStepTime) / 1000;
      const time = (now - startTime) / 1000;
      lastStepTime = now;
      const note = Number(step?.n ?? step?.note);
      const stepVelocity = Number(step?.v ?? step?.velocity);
      const index = Number(step?.i);
      if (!Number.isFinite(note) || !Number.isFinite(stepVelocity) || stepVelocity < 0 || !Number.isFinite(index) || index >= maxAlgorithmSteps) {
        finishSequence();
        return;
      }

      const stepTime = normalizeAlgorithmTime(
        Number(step?.t ?? step?.time ?? step?.ms),
        index,
      );
      const stepGate = normalizeAlgorithmGate(
        Number(step?.g ?? step?.gate),
        step?.g ?? step?.gate ?? initialAlgorithmGate,
      );
      const stepCents = Number.isFinite(Number(step?.cents)) ? Number(step.cents) : 0;
      const voiceId = `${token}:alg:${index}`;
      const clampedVelocity = clamp(stepVelocity, 0.001, 1);
      // Build sound param snapshot for context
      const soundParams = {};
      const sMap = YamaBruhSynth.SOUND_PARAM_MAP;
      const baseArr = Array.isArray(preset) ? preset : this.getPresetParams(presetIndex);
      const stepSoundArr = step._sound || baseArr;
      for (const key in sMap) soundParams[key] = stepSoundArr[sMap[key]];
      const stepSus = step?.sus !== undefined ? (step.sus ? 1 : 0) : (state.released ? 0 : 1);
      let nextState = null;
      const context = {
        n: note,
        v: stepVelocity,
        i: index,
        t: stepTime,
        g: stepGate,
        cents: stepCents,
        sus: stepSus,
        dt,
        time,
        rootN: midiNote,
        rootV: velocity,
        rootT: initialAlgorithmTime,
        rootG: initialAlgorithmGate,
        ...soundParams,
      };

      try {
        nextState = sequence.algorithmFn.length >= 2
          ? sequence.algorithmFn(note, stepVelocity, index, midiNote, velocity, stepTime, stepGate) // legacy multi-arg
          : sequence.algorithmFn(context);
      } catch (error) {
        console.error('[SEQ ALGO] Execution failed:', error);
        finishSequence();
        return;
      }
      const stepPreset = this._applyAlgoPreset(stepSoundArr, step);
      const stepMs = this._beatsToMs(stepTime);
      const holdTime = Math.max(10, stepMs * stepGate);

      stopCurrentVoice();
      state.currentVoiceId = voiceId;
      this._postNoteOn(voiceId, note, clampedVelocity, stepPreset, stepCents, sequence.noteAlgo, stepSus === 1);

      schedule(() => {
        if (state.currentVoiceId === voiceId) {
          this._postNoteOff(voiceId);
          state.currentVoiceId = null;
        }
      }, holdTime);

      if (!nextState || typeof nextState !== 'object') {
        schedule(finishSequence, stepMs);
        return;
      }

      const nextNote = Number(nextState.n ?? nextState.note);
      const nextVelocity = Number(nextState.v ?? nextState.velocity);
      if (!Number.isFinite(nextNote) || !Number.isFinite(nextVelocity) || nextVelocity < 0) {
        schedule(finishSequence, stepMs);
        return;
      }

      const nextTime = normalizeAlgorithmTime(
        Number(nextState.t ?? nextState.time ?? nextState.ms),
        index + 1,
      );
      const nextGate = normalizeAlgorithmGate(
        Number(nextState.g ?? nextState.gate),
        stepGate,
      );

      const nextCents = Number.isFinite(Number(nextState.cents)) ? Number(nextState.cents) : stepCents;
      const nextSound = this._applyAlgoPreset(stepSoundArr, nextState);

      schedule(() => runAlgorithmStep({
        n: nextNote,
        v: nextVelocity,
        i: index + 1,
        t: nextTime,
        g: nextGate,
        cents: nextCents,
        sus: nextState.sus !== undefined ? (nextState.sus ? 1 : 0) : undefined,
        _sound: nextSound !== stepSoundArr ? nextSound : step._sound,
      }), stepMs);
    };

    const runStep = (index) => {
      if (state.stopped) return;
      if (sequence.gated && state.released) { finishSequence(); return; }
      if (index >= sequence.offsets.length) {
        finishSequence();
        return;
      }

      const stepNote = midiNote + sequence.offsets[index];
      const stepVelocity = clamp(velocity * sequence.levels[index], 0.001, 1);
      const stepMs = this._beatsToMs(sequence.times[index]);
      const holdTime = Math.max(10, stepMs * sequence.gate);
      const voiceId = `${token}:${state.cycle}:${index}`;

      stopCurrentVoice();
      state.currentVoiceId = voiceId;
      this._postNoteOn(voiceId, stepNote, stepVelocity, preset, 0, sequence.noteAlgo);

      schedule(() => {
        if (state.currentVoiceId === voiceId) {
          this._postNoteOff(voiceId);
          state.currentVoiceId = null;
        }
      }, holdTime);

      schedule(() => runStep(index + 1), stepMs);
    };

    if (sequence.algorithmFn) {
      runAlgorithmStep({
        n: sequence.initN !== null ? midiNote + sequence.initN : midiNote,
        v: sequence.initV ?? velocity,
        i: 0,
        t: sequence.initT ?? initialAlgorithmTime,
        g: sequence.initG ?? initialAlgorithmGate,
        cents: sequence.initCents,
      });
      return token;
    }

    runStep(0);
    return token;
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
  // Optional presetIndex overrides current preset (for MIDI channel routing)
  playNote(midiNote, velocity = 0.8, presetIndex) {
    this.ensureContext();
    if (!this.workletNode) return midiNote;

    const resolvedPreset = presetIndex !== undefined ? presetIndex : this.currentPreset;
    const preset = presetIndex !== undefined
      ? this.getPresetParams(presetIndex)
      : this.getPresetParams(this.currentPreset);
    const sequence = this.getSequenceDef(resolvedPreset);
    if (sequence) {
      return this._playSequence(midiNote, velocity, resolvedPreset, preset, sequence);
    }
    this._postNoteOn(midiNote, midiNote, velocity, preset);
    return midiNote;
  }

  stopNote(noteId) {
    if (typeof noteId === 'string' && this._activeSequences.has(noteId)) {
      const sequence = this._activeSequences.get(noteId);
      sequence.released = true;
      return false;
    }
    if (!this.workletNode) return;
    this._postNoteOff(noteId);
    return true;
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
    const keys = ['carrierRatio','modRatio','modIndex','attack','decay','sustain','release','feedback',
      'carrierWave','modWave','tremolo','chipVibrato','ksr','ksl','modLevel','egType'];
    keys.forEach((k, i) => {
      if (params[k] !== undefined) {
        this.wasm.set_custom_param(i, params[k]);
      }
    });
  }

  // ── Effect toggles (PSS-470 style) ──────────────────────────────────

  setVibrato(on, rate, depth) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'vibrato', on, rate, depth });
    }
    if (this.wasm?.set_vibrato) {
      this.wasm.set_vibrato(on ? 1 : 0, rate || 5.5, depth ?? 0.004);
    }
  }

  setPortamento(on, time) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'portamento', on, time });
    }
  }

  setSustain(on, mult) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'sustain', on, mult });
    }
    if (this.wasm?.set_sustain) {
      this.wasm.set_sustain(on ? 1 : 0, mult || 3.0);
    }
  }

  setDelay(beats, feedback, mix) {
    if (!this.workletNode) return;
    const timeSec = this._beatsToMs(beats) / 1000;
    const timeSamples = Math.floor(timeSec * 44100);
    this.workletNode.port.postMessage({
      type: 'delay',
      timeSamples,
      feedback: feedback / 100,
      mix: mix / 100,
    });
  }
}

window.synth = new YamaBruhSynth();
