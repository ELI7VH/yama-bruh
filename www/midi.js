// ── MIDI Support ──────────────────────────────────────────────────────
// 16-channel routing — each channel can have its own voice preset
// Channels 13-16 route to drum engine instead of synth

class MIDIManager {
  constructor(synth) {
    this.synth = synth;
    this.access = null;
    this.connected = false;
    this.selectedInputId = null;
    this.activeNotes = new Map(); // key: "ch:note", value: noteId
    this.onStateChange = null;
    this.onDevicesChange = null;

    // Channel map: channel (0-15) → preset index
    // Channels 12-15 (displayed as 13-16) are drum channels
    this.channelMap = new Array(16).fill(0);
    this.drumChannels = new Set([12, 13, 14, 15]); // 0-indexed

    // Active channel — auto-set by incoming MIDI, used for preset assignment
    this.activeChannel = 0;
    this.onChannelChange = null; // (channel) => {}

    this._loadChannelMap();
  }

  _loadChannelMap() {
    const saved = localStorage.getItem('yamabruh_chmap');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 16) {
          this.channelMap = parsed;
        }
      } catch (e) {}
    }
  }

  saveChannelMap() {
    localStorage.setItem('yamabruh_chmap', JSON.stringify(this.channelMap));
  }

  setChannelPreset(channel, preset) {
    if (channel >= 0 && channel < 16) {
      this.channelMap[channel] = preset;
      this.saveChannelMap();
    }
  }

  getChannelPreset(channel) {
    return this.channelMap[channel] || 0;
  }

  isDrumChannel(channel) {
    return this.drumChannels.has(channel);
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
    for (const [key, noteId] of this.activeNotes) {
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
    for (const [key, noteId] of this.activeNotes) {
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
    const ch = d[0] & 0x0f;   // MIDI channel 0-15
    const note = d[1];
    const vel = d.length > 2 ? d[2] : 0;
    const noteKey = ch * 128 + note; // unique key per channel+note

    if (cmd === 0x90 && vel > 0) {
      // Track active channel — auto-selects on note-on
      if (this.activeChannel !== ch) {
        this.activeChannel = ch;
        if (this.onChannelChange) this.onChannelChange(ch);
      }

      if (this.isDrumChannel(ch)) {
        // Drum channel — map MIDI notes to drum sounds
        this._triggerDrum(note, vel / 127);
      } else {
        // Melodic channel — use channel's assigned preset
        const preset = this.channelMap[ch];
        const noteId = this.synth.playNote(note, vel / 127, preset);
        this.activeNotes.set(noteKey, noteId);
        this._highlightKey(note, true);
      }
      // Update LCD
      const lcdInfo = document.getElementById('lcd-info');
      if (lcdInfo) {
        const names = 'C C#D D#E F F#G G#A A#B ';
        const n = note % 12;
        const chLabel = this.isDrumChannel(ch) ? 'DR' : ('CH' + (ch + 1));
        lcdInfo.textContent = names.substr(n * 2, 2).trim() + (((note / 12) | 0) - 1) + ' ' + chLabel;
      }
    } else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) {
      if (!this.isDrumChannel(ch)) {
        const noteId = this.activeNotes.get(noteKey);
        if (noteId !== undefined) {
          this.synth.stopNote(noteId);
          this.activeNotes.delete(noteKey);
        }
        this._highlightKey(note, false);
      }
    }
  }

  // Map GM drum notes to our drum sounds
  _triggerDrum(note, velocity) {
    if (!window.drums) return;
    const drumMap = {
      36: 'kick', 35: 'kick',         // Bass Drum
      38: 'snare', 40: 'snare',       // Snare
      42: 'hihat_c', 44: 'hihat_c',   // Closed Hi-Hat
      46: 'hihat_o',                   // Open Hi-Hat
      39: 'clap',                      // Hand Clap
      48: 'tom_hi', 50: 'tom_hi',     // High Tom
      45: 'tom_lo', 47: 'tom_lo', 43: 'tom_lo', 41: 'tom_lo', // Low/Mid Toms
      37: 'rimshot',                   // Side Stick
      56: 'cowbell',                   // Cowbell
      49: 'cymbal', 51: 'cymbal', 52: 'cymbal', 57: 'cymbal', // Cymbals
    };
    const sound = drumMap[note];
    if (sound) window.drums.trigger(sound, velocity);
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
