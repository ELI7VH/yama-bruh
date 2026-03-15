// ── MIDI Support ──────────────────────────────────────────────────────

class MIDIManager {
  constructor(synth) {
    this.synth = synth;
    this.access = null;
    this.connected = false;
    this.selectedInputId = null;
    this.activeNotes = new Map();
    this.onStateChange = null;
    this.onDevicesChange = null;
  }

  async connect() {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI not supported');
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        this._updateDeviceList();
        this._bindSelected();
      };
      this._updateDeviceList();
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
    for (const [note, noteId] of this.activeNotes) {
      this.synth.stopNote(noteId);
    }
    this.activeNotes.clear();
    this.connected = false;
    this.selectedInputId = null;
    if (this.onStateChange) this.onStateChange(false);
  }

  getInputs() {
    if (!this.access) return [];
    const inputs = [];
    for (const input of this.access.inputs.values()) {
      inputs.push({ id: input.id, name: input.name, manufacturer: input.manufacturer });
    }
    return inputs;
  }

  selectInput(inputId) {
    // Unbind all first
    if (this.access) {
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = null;
      }
    }
    // Stop active notes
    for (const [note, noteId] of this.activeNotes) {
      this.synth.stopNote(noteId);
    }
    this.activeNotes.clear();

    this.selectedInputId = inputId;
    this._bindSelected();
  }

  _updateDeviceList() {
    if (this.onDevicesChange) {
      this.onDevicesChange(this.getInputs());
    }
  }

  _bindSelected() {
    if (!this.access) return;

    // Unbind all
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = null;
    }

    if (!this.selectedInputId) {
      // If nothing selected, bind ALL inputs (fallback)
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = (e) => this._handleMessage(e);
      }
    } else {
      // Bind only selected
      const selected = this.access.inputs.get(this.selectedInputId);
      if (selected) {
        selected.onmidimessage = (e) => this._handleMessage(e);
      }
    }
  }

  _handleMessage(event) {
    if (!event.data || event.data.length < 2) return;
    const [status, note, velocity = 0] = event.data;
    const cmd = status & 0xf0;

    if (cmd === 0x90 && velocity > 0) {
      const vel = velocity / 127;
      const noteId = this.synth.playNote(note, vel);
      this.activeNotes.set(note, noteId);
      this._highlightKey(note, true);
    } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
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
