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
  tom_hi:  [1,0,0,0, 1,0,0,0, 0,0,0,1, 0,0,0,0],
  tom_lo:  [0,0,0,1, 0,0,1,0, 0,1,0,0, 0,0,0,0],
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

  trigger(sound, velocity) {
    if (!this.drumNode) return;
    this.drumNode.port.postMessage({ type: 'drum', sound, velocity });
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
    const sounds = ['kick','snare','hihat_c','hihat_o','clap','tom_hi','tom_lo','rimshot','cowbell','cymbal'];
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
