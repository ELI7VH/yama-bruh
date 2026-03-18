// ── YAMA-BRUH AudioWorklet FM Synth (YM2413 Views) ─────────────────────
// Accepts either the legacy param array or a chip-shaped preset object.

const CHIP_TREM_DEPTH = 0.28;
const CHIP_VIB_DEPTH = 0.008;
const KSL_DB_PER_OCT = [0, 1.5, 3, 6];
const FEEDBACK_TABLE = [0, Math.PI / 16, Math.PI / 8, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 2, Math.PI * 4];
const CHOKE_FADE_SECONDS = 0.006;
const ENV_FLOOR = 1e-5;
const ENV_SNAP = 2e-4;
const VOICE_DONE_LEVEL = 0.004;
const VOICE_VISIBLE_LEVEL = 0.008;
const SUS_ON_RELEASE_SECONDS = 0.31;
const SUS_ON_SUSTAIN_SECONDS = 1.2;

function makeOperator(overrides = {}) {
  return {
    mult: 1,
    attack: 0.01,
    decay: 0.2,
    sustain: 0.7,
    release: 0.2,
    wave: 0,
    tremolo: false,
    vibrato: false,
    sustained: true,
    ksr: 0,
    ksl: 0,
    ...overrides,
  };
}

function makePreset(overrides = {}) {
  return {
    modDepth: 1.0,
    feedback: 0,
    modLevel: 1,
    carrier: makeOperator(),
    modulator: makeOperator(),
    ...overrides,
  };
}

function normalizeBool(value, fallback = false) {
  return value === undefined ? fallback : !!value;
}

function normalizeNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeOperator(op, fallback) {
  const src = op || {};
  return makeOperator({
    mult: normalizeNumber(src.mult ?? src.ratio, fallback.mult),
    attack: normalizeNumber(src.attack, fallback.attack),
    decay: normalizeNumber(src.decay, fallback.decay),
    sustain: normalizeNumber(src.sustain ?? src.sustainLevel, fallback.sustain),
    release: normalizeNumber(src.release, fallback.release),
    wave: normalizeNumber(src.wave ?? src.waveform, fallback.wave) | 0,
    tremolo: normalizeBool(src.tremolo, fallback.tremolo),
    vibrato: normalizeBool(src.vibrato, fallback.vibrato),
    sustained: normalizeBool(src.sustained, fallback.sustained),
    ksr: normalizeBool(src.ksr, fallback.ksr) ? 1 : 0,
    ksl: Math.max(0, Math.min(3, normalizeNumber(src.ksl, fallback.ksl) | 0)),
  });
}

function arrayToPreset(params) {
  const p = Array.isArray(params) ? params : [];
  const carrierPerc = (p[15] || 0) > 0.5;
  const modPerc = (p[20] || 0) > 0.5;
  return makePreset({
    modDepth: normalizeNumber(p[2], 1.0),
    feedback: normalizeNumber(p[7], 0),
    modLevel: normalizeNumber(p[14], 1),
    carrier: makeOperator({
      mult: normalizeNumber(p[0], 1),
      attack: normalizeNumber(p[3], 0.01),
      decay: normalizeNumber(p[4], 0.3),
      sustain: normalizeNumber(p[5], 0.7),
      release: normalizeNumber(p[6], 0.2),
      wave: normalizeNumber(p[8], 0) | 0,
      tremolo: (p[10] || 0) > 0,
      vibrato: (p[11] || 0) > 0,
      sustained: !carrierPerc,
      ksr: (p[12] || 0) > 0,
      ksl: Math.max(0, Math.min(3, normalizeNumber(p[13], 0) | 0)),
    }),
    modulator: makeOperator({
      mult: normalizeNumber(p[1], 1),
      attack: normalizeNumber(p[16], normalizeNumber(p[3], 0.01)),
      decay: normalizeNumber(p[17], normalizeNumber(p[4], 0.3)),
      sustain: normalizeNumber(p[18], normalizeNumber(p[5], 0.7)),
      release: normalizeNumber(p[19], normalizeNumber(p[6], 0.2)),
      wave: normalizeNumber(p[9], 0) | 0,
      tremolo: false,
      vibrato: false,
      sustained: !modPerc,
      ksr: (p[12] || 0) > 0,
      ksl: 0,
    }),
  });
}

function normalizePreset(data) {
  if (Array.isArray(data)) return arrayToPreset(data);
  const fallback = makePreset();
  const src = data || {};
  return makePreset({
    modDepth: normalizeNumber(src.modDepth, fallback.modDepth),
    feedback: normalizeNumber(src.feedback, fallback.feedback),
    modLevel: normalizeNumber(src.modLevel, fallback.modLevel),
    carrier: normalizeOperator(src.carrier, fallback.carrier),
    modulator: normalizeOperator(src.modulator, fallback.modulator),
  });
}

function tremoloGain(enabled, tremVal, modWheel, modTarget) {
  if (!enabled && modTarget !== 'tremolo') return 1;
  const depth = CHIP_TREM_DEPTH + (modTarget === 'tremolo' ? modWheel * 0.18 : 0);
  return 1 - depth * (1 + tremVal) * 0.5;
}

function vibratoDepth(enabled, modWheel, modTarget) {
  if (!enabled && modTarget !== 'vibrato') return 0;
  return CHIP_VIB_DEPTH + (modTarget === 'vibrato' ? modWheel * 0.004 : 0);
}

function kslAttenuation(freq, bits) {
  const dbPerOct = KSL_DB_PER_OCT[Math.max(0, Math.min(3, bits | 0))];
  if (dbPerOct === 0 || freq <= 440) return 1;
  const octave = Math.log2(freq / 440);
  return Math.pow(10, -(dbPerOct * octave) / 20);
}

function envelopeStep(current, target, seconds, sr) {
  if (seconds <= 0.00001) return target;
  const samples = Math.max(1, seconds * sr);
  const coeff = 1 - Math.exp(-5 / samples);
  return current + (target - current) * coeff;
}

class YamaBruhProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.preset = makePreset();
    // Delay effect — max 2 beats at 60 BPM = 2 seconds, but allow up to 4s for safety
    this.delayBuffer = new Float32Array(Math.ceil(sampleRate * 4));
    this.delayWritePos = 0;
    this.delayTimeSamples = Math.floor(sampleRate * 0.5); // default 0.5s
    this.delayFeedback = 0.3;
    // Lowpass filter (state-variable)
    this.filterCutoff = 20000;
    this.filterReso = 0;
    this.filterLow = 0;
    this.filterBand = 0;
    this.delayMix = 0.25;
    // YM2413 LFO phases (shared across voices like hardware)
    this.tremoloPhase = 0;  // 3.7Hz AM
    this.chipVibPhase = 0;  // 6.4Hz pitch
    // User vibrato LFO
    this.vibratoOn = false;
    this.vibratoRate = 5.5;
    this.vibratoDepth = 0.004;
    this.vibratoPhase = 0;
    // Portamento
    this.portaOn = false;
    this.portaTime = 0.08;
    this.lastFreq = 0;
    // Global sustain
    this.sustainOn = false;
    this.sustainMult = 3.0;
    // Pitch bend (±2 semitones default, stored as multiplier)
    this.pitchBend = 1.0;       // frequency multiplier (1.0 = no bend)
    this.pitchBendRange = 2;    // semitones
    // Mod wheel
    this.modWheel = 0;          // 0-1 normalized
    this.modTarget = 'vibrato'; // 'vibrato' | 'modIndex' | 'tremolo'
    this.chokeSameNotes = false;
    this.monoMode = false;
    this.maxVoices = 16;
    // Crash diagnostics
    this._crashCount = 0;
    this._lastCrashReport = 0;
    // YM2413-style 23-bit LFSR noise generator (shared, like hardware)
    this.lfsr = 1;
    this.noiseOut = 0;
    this.noiseClock = 0;
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _reportCrash(reason, detail) {
    this._crashCount++;
    const now = currentTime;
    if (now - this._lastCrashReport > 1) {
      this._lastCrashReport = now;
      this.port.postMessage({ type: 'crash', reason, detail, count: this._crashCount });
    }
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'noteOn': {
        if (this.monoMode) {
          for (const voice of this.voices) {
            if (!voice.choking) {
              voice.choking = true;
              voice.chokePos = 0;
              voice.chokeLen = Math.max(1, Math.floor(sampleRate * CHOKE_FADE_SECONDS));
            }
          }
        }
        if (this.chokeSameNotes) {
          for (const voice of this.voices) {
            if (voice.key === (msg.sourceNote ?? msg.note) && !voice.choking) {
              voice.choking = true;
              voice.chokePos = 0;
              voice.chokeLen = Math.max(1, Math.floor(sampleRate * CHOKE_FADE_SECONDS));
            }
          }
        }
        while (this.voices.length >= this.maxVoices) this.voices.shift();
        const startFreq = (this.portaOn && this.lastFreq > 0) ? this.lastFreq : msg.freq;
        this.lastFreq = msg.freq;
        this.voices.push({
          note: msg.note,
          key: msg.sourceNote ?? msg.note,
          freq: msg.freq,
          curFreq: startFreq,
          velocity: msg.velocity,
          cp: 0, mp: 0, pm: 0,
          choking: false,
          chokePos: 0,
          chokeLen: 0,
          // Carrier envelope
          es: 0, el: ENV_FLOOR,
          // Modulator envelope
          mes: 0, mel: ENV_FLOOR,
          sustainOn: !!msg.sustain,
          age: 0,
          sampleIndex: 0,
          noteAlgo: compileNoteAlgo(msg.noteAlgo),
          p: normalizePreset(msg.preset || this.preset),
        });
        break;
      }
      case 'noteOff': {
        for (const v of this.voices) {
          if (v.note === msg.note && v.es < 3) {
            v.es = 3;
            if (v.mes < 3) {
              v.mes = 3;
            }
          }
        }
        break;
      }
      case 'preset': {
        this.preset = normalizePreset(msg.params);
        // Update all active voices so fader changes are heard immediately
        for (const v of this.voices) {
          v.p = this.preset;
        }
        break;
      }
      case 'vibrato': {
        this.vibratoOn = msg.on;
        if (msg.rate !== undefined) this.vibratoRate = msg.rate;
        if (msg.depth !== undefined) this.vibratoDepth = msg.depth;
        break;
      }
      case 'portamento': {
        this.portaOn = msg.on;
        if (msg.time !== undefined) this.portaTime = msg.time;
        break;
      }
      case 'sustain': {
        this.sustainOn = msg.on;
        if (msg.mult !== undefined) this.sustainMult = msg.mult;
        break;
      }
      case 'pitchBend': {
        // msg.value: 0-16383 (14-bit MIDI), 8192 = center
        const centered = (msg.value - 8192) / 8192; // -1 to +1
        this.pitchBend = Math.pow(2, centered * this.pitchBendRange / 12);
        break;
      }
      case 'modWheel': {
        this.modWheel = msg.value; // 0-1 normalized
        break;
      }
      case 'modTarget': {
        this.modTarget = msg.target || 'vibrato'; // 'vibrato' | 'modIndex' | 'tremolo'
        break;
      }
      case 'pitchBendRange': {
        this.pitchBendRange = msg.semitones || 2;
        break;
      }
      case 'chokeSameNotes': {
        this.chokeSameNotes = !!msg.on;
        break;
      }
      case 'monoMode': {
        this.monoMode = !!msg.on;
        break;
      }
      case 'setMaxVoices': {
        this.maxVoices = Math.max(1, Math.min(16, msg.count | 0));
        while (this.voices.length > this.maxVoices) this.voices.shift();
        break;
      }
      case 'filter': {
        if (msg.cutoff !== undefined) this.filterCutoff = Math.max(20, Math.min(20000, msg.cutoff));
        if (msg.reso !== undefined) this.filterReso = Math.max(0, Math.min(30, msg.reso));
        break;
      }
      case 'delay': {
        if (msg.timeSamples !== undefined) this.delayTimeSamples = Math.max(1, Math.min(this.delayBuffer.length - 1, msg.timeSamples | 0));
        if (msg.feedback !== undefined) this.delayFeedback = Math.max(0, Math.min(0.98, msg.feedback));
        if (msg.mix !== undefined) this.delayMix = Math.max(0, Math.min(1, msg.mix));
        break;
      }
      case 'healthCheck': {
        this.port.postMessage({
          type: 'health',
          voices: this.voices.length,
          maxVoices: this.maxVoices,
          limiter: 'soft-knee',
          engine: 'ym2413-extended',
          crashes: this._crashCount,
          pitchBend: this.pitchBend,
          modWheel: this.modWheel,
          modTarget: this.modTarget,
        });
        break;
      }
      case 'voiceSnapshot': {
        this.port.postMessage({
          type: 'voiceSnapshot',
          maxVoices: this.maxVoices,
          voices: this.voices.map((voice, index) => ({
            slot: index,
            note: voice.note,
            key: voice.key,
            freq: voice.freq,
            env: voice.el,
            modEnv: voice.mel,
            phase: voice.cp,
            modPhase: voice.mp,
            choking: !!voice.choking,
            age: voice.age,
            carrierWave: voice.p.carrier.wave,
            modWave: voice.p.modulator.wave,
            carrierMult: voice.p.carrier.mult,
            modMult: voice.p.modulator.mult,
            modDepth: voice.p.modDepth,
            audible: voice.choking || voice.el > VOICE_VISIBLE_LEVEL,
          })),
        });
        break;
      }
    }
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const sr = sampleRate;
    const TAU = 6.283185307179586;
    const HALF_PI = 1.5707963;
    const len = out.length;
    const dt = 1 / sr;

    const vibOn = this.vibratoOn;
    const vibRate = this.vibratoRate;
    const vibDepth = this.vibratoDepth;
    const portaOn = this.portaOn;
    const portaCoeff = this.portaTime > 0.001 ? Math.exp(-dt / this.portaTime) : 0;
    const susOn = this.sustainOn;
    const susMult = this.sustainMult;
    const pbMult = this.pitchBend;
    const modW = this.modWheel;
    const modTgt = this.modTarget;

    for (let i = 0; i < len; i++) {
      let s = 0;

      // ── YM2413 noise LFSR (clocked every sample for full-bandwidth noise) ──
      // 23-bit LFSR: taps at bits 0 and 14 (matches YM2413 hardware)
      const bit = ((this.lfsr >> 0) ^ (this.lfsr >> 14)) & 1;
      this.lfsr = ((this.lfsr >> 1) | (bit << 22)) & 0x7FFFFF;
      const noise = (this.lfsr & 1) ? 1 : -1;

      // ── YM2413 shared LFOs (hardware-accurate: single LFO for all voices) ──
      // Tremolo at 3.7Hz
      const tremVal = Math.sin(this.tremoloPhase);
      this.tremoloPhase += TAU * 3.7 * dt;
      if (this.tremoloPhase > TAU) this.tremoloPhase -= TAU;

      // Chip vibrato at 6.4Hz
      const chipVibVal = Math.sin(this.chipVibPhase);
      this.chipVibPhase += TAU * 6.4 * dt;
      if (this.chipVibPhase > TAU) this.chipVibPhase -= TAU;

      // User vibrato
      let vibMod = 0;
      if (vibOn) {
        vibMod = Math.sin(this.vibratoPhase) * vibDepth;
        this.vibratoPhase += TAU * vibRate * dt;
        if (this.vibratoPhase > TAU) this.vibratoPhase -= TAU;
      }

      for (let vi = this.voices.length - 1; vi >= 0; vi--) {
        const v = this.voices[vi];
        const p = v.p;
        const c = p.carrier;
        const m = p.modulator;

        // Portamento
        if (portaOn && v.curFreq !== v.freq) {
          v.curFreq = v.freq + (v.curFreq - v.freq) * portaCoeff;
          if (Math.abs(v.curFreq - v.freq) < 0.1) v.curFreq = v.freq;
        } else {
          v.curFreq = v.freq;
        }

        // Apply pitch bend + noteAlgo to base frequency and synth params
        let noteAlgoCents = 0;
        let naMod = null; // noteAlgo modulations
        if (v.noteAlgo) {
          try {
            const result = v.noteAlgo({
              time: v.age, i: v.sampleIndex, freq: v.curFreq,
              v: v.velocity, n: v.note, dt,
              feedback: p.feedback, mDepth: p.modDepth,
              cRatio: c.mult, mRatio: m.mult,
              cWave: c.wave, mWave: m.wave,
            });
            if (typeof result === 'number') {
              noteAlgoCents = result;
            } else if (result && typeof result === 'object') {
              noteAlgoCents = result.cents || 0;
              naMod = result;
            }
          } catch (_) { v.noteAlgo = null; }
        }
        v.sampleIndex++;
        const baseFreq = v.curFreq * pbMult * (noteAlgoCents !== 0 ? Math.pow(2, noteAlgoCents / 1200) : 1);

        // noteAlgo can override synth params per-sample
        const naFeedback = naMod && Number.isFinite(naMod.feedback) ? naMod.feedback : p.feedback;
        const naModDepth = naMod && Number.isFinite(naMod.mDepth) ? naMod.mDepth : p.modDepth;
        const naCMult = naMod && Number.isFinite(naMod.cRatio) ? naMod.cRatio : c.mult;
        const naMMult = naMod && Number.isFinite(naMod.mRatio) ? naMod.mRatio : m.mult;
        const naCWave = naMod && Number.isFinite(naMod.cWave) ? (naMod.cWave | 0) : c.wave;
        const naMWave = naMod && Number.isFinite(naMod.mWave) ? (naMod.mWave | 0) : m.wave;

        // Mod wheel can still boost mod index in the extended control path.
        const mi = modTgt === 'modIndex' ? naModDepth * (1 + modW * 3) : naModDepth;
        const cRel = susOn ? c.release * susMult : c.release;
        const mRel = susOn ? m.release * susMult : m.release;
        const cVib = vibratoDepth(c.vibrato, modW, modTgt);
        const mVib = vibratoDepth(m.vibrato, modW, modTgt);
        const cFreq = baseFreq * (1 + cVib * chipVibVal + vibMod);
        const mFreq = baseFreq * (1 + mVib * chipVibVal + vibMod);

        const crf = cFreq * naCMult;
        const mrf = mFreq * naMMult;

        // KSR scales envelope speed per operator.
        let atkScaled = c.attack, decScaled = c.decay, relScaled = cRel;
        if (c.ksr) {
          const octave = Math.log2(baseFreq / 440);
          const ksrFactor = Math.pow(2, -octave);
          atkScaled *= ksrFactor;
          decScaled *= ksrFactor;
          relScaled *= ksrFactor;
        }

        const cTrem = tremoloGain(c.tremolo, tremVal, modW, modTgt);
        const mTrem = tremoloGain(m.tremolo, tremVal, modW, modTgt);
        const cKsl = kslAttenuation(baseFreq, c.ksl);
        const mKsl = kslAttenuation(baseFreq, m.ksl);
        const cSus = Math.max(ENV_FLOOR, Math.min(1, c.sustain));
        const mSus = Math.max(ENV_FLOOR, Math.min(1, m.sustain));

        // Age tracking
        v.age += dt;
        if (v.age > 30) { this.voices.splice(vi, 1); continue; }

        // ── Modulator Envelope ──
        let mEnv;
        let mAtkS = m.attack, mDecS = m.decay, mRelS = mRel;
        if (m.ksr) {
          const octave = Math.log2(baseFreq / 440);
          const ksrFactor = Math.pow(2, -octave);
          mAtkS *= ksrFactor;
          mDecS *= ksrFactor;
          mRelS *= ksrFactor;
        }
        const cKeyOffRel = v.sustainOn ? SUS_ON_RELEASE_SECONDS : relScaled;
        const mKeyOffRel = v.sustainOn ? SUS_ON_RELEASE_SECONDS : mRelS;
        const cHoldRate = v.sustainOn ? SUS_ON_SUSTAIN_SECONDS : relScaled;
        const mHoldRate = v.sustainOn ? SUS_ON_SUSTAIN_SECONDS : mRelS;

        if (v.mes === 0) {
          v.mel = envelopeStep(v.mel, 1, mAtkS, sr);
          if (v.mel >= 1 - ENV_SNAP) {
            v.mel = 1;
            v.mes = 1;
          }
        } else if (v.mes === 1) {
          v.mel = envelopeStep(v.mel, mSus, mDecS, sr);
          if (Math.abs(v.mel - mSus) <= ENV_SNAP) {
            v.mel = mSus;
            v.mes = 2;
          }
        } else if (v.mes === 2) {
          if (m.sustained) {
            v.mel = v.sustainOn ? envelopeStep(v.mel, ENV_FLOOR, SUS_ON_SUSTAIN_SECONDS, sr) : mSus;
          } else {
            v.mel = envelopeStep(v.mel, ENV_FLOOR, mHoldRate, sr);
          }
        } else {
          v.mel = envelopeStep(v.mel, ENV_FLOOR, mKeyOffRel, sr);
        }
        mEnv = v.mel;

        // ── Carrier Envelope ──
        let env;
        if (v.es === 0) {
          v.el = envelopeStep(v.el, 1, atkScaled, sr);
          if (v.el >= 1 - ENV_SNAP) {
            v.el = 1;
            v.es = 1;
          }
        } else if (v.es === 1) {
          v.el = envelopeStep(v.el, cSus, decScaled, sr);
          if (Math.abs(v.el - cSus) <= ENV_SNAP) {
            v.el = cSus;
            v.es = 2;
          }
        } else if (v.es === 2) {
          if (c.sustained) {
            v.el = v.sustainOn ? envelopeStep(v.el, ENV_FLOOR, SUS_ON_SUSTAIN_SECONDS, sr) : cSus;
          } else {
            v.el = envelopeStep(v.el, ENV_FLOOR, cHoldRate, sr);
          }
        } else {
          v.el = envelopeStep(v.el, ENV_FLOOR, cKeyOffRel, sr);
        }
        env = v.el;
        if (env <= VOICE_DONE_LEVEL && (v.es >= 2 || v.mes >= 2)) {
          this.voices.splice(vi, 1);
          continue;
        }

        // ── 2-op FM with YM2413 waveforms ──
        // Feedback uses raw (pre-envelope) modulator — hardware-accurate
        const msRaw = _waveform(v.mp + naFeedback * v.pm, naMWave, noise);
        v.pm = msRaw; // feedback loop stays alive regardless of mod envelope
        const ms = msRaw * p.modLevel * mEnv * mTrem * mKsl;
        const voiceSample = _waveform(v.cp + mi * ms, naCWave, noise) * env * v.velocity * 0.35 * cTrem * cKsl;
        let outSample = voiceSample;

        if (v.choking) {
          const chokeMul = Math.max(0, 1 - (v.chokePos / Math.max(1, v.chokeLen)));
          outSample *= chokeMul;
          v.chokePos++;
          if (v.chokePos >= v.chokeLen) {
            this.voices.splice(vi, 1);
            continue;
          }
        }

        // NaN guard
        if (outSample !== outSample || !isFinite(v.cp) || !isFinite(v.mp)) {
          this._reportCrash('nan_voice', { note: v.note, freq: v.freq, cp: v.cp, mp: v.mp });
          this.voices.splice(vi, 1);
          continue;
        }

        s += outSample;

        v.cp += TAU * crf / sr;
        v.mp += TAU * mrf / sr;
        if (v.cp > TAU) v.cp -= TAU;
        if (v.mp > TAU) v.mp -= TAU;
      }

      // NaN guard
      if (s !== s) {
        s = 0;
        this._reportCrash('nan_output', { voices: this.voices.length });
      }

      // ── YM2413 DAC noise (9-bit quantization + noise floor) ────
      // Simulate the chip's lo-fi DAC: bit-crush to ~9-bit resolution
      const dacLevels = 512; // 9-bit DAC
      s = Math.round(s * dacLevels) / dacLevels;
      // Analog noise floor — subtle hiss like real hardware
      s += (Math.random() - 0.5) * 0.0012;

      // ── Lowpass filter (state-variable, 2x oversampled) ────────
      if (this.filterCutoff < 19999) {
        const f = Math.min(0.45, 2 * Math.sin(Math.PI * Math.min(this.filterCutoff, sr * 0.22) / sr));
        const q = 1 / (1 + this.filterReso * 0.0333);
        for (let oi = 0; oi < 2; oi++) {
          this.filterLow += f * this.filterBand;
          const high = s - this.filterLow - q * this.filterBand;
          this.filterBand += f * high;
        }
        // NaN guard
        if (this.filterLow !== this.filterLow || this.filterBand !== this.filterBand) {
          this.filterLow = 0;
          this.filterBand = 0;
        }
        s = this.filterLow;
      }

      // ── Soft-knee limiter (no compressor) ──────────────────────
      const absS = s < 0 ? -s : s;
      if (absS > 0.5) {
        const over = absS - 0.5;
        const gain = 0.5 + over / (1.0 + over * 2.0);
        s = s < 0 ? -gain : gain;
      }
      if (s > 0.95) s = 0.95;
      else if (s < -0.95) s = -0.95;

      // ── Delay effect ─────────────────────────────────────────────
      const dBuf = this.delayBuffer;
      const dLen = dBuf.length;
      const dTime = this.delayTimeSamples;
      const dFb = this.delayFeedback;
      const dMix = this.delayMix;
      let readPos = this.delayWritePos - dTime;
      if (readPos < 0) readPos += dLen;
      const delayed = dBuf[readPos];
      dBuf[this.delayWritePos] = s + delayed * dFb;
      this.delayWritePos = (this.delayWritePos + 1) % dLen;
      s = s * (1 - dMix) + delayed * dMix;

      out[i] = s;
    }

    return true;
  }
}

// ── YM2413 Waveform Types ──────────────────────────────────────────────
// 0=sine, 1=half-sine (rectified +), 2=abs-sine, 3=quarter-sine
function _waveform(phase, type, noise) {
  switch (type) {
    case 1: { const s = Math.sin(phase); return s > 0 ? s : 0; }
    case 2: return Math.abs(Math.sin(phase));
    case 3: {
      const TAU = 6.283185307179586;
      let p = phase % TAU;
      if (p < 0) p += TAU;
      return p < 1.5707963 ? Math.sin(p) : 0;
    }
    case 4: return noise || 0; // pure noise (YM2413 percussion LFSR)
    case 5: return (Math.sin(phase) + (noise || 0)) * 0.5; // tone + noise mix
    default: return Math.sin(phase);
  }
}

// ── noteAlgo compilation ──────────────────────────────────────────────
const _MATH_PREAMBLE = 'const{sin,cos,abs,floor,ceil,round,min,max,pow,sqrt,log,exp,random}=Math;const PI=Math.PI;const TAU=2*Math.PI;function clamp(v,lo,hi){return v<lo?lo:v>hi?hi:v;}';

function compileNoteAlgo(source) {
  if (!source || typeof source !== 'string') return null;
  try {
    return new Function(_MATH_PREAMBLE + 'return (' + source + ');')();
  } catch (e) { return null; }
}

registerProcessor('yambruh-synth', YamaBruhProcessor);
