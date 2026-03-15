// ── YAMA-BRUH AudioWorklet FM Synth ───────────────────────────────────
// Runs on audio thread — zero main-thread overhead, minimal latency

class YamaBruhProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    this.preset = [1, 1, 2, 0.01, 0.3, 0.3, 0.2, 0];
    // Compressor state
    this.comp1Env = 0;  // stage 1: gentle
    this.comp2Env = 0;  // stage 2: heavier
    this.limiterEnv = 0;
    this.port.onmessage = (e) => this._onMessage(e.data);
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
        this.voices.push({
          note: msg.note,
          freq: msg.freq,
          velocity: msg.velocity,
          cp: 0, mp: 0, pm: 0,
          es: 0, el: 0, et: 0, rl: 0,
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
    }
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const sr = sampleRate;
    const TAU = 6.283185307179586;
    const len = out.length;

    for (let i = 0; i < len; i++) {
      let s = 0;

      for (let vi = this.voices.length - 1; vi >= 0; vi--) {
        const v = this.voices[vi];
        const p = v.p;
        const crf = v.freq * p[0];
        const mrf = v.freq * p[1];
        const mi = p[2];
        const atk = p[3], dec = p[4], sus = p[5], rel = p[6], fb = p[7];
        const dt = 1 / sr;

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
        s += Math.sin(v.cp + mi * ms) * env * v.velocity * 0.35;

        v.cp += TAU * crf / sr;
        v.mp += TAU * mrf / sr;
        if (v.cp > TAU) v.cp -= TAU;
        if (v.mp > TAU) v.mp -= TAU;
      }

      // ── Two-stage compression + limiter ──────────────────────
      const abs = s < 0 ? -s : s;

      // Stage 1: gentle compression (threshold -12dB ≈ 0.25, ratio 3:1)
      const t1 = 0.25;
      const atk1 = 0.002 * sr, rel1 = 0.05 * sr;
      this.comp1Env += (abs > this.comp1Env ? 1/atk1 : -1/rel1) * (abs - this.comp1Env);
      if (this.comp1Env < 0) this.comp1Env = 0;
      if (this.comp1Env > t1) {
        const over = this.comp1Env - t1;
        const gain = t1 + over / 3;
        s *= gain / this.comp1Env;
      }

      // Stage 2: heavier compression (threshold -6dB ≈ 0.5, ratio 6:1)
      const abs2 = s < 0 ? -s : s;
      const t2 = 0.5;
      const atk2 = 0.001 * sr, rel2 = 0.04 * sr;
      this.comp2Env += (abs2 > this.comp2Env ? 1/atk2 : -1/rel2) * (abs2 - this.comp2Env);
      if (this.comp2Env < 0) this.comp2Env = 0;
      if (this.comp2Env > t2) {
        const over = this.comp2Env - t2;
        const gain = t2 + over / 6;
        s *= gain / this.comp2Env;
      }

      // Brickwall limiter at -0.1dB ≈ 0.9886
      const limit = 0.9886;
      if (s > limit) s = limit;
      else if (s < -limit) s = -limit;

      out[i] = s;
    }

    return true;
  }
}

registerProcessor('yambruh-synth', YamaBruhProcessor);
