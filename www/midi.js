// ── MIDI Support ──────────────────────────────────────────────────────

class MIDIManager {
  constructor(synth) {
    this.synth = synth;
    this.access = null;
    this.connected = false;
    this.activeNotes = new Map(); // midiNote -> noteId
    this.onStateChange = null;
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI not supported');
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess();
      this.access.onstatechange = () => this._bindInputs();
      this._bindInputs();
      this.connected = true;
      if (this.onStateChange) this.onStateChange(true);
      return true;
    } catch (e) {
      console.error('MIDI access denied:', e);
      return false;
    }
  }

  disconnect() {
    if (this.access) {
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = null;
      }
    }
    // Stop all active notes
    for (const [note, noteId] of this.activeNotes) {
      this.synth.stopNote(noteId);
    }
    this.activeNotes.clear();
    this.connected = false;
    if (this.onStateChange) this.onStateChange(false);
  }

  _bindInputs() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => this._handleMessage(e);
    }
  }

  _handleMessage(event) {
    const [status, note, velocity] = event.data;
    const cmd = status & 0xf0;

    if (cmd === 0x90 && velocity > 0) {
      // Note On
      const vel = velocity / 127;
      const noteId = this.synth.playNote(note, vel);
      this.activeNotes.set(note, noteId);
      this._highlightKey(note, true);
    } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
      // Note Off
      const noteId = this.activeNotes.get(note);
      if (noteId) {
        this.synth.stopNote(noteId);
        this.activeNotes.delete(note);
      }
      this._highlightKey(note, false);
    }
  }

  _highlightKey(midiNote, on) {
    const key = document.querySelector(`[data-midi="${midiNote}"]`);
    if (key) {
      if (on) key.classList.add('active');
      else key.classList.remove('active');
    }
  }
}

window.midiManager = new MIDIManager(window.synth);
