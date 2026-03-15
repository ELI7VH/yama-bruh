// ── YAMA-BRUH Drum AudioWorklet ───────────────────────────────────────
// FM-based percussion synthesis matching PSS-170/470 drum chip
// 10 drum sounds, each a short FM burst with specific parameters

class YamaBruhDrumProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hits = [];   // active drum hit voices
    this.noise = 0;   // noise state (LFSR)
    this.noiseSeed = 1;
    this.port.onmessage = (e) => this._onMessage(e.data);
  }

  _nextNoise() {
    // Linear feedback shift register for noise
    this.noiseSeed ^= this.noiseSeed << 13;
    this.noiseSeed ^= this.noiseSeed >> 17;
    this.noiseSeed ^= this.noiseSeed << 5;
    return (this.noiseSeed & 0x7fffffff) / 0x7fffffff * 2 - 1;
  }

  _onMessage(msg) {
    if (msg.type !== 'drum') return;
    const vel = msg.velocity || 0.8;
    // Each sound gets its own synthesis parameters
    const sound = this._makeDrum(msg.sound, vel);
    if (sound) this.hits.push(sound);
  }

  _makeDrum(name, vel) {
    const TAU = 6.283185307179586;
    const base = {
      t: 0,            // time elapsed
      vel,
      cp: 0, mp: 0,    // carrier/mod phase
      done: false,
    };

    switch (name) {
      case 'kick':
        return { ...base,
          carrierFreq: 60, modFreq: 90, modIndex: 3.0,
          pitchSweep: 160, pitchDecay: 0.015,
          decay: 0.25, noiseAmt: 0, clickAmt: 0.3,
        };
      case 'snare':
        return { ...base,
          carrierFreq: 200, modFreq: 340, modIndex: 2.5,
          pitchSweep: 60, pitchDecay: 0.01,
          decay: 0.18, noiseAmt: 0.6, clickAmt: 0.15,
        };
      case 'hihat_c':
        return { ...base,
          carrierFreq: 800, modFreq: 5600, modIndex: 4.0,
          pitchSweep: 0, pitchDecay: 0,
          decay: 0.04, noiseAmt: 0.5, clickAmt: 0,
        };
      case 'hihat_o':
        return { ...base,
          carrierFreq: 800, modFreq: 5600, modIndex: 4.0,
          pitchSweep: 0, pitchDecay: 0,
          decay: 0.22, noiseAmt: 0.5, clickAmt: 0,
        };
      case 'clap':
        return { ...base,
          carrierFreq: 1200, modFreq: 2400, modIndex: 1.5,
          pitchSweep: 0, pitchDecay: 0,
          decay: 0.2, noiseAmt: 0.85, clickAmt: 0,
          clapMode: true, clapCount: 3, clapGap: 0.012,
        };
      case 'tom_hi':
        return { ...base,
          carrierFreq: 240, modFreq: 360, modIndex: 2.0,
          pitchSweep: 80, pitchDecay: 0.02,
          decay: 0.2, noiseAmt: 0, clickAmt: 0.1,
        };
      case 'tom_lo':
        return { ...base,
          carrierFreq: 130, modFreq: 195, modIndex: 2.0,
          pitchSweep: 60, pitchDecay: 0.025,
          decay: 0.25, noiseAmt: 0, clickAmt: 0.1,
        };
      case 'rimshot':
        return { ...base,
          carrierFreq: 500, modFreq: 1600, modIndex: 2.0,
          pitchSweep: 200, pitchDecay: 0.005,
          decay: 0.06, noiseAmt: 0.2, clickAmt: 0.5,
        };
      case 'cowbell':
        return { ...base,
          carrierFreq: 587, modFreq: 829, modIndex: 1.8,
          pitchSweep: 0, pitchDecay: 0,
          decay: 0.12, noiseAmt: 0, clickAmt: 0.1,
        };
      case 'cymbal':
        return { ...base,
          carrierFreq: 940, modFreq: 6580, modIndex: 5.0,
          pitchSweep: 0, pitchDecay: 0,
          decay: 0.8, noiseAmt: 0.4, clickAmt: 0,
        };
      default:
        return null;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0][0];
    if (!out) return true;

    const sr = sampleRate;
    const TAU = 6.283185307179586;
    const dt = 1 / sr;

    for (let i = 0; i < out.length; i++) {
      let s = 0;

      for (let hi = this.hits.length - 1; hi >= 0; hi--) {
        const h = this.hits[hi];

        // Envelope — exponential decay
        const env = Math.exp(-h.t / (h.decay * 0.4)) * h.vel;
        if (env < 0.001) {
          this.hits.splice(hi, 1);
          continue;
        }

        // Pitch sweep (kick, snare, toms)
        const sweep = h.pitchSweep * Math.exp(-h.t / Math.max(h.pitchDecay, 0.001));
        const cFreq = h.carrierFreq + sweep;
        const mFreq = h.modFreq + sweep * 0.5;

        // FM synthesis
        const mod = Math.sin(h.mp) * h.modIndex;
        const carrier = Math.sin(h.cp + mod);

        // Noise component
        let noiseVal = 0;
        if (h.noiseAmt > 0) {
          noiseVal = this._nextNoise() * h.noiseAmt * env;
        }

        // Click transient (first ~2ms)
        let click = 0;
        if (h.clickAmt > 0 && h.t < 0.002) {
          click = (1 - h.t / 0.002) * h.clickAmt * h.vel;
        }

        // Clap mode: re-trigger envelope 3 times
        let clapEnv = 1;
        if (h.clapMode) {
          const gap = h.clapGap;
          if (h.t < gap * h.clapCount) {
            const clapIdx = Math.floor(h.t / gap);
            const clapT = h.t - clapIdx * gap;
            clapEnv = Math.exp(-clapT / 0.008);
          }
        }

        s += (carrier * env * (1 - h.noiseAmt) + noiseVal + click) * clapEnv * 0.5;

        // Advance phases
        h.cp += TAU * cFreq / sr;
        h.mp += TAU * mFreq / sr;
        if (h.cp > TAU) h.cp -= TAU;
        if (h.mp > TAU) h.mp -= TAU;
        h.t += dt;
      }

      // Soft clip
      if (s > 0.95) s = 0.95;
      else if (s < -0.95) s = -0.95;

      out[i] = s;
    }

    return true;
  }
}

registerProcessor('yambruh-drums', YamaBruhDrumProcessor);
