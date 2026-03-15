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
      console.log(`[MIDI] Input: "${input.name}" (${input.manufacturer}) id:${input.id} state:${input.state} connection:${input.connection}`);
      inputs.push({ id: input.id, name: input.name, manufacturer: input.manufacturer });
    }
    if (inputs.length === 0) console.log('[MIDI] No input devices found');
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

  async _bindSelected() {
    if (!this.access) return;

    // Unbind all
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = null;
    }

    if (!this.selectedInputId) {
      // If nothing selected, bind ALL inputs
      let count = 0;
      for (const input of this.access.inputs.values()) {
        await this._openAndBind(input);
        count++;
      }
      console.log(`[MIDI] Listening to ALL inputs (${count} devices)`);
    } else {
      // Bind only selected
      const selected = this.access.inputs.get(this.selectedInputId);
      if (selected) {
        await this._openAndBind(selected);
        console.log(`[MIDI] Listening to: "${selected.name}"`);
      } else {
        console.warn(`[MIDI] Selected input ${this.selectedInputId} not found`);
      }
    }
  }

  async _openAndBind(input) {
    try {
      if (input.connection !== 'open') {
        console.log(`[MIDI] Opening port: "${input.name}" (was ${input.connection})`);
        await input.open();
        console.log(`[MIDI] Port opened: "${input.name}" connection:${input.connection}`);
      }
      input.onmidimessage = (e) => this._handleMessage(e);
    } catch (e) {
      console.error(`[MIDI] Failed to open "${input.name}":`, e);
    }
  }

  _handleMessage(event) {
    if (!event.data || event.data.length < 2) return;
    const [status, note, velocity = 0] = event.data;
    const cmd = status & 0xf0;
    const ch = status & 0x0f;

    // Log all MIDI messages
    const hex = Array.from(event.data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[MIDI] ch:${ch + 1} cmd:0x${cmd.toString(16)} | ${hex}`);

    const lcdInfo = document.getElementById('lcd-info');

    if (cmd === 0x90 && velocity > 0) {
      const vel = velocity / 127;
      const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const name = noteNames[note % 12] + Math.floor(note / 12 - 1);
      if (lcdInfo) lcdInfo.textContent = `NOTE ${name} vel:${velocity}`;
      console.log(`[MIDI] NOTE ON: ${name} (${note}) vel:${velocity}`);

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
    } else if (cmd === 0xb0) {
      console.log(`[MIDI] CC ${note} = ${velocity}`);
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
