// ── YAMA-BRUH Main App ────────────────────────────────────────────────

(async function () {
  // ── State ─────────────────────────────────────────────────────────
  let currentPreset = parseInt(localStorage.getItem('yamabruh_preset') || '0');
  let presetInput = '';
  let presetTimeout = null;
  let flash = 0;
  let playingSources = new Map();
  const savedMidi = JSON.parse(localStorage.getItem('yamabruh_midi') || 'null');

  // ── Init synth ────────────────────────────────────────────────────
  await window.synth.init();
  window.synth.currentPreset = currentPreset;

  // ── Build Voice Bank ──────────────────────────────────────────────
  const vbGrid = document.getElementById('voice-bank-grid');
  PRESET_NAMES.forEach((name, i) => {
    const entry = document.createElement('div');
    entry.className = 'vb-entry' + (i === 0 ? ' active' : '');
    entry.dataset.preset = i;
    const num = String(i).padStart(2, '0');
    entry.innerHTML = `<span class="vb-num">${num}</span>${name}`;
    entry.addEventListener('click', () => {
      selectPreset(i);
      window.synth.playClick();
    });
    vbGrid.appendChild(entry);
  });

  updateDisplay();

  // ── GLSL Background ──────────────────────────────────────────────
  const canvas = document.getElementById('bg-canvas');
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
  let mouseX = 0, mouseY = 0;

  const vsSource = `
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const fsSource = `
    precision mediump float;
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform vec2 u_mouse;
    uniform float u_flash;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.48;
      }
      return v;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;

      // Base aged plastic — dark charcoal
      vec3 col = vec3(0.12, 0.12, 0.11);

      // Large-scale discoloration
      float stain = fbm(uv * 3.0 + 42.0);
      col += vec3(stain * 0.04, stain * 0.03, stain * 0.01);

      // Darker wear zones
      float wear = fbm(uv * vec2(2.0, 5.0) + 100.0);
      col -= wear * 0.03;

      // Micro-texture: plastic grain
      float grain = noise(uv * 400.0);
      col += (grain - 0.5) * 0.025;

      // Scratches — horizontal bias
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        vec2 suv = uv * vec2(0.8, 50.0 + fi * 12.0) + vec2(fi * 17.3, fi * 31.7);
        float s = noise(suv);
        float scratch = smoothstep(0.49, 0.5, s) * 0.025;
        col += scratch;
      }

      // Specular highlight from mouse
      vec2 mUV = u_mouse / u_resolution;
      float highlight = 1.0 - distance(uv, mUV);
      highlight = pow(max(highlight, 0.0), 4.0) * 0.10;
      col += highlight;

      // Edge shadow / bezel
      float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float edgeShadow = smoothstep(0.0, 0.04, edgeDist);
      col *= 0.85 + 0.15 * edgeShadow;

      // Corner wear
      float cornerWear = smoothstep(0.0, 0.08, edgeDist);
      col = mix(col + 0.04, col, cornerWear);

      // Flash on key press
      col += u_flash * vec3(0.08, 0.12, 0.10);

      // Subtle time variation
      col += sin(u_time * 0.5) * 0.003;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  if (gl) {
    const vs = compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const verts = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_resolution');
    const uMouse = gl.getUniformLocation(prog, 'u_mouse');
    const uFlash = gl.getUniformLocation(prog, 'u_flash');

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();
    window.addEventListener('resize', resize);

    document.addEventListener('mousemove', e => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });

    function render(t) {
      flash *= 0.92;
      gl.uniform1f(uTime, t * 0.001);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uMouse, mouseX, canvas.height - mouseY);
      gl.uniform1f(uFlash, flash);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  }

  // ── Build Keyboard ────────────────────────────────────────────────
  const keyboard = document.getElementById('keyboard');
  const START_NOTE = 54; // F#3
  const END_NOTE = 78;   // F#5
  const blackPattern = [0,1,0,1,0,0,1,0,1,0,1,0];

  const whiteNotes = [];
  const blackNotes = [];

  for (let n = START_NOTE; n <= END_NOTE; n++) {
    if (blackPattern[n % 12]) blackNotes.push(n);
    else whiteNotes.push(n);
  }

  whiteNotes.forEach(n => {
    const key = document.createElement('div');
    key.className = 'key-white';
    key.dataset.midi = n;
    keyboard.appendChild(key);
  });

  const whiteKeyWidth = 100 / whiteNotes.length;
  blackNotes.forEach(n => {
    const key = document.createElement('div');
    key.className = 'key-black';
    key.dataset.midi = n;
    const prevWhite = whiteNotes.filter(w => w < n).length;
    key.style.left = (prevWhite * whiteKeyWidth - whiteKeyWidth * 0.18) + '%';
    keyboard.appendChild(key);
  });

  // Keyboard interaction
  let keyNoteIds = new Map();

  function keyDown(el, midiNote) {
    if (keyNoteIds.has(midiNote)) return;
    el.classList.add('active');
    flash = 1.0;
    const noteId = window.synth.playNote(midiNote, 0.7);
    keyNoteIds.set(midiNote, noteId);
  }

  function keyUp(el, midiNote) {
    el.classList.remove('active');
    const noteId = keyNoteIds.get(midiNote);
    if (noteId !== undefined) {
      window.synth.stopNote(noteId);
      keyNoteIds.delete(midiNote);
    }
  }

  keyboard.addEventListener('pointerdown', e => {
    const el = e.target;
    const midi = parseInt(el.dataset.midi);
    if (!isNaN(midi)) {
      el.setPointerCapture(e.pointerId);
      keyDown(el, midi);
    }
  });

  keyboard.addEventListener('pointerup', e => {
    const el = e.target;
    const midi = parseInt(el.dataset.midi);
    if (!isNaN(midi)) keyUp(el, midi);
  });

  keyboard.addEventListener('pointerleave', e => {
    const el = e.target;
    const midi = parseInt(el.dataset.midi);
    if (!isNaN(midi)) keyUp(el, midi);
  });

  // ── Build ID Sections ─────────────────────────────────────────────
  const randomContainer = document.getElementById('random-ids');
  const customContainer = document.getElementById('custom-ids');

  function generateId() {
    const chars = 'abcdef0123456789';
    let id = '';
    for (let i = 0; i < 12; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
      if (i === 3 || i === 7) id += '-';
    }
    return id;
  }

  const randomIds = Array.from({ length: 5 }, generateId);

  randomIds.forEach((id, i) => {
    const row = document.createElement('div');
    row.className = 'id-row';
    row.innerHTML = `
      <input class="id-field" type="text" value="${id}" readonly>
      <button class="play-btn" data-rid="${i}">&#9654;</button>
    `;
    randomContainer.appendChild(row);
  });

  const savedCustom = JSON.parse(localStorage.getItem('yamabruh_custom_ids') || '["","","","",""]');

  for (let i = 0; i < 5; i++) {
    const row = document.createElement('div');
    row.className = 'id-row';
    row.innerHTML = `
      <input class="id-field custom-input" type="text" value="${savedCustom[i] || ''}" placeholder="enter id..." data-ci="${i}">
      <button class="play-btn" data-cid="${i}">&#9654;</button>
    `;
    customContainer.appendChild(row);
  }

  document.querySelectorAll('.custom-input').forEach(input => {
    input.addEventListener('input', () => {
      const idx = parseInt(input.dataset.ci);
      savedCustom[idx] = input.value;
      localStorage.setItem('yamabruh_custom_ids', JSON.stringify(savedCustom));
    });
  });

  // Play buttons
  document.addEventListener('click', e => {
    const playBtn = e.target.closest('.play-btn');
    if (!playBtn) return;

    flash = 1.0;

    let idStr = '';
    if (playBtn.dataset.rid !== undefined) {
      idStr = randomIds[parseInt(playBtn.dataset.rid)];
    } else if (playBtn.dataset.cid !== undefined) {
      idStr = savedCustom[parseInt(playBtn.dataset.cid)] || '';
    }

    if (!idStr) return;

    const key = playBtn.dataset.rid || 'c' + playBtn.dataset.cid;
    if (playingSources.has(key)) {
      try { playingSources.get(key).stop(); } catch (e) {}
      playingSources.delete(key);
      playBtn.classList.remove('playing');
    }

    playBtn.classList.add('playing');
    const lcdInfo = document.getElementById('lcd-info');
    lcdInfo.textContent = 'PLAYING: ' + idStr.substring(0, 16);

    const source = window.synth.playRingtone(idStr, () => {
      playBtn.classList.remove('playing');
      playingSources.delete(key);
      lcdInfo.textContent = 'READY';
    });
    playingSources.set(key, source);
  });

  // ── Preset Logic ──────────────────────────────────────────────────
  function updateDisplay() {
    const num = String(currentPreset).padStart(2, '0');
    document.getElementById('seg-digits').textContent = num;
    document.getElementById('preset-readout').textContent = window.synth.getPresetName(currentPreset);
    window.synth.currentPreset = currentPreset;

    // Update voice bank highlight
    const prev = vbGrid.querySelector('.vb-entry.active');
    if (prev) prev.classList.remove('active');
    const entry = vbGrid.querySelector(`[data-preset="${currentPreset}"]`);
    if (entry) {
      entry.classList.add('active');
      // Scroll into view if needed
      const gridRect = vbGrid.getBoundingClientRect();
      const entryRect = entry.getBoundingClientRect();
      if (entryRect.top < gridRect.top || entryRect.bottom > gridRect.bottom) {
        entry.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function selectPreset(num) {
    currentPreset = Math.max(0, Math.min(98, num));
    updateDisplay();
    window.synth._sendPreset();
    localStorage.setItem('yamabruh_preset', currentPreset);
    document.getElementById('lcd-info').textContent = 'READY';
  }

  function enterDigit(d) {
    clearTimeout(presetTimeout);
    window.synth.playClick();
    flash = 0.6;

    presetInput += d;

    if (presetInput.length >= 2) {
      const num = parseInt(presetInput);
      selectPreset(num);
      presetInput = '';
    } else {
      document.getElementById('lcd-info').textContent = presetInput + '_';
      // Auto-complete after 1.5s
      presetTimeout = setTimeout(() => {
        if (presetInput.length === 1) {
          selectPreset(parseInt(presetInput));
          presetInput = '';
        }
      }, 1500);
    }
  }

  // Voice selector buttons
  document.querySelectorAll('.sel-btn').forEach(btn => {
    btn.addEventListener('pointerdown', () => {
      enterDigit(btn.dataset.num);
    });
  });

  // ── MIDI Button + Device Select ───────────────────────────────────
  const midiBtn = document.getElementById('midi-btn');
  const midiSelect = document.getElementById('midi-select');

  function saveMidiState(enabled, deviceId) {
    localStorage.setItem('yamabruh_midi', JSON.stringify({ enabled, deviceId: deviceId || null }));
  }

  function updateMidiDeviceList(inputs) {
    midiSelect.innerHTML = '';
    if (inputs.length === 0) {
      midiSelect.innerHTML = '<option value="">-- no devices --</option>';
      midiSelect.disabled = true;
      return;
    }
    midiSelect.disabled = false;
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = 'ALL INPUTS';
    midiSelect.appendChild(allOpt);

    inputs.forEach(inp => {
      const opt = document.createElement('option');
      opt.value = inp.id;
      opt.textContent = (inp.name || 'Unknown') + (inp.manufacturer ? ' (' + inp.manufacturer + ')' : '');
      midiSelect.appendChild(opt);
    });

    // Restore saved device selection, or auto-select if only one
    const restoreId = savedMidi?.deviceId;
    if (restoreId && [...midiSelect.options].some(o => o.value === restoreId)) {
      midiSelect.value = restoreId;
      window.midiManager.selectInput(restoreId).then(() => {
        const opt = midiSelect.options[midiSelect.selectedIndex];
        document.getElementById('lcd-info').textContent = 'MIDI: ' + opt.textContent.substring(0, 20);
      });
    } else if (inputs.length === 1) {
      midiSelect.value = inputs[0].id;
      window.midiManager.selectInput(inputs[0].id).then(() => {
        document.getElementById('lcd-info').textContent = inputs[0].name || 'MIDI DEVICE';
      });
    }
  }

  window.midiManager.onDevicesChange = updateMidiDeviceList;

  midiSelect.addEventListener('change', async () => {
    const id = midiSelect.value || null;
    await window.midiManager.selectInput(id);
    saveMidiState(true, id);
    const lcdInfo = document.getElementById('lcd-info');
    if (id) {
      const opt = midiSelect.options[midiSelect.selectedIndex];
      lcdInfo.textContent = 'MIDI: ' + opt.textContent.substring(0, 20);
    } else {
      lcdInfo.textContent = 'MIDI: ALL INPUTS';
    }
  });

  async function connectMidi() {
    const ok = await window.midiManager.connect();
    if (ok) {
      midiBtn.textContent = 'MIDI: ON';
      midiBtn.classList.add('active');
      const inputs = window.midiManager.getInputs();
      document.getElementById('lcd-info').textContent = inputs.length + ' MIDI DEVICE' + (inputs.length !== 1 ? 'S' : '') + ' FOUND';
      saveMidiState(true, midiSelect.value || null);
      return true;
    } else {
      document.getElementById('lcd-info').textContent = 'MIDI UNAVAILABLE';
      return false;
    }
  }

  midiBtn.addEventListener('click', async () => {
    if (window.midiManager.connected) {
      window.midiManager.disconnect();
      midiBtn.textContent = 'MIDI: OFF';
      midiBtn.classList.remove('active');
      midiSelect.innerHTML = '<option value="">-- no devices --</option>';
      midiSelect.disabled = true;
      saveMidiState(false, null);
      document.getElementById('lcd-info').textContent = 'MIDI DISCONNECTED';
    } else {
      await connectMidi();
    }
  });

  // Auto-reconnect MIDI if was previously enabled
  if (savedMidi?.enabled) {
    connectMidi();
  }

  // ── Computer Keyboard → Piano + Patch Control ─────────────────────
  const qwertyMap = {
    'a': 54, 'w': 55, 's': 56, 'e': 57, 'd': 58,
    'f': 59, 't': 60, 'g': 61, 'y': 62, 'h': 63,
    'u': 64, 'j': 65, 'k': 66, 'o': 67, 'l': 68,
    'p': 69, ';': 70, "'": 71,
  };

  const activeQwerty = new Set();

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    // Arrow keys for patch change
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      presetInput = '';
      clearTimeout(presetTimeout);
      selectPreset(currentPreset + 1);
      window.synth.playClick();
      flash = 0.4;
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      presetInput = '';
      clearTimeout(presetTimeout);
      selectPreset(currentPreset - 1);
      window.synth.playClick();
      flash = 0.4;
      return;
    }

    // Number keys for direct patch entry
    if (e.key >= '0' && e.key <= '9' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      enterDigit(e.key);
      return;
    }

    // QWERTY piano
    const midi = qwertyMap[e.key.toLowerCase()];
    if (midi !== undefined && !activeQwerty.has(e.key)) {
      activeQwerty.add(e.key);
      const el = document.querySelector(`[data-midi="${midi}"]`);
      if (el) keyDown(el, midi);
    }
  });

  document.addEventListener('keyup', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const midi = qwertyMap[e.key.toLowerCase()];
    if (midi !== undefined) {
      activeQwerty.delete(e.key);
      const el = document.querySelector(`[data-midi="${midi}"]`);
      if (el) keyUp(el, midi);
    }
  });
})();
