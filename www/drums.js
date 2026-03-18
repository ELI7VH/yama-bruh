// ── YAMA-BRUH Drum Sequencer ──────────────────────────────────────────
// 10 rhythm patterns (PSS-170 style), tempo control, fill, start/stop
// Uses Web Audio clock for tight timing via lookahead scheduling

const RHYTHM_NAMES = [
  '8 Beat', '16 Beat', 'Rock', 'Disco', 'Swing',
  'Waltz', 'Bossa Nova', 'Samba', 'Reggae', 'March',
];

// 16-step patterns (16th notes per bar)
// Values: 0 = off, 1 = normal, 0.5 = ghost/soft
const PATTERNS = {
  '8 Beat': {
    kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat_c: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
  },
  '16 Beat': {
    kick:    [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat_c: [1,0.5,1,0.5, 1,0.5,1,0.5, 1,0.5,1,0.5, 1,0.5,1,0.5],
  },
  'Rock': {
    kick:    [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    hihat_c: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    cymbal:  [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
  'Disco': {
    kick:    [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat_o: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
    hihat_c: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  },
  'Swing': {
    kick:    [1,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    hihat_c: [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1],
    rimshot: [0,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
  },
  'Waltz': {  // 3/4 time — use 12 steps (3 beats × 4 subdivisions)
    kick:    [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
    snare:   [0,0,0,0, 1,0,0,0, 1,0,0,0, 0,0,0,0],
    hihat_c: [1,0,1,0, 1,0,1,0, 1,0,1,0, 0,0,0,0],
    _steps: 12,
  },
  'Bossa Nova': {
    kick:    [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
    rimshot: [0,0,0,1, 0,0,0,0, 0,1,0,0, 1,0,0,0],
    hihat_c: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    clap:    [0,0,0,0, 0,0,0,0, 0,0,0,1, 0,0,0,0],
  },
  'Samba': {
    kick:    [1,0,0,0, 0,0,1,0, 0,0,0,0, 1,0,0,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,0],
    hihat_c: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
    cowbell: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
    rimshot: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  },
  'Reggae': {
    kick:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,0,0],
    snare:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 1,0,0,0],
    rimshot: [0,0,0,0, 1,0,0,0, 0,0,0,0, 0,0,0,0],
    hihat_c: [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
  },
  'March': {
    kick:    [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
    snare:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
    hihat_c: [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
    cymbal:  [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
  },
};

// Fill pattern — 1-bar percussion break
const FILL_PATTERN = {
  snare:   [0,0,1,0, 0,1,0,1, 1,0,1,0, 1,1,1,1],
  tom:     [1,0,0,1, 1,0,1,0, 0,1,0,1, 0,0,0,0],
  kick:    [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
  cymbal:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
};

class YamaBruhDrums {
  constructor() {
    this.drumNode = null;
    this.ctx = null;
    this.ready = false;

    // Sequencer state
    this.playing = false;
    this.bpm = 120;
    this.currentPattern = 0;
    this.currentStep = 0;
    this.stepsInPattern = 16;
    this.filling = false;    // one-bar fill in progress

    // Lookahead scheduling
    this._scheduleAhead = 0.05;  // seconds to schedule ahead
    this._lookInterval = 25;     // ms between checks
    this._nextStepTime = 0;
    this._timerId = null;

    // Drum bank
    this.currentBank = 0;
    this.soundNames = ['kick','snare','hihat_c','hihat_o','clap','tom','rimshot','cowbell','cymbal','zap','riser','glitch','bomb','scratch','chirp','metallic','noise_burst','blip','whoosh','thud','shaker','fm_pop','gen_perc'];

    // Callbacks
    this.onStep = null;     // (step, totalSteps) => {}
    this.onStop = null;     // () => {}
  }

  async init(audioContext) {
    this.ctx = audioContext;
    await this.ctx.audioWorklet.addModule('drum-worklet.js');
    this.drumNode = new AudioWorkletNode(this.ctx, 'yambruh-drums', {
      outputChannelCount: [1],
    });

    // Connect through a gain node for volume control
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 0.8;
    this.drumNode.connect(this.gainNode);
    this.gainNode.connect(this.ctx.destination);

    this.ready = true;
  }

  trigger(sound, velocity, midiNote) {
    if (!this.drumNode) return;
    this.drumNode.port.postMessage({ type: 'drum', sound, velocity, note: midiNote || 0 });
  }

  triggerPad(config) {
    if (!this.drumNode || !config) return;
    this.drumNode.port.postMessage({
      type: 'drum',
      sound: config.sound,
      velocity: config.velocity,
      note: config.note || 0,
      bank: config.bank ?? this.currentBank,
      overrides: config.overrides || null,
    });
  }

  setChoke(on) {
    if (this.drumNode) {
      this.drumNode.port.postMessage({ type: 'drumChoke', on: !!on });
    }
  }

  setBank(index) {
    this.currentBank = Math.max(0, Math.min(7, index));
    if (this.drumNode) {
      this.drumNode.port.postMessage({ type: 'setBank', bank: this.currentBank });
    }
  }

  getBankName(index) {
    const names = ['Standard', 'Electronic', 'Power', 'Brush', 'Orchestra', 'Synth', 'Latin', 'Lo-Fi'];
    return names[index] || 'Unknown';
  }

  getBankCount() { return 8; }

  // Base defaults for each sound (mirrors drum-worklet.js _makeDrum)
  static SOUND_DEFAULTS = {
    kick:    { carrierFreq: 60, modFreq: 90, modIndex: 3.0, pitchSweep: 160, pitchDecay: 0.015, decay: 0.25, noiseAmt: 0, clickAmt: 0.3 },
    snare:   { carrierFreq: 200, modFreq: 340, modIndex: 2.5, pitchSweep: 60, pitchDecay: 0.01, decay: 0.18, noiseAmt: 0.6, clickAmt: 0.15 },
    hihat_c: { carrierFreq: 800, modFreq: 5600, modIndex: 4.0, pitchSweep: 0, pitchDecay: 0.01, decay: 0.04, noiseAmt: 0.5, clickAmt: 0 },
    hihat_o: { carrierFreq: 800, modFreq: 5600, modIndex: 4.0, pitchSweep: 0, pitchDecay: 0.01, decay: 0.22, noiseAmt: 0.5, clickAmt: 0 },
    clap:    { carrierFreq: 1200, modFreq: 2400, modIndex: 1.5, pitchSweep: 0, pitchDecay: 0.01, decay: 0.2, noiseAmt: 0.85, clickAmt: 0 },
    tom:     { carrierFreq: 165, modFreq: 248, modIndex: 2.0, pitchSweep: 83, pitchDecay: 0.02, decay: 0.22, noiseAmt: 0, clickAmt: 0.1 },
    rimshot: { carrierFreq: 500, modFreq: 1600, modIndex: 2.0, pitchSweep: 200, pitchDecay: 0.005, decay: 0.06, noiseAmt: 0.2, clickAmt: 0.5 },
    cowbell: { carrierFreq: 587, modFreq: 829, modIndex: 1.8, pitchSweep: 0, pitchDecay: 0.01, decay: 0.12, noiseAmt: 0, clickAmt: 0.1 },
    cymbal:  { carrierFreq: 500, modFreq: 3500, modIndex: 5.0, pitchSweep: 0, pitchDecay: 0.01, decay: 0.6, noiseAmt: 0.3, clickAmt: 0 },
  };

  static BANK_MODS = [
    {},
    { kick: { decay: 0.4, pitchSweep: 220, modIndex: 1.5, clickAmt: 0.1 }, snare: { noiseAmt: 0.75, decay: 0.22, modIndex: 1.5, clickAmt: 0.05 }, hihat_c: { decay: 0.025, carrierFreq: 1200, modFreq: 7800, modIndex: 5.0 }, hihat_o: { decay: 0.35, carrierFreq: 1200, modFreq: 7800, modIndex: 5.0 }, tom: { modIndex: 1.0, pitchSweep: 40, decay: 0.35, noiseAmt: 0 }, clap: { decay: 0.25, noiseAmt: 0.9 } },
    { kick: { decay: 0.35, pitchSweep: 200, modIndex: 4.0, clickAmt: 0.5 }, snare: { decay: 0.25, modIndex: 3.5, clickAmt: 0.3, noiseAmt: 0.5 }, tom: { decay: 0.3, modIndex: 3.0, pitchSweep: 100, clickAmt: 0.2 }, cymbal: { decay: 1.2 } },
    { kick: { decay: 0.15, pitchSweep: 80, modIndex: 1.5, clickAmt: 0.1 }, snare: { noiseAmt: 0.85, decay: 0.3, modIndex: 0.8, clickAmt: 0.0 }, hihat_c: { decay: 0.06, noiseAmt: 0.7, modIndex: 2.5 }, hihat_o: { decay: 0.3, noiseAmt: 0.7, modIndex: 2.5 }, tom: { modIndex: 1.2, decay: 0.2, noiseAmt: 0.1 }, rimshot: { noiseAmt: 0.4, clickAmt: 0.3 } },
    { kick: { carrierFreq: 50, decay: 0.5, pitchSweep: 30, modIndex: 1.0, clickAmt: 0.05 }, snare: { carrierFreq: 280, decay: 0.15, modIndex: 1.8, noiseAmt: 0.3, clickAmt: 0.2 }, tom: { modIndex: 1.0, pitchSweep: 20, decay: 0.45, clickAmt: 0.05 }, cymbal: { decay: 1.5, carrierFreq: 700, modIndex: 6.0 } },
    { kick: { carrierFreq: 55, decay: 0.18, pitchSweep: 300, pitchDecay: 0.008, modIndex: 5.0, clickAmt: 0.6 }, snare: { carrierFreq: 250, modIndex: 4.0, noiseAmt: 0.4, decay: 0.12, clickAmt: 0.4 }, hihat_c: { decay: 0.02, carrierFreq: 1500, modFreq: 9000, modIndex: 6.0 }, hihat_o: { decay: 0.15, carrierFreq: 1500, modFreq: 9000, modIndex: 6.0 }, tom: { modIndex: 3.5, pitchSweep: 120, decay: 0.15, clickAmt: 0.3 }, clap: { decay: 0.12, noiseAmt: 0.95 }, cowbell: { carrierFreq: 700, modFreq: 1000, modIndex: 2.5 } },
    { kick: { carrierFreq: 80, decay: 0.2, pitchSweep: 50, modIndex: 1.5, clickAmt: 0.15 }, snare: { carrierFreq: 300, decay: 0.1, modIndex: 1.5, noiseAmt: 0.2, clickAmt: 0.35 }, tom: { modIndex: 1.5, pitchSweep: 30, pitchDecay: 0.01, decay: 0.15, clickAmt: 0.25 }, rimshot: { decay: 0.04, clickAmt: 0.7, noiseAmt: 0.1 }, cowbell: { decay: 0.08 } },
    { kick: { decay: 0.2, modIndex: 6.0, clickAmt: 0.15 }, snare: { modIndex: 5.0, noiseAmt: 0.7, decay: 0.15 }, hihat_c: { modIndex: 7.0, decay: 0.03 }, hihat_o: { modIndex: 7.0, decay: 0.18 }, tom: { modIndex: 4.0, decay: 0.2 } },
  ];

  getSoundDefaults(sound, bankIdx) {
    const base = YamaBruhDrums.SOUND_DEFAULTS[sound] || { carrierFreq: 200, modFreq: 400, modIndex: 2, pitchSweep: 0, pitchDecay: 0.01, decay: 0.2, noiseAmt: 0, clickAmt: 0 };
    const bankMods = (YamaBruhDrums.BANK_MODS[bankIdx] || {})[sound] || {};
    return { ...base, ...bankMods };
  }

  getSoundNames() {
    return this.soundNames.slice();
  }

  getPatternName(index) {
    return RHYTHM_NAMES[index] || 'Unknown';
  }

  getPatternCount() {
    return RHYTHM_NAMES.length;
  }

  setPattern(index) {
    this.currentPattern = Math.max(0, Math.min(RHYTHM_NAMES.length - 1, index));
    const pat = PATTERNS[RHYTHM_NAMES[this.currentPattern]];
    this.stepsInPattern = pat._steps || 16;
  }

  start() {
    if (this.playing) return;
    if (!this.ready) return;

    this.playing = true;
    this.currentStep = 0;
    this._nextStepTime = this.ctx.currentTime + 0.05; // small delay to start
    this._schedule();
  }

  stop() {
    this.playing = false;
    this.filling = false;
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = null;
    }
    if (this.onStop) this.onStop();
  }

  fill() {
    if (!this.playing) return;
    this.filling = true;
    // Fill starts at next bar boundary — snap to step 0
    // If mid-bar, let current bar finish then fill plays
    // For simplicity: fill starts at next step 0
  }

  setBpm(bpm) {
    this.bpm = Math.max(60, Math.min(240, bpm));
  }

  _getStepDuration() {
    // Duration of one 16th note
    return 60 / this.bpm / 4;
  }

  _schedule() {
    this._timerId = setInterval(() => {
      if (!this.playing) return;

      // If we fell too far behind (e.g. tab was backgrounded), skip ahead
      // instead of flooding the worklet with hundreds of catch-up triggers
      const maxBehind = this._getStepDuration() * 4; // max 4 steps behind
      if (this._nextStepTime < this.ctx.currentTime - maxBehind) {
        this._nextStepTime = this.ctx.currentTime + 0.01;
        this.currentStep = 0;
      }

      while (this._nextStepTime < this.ctx.currentTime + this._scheduleAhead) {
        this._playStep(this._nextStepTime);
        this._nextStepTime += this._getStepDuration();
      }
    }, this._lookInterval);
  }

  _playStep(time) {
    const patName = RHYTHM_NAMES[this.currentPattern];
    const pat = (this.filling && this.currentStep === 0)
      ? FILL_PATTERN
      : (this.filling ? FILL_PATTERN : PATTERNS[patName]);

    // Use fill pattern for the entire bar once fill is triggered at step 0
    const activePat = this.filling ? FILL_PATTERN : PATTERNS[patName];
    const steps = this.filling ? 16 : (activePat._steps || 16);

    // Trigger sounds for this step
    const sounds = ['kick','snare','hihat_c','hihat_o','clap','tom','rimshot','cowbell','cymbal'];
    for (const sound of sounds) {
      const row = activePat[sound];
      if (!row) continue;
      const vel = row[this.currentStep % row.length];
      if (vel > 0) {
        this.trigger(sound, vel);
      }
    }

    // Notify UI
    if (this.onStep) this.onStep(this.currentStep, steps);

    // Advance step
    this.currentStep++;
    if (this.currentStep >= steps) {
      this.currentStep = 0;
      // End fill after one bar
      if (this.filling) {
        this.filling = false;
      }
    }
  }
}

window.drums = new YamaBruhDrums();
