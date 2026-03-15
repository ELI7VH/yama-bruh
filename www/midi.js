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
      console.warn('[MIDI] Web MIDI API not supported in this browser');
      return false;
    }

    try {
      console.log('[MIDI] Requesting MIDI access...');
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      console.log('[MIDI] Access granted. Inputs:', this.access.inputs.size, 'Outputs:', this.access.outputs.size);

      this.access.onstatechange = (e) => {
        console.log(`[MIDI] State change: "${e.port.name}" type:${e.port.type} state:${e.port.state} connection:${e.port.connection}`);
        this._updateDeviceList();
      };

      this._updateDeviceList();

      // Open and bind all ports immediately on connect
      await this._openAllAndBind();

      this.connected = true;
      if (this.onStateChange) this.onStateChange(true);
      return true;
    } catch (e) {
      console.error('[MIDI] Access denied:', e);
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

  async selectInput(inputId) {
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
    await this._bindSelected();
  }

  _updateDeviceList() {
    if (this.onDevicesChange) {
      this.onDevicesChange(this.getInputs());
    }
  }

  async _openAllAndBind() {
    if (!this.access) return;
    console.log('[MIDI] Opening all ports...');
    const promises = [];
    for (const input of this.access.inputs.values()) {
      promises.push(this._openAndBind(input));
    }
    await Promise.all(promises);
    console.log('[MIDI] All ports processed');
  }

  async _bindSelected() {
    if (!this.access) return;

    // Unbind all
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = null;
    }

    if (!this.selectedInputId) {
      // Bind ALL inputs
      await this._openAllAndBind();
    } else {
      // Bind only selected
      const selected = this.access.inputs.get(this.selectedInputId);
      if (selected) {
        await this._openAndBind(selected);
        console.log(`[MIDI] Listening to: "${selected.name}"`);
      } else {
        console.warn(`[MIDI] Selected input ${this.selectedInputId} not found in inputs map`);
        // Try iterating to find it
        for (const input of this.access.inputs.values()) {
          console.log(`[MIDI] Available: id="${input.id}" name="${input.name}"`);
        }
      }
    }
  }

  async _openAndBind(input) {
    try {
      console.log(`[MIDI] Opening "${input.name}" (connection: ${input.connection}, state: ${input.state})`);
      if (input.connection !== 'open') {
        await input.open();
      }
      console.log(`[MIDI] Opened "${input.name}" -> connection: ${input.connection}, state: ${input.state}`);
      input.onmidimessage = (e) => this._handleMessage(e);
      console.log(`[MIDI] Handler bound to "${input.name}"`);
    } catch (e) {
      console.error(`[MIDI] Failed to open "${input.name}":`, e);
    }
  }

  _handleMessage(event) {
    if (!event.data || event.data.length < 2) {
      console.log('[MIDI] Empty/short message received');
      return;
    }
    const [status, note, velocity = 0] = event.data;
    const cmd = status & 0xf0;
    const ch = status & 0x0f;

    // Log ALL MIDI messages with hex dump
    const hex = Array.from(event.data).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.log(`[MIDI] IN ch:${ch + 1} cmd:0x${cmd.toString(16)} data:[${hex}]`);

    const lcdInfo = document.getElementById('lcd-info');

    if (cmd === 0x90 && velocity > 0) {
      const vel = velocity / 127;
      const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
      const name = noteNames[note % 12] + Math.floor(note / 12 - 1);
      if (lcdInfo) lcdInfo.textContent = `NOTE ${name} vel:${velocity}`;
      console.log(`[MIDI] >>> NOTE ON: ${name} (${note}) vel:${velocity}`);

      const noteId = this.synth.playNote(note, vel);
      this.activeNotes.set(note, noteId);
      this._highlightKey(note, true);
    } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
      console.log(`[MIDI] >>> NOTE OFF: ${note}`);
      const noteId = this.activeNotes.get(note);
      if (noteId) {
        this.synth.stopNote(noteId);
        this.activeNotes.delete(note);
      }
      this._highlightKey(note, false);
    } else if (cmd === 0xb0) {
      console.log(`[MIDI] CC ${note} = ${velocity}`);
    } else if (cmd === 0xfe) {
      // Active sensing — ignore silently
    } else if (cmd === 0xf0) {
      console.log(`[MIDI] SysEx (${event.data.length} bytes)`);
    } else {
      console.log(`[MIDI] Other: status=0x${status.toString(16)} [${hex}]`);
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
