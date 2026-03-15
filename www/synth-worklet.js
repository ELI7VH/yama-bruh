// ── YAMA-BRUH AudioWorklet FM Synth ───────────────────────────────────
// Runs on audio thread — zero main-thread overhead, minimal latency

class YamaBruhProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.preset = [1, 1, 2, 0.01, 0.3, 0.3, 0.2, 0];
    // Compressor state
    this.comp1Env = 0;
    this.comp2Env = 0;
    // Vibrato LFO state
    this.vibratoOn = false;
    this.vibratoRate = 5.5;   // Hz
    this.vibratoDepth = 0.004; // ~7 cents
    this.vibratoPhase = 0;
    // Portamento
    this.portaOn = false;
    this.portaTime = 0.08; // seconds
    this.lastFreq = 0;     // track last note frequency
    // Global sustain
    this.sustainOn = false;
    this.sustainMult = 3.0; // release multiplier when sustain engaged
    // Crash diagnostics
    this._crashCount = 0;
    this._lastCrashReport = 0;
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _reportCrash(reason, detail) {
    this._crashCount++;
    const now = currentTime;
    // Throttle reports to max 1 per second
    if (now - this._lastCrashReport > 1) {
      this._lastCrashReport = now;
      this.port.postMessage({ type: 'crash', reason, detail, count: this._crashCount });
    }
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'noteOn': {
        // Kill duplicate
        for (let i = this.voices.length - 1; i >= 0; i--) {
          if (this.voices[i].note === msg.note) {
            this.voices.splice(i, 1);
          }
        }
        // Cap polyphony at 16
        if (this.voices.length >= 16) this.voices.shift();
        // Portamento: start from last played frequency
        const startFreq = (this.portaOn && this.lastFreq > 0) ? this.lastFreq : msg.freq;
        this.lastFreq = msg.freq;
        this.voices.push({
          note: msg.note,
          freq: msg.freq,       // target frequency
          curFreq: startFreq,   // current frequency (for portamento)
          velocity: msg.velocity,
          cp: 0, mp: 0, pm: 0,
          es: 0, el: 0, et: 0, rl: 0,
          age: 0,
          p: msg.preset || this.preset,
        });
        break;
      }
      case 'noteOff': {
        for (const v of this.voices) {
          if (v.note === msg.note && v.es < 3) {
            v.es = 3; // release
            v.et = 0;
            v.rl = v.el; // release from current level
          }
        }
        break;
      }
      case 'preset': {
        this.preset = msg.params;
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
    }
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const sr = sampleRate;
    const TAU = 6.283185307179586;
    const len = out.length;
    const dt = 1 / sr;

    // Vibrato + portamento pre-compute
    const vibOn = this.vibratoOn;
    const vibRate = this.vibratoRate;
    const vibDepth = this.vibratoDepth;
    const portaOn = this.portaOn;
    const portaCoeff = this.portaTime > 0.001 ? Math.exp(-dt / this.portaTime) : 0;
    const susOn = this.sustainOn;
    const susMult = this.sustainMult;

    for (let i = 0; i < len; i++) {
      let s = 0;

      // Advance vibrato LFO (shared across all voices, like hardware)
      let vibMod = 0;
      if (vibOn) {
        vibMod = Math.sin(this.vibratoPhase) * vibDepth;
        this.vibratoPhase += TAU * vibRate * dt;
        if (this.vibratoPhase > TAU) this.vibratoPhase -= TAU;
      }

      for (let vi = this.voices.length - 1; vi >= 0; vi--) {
        const v = this.voices[vi];
        const p = v.p;

        // Portamento: glide curFreq toward target freq
        if (portaOn && v.curFreq !== v.freq) {
          v.curFreq = v.freq + (v.curFreq - v.freq) * portaCoeff;
          // Snap when close enough
          if (Math.abs(v.curFreq - v.freq) < 0.1) v.curFreq = v.freq;
        } else {
          v.curFreq = v.freq;
        }

        // Apply vibrato to frequency
        const baseFreq = v.curFreq;
        const freq = vibOn ? baseFreq * (1 + vibMod) : baseFreq;

        const crf = freq * p[0];
        const mrf = freq * p[1];
        const mi = p[2];
        const atk = p[3], dec = p[4], sus = p[5];
        const rel = susOn ? p[6] * susMult : p[6];
        const fb = p[7];

        // Track voice age — auto-kill stuck voices after 30s
        v.age += dt;
        if (v.age > 30) { this.voices.splice(vi, 1); continue; }

        // Envelope: 0=attack 1=decay 2=sustain 3=release
        let env;
        v.et += dt;

        if (v.es === 0) {
          env = atk > 0.0001 ? v.et / atk : 1;
          if (env >= 1) { env = 1; v.es = 1; v.et = 0; }
          v.el = env;
        } else if (v.es === 1) {
          const t = dec > 0.0001 ? v.et / dec : 1;
          env = t >= 1 ? sus : 1 - (1 - sus) * t;
          if (t >= 1) { v.es = 2; }
          v.el = env;
        } else if (v.es === 2) {
          env = sus;
          v.el = env;
        } else {
          const t = rel > 0.0001 ? v.et / rel : 1;
          env = t >= 1 ? 0 : v.rl * (1 - t);
          if (t >= 1) { this.voices.splice(vi, 1); continue; }
        }

        // 2-op FM
        const ms = Math.sin(v.mp + fb * v.pm);
        v.pm = ms;
        const voiceSample = Math.sin(v.cp + mi * ms) * env * v.velocity * 0.35;

        // Kill voice if it produces NaN (bad preset, phase overflow)
        if (voiceSample !== voiceSample || !isFinite(v.cp) || !isFinite(v.mp)) {
          this._reportCrash('nan_voice', { note: v.note, freq: v.freq, cp: v.cp, mp: v.mp });
          this.voices.splice(vi, 1);
          continue;
        }

        s += voiceSample;

        v.cp += TAU * crf / sr;
        v.mp += TAU * mrf / sr;
        if (v.cp > TAU) v.cp -= TAU;
        if (v.mp > TAU) v.mp -= TAU;
      }

      // NaN guard — reset if audio goes bad
      if (s !== s) {
        s = 0;
        this.comp1Env = 0;
        this.comp2Env = 0;
        this._reportCrash('nan_output', { voices: this.voices.length });
      }

      // ── Two-stage compression + limiter ──────────────────────
      const abs1 = s < 0 ? -s : s;

      // Stage 1: gentle compression (threshold -12dB ≈ 0.25, ratio 3:1)
      const t1 = 0.25;
      const atk1 = 0.002 * sr, rel1 = 0.05 * sr;
      this.comp1Env += (abs1 > this.comp1Env ? 1/atk1 : -1/rel1) * (abs1 - this.comp1Env);
      if (this.comp1Env < 0) this.comp1Env = 0;
      if (this.comp1Env > t1) {
        const over = this.comp1Env - t1;
        s *= (t1 + over / 3) / this.comp1Env;
      }

      // Stage 2: heavier compression (threshold -6dB ≈ 0.5, ratio 6:1)
      const abs2 = s < 0 ? -s : s;
      const t2 = 0.5;
      const atk2 = 0.001 * sr, rel2 = 0.04 * sr;
      this.comp2Env += (abs2 > this.comp2Env ? 1/atk2 : -1/rel2) * (abs2 - this.comp2Env);
      if (this.comp2Env < 0) this.comp2Env = 0;
      if (this.comp2Env > t2) {
        const over = this.comp2Env - t2;
        s *= (t2 + over / 6) / this.comp2Env;
      }

      // NaN guard on compressor envelopes
      if (this.comp1Env !== this.comp1Env) this.comp1Env = 0;
      if (this.comp2Env !== this.comp2Env) this.comp2Env = 0;

      // Brickwall limiter at -0.1dB ≈ 0.9886
      if (s > 0.9886) s = 0.9886;
      else if (s < -0.9886) s = -0.9886;

      out[i] = s;
    }

    return true;
  }
}

registerProcessor('yambruh-synth', YamaBruhProcessor);
