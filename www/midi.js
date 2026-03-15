// ── MIDI Support ──────────────────────────────────────────────────────
// Zero-overhead hot path — no logging in message handler

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
    if (!navigator.requestMIDIAccess) return false;

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => this._updateDeviceList();
      this._updateDeviceList();
      await this._openAllAndBind();
      this.connected = true;
      if (this.onStateChange) this.onStateChange(true);
      return true;
    } catch (e) {
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

  async selectInput(inputId) {
    if (this.access) {
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = null;
      }
    }
    for (const [note, noteId] of this.activeNotes) {
      this.synth.stopNote(noteId);
    }
    this.activeNotes.clear();
    this.selectedInputId = inputId;
    await this._bindSelected();
  }

  _updateDeviceList() {
    if (this.onDevicesChange) this.onDevicesChange(this.getInputs());
  }

  async _openAllAndBind() {
    if (!this.access) return;
    const promises = [];
    for (const input of this.access.inputs.values()) {
      promises.push(this._openAndBind(input));
    }
    await Promise.all(promises);
  }

  async _bindSelected() {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = null;
    }
    if (!this.selectedInputId) {
      await this._openAllAndBind();
    } else {
      const selected = this.access.inputs.get(this.selectedInputId);
      if (selected) await this._openAndBind(selected);
    }
  }

  async _openAndBind(input) {
    try {
      if (input.connection !== 'open') await input.open();
      input.onmidimessage = (e) => this._handleMessage(e);
    } catch (e) {}
  }

  // HOT PATH — no logging, no allocations, minimal work
  _handleMessage(event) {
    const d = event.data;
    if (!d || d.length < 2) return;
    const cmd = d[0] & 0xf0;
    const note = d[1];
    const vel = d.length > 2 ? d[2] : 0;

    if (cmd === 0x90 && vel > 0) {
      const noteId = this.synth.playNote(note, vel / 127);
      this.activeNotes.set(note, noteId);
      this._highlightKey(note, true);
      // Update LCD with note name
      const lcdInfo = document.getElementById('lcd-info');
      if (lcdInfo) {
        const names = 'C C#D D#E F F#G G#A A#B ';
        const n = note % 12;
        lcdInfo.textContent = names.substr(n * 2, 2).trim() + (((note / 12) | 0) - 1) + ' v' + vel;
      }
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      const noteId = this.activeNotes.get(note);
      if (noteId !== undefined) {
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
