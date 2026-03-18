// ── YAMA-BRUH Main App ────────────────────────────────────────────────

(async function () {
  // ── State ─────────────────────────────────────────────────────────
  let currentPreset = parseInt(localStorage.getItem('yamabruh_preset') || '0');
  let flash = 0;
  let playingSources = new Map();
  const chNameEls = [];
  const savedMidi = JSON.parse(localStorage.getItem('yamabruh_midi') || 'null');
  const SEQUENCE_STORAGE_KEY = 'yamabruh_sequences_v2';
  const VOICE_BANK_STORAGE_KEY = 'yamabruh_voice_bank_v1';
  const PRESET_NAMES_STORAGE_KEY = 'yamabruh_preset_names';
  const customPresetNames = JSON.parse(localStorage.getItem(PRESET_NAMES_STORAGE_KEY) || '{}');

  function persistPresetNames() {
    localStorage.setItem(PRESET_NAMES_STORAGE_KEY, JSON.stringify(customPresetNames));
  }

  function getPresetDisplayName(index) {
    return customPresetNames[index] || window.synth.getPresetName(index);
  }
  const DEFAULT_SEQUENCE_DEFS = {
    88: {
      enabled: true,
      name: 'Crystal Octave',
      gated: false,
      g: 0.82,
      offsets: [0, 12, 0, 12],
      times: [0.25, 0.25, 0.25, 0.5],
      levels: [1, 0.72, 0.46, 0.24],
    },
  };

  // ── Visual Config State ──────────────────────────────────────────
  const DEFAULT_VISUAL = { dust: 0.5, wear: 0.5, patina: 0.3, light: 0.7, grain: 0.5, scratches: 0.5, todMode: 'auto', todManual: 12 };
  const visualConfig = { ...DEFAULT_VISUAL, ...JSON.parse(localStorage.getItem('yamabruh_visual') || '{}') };

  function getTod() {
    if (visualConfig.todMode === 'manual') return visualConfig.todManual;
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }

  // ── Init synth ────────────────────────────────────────────────────
  await window.synth.init();
  window.synth.currentPreset = currentPreset;

  function loadVoiceBankEdits() {
    try {
      const raw = JSON.parse(localStorage.getItem(VOICE_BANK_STORAGE_KEY) || '{}');
      if (!raw || typeof raw !== 'object') return {};
      return raw;
    } catch (error) {
      return {};
    }
  }

  const voiceBankEdits = loadVoiceBankEdits();

  function persistVoiceBankEdits() {
    localStorage.setItem(VOICE_BANK_STORAGE_KEY, JSON.stringify(voiceBankEdits));
  }

  Object.entries(voiceBankEdits).forEach(([presetIndex, params]) => {
    if (Array.isArray(params)) {
      window.synth._presetCache.set(Number(presetIndex), params.slice());
    }
  });

  // ── Build Voice Bank ──────────────────────────────────────────────
  const vbGrid = document.getElementById('voice-bank-grid');
  const presetNameInput = document.getElementById('preset-name-input');

  function updateVoiceBankEntry(index) {
    if (!vbGrid) return;
    const entry = vbGrid.querySelector(`[data-preset="${index}"]`);
    if (!entry) return;
    const num = String(index).padStart(2, '0');
    const nameSpan = entry.querySelector('.vb-name');
    if (nameSpan) nameSpan.textContent = getPresetDisplayName(index);
    else entry.innerHTML = `<span class="vb-num">${num}</span><span class="vb-name">${getPresetDisplayName(index)}</span>`;
  }

  if (vbGrid) PRESET_NAMES.forEach((name, i) => {
    const entry = document.createElement('div');
    entry.className = 'vb-entry' + (i === 0 ? ' active' : '');
    entry.dataset.preset = i;
    const num = String(i).padStart(2, '0');
    entry.innerHTML = `<span class="vb-num">${num}</span><span class="vb-name">${getPresetDisplayName(i)}</span>`;
    entry.addEventListener('click', () => {
      selectPreset(i);
      window.synth.playClick();
    });
    vbGrid.appendChild(entry);
  });

  function loadPresetNameInput() {
    if (presetNameInput) {
      presetNameInput.value = customPresetNames[currentPreset] || '';
      presetNameInput.placeholder = window.synth.getPresetName(currentPreset);
    }
  }

  if (presetNameInput) {
    presetNameInput.addEventListener('input', () => {
      const val = presetNameInput.value.trim();
      if (val) customPresetNames[currentPreset] = val;
      else delete customPresetNames[currentPreset];
      persistPresetNames();
      updateVoiceBankEntry(currentPreset);
      const lcdInfo = document.getElementById('lcd-info');
      if (lcdInfo) lcdInfo.textContent = getPresetDisplayName(currentPreset);
    });
    ['keydown', 'keypress', 'keyup'].forEach((ev) => {
      presetNameInput.addEventListener(ev, (e) => e.stopPropagation());
    });
  }

  loadPresetNameInput();
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
    uniform float u_tod;
    uniform float u_dust;
    uniform float u_wear;
    uniform float u_patina;
    uniform float u_light;
    uniform float u_grain;
    uniform float u_scratches;

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
      for (int i = 0; i < 3; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.48;
      }
      return v;
    }

    // Time-of-day light color
    vec3 todColor(float t) {
      vec3 night  = vec3(0.30, 0.35, 0.50);
      vec3 dawn   = vec3(1.00, 0.70, 0.40);
      vec3 day    = vec3(1.00, 0.98, 0.95);
      vec3 sunset = vec3(1.00, 0.55, 0.28);
      vec3 dusk   = vec3(0.50, 0.40, 0.60);
      if (t < 5.0)  return night;
      if (t < 7.0)  return mix(night, dawn,   (t - 5.0)  / 2.0);
      if (t < 9.0)  return mix(dawn,  day,    (t - 7.0)  / 2.0);
      if (t < 16.0) return day;
      if (t < 18.0) return mix(day,   sunset, (t - 16.0) / 2.0);
      if (t < 20.0) return mix(sunset,dusk,   (t - 18.0) / 2.0);
      if (t < 22.0) return mix(dusk,  night,  (t - 20.0) / 2.0);
      return night;
    }

    float todBright(float t) {
      if (t < 5.0)  return 0.3;
      if (t < 7.0)  return mix(0.3, 0.7, (t - 5.0)  / 2.0);
      if (t < 9.0)  return mix(0.7, 1.0, (t - 7.0)  / 2.0);
      if (t < 16.0) return 1.0;
      if (t < 18.0) return mix(1.0, 0.7, (t - 16.0) / 2.0);
      if (t < 20.0) return mix(0.7, 0.4, (t - 18.0) / 2.0);
      if (t < 22.0) return mix(0.4, 0.3, (t - 20.0) / 2.0);
      return 0.3;
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution;

      // Base aged plastic
      vec3 col = vec3(0.12, 0.12, 0.11);

      // Time-of-day lighting
      vec3 lightCol = todColor(u_tod);
      float brightness = todBright(u_tod) * u_light;

      // Light sweeps east→west across the day
      float lightAngle = mix(-0.8, 0.8, clamp((u_tod - 6.0) / 12.0, 0.0, 1.0));
      vec2 lightDir = normalize(vec2(lightAngle, 0.5));
      float dirLight = dot(uv - 0.5, lightDir) * 0.5 + 0.5;
      col += lightCol * dirLight * brightness * 0.06;

      // Discoloration + patina (yellowed aging)
      float stain = fbm(uv * 3.0 + 42.0);
      col += vec3(stain * 0.04, stain * 0.03, stain * 0.01) * (1.0 + u_patina);
      float patinaZone = fbm(uv * 2.0 + 77.0);
      col += vec3(0.03, 0.02, -0.01) * patinaZone * u_patina;

      // Wear zones — darkened from use
      float wearZone = fbm(uv * vec2(2.0, 5.0) + 100.0);
      col -= wearZone * 0.03 * (0.5 + u_wear);
      float groove = fbm(uv * vec2(1.5, 20.0) + 200.0);
      col -= smoothstep(0.45, 0.55, groove) * 0.04 * u_wear;

      // Plastic grain (micro-texture)
      float grn = noise(uv * 400.0);
      col += (grn - 0.5) * 0.025 * (0.3 + u_grain);
      float fineGrn = noise(uv * 800.0);
      col += (fineGrn - 0.5) * 0.012 * u_grain;

      // Scratches — two passes, varied angles
      float s1 = noise(vec2(uv.x * 1.2 + uv.y * 0.4, uv.y * 140.0) + 17.3);
      col += smoothstep(0.49, 0.50, s1) * 0.025 * u_scratches;
      float s2 = noise(vec2(uv.x * 0.6 - uv.y * 0.8, (uv.x * 0.8 + uv.y * 0.6) * 100.0) + 51.7);
      col += smoothstep(0.49, 0.50, s2) * 0.018 * u_scratches;

      // Dust — heavier in corners and edges
      float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float dustBase = fbm(uv * 8.0 + 300.0);
      float dustEdge = 1.0 - smoothstep(0.0, 0.15, edgeDist);
      float dustPattern = dustBase * 0.4 + dustEdge * 0.6;
      vec3 dustCol = vec3(0.15, 0.14, 0.12);
      col = mix(col, dustCol, dustPattern * u_dust * 0.15);
      // Dust fibres — two thin streaks at different angles
      float f1 = noise(vec2(uv.x * 3.0 + uv.y * 1.5, (uv.y * 0.9 - uv.x * 0.4) * 600.0) + 543.1);
      col += smoothstep(0.48, 0.50, f1) * vec3(0.035, 0.03, 0.025) * u_dust;
      float f2 = noise(vec2(-uv.x * 2.0 + uv.y * 2.5, (uv.x * 0.7 + uv.y * 0.7) * 800.0) + 710.9);
      col += smoothstep(0.48, 0.50, f2) * vec3(0.03, 0.025, 0.02) * u_dust;
      // Fine dust specks
      float specks = noise(uv * 300.0 + 500.0);
      col += smoothstep(0.72, 0.73, specks) * vec3(0.03, 0.025, 0.02) * u_dust;

      // Specular highlight from mouse (lamp effect)
      vec2 mUV = u_mouse / u_resolution;
      float highlight = 1.0 - distance(uv, mUV);
      highlight = pow(max(highlight, 0.0), 4.0) * 0.10 * u_light;
      col += highlight * lightCol;

      // Soft ambient from top
      col += vec3(0.01, 0.01, 0.012) * (1.0 - uv.y) * brightness;

      // Edge shadow / bezel
      float edgeShadow = smoothstep(0.0, 0.04, edgeDist);
      col *= 0.85 + 0.15 * edgeShadow;

      // Corner wear — lighter in corners
      float cornerWear = smoothstep(0.0, 0.08, edgeDist);
      col = mix(col + 0.04 * u_wear, col, cornerWear);

      // Flash on key press
      col += u_flash * vec3(0.08, 0.12, 0.10);

      // Overall TOD brightness
      col *= 0.7 + brightness * 0.3;

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
    const uTod = gl.getUniformLocation(prog, 'u_tod');
    const uDust = gl.getUniformLocation(prog, 'u_dust');
    const uWear = gl.getUniformLocation(prog, 'u_wear');
    const uPatina = gl.getUniformLocation(prog, 'u_patina');
    const uLight = gl.getUniformLocation(prog, 'u_light');
    const uGrain = gl.getUniformLocation(prog, 'u_grain');
    const uScratches = gl.getUniformLocation(prog, 'u_scratches');

    let shaderDirty = true;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
      shaderDirty = true;
    }
    resize();
    window.addEventListener('resize', resize);

    document.addEventListener('mousemove', e => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      shaderDirty = true;
    });

    function renderOnce() {
      gl.uniform1f(uTime, performance.now() * 0.001);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform2f(uMouse, mouseX, canvas.height - mouseY);
      gl.uniform1f(uFlash, flash);
      gl.uniform1f(uTod, getTod());
      gl.uniform1f(uDust, visualConfig.dust);
      gl.uniform1f(uWear, visualConfig.wear);
      gl.uniform1f(uPatina, visualConfig.patina);
      gl.uniform1f(uLight, visualConfig.light);
      gl.uniform1f(uGrain, visualConfig.grain);
      gl.uniform1f(uScratches, visualConfig.scratches);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // Render loop — only draws when dirty, then idles
    function render() {
      if (shaderDirty) {
        shaderDirty = false;
        renderOnce();
      }
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    // Mark dirty from outside (config changes, resize, etc.)
    window.markShaderDirty = () => { shaderDirty = true; };
  }

  // ── Build Keyboard ────────────────────────────────────────────────
  const keyboard = document.getElementById('keyboard');
  let keyNoteIds = new Map();

  function keyDown(el, midiNote) {
    if (keyNoteIds.has(midiNote)) return;
    el.classList.add('active');
    const noteId = window.synth.playNote(midiNote, 0.7);
    keyNoteIds.set(midiNote, noteId);
    if (typeof noteId === 'string') {
      window.synth.onNoteEnded(noteId, () => {
        if (keyNoteIds.get(midiNote) === noteId) {
          keyNoteIds.delete(midiNote);
          el.classList.remove('active');
        }
      });
    }
  }

  function keyUp(el, midiNote) {
    const noteId = keyNoteIds.get(midiNote);
    if (noteId !== undefined) {
      const stopped = window.synth.stopNote(noteId);
      if (stopped !== false) {
        keyNoteIds.delete(midiNote);
        el.classList.remove('active');
      }
      return;
    }
    el.classList.remove('active');
  }

  if (keyboard) {
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
  }

  // ── Build ID Sections (ringtones page only) ─────────────────────
  const randomContainer = document.getElementById('random-ids');
  const customContainer = document.getElementById('custom-ids');
  const randomIds = [];
  const savedCustom = JSON.parse(localStorage.getItem('yamabruh_custom_ids') || '["","","","",""]');

  if (randomContainer && customContainer) {
    function generateId() {
      const chars = 'abcdef0123456789';
      let id = '';
      for (let i = 0; i < 12; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
        if (i === 3 || i === 7) id += '-';
      }
      return id;
    }

    randomIds.push(...Array.from({ length: 5 }, generateId));

    randomIds.forEach((id, i) => {
      const row = document.createElement('div');
      row.className = 'id-row';
      row.innerHTML = `
        <input class="id-field" type="text" value="${id}" readonly>
        <button class="play-btn" data-rid="${i}">&#9654;</button>
      `;
      randomContainer.appendChild(row);
    });

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
  }

  // Play buttons
  document.addEventListener('click', e => {
    const playBtn = e.target.closest('.play-btn');
    if (!playBtn) return;

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
      if (lcdInfo) lcdInfo.textContent = '';
    });
    playingSources.set(key, source);
  });

  // ── Preset Logic ──────────────────────────────────────────────────
  function updateDisplay() {
    const num = String(currentPreset).padStart(2, '0');
    const segEl = document.getElementById('seg-digits');
    if (segEl) segEl.textContent = num;
    window.synth.currentPreset = currentPreset;

    // Update voice bank highlight
    if (!vbGrid) return;
    const prev = vbGrid.querySelector('.vb-entry.active');
    if (prev) prev.classList.remove('active');
    const entry = vbGrid.querySelector(`[data-preset="${currentPreset}"]`);
    if (entry) {
      entry.classList.add('active');
      // Scroll horizontally into view (column-wrap grid scrolls on x-axis)
      const gridRect = vbGrid.getBoundingClientRect();
      const entryRect = entry.getBoundingClientRect();
      if (entryRect.left < gridRect.left || entryRect.right > gridRect.right) {
        entry.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  function selectPreset(num) {
    currentPreset = Math.max(0, Math.min(99, num));
    updateDisplay();
    window.synth._sendPreset();
    localStorage.setItem('yamabruh_preset', currentPreset);
    const lcdInfo = document.getElementById('lcd-info');
    if (lcdInfo) lcdInfo.textContent = getPresetDisplayName(currentPreset);
    loadPresetNameInput();
    // Reload tweak sliders
    const tb = document.getElementById('tweak-body');
    if (tb && tb.classList.contains('open')) loadTweakFromPreset();
    loadSequenceEditor();
    // Auto-save preset to active MIDI channel
    if (window.midiManager && window.midiManager.connected) {
      const ch = window.midiManager.activeChannel;
      if (!window.midiManager.isDrumChannel(ch)) {
        window.midiManager.setChannelPreset(ch, currentPreset);
        // Update channel grid display
        if (chNameEls[ch]) {
          chNameEls[ch].textContent = window.synth.getPresetName(currentPreset);
        }
      }
    }
    // Scroll voice bank grid to show selected preset
    const vbGrid = document.getElementById('vb-grid');
    if (vbGrid) {
      const entry = vbGrid.children[currentPreset];
      if (entry) entry.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // Highlight active entry in voice bank
    document.querySelectorAll('.vb-entry').forEach((el, i) => {
      el.classList.toggle('active', i === currentPreset);
    });
  }

  function enterDigit(d) {
    window.synth.playClick();
    // Shift left: current ones digit becomes tens, new digit becomes ones
    const oldOnes = currentPreset % 10;
    const newPreset = (oldOnes * 10) + parseInt(d);
    selectPreset(newPreset);
  }

  // Voice selector buttons (only those with data-num)
  document.querySelectorAll('.sel-btn[data-num]').forEach(btn => {
    btn.addEventListener('pointerdown', () => {
      enterDigit(btn.dataset.num);
    });
  });

  // ── Synth Page UI (only on index.html) ────────────────────────────
  const midiBtn = document.getElementById('midi-btn');
  if (midiBtn) { // guard: synth page only
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
      document.getElementById('lcd-info').textContent = window.midiManager.lastError || 'MIDI UNAVAILABLE';
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

  // ── Effect Switches (Sustain / Vibrato / Portamento) ──────────────
  const fxSustain = document.getElementById('fx-sustain');
  const fxVibrato = document.getElementById('fx-vibrato');
  const fxPortamento = document.getElementById('fx-portamento');

  // Restore saved state
  const savedFx = JSON.parse(localStorage.getItem('yamabruh_fx') || '{}');
  let fxState = { sustain: false, vibrato: false, portamento: false, ...savedFx };

  function applyFxState() {
    fxSustain.classList.toggle('active', fxState.sustain);
    fxVibrato.classList.toggle('active', fxState.vibrato);
    fxPortamento.classList.toggle('active', fxState.portamento);
    window.synth.setSustain(fxState.sustain, 3.0);
    window.synth.setVibrato(fxState.vibrato, 5.5, 0.004);
    window.synth.setPortamento(fxState.portamento, 0.08);
    localStorage.setItem('yamabruh_fx', JSON.stringify(fxState));
  }

  fxSustain.addEventListener('click', () => {
    fxState.sustain = !fxState.sustain;
    applyFxState();
    document.getElementById('lcd-info').textContent = 'SUSTAIN ' + (fxState.sustain ? 'ON' : 'OFF');
  });

  fxVibrato.addEventListener('click', () => {
    fxState.vibrato = !fxState.vibrato;
    applyFxState();
    document.getElementById('lcd-info').textContent = 'VIBRATO ' + (fxState.vibrato ? 'ON' : 'OFF');
  });

  fxPortamento.addEventListener('click', () => {
    fxState.portamento = !fxState.portamento;
    applyFxState();
    document.getElementById('lcd-info').textContent = 'PORTAMENTO ' + (fxState.portamento ? 'ON' : 'OFF');
  });

  // Apply on init
  applyFxState();

  // ── Delay Effect UI ────────────────────────────────────────────────
  const delayTimeEl = document.getElementById('delay-time');
  const delayFeedbackEl = document.getElementById('delay-feedback');
  const delayMixEl = document.getElementById('delay-mix');
  const delayFbVal = document.getElementById('delay-feedback-val');
  const delayMixVal = document.getElementById('delay-mix-val');

  const savedDelay = JSON.parse(localStorage.getItem('yamabruh_delay') || '{}');
  if (savedDelay.time) delayTimeEl.value = savedDelay.time;
  if (savedDelay.feedback !== undefined) delayFeedbackEl.value = savedDelay.feedback;
  if (savedDelay.mix !== undefined) delayMixEl.value = savedDelay.mix;

  function sendDelay() {
    const beats = parseFloat(delayTimeEl.value);
    const feedback = parseInt(delayFeedbackEl.value);
    const mix = parseInt(delayMixEl.value);
    delayFbVal.textContent = feedback;
    delayMixVal.textContent = mix;
    window.synth.setDelay(beats, feedback, mix);
    localStorage.setItem('yamabruh_delay', JSON.stringify({
      time: delayTimeEl.value, feedback, mix,
    }));
  }

  delayTimeEl.addEventListener('change', sendDelay);
  delayFeedbackEl.addEventListener('input', sendDelay);
  delayMixEl.addEventListener('input', sendDelay);

  // Init delay values from saved state
  delayFbVal.textContent = delayFeedbackEl.value;
  delayMixVal.textContent = delayMixEl.value;
  sendDelay();

  // ── Filter UI ──────────────────────────────────────────────────────
  const filterCutoffEl = document.getElementById('filter-cutoff');
  const filterResoEl = document.getElementById('filter-reso');
  const filterCutoffVal = document.getElementById('filter-cutoff-val');
  const filterResoVal = document.getElementById('filter-reso-val');

  const savedFilter = JSON.parse(localStorage.getItem('yamabruh_filter') || '{}');
  if (savedFilter.cutoff !== undefined) filterCutoffEl.value = savedFilter.cutoff;
  if (savedFilter.reso !== undefined) filterResoEl.value = savedFilter.reso;

  function sendFilter() {
    const cutoff = parseFloat(filterCutoffEl.value);
    const reso = parseFloat(filterResoEl.value);
    filterCutoffVal.textContent = cutoff >= 10000 ? (cutoff / 1000).toFixed(1) + 'k' : cutoff;
    filterResoVal.textContent = reso.toFixed(1);
    window.synth.setFilter(cutoff, reso);
    localStorage.setItem('yamabruh_filter', JSON.stringify({ cutoff, reso }));
  }

  filterCutoffEl.addEventListener('input', sendFilter);
  filterResoEl.addEventListener('input', sendFilter);
  filterCutoffVal.textContent = filterCutoffEl.value >= 10000 ? (filterCutoffEl.value / 1000).toFixed(1) + 'k' : filterCutoffEl.value;
  filterResoVal.textContent = parseFloat(filterResoEl.value).toFixed(1);
  sendFilter();

  // ── Drum Engine Init + Rhythm UI ──────────────────────────────────
  await window.drums.init(window.synth.ctx);

  const savedDrums = JSON.parse(localStorage.getItem('yamabruh_drums') || '{}');
  let drumPattern = savedDrums.pattern || 0;
  let drumBpm = savedDrums.bpm || 120;

  window.drums.setPattern(drumPattern);
  window.drums.setBpm(drumBpm);
  window.synth.setBpm(drumBpm);

  const rhythmDisplay = document.getElementById('rhythm-display');
  const tempoDisplay = document.getElementById('tempo-display');
  const startBtn = document.getElementById('rhythm-start');
  const fillBtn = document.getElementById('rhythm-fill');
  const stepDots = document.querySelectorAll('#rhythm-steps .step-dot');

  const patBtns = document.querySelectorAll('.rhythm-pat');

  function updateRhythmDisplay() {
    const num = String(drumPattern + 1).padStart(2, '0');
    rhythmDisplay.textContent = num + ' ' + window.drums.getPatternName(drumPattern);
    tempoDisplay.innerHTML = drumBpm + ' <span class="tempo-label">BPM</span>';
    // Highlight active pattern button
    patBtns.forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.pat) === drumPattern);
    });
  }
  updateRhythmDisplay();

  function saveDrumState() {
    localStorage.setItem('yamabruh_drums', JSON.stringify({ pattern: drumPattern, bpm: drumBpm }));
  }

  // Direct pattern select buttons
  patBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      drumPattern = parseInt(btn.dataset.pat);
      window.drums.setPattern(drumPattern);
      updateRhythmDisplay();
      saveDrumState();
      document.getElementById('lcd-info').textContent = 'RHYTHM: ' + window.drums.getPatternName(drumPattern);
    });
  });

  startBtn.addEventListener('click', () => {
    if (window.drums.playing) {
      window.drums.stop();
      startBtn.textContent = 'START';
      startBtn.classList.remove('active');
      // Clear step dots
      stepDots.forEach(d => { d.classList.remove('active', 'beat'); });
      document.getElementById('lcd-info').textContent = 'RHYTHM STOP';
    } else {
      window.synth.ensureContext();
      window.drums.start();
      startBtn.textContent = 'STOP';
      startBtn.classList.add('active');
      document.getElementById('lcd-info').textContent = 'RHYTHM: ' + window.drums.getPatternName(drumPattern);
    }
  });

  fillBtn.addEventListener('click', () => {
    if (window.drums.playing) {
      window.drums.fill();
      document.getElementById('lcd-info').textContent = 'FILL IN';
    }
  });

  document.getElementById('tempo-down').addEventListener('click', () => {
    drumBpm = Math.max(60, drumBpm - 4);
    window.drums.setBpm(drumBpm);
    window.synth.setBpm(drumBpm);
    sendDelay();
    tempoDisplay.innerHTML = drumBpm + ' <span class="tempo-label">BPM</span>';
    saveDrumState();
  });

  document.getElementById('tempo-up').addEventListener('click', () => {
    drumBpm = Math.min(240, drumBpm + 4);
    window.drums.setBpm(drumBpm);
    window.synth.setBpm(drumBpm);
    sendDelay();
    tempoDisplay.innerHTML = drumBpm + ' <span class="tempo-label">BPM</span>';
    saveDrumState();
  });

  // Step indicator callback
  window.drums.onStep = (step, totalSteps) => {
    stepDots.forEach((dot, i) => {
      if (i >= totalSteps) {
        dot.classList.remove('active', 'beat');
        return;
      }
      if (i === step) {
        dot.classList.add(i % 4 === 0 ? 'beat' : 'active');
      } else {
        dot.classList.remove('active', 'beat');
      }
    });
  };

  window.drums.onStop = () => {
    stepDots.forEach(d => { d.classList.remove('active', 'beat'); });
  };

  // ── Drum Key Editor ────────────────────────────────────────────────
  const DRUM_PAD_STORAGE_KEY = 'yamabruh_drum_keys_v1';
  const DEFAULT_DRUM_PADS = [
    { key: '1', sound: 'kick', note: 36, velocity: 0.95, bank: 0 },
    { key: '2', sound: 'snare', note: 38, velocity: 0.9, bank: 0 },
    { key: '3', sound: 'hihat_c', note: 42, velocity: 0.8, bank: 0 },
    { key: '4', sound: 'hihat_o', note: 46, velocity: 0.8, bank: 0 },
    { key: '5', sound: 'tom', note: 45, velocity: 0.9, bank: 0 },
    { key: '6', sound: 'cymbal', note: 49, velocity: 0.85, bank: 0 },
    { key: '7', sound: 'clap', note: 39, velocity: 0.85, bank: 0 },
    { key: '8', sound: 'rimshot', note: 37, velocity: 0.8, bank: 0 },
    { key: '9', sound: 'cowbell', note: 56, velocity: 0.8, bank: 0 },
    { key: '0', sound: 'zap', note: 88, velocity: 0.85, bank: 5 },
    { key: '-', sound: 'glitch', note: 89, velocity: 0.8, bank: 7 },
    { key: '=', sound: 'whoosh', note: 91, velocity: 0.8, bank: 5 },
    { key: '[', sound: 'thud', note: 33, velocity: 0.92, bank: 2 },
    { key: ']', sound: 'shaker', note: 69, velocity: 0.82, bank: 3 },
    { key: '\\', sound: 'fm_pop', note: 72, velocity: 0.82, bank: 5 },
    { key: '/', sound: 'gen_perc', note: 60, velocity: 0.88, bank: 6 },
  ];

  function makePadConfig(base) {
    return {
      key: base.key,
      sound: base.sound,
      note: base.note,
      velocity: base.velocity,
      bank: base.bank ?? 0,
      overrides: {
        decay: base.overrides?.decay ?? null,
        modIndex: base.overrides?.modIndex ?? null,
        pitchSweep: base.overrides?.pitchSweep ?? null,
        pitchDecay: base.overrides?.pitchDecay ?? null,
        pitchSemis: base.overrides?.pitchSemis ?? null,
        noiseAmt: base.overrides?.noiseAmt ?? null,
        clickAmt: base.overrides?.clickAmt ?? null,
        carrierFreq: base.overrides?.carrierFreq ?? null,
        modFreq: base.overrides?.modFreq ?? null,
      },
    };
  }

  function loadDrumPads() {
    try {
      const raw = JSON.parse(localStorage.getItem(DRUM_PAD_STORAGE_KEY) || 'null');
      if (!Array.isArray(raw) || !raw.length) return DEFAULT_DRUM_PADS.map(makePadConfig);
      return raw.map((item, i) => makePadConfig({ ...DEFAULT_DRUM_PADS[i % DEFAULT_DRUM_PADS.length], ...item }));
    } catch {
      return DEFAULT_DRUM_PADS.map(makePadConfig);
    }
  }

  function saveDrumPads() {
    localStorage.setItem(DRUM_PAD_STORAGE_KEY, JSON.stringify(drumPads));
  }

  function normalizeDrumKey(value) {
    return String(value || '').slice(0, 2).trim().toLowerCase();
  }

  function isAssignableDrumKey(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 2;
  }

  const drumToggle = document.getElementById('drum-toggle');
  const drumBody = document.getElementById('drum-body');
  const drumPadGrid = document.getElementById('drum-pad-grid');
  const drumEditorName = document.getElementById('drum-editor-name');
  const drumPreviewBtn = document.getElementById('drum-pad-preview');
  const drumPadResetBtn = document.getElementById('drum-pad-reset');
  const drumPadsResetAllBtn = document.getElementById('drum-pads-reset-all');
  const drumFields = {
    key: document.getElementById('drum-key-char'),
    sound: document.getElementById('drum-sound'),
    note: document.getElementById('drum-note'),
    pitchSemis: document.getElementById('drum-pitch'),
    velocity: document.getElementById('drum-velocity'),
    bank: document.getElementById('drum-bank'),
    decay: document.getElementById('drum-decay'),
    modIndex: document.getElementById('drum-modindex'),
    pitchSweep: document.getElementById('drum-pitchsweep'),
    pitchDecay: document.getElementById('drum-pitchdecay'),
    noiseAmt: document.getElementById('drum-noise'),
    clickAmt: document.getElementById('drum-click'),
    carrierFreq: document.getElementById('drum-carrierfreq'),
    modFreq: document.getElementById('drum-modfreq'),
  };
  const drumVals = {
    key: document.getElementById('drum-key-char-val'),
    sound: document.getElementById('drum-sound-val'),
    note: document.getElementById('drum-note-val'),
    pitchSemis: document.getElementById('drum-pitch-val'),
    velocity: document.getElementById('drum-velocity-val'),
    bank: document.getElementById('drum-bank-val'),
    decay: document.getElementById('drum-decay-val'),
    modIndex: document.getElementById('drum-modindex-val'),
    pitchSweep: document.getElementById('drum-pitchsweep-val'),
    pitchDecay: document.getElementById('drum-pitchdecay-val'),
    noiseAmt: document.getElementById('drum-noise-val'),
    clickAmt: document.getElementById('drum-click-val'),
    carrierFreq: document.getElementById('drum-carrierfreq-val'),
    modFreq: document.getElementById('drum-modfreq-val'),
  };
  const drumPads = loadDrumPads();
  let activeDrumPad = 0;
  const activeDrumKeys = new Set();

  function formatDrumKey(value) {
    const key = String(value || '').trim();
    return key ? key.toUpperCase() : '--';
  }

  window.drums.getSoundNames().forEach(sound => {
    const opt = document.createElement('option');
    opt.value = sound;
    opt.textContent = sound.toUpperCase();
    drumFields.sound.appendChild(opt);
  });

  function flashDrumPad(index) {
    const el = drumPadGrid.querySelector(`[data-drum-pad="${index}"]`);
    if (el) {
      el.classList.add('playing');
      setTimeout(() => el.classList.remove('playing'), 120);
    }
  }

  function findDrumPadIndex(note, sound) {
    const exact = drumPads.findIndex((pad) => pad.note === note);
    if (exact !== -1) return exact;
    if (sound) {
      const bySound = drumPads.findIndex((pad) => pad.sound === sound);
      if (bySound !== -1) return bySound;
    }
    return -1;
  }

  function resolveDrumPadConfig(note, sound, velocity = 1) {
    const index = findDrumPadIndex(note, sound);
    if (index === -1) return null;
    const pad = drumPads[index];
    const vel = Math.max(0, Math.min(1, Number(velocity) || 0));
    const padVel = Math.max(0, Math.min(1, Number(pad.velocity) || 0));
    return {
      sound: pad.sound,
      note,
      bank: pad.bank ?? 0,
      velocity: Math.max(0.001, Math.min(1, vel * padVel)),
      overrides: { ...(pad.overrides || {}) },
    };
  }

  function setActiveDrumPad(index, options = {}) {
    if (index < 0 || index >= drumPads.length) return;
    activeDrumPad = index;
    updateDrumEditor();
    if (options.flash) flashDrumPad(index);
  }

  function previewDrumPad(index) {
    const pad = drumPads[index];
    if (!pad) return;
    window.synth.ensureContext();
    window.drums.triggerPad(pad);
    flashDrumPad(index);
  }

  function renderDrumPads() {
    drumPadGrid.innerHTML = drumPads.map((pad, index) => `
      <button class="drum-pad${index === activeDrumPad ? ' active' : ''}" data-drum-pad="${index}">
        <div class="drum-pad-key">KEY ${formatDrumKey(pad.key)}</div>
        <div class="drum-pad-name">${pad.sound}</div>
        <div class="drum-pad-meta">N${pad.note} V${pad.velocity.toFixed(2)} B${pad.bank + 1}</div>
      </button>
    `).join('');
  }

  function updateDrumEditor() {
    const pad = drumPads[activeDrumPad];
    if (!pad) return;
    drumEditorName.textContent = 'KEY ' + formatDrumKey(pad.key) + ' / ' + (pad.sound || '').toUpperCase();
    drumFields.key.value = formatDrumKey(pad.key);
    drumFields.sound.value = pad.sound;
    drumFields.note.value = pad.note;
    drumFields.pitchSemis.value = pad.overrides.pitchSemis ?? 0;
    drumFields.velocity.value = pad.velocity;
    drumFields.bank.value = pad.bank;
    drumFields.decay.value = pad.overrides.decay ?? 0.25;
    drumFields.modIndex.value = pad.overrides.modIndex ?? 3;
    drumFields.pitchSweep.value = pad.overrides.pitchSweep ?? 0;
    drumFields.pitchDecay.value = pad.overrides.pitchDecay ?? 0.015;
    drumFields.noiseAmt.value = pad.overrides.noiseAmt ?? 0;
    drumFields.clickAmt.value = pad.overrides.clickAmt ?? 0.3;
    drumFields.carrierFreq.value = pad.overrides.carrierFreq ?? 60;
    drumFields.modFreq.value = pad.overrides.modFreq ?? 90;

    drumVals.key.textContent = formatDrumKey(pad.key);
    drumVals.sound.textContent = pad.sound;
    drumVals.note.textContent = String(pad.note);
    drumVals.pitchSemis.textContent = String(Math.round(Number(drumFields.pitchSemis.value)));
    drumVals.velocity.textContent = Number(pad.velocity).toFixed(2);
    drumVals.bank.textContent = window.drums.getBankName(pad.bank);
    drumVals.decay.textContent = Number(drumFields.decay.value).toFixed(3);
    drumVals.modIndex.textContent = Number(drumFields.modIndex.value).toFixed(2);
    drumVals.pitchSweep.textContent = String(Math.round(Number(drumFields.pitchSweep.value)));
    drumVals.pitchDecay.textContent = Number(drumFields.pitchDecay.value).toFixed(3);
    drumVals.noiseAmt.textContent = Number(drumFields.noiseAmt.value).toFixed(2);
    drumVals.clickAmt.textContent = Number(drumFields.clickAmt.value).toFixed(2);
    drumVals.carrierFreq.textContent = String(Math.round(Number(drumFields.carrierFreq.value)));
    drumVals.modFreq.textContent = String(Math.round(Number(drumFields.modFreq.value)));
    renderDrumPads();
  }

  function writeActiveDrumPad(fieldName) {
    const pad = drumPads[activeDrumPad];
    if (!pad) return;
    switch (fieldName) {
      case 'key':
        pad.key = normalizeDrumKey(drumFields.key.value) || pad.key;
        break;
      case 'sound':
        pad.sound = drumFields.sound.value;
        break;
      case 'note':
        pad.note = parseInt(drumFields.note.value, 10);
        break;
      case 'pitchSemis':
        pad.overrides.pitchSemis = parseInt(drumFields.pitchSemis.value, 10);
        break;
      case 'velocity':
        pad.velocity = parseFloat(drumFields.velocity.value);
        break;
      case 'bank':
        pad.bank = parseInt(drumFields.bank.value, 10);
        break;
      case 'decay':
        pad.overrides.decay = parseFloat(drumFields.decay.value);
        break;
      case 'modIndex':
        pad.overrides.modIndex = parseFloat(drumFields.modIndex.value);
        break;
      case 'pitchSweep':
        pad.overrides.pitchSweep = parseFloat(drumFields.pitchSweep.value);
        break;
      case 'pitchDecay':
        pad.overrides.pitchDecay = parseFloat(drumFields.pitchDecay.value);
        break;
      case 'noiseAmt':
        pad.overrides.noiseAmt = parseFloat(drumFields.noiseAmt.value);
        break;
      case 'clickAmt':
        pad.overrides.clickAmt = parseFloat(drumFields.clickAmt.value);
        break;
      case 'carrierFreq':
        pad.overrides.carrierFreq = parseFloat(drumFields.carrierFreq.value);
        break;
      case 'modFreq':
        pad.overrides.modFreq = parseFloat(drumFields.modFreq.value);
        break;
      default:
        return;
    }
    saveDrumPads();
    updateDrumEditor();
  }

  drumToggle.addEventListener('click', () => {
    const open = drumBody.classList.toggle('open');
    drumToggle.classList.toggle('open', open);
    drumToggle.innerHTML = 'DRUM KEYS ' + (open ? '&#9650;' : '&#9660;');
    if (open) updateDrumEditor();
  });

  drumPadGrid.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-drum-pad]');
    if (!btn) return;
    setActiveDrumPad(parseInt(btn.dataset.drumPad, 10));
    previewDrumPad(activeDrumPad);
  });

  Object.entries(drumFields).forEach(([name, field]) => {
    const handler = () => writeActiveDrumPad(name);
    field.addEventListener('input', handler);
    field.addEventListener('change', handler);
  });

  drumFields.key.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    if (!isAssignableDrumKey(event.key)) return;
    const normalized = normalizeDrumKey(event.key);
    if (!normalized) return;
    drumFields.key.value = formatDrumKey(normalized);
    writeActiveDrumPad('key');
  });

  drumPreviewBtn.addEventListener('click', () => previewDrumPad(activeDrumPad));
  drumPadResetBtn.addEventListener('click', () => {
    drumPads[activeDrumPad] = makePadConfig(DEFAULT_DRUM_PADS[activeDrumPad % DEFAULT_DRUM_PADS.length]);
    saveDrumPads();
    updateDrumEditor();
  });
  drumPadsResetAllBtn.addEventListener('click', () => {
    for (let i = 0; i < drumPads.length; i++) drumPads[i] = makePadConfig(DEFAULT_DRUM_PADS[i % DEFAULT_DRUM_PADS.length]);
    saveDrumPads();
    updateDrumEditor();
  });

  renderDrumPads();
  updateDrumEditor();

  window.resolveDrumPadConfig = ({ note, sound, velocity }) => resolveDrumPadConfig(note, sound, velocity);

  window.midiManager.onDrumNote = ({ note, sound }) => {
    const index = findDrumPadIndex(note, sound);
    if (index === -1) return;
    setActiveDrumPad(index, { flash: true });
  };

  function playDrumKey(keyValue) {
    const normalized = normalizeDrumKey(keyValue);
    if (!normalized || activeDrumKeys.has(normalized)) return false;
    const index = drumPads.findIndex((pad) => normalizeDrumKey(pad.key) === normalized);
    if (index === -1) return false;
    activeDrumKeys.add(normalized);
    setActiveDrumPad(index);
    previewDrumPad(index);
    return true;
  }

  function releaseDrumKey(keyValue) {
    const normalized = normalizeDrumKey(keyValue);
    if (!normalized) return;
    activeDrumKeys.delete(normalized);
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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (drumBody.classList.contains('open') && playDrumKey(e.key)) {
      e.preventDefault();
      return;
    }

    // Arrow keys for patch change
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectPreset(currentPreset + 1);
      window.synth.playClick();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectPreset(currentPreset - 1);
      window.synth.playClick();
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
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    releaseDrumKey(e.key);
    const midi = qwertyMap[e.key.toLowerCase()];
    if (midi !== undefined) {
      activeQwerty.delete(e.key);
      const el = document.querySelector(`[data-midi="${midi}"]`);
      if (el) keyUp(el, midi);
    }
  });

  // ── Tweak Section ───────────────────────────────────────────────────
  const tweakToggle = document.getElementById('tweak-toggle');
  const tweakBody = document.getElementById('tweak-body');
  const tweakReset = document.getElementById('tweak-reset');

  // Slider ID → param index in 21-param array
  // [cr, mr, mi, atk, dec, sus, rel, fb, cWave, mWave, trem, chipVib, ksr, ksl, modLvl, egType, mAtk, mDec, mSus, mRel, mEgType]
  const tweakMap = [
    ['tw-carrier',  0], ['tw-attack',   3], ['tw-decay',    4], ['tw-sustain',  5],
    ['tw-release',  6], ['tw-cwave',    8], ['tw-egtype',  15], ['tw-tremolo', 10],
    ['tw-ksl',     13], ['tw-modratio', 1], ['tw-modindex', 2], ['tw-feedback', 7],
    ['tw-matk',    16], ['tw-mdec',    17], ['tw-msus',    18], ['tw-mrel',    19],
    ['tw-mwave',    9], ['tw-megtype', 20],
  ];
  const tweakIds = tweakMap.map(m => m[0]);
  const tweakParamIdx = tweakMap.map(m => m[1]);
  const tweakSliders = tweakIds.map(id => document.getElementById(id));
  const tweakVals = tweakIds.map(id => document.getElementById(id + '-val'));

  tweakToggle.addEventListener('click', () => {
    const open = tweakBody.classList.toggle('open');
    tweakToggle.classList.toggle('open', open);
    tweakToggle.innerHTML = 'EDITOR ' + (open ? '&#9650;' : '&#9660;');
    if (open) {
      loadTweakFromPreset();
      loadSequenceEditor();
    }
  });

  function loadTweakFromPreset() {
    const params = window.synth.getPresetParams(currentPreset);
    tweakSliders.forEach((slider, i) => {
      const pi = tweakParamIdx[i];
      const v = params[pi] || 0;
      slider.value = v;
      tweakVals[i].textContent = Number.isInteger(v) ? v.toString() : v.toFixed(3);
    });
  }

  function getTweakParams() {
    const base = window.synth.getPresetParams(currentPreset);
    const params = base.slice();
    tweakSliders.forEach((s, i) => {
      params[tweakParamIdx[i]] = parseFloat(s.value);
    });
    return params;
  }

  function sendTweakToWorklet() {
    const params = getTweakParams();
    if (window.synth.workletNode) {
      window.synth.workletNode.port.postMessage({ type: 'preset', params });
    }
    // Override preset cache so MIDI/keyboard notes also use tweaked values
    window.synth._presetCache.set(currentPreset, params);
    voiceBankEdits[currentPreset] = params.slice();
    persistVoiceBankEdits();
    // Update value displays
    tweakSliders.forEach((slider, i) => {
      const v = parseFloat(slider.value);
      tweakVals[i].textContent = Number.isInteger(v) ? v.toString() : v.toFixed(3);
    });
  }

  tweakSliders.forEach(slider => {
    slider.addEventListener('input', sendTweakToWorklet);
  });

  tweakReset.addEventListener('click', () => {
    window.synth._presetCache.delete(currentPreset);
    delete voiceBankEdits[currentPreset];
    persistVoiceBankEdits();
    loadTweakFromPreset();
    window.synth._sendPreset();
  });

  document.getElementById('tweak-copy').addEventListener('click', () => {
    const params = getTweakParams();
    const rounded = params.map(v => {
      if (Number.isInteger(v)) return v;
      const s = v.toPrecision(4);
      return parseFloat(s);
    });
    const name = getPresetDisplayName(currentPreset);
    const seqDef = getSequenceDefForPreset(currentPreset);
    const seqSource = seqDef?.source ? seqDef.source.trim() : null;
    const lines = [
      '// ' + String(currentPreset).padStart(2, '0') + ' ' + name,
      '[' + rounded.join(', ') + ']',
    ];
    if (seqSource) {
      lines.push('// sequence:');
      lines.push(seqSource);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      const lcdInfo = document.getElementById('lcd-info');
      if (lcdInfo) lcdInfo.textContent = 'COPIED PRESET ' + currentPreset;
    });
  });

  const seqFields = {
    enabled: document.getElementById('seq-enabled'),
    source: document.getElementById('seq-source'),
  };
  const seqVals = {
    enabled: document.getElementById('seq-enabled-val'),
    source: document.getElementById('seq-source-val'),
  };
  const seqCrystalBtn = document.getElementById('seq-crystal');
  const seqClearBtn = document.getElementById('seq-clear');

  function formatSequenceSourceValue(value) {
    if (typeof value === 'function') return value.toString();
    if (Array.isArray(value)) return JSON.stringify(value);
    if (typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return null;
  }

  function sequenceDefToSource(def) {
    if (!def) return '';
    if (typeof def.source === 'string' && def.source.trim()) return def.source.trim();
    const lines = ['{'];
    ['gated', 'g', 'n', 'v', 't', 'cents', 'offsets', 'times', 'levels', 'algorithm', 'noteAlgo'].forEach((key) => {
      const value = def[key];
      if (value === undefined || value === null || value === '') return;
      const formatted = (key === 'algorithm' || key === 'noteAlgo') && typeof value === 'string'
        ? value
        : formatSequenceSourceValue(value);
      if (formatted === null) return;
      lines.push(`  ${key}: ${formatted},`);
    });
    lines.push('}');
    return lines.join('\n');
  }

  function defaultSequenceSource() {
    return [
      '{',
      '  gated: true,',
      '  g: 0.82,',
      '  t: 0.25,',
      '  algorithm: ({ n, v, t, g }) => ({',
      '    n,',
      '    v,',
      '    t,',
      '    g,',
      '  }),',
      '}',
    ].join('\n');
  }

  function cloneSequenceDef(def) {
    if (!def) return null;
    return {
      enabled: !!def.enabled,
      name: String(def.name || ''),
      source: sequenceDefToSource(def),
    };
  }

  function defaultSequenceForPreset(index) {
    return cloneSequenceDef(DEFAULT_SEQUENCE_DEFS[index] || null);
  }

  function loadSequenceDefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(SEQUENCE_STORAGE_KEY) || '{}');
      if (!raw || typeof raw !== 'object') return {};
      // Migrate: replace deprecated 'loop' with 'gated' in stored sources
      for (const key in raw) {
        const def = raw[key];
        if (def?.source && typeof def.source === 'string') {
          def.source = def.source.replace(/\bloop\s*:/g, 'gated:');
        }
        if (def?.loop !== undefined) {
          def.gated = !!def.loop;
          delete def.loop;
        }
      }
      return raw;
    } catch (error) {
      return {};
    }
  }

  const sequenceDefs = loadSequenceDefs();

  function persistSequenceDefs() {
    localStorage.setItem(SEQUENCE_STORAGE_KEY, JSON.stringify(sequenceDefs));
  }

  function getSequenceDefForPreset(index) {
    if (Object.prototype.hasOwnProperty.call(sequenceDefs, index)) {
      return sequenceDefs[index] && sequenceDefs[index].enabled ? cloneSequenceDef(sequenceDefs[index]) : null;
    }
    return cloneSequenceDef(DEFAULT_SEQUENCE_DEFS[index] || null);
  }

  function syncSequenceToSynth(index) {
    window.synth.setSequenceDef(index, getSequenceDefForPreset(index));
  }

  Object.keys(DEFAULT_SEQUENCE_DEFS).forEach((key) => syncSequenceToSynth(Number(key)));
  Object.keys(sequenceDefs).forEach((key) => syncSequenceToSynth(Number(key)));
  loadSequenceEditor();

  function currentSequenceFromEditor() {
    if (!seqFields.enabled.checked) return null;
    const source = String(seqFields.source.value || '').trim()
      || sequenceDefToSource(getSequenceDefForPreset(currentPreset))
      || defaultSequenceSource();
    seqFields.source.value = source;
    return {
      enabled: true,
      name: window.synth.getPresetName(currentPreset) + ' Seq',
      source,
    };
  }

  function updateSequenceReadout(def) {
    seqVals.enabled.textContent = def && def.enabled ? 'ON' : 'OFF';
    if (seqVals.source) seqVals.source.textContent = def?.source ? 'OBJECT SOURCE' : '--';
  }

  function loadSequenceEditor() {
    const def = getSequenceDefForPreset(currentPreset);
    seqFields.enabled.checked = !!def;
    seqFields.source.value = def?.source || '';
    updateSequenceReadout(def);
  }

  function saveSequenceEditor() {
    const def = currentSequenceFromEditor();
    if (def) sequenceDefs[currentPreset] = def;
    else if (DEFAULT_SEQUENCE_DEFS[currentPreset]) sequenceDefs[currentPreset] = { enabled: false };
    else delete sequenceDefs[currentPreset];
    persistSequenceDefs();
    syncSequenceToSynth(currentPreset);
    updateSequenceReadout(def);
  }

  Object.entries(seqFields).forEach(([name, field]) => {
    const handler = () => saveSequenceEditor();
    field.addEventListener('input', handler);
    field.addEventListener('change', handler);
    field.addEventListener('paste', () => setTimeout(handler, 0));
  });

  ['keydown', 'keypress', 'keyup'].forEach((eventName) => {
    seqFields.source.addEventListener(eventName, (event) => {
      event.stopPropagation();
    });
  });

  document.getElementById('seq-basic').addEventListener('click', () => {
    sequenceDefs[currentPreset] = {
      enabled: true,
      source: defaultSequenceSource(),
    };
    persistSequenceDefs();
    syncSequenceToSynth(currentPreset);
    loadSequenceEditor();
  });

  seqCrystalBtn.addEventListener('click', () => {
    sequenceDefs[currentPreset] = cloneSequenceDef(DEFAULT_SEQUENCE_DEFS[88]);
    persistSequenceDefs();
    syncSequenceToSynth(currentPreset);
    loadSequenceEditor();
  });

  seqClearBtn.addEventListener('click', () => {
    if (DEFAULT_SEQUENCE_DEFS[currentPreset]) sequenceDefs[currentPreset] = { enabled: false };
    else delete sequenceDefs[currentPreset];
    persistSequenceDefs();
    syncSequenceToSynth(currentPreset);
    loadSequenceEditor();
  });

  // ── MIDI Learn Mode ────────────────────────────────────────────────
  const learnBtn = document.getElementById('tweak-learn');
  let learnMode = false;
  let learnTarget = null; // index of slider waiting for CC
  const ccMap = JSON.parse(localStorage.getItem('yamabruh_cc_map') || '{}');
  // Reverse map: CC number → slider index
  const ccToSlider = {};
  for (const [idx, cc] of Object.entries(ccMap)) {
    ccToSlider[cc] = parseInt(idx);
  }

  function setLearnMode(on) {
    learnMode = on;
    learnTarget = null;
    learnBtn.classList.toggle('active', on);
    learnBtn.textContent = on ? 'LEARNING...' : 'LEARN';
    // Remove any pending highlight
    tweakSliders.forEach(s => s.classList.remove('learn-waiting'));
    document.getElementById('lcd-info').textContent = on ? 'CLICK A FADER, THEN MOVE A KNOB' : 'LEARN OFF';
  }

  learnBtn.addEventListener('click', () => {
    setLearnMode(!learnMode);
  });

  // Click a slider in learn mode → mark it as waiting for CC
  tweakSliders.forEach((slider, i) => {
    slider.addEventListener('pointerdown', () => {
      if (!learnMode) return;
      learnTarget = i;
      tweakSliders.forEach(s => s.classList.remove('learn-waiting'));
      slider.classList.add('learn-waiting');
      const paramName = tweakIds[i].replace('tw-', '').toUpperCase();
      document.getElementById('lcd-info').textContent = 'MOVE KNOB FOR: ' + paramName;
    });
  });

  // CC callback — learn or apply mapped CCs
  window.midiManager.onCC = (cc, val) => {
    if (learnMode && learnTarget !== null) {
      // Map this CC to the selected slider
      // Remove any old mapping for this CC
      for (const [idx, oldCc] of Object.entries(ccMap)) {
        if (oldCc === cc) {
          delete ccMap[idx];
          delete ccToSlider[cc];
        }
      }
      ccMap[learnTarget] = cc;
      ccToSlider[cc] = learnTarget;
      localStorage.setItem('yamabruh_cc_map', JSON.stringify(ccMap));
      const paramName = tweakIds[learnTarget].replace('tw-', '').toUpperCase();
      document.getElementById('lcd-info').textContent = 'CC' + cc + ' → ' + paramName;
      tweakSliders[learnTarget].classList.remove('learn-waiting');
      learnTarget = null;
      return;
    }

    // Apply mapped CCs to sliders
    const sliderIdx = ccToSlider[cc];
    if (sliderIdx !== undefined && tweakSliders[sliderIdx]) {
      const slider = tweakSliders[sliderIdx];
      const min = parseFloat(slider.min);
      const max = parseFloat(slider.max);
      slider.value = min + (val / 127) * (max - min);
      sendTweakToWorklet();
    }
  };

  // ── MIDI Channel Grid ──────────────────────────────────────────────
  const chGrid = document.getElementById('ch-grid');
  const chSlots = [];
  function getChDisplayName(ch) {
    if (window.midiManager.isDrumChannel(ch)) return 'DRUMS';
    const preset = window.midiManager.getChannelPreset(ch);
    return window.synth.getPresetName(preset);
  }

  function highlightActiveChannel(ch) {
    chSlots.forEach((slot, i) => {
      slot.classList.toggle('active-ch', i === ch);
    });
  }

  for (let ch = 0; ch < 16; ch++) {
    const slot = document.createElement('div');
    const isDrum = window.midiManager.isDrumChannel(ch);
    slot.className = 'ch-slot' + (isDrum ? ' drum-ch' : '');
    chSlots.push(slot);

    const numEl = document.createElement('div');
    numEl.className = 'ch-num';
    numEl.textContent = 'CH' + (ch + 1);

    const nameEl = document.createElement('div');
    nameEl.className = 'ch-name';
    nameEl.textContent = getChDisplayName(ch);
    chNameEls.push(nameEl);

    const setBtn = document.createElement('button');
    setBtn.className = 'ch-set-btn';
    setBtn.textContent = 'SET';
    setBtn.dataset.ch = ch;

    if (isDrum) {
      setBtn.style.display = 'none'; // drum channels don't need SET
    }

    setBtn.addEventListener('click', () => {
      const c = parseInt(setBtn.dataset.ch);
      window.midiManager.setChannelPreset(c, currentPreset);
      nameEl.textContent = window.synth.getPresetName(currentPreset);
      document.getElementById('lcd-info').textContent = 'CH' + (c + 1) + ' = ' + window.synth.getPresetName(currentPreset);
    });

    slot.appendChild(numEl);
    slot.appendChild(nameEl);
    slot.appendChild(setBtn);
    chGrid.appendChild(slot);
  }

  // Auto-channel: highlight active MIDI channel and load its preset
  window.midiManager.onChannelChange = (ch) => {
    highlightActiveChannel(ch);
    if (!window.midiManager.isDrumChannel(ch)) {
      const chPreset = window.midiManager.getChannelPreset(ch);
      selectPreset(chPreset);
    }
  };

  // MIDI Program Change: update preset selector when PC message received
  window.midiManager.onPresetChange = (preset) => {
    selectPreset(preset);
  };

  // ── Effects Toggle ──────────────────────────────────────────────────
  const fxRackToggle = document.getElementById('fx-rack-toggle');
  const fxRackBody = document.getElementById('fx-rack-body');
  fxRackToggle.addEventListener('click', () => {
    const open = fxRackBody.classList.toggle('open');
    fxRackToggle.classList.toggle('open', open);
    fxRackToggle.innerHTML = 'EFFECTS ' + (open ? '&#9650;' : '&#9660;');
  });

  // ── Key Sequence Toggle ─────────────────────────────────────────────
  const seqToggle = document.getElementById('seq-toggle');
  const seqBody = document.getElementById('seq-body');
  seqToggle.addEventListener('click', () => {
    const open = seqBody.classList.toggle('open');
    seqToggle.classList.toggle('open', open);
    seqToggle.innerHTML = 'KEY SEQUENCE ' + (open ? '&#9650;' : '&#9660;');
  });

  // Choke same notes toggle
  const seqChokeEl = document.getElementById('seq-choke');
  const seqChokeVal = document.getElementById('seq-choke-val');
  const savedChoke = localStorage.getItem('yamabruh_choke') === '1';
  seqChokeEl.checked = savedChoke;
  seqChokeVal.textContent = savedChoke ? 'ON' : 'OFF';
  if (window.synth.workletNode) {
    window.synth.workletNode.port.postMessage({ type: 'chokeSameNotes', on: savedChoke });
  }
  seqChokeEl.addEventListener('change', () => {
    const on = seqChokeEl.checked;
    seqChokeVal.textContent = on ? 'ON' : 'OFF';
    localStorage.setItem('yamabruh_choke', on ? '1' : '0');
    if (window.synth.workletNode) {
      window.synth.workletNode.port.postMessage({ type: 'chokeSameNotes', on });
    }
  });

  // Hint toggle
  const seqHintBtn = document.getElementById('seq-hint-btn');
  const seqHint = document.getElementById('seq-hint');
  seqHintBtn.addEventListener('click', () => {
    seqHint.style.display = seqHint.style.display === 'none' ? 'block' : 'none';
  });

  // ── MIDI Channels Toggle ────────────────────────────────────────────
  const midiChToggle = document.getElementById('midi-ch-toggle');
  const midiChBody = document.getElementById('midi-ch-body');
  midiChToggle.addEventListener('click', () => {
    const open = midiChBody.classList.toggle('open');
    midiChToggle.classList.toggle('open', open);
    midiChToggle.innerHTML = 'MIDI CHANNELS ' + (open ? '&#9650;' : '&#9660;');
  });

  // ── Visual Config UI ──────────────────────────────────────────────
  const visualToggle = document.getElementById('visual-toggle');
  const visualBody = document.getElementById('visual-body');
  const visualReset = document.getElementById('visual-reset');
  const todModeBtn = document.getElementById('tod-mode-btn');
  const todSlider = document.getElementById('vis-tod');

  visualToggle.addEventListener('click', () => {
    const open = visualBody.classList.toggle('open');
    visualToggle.classList.toggle('open', open);
    visualToggle.innerHTML = 'VISUAL CONFIG ' + (open ? '&#9650;' : '&#9660;');
  });

  const visIds = ['vis-dust','vis-wear','vis-patina','vis-light','vis-grain','vis-scratches'];
  const visKeys = ['dust','wear','patina','light','grain','scratches'];

  visIds.forEach((id, i) => {
    const slider = document.getElementById(id);
    const val = document.getElementById(id + '-val');
    slider.value = visualConfig[visKeys[i]];
    val.textContent = Number(visualConfig[visKeys[i]]).toFixed(2);
    slider.addEventListener('input', () => {
      visualConfig[visKeys[i]] = parseFloat(slider.value);
      val.textContent = parseFloat(slider.value).toFixed(2);
      localStorage.setItem('yamabruh_visual', JSON.stringify(visualConfig));
      if (window.markShaderDirty) window.markShaderDirty();
    });
  });

  function updateTodUI() {
    const isAuto = visualConfig.todMode === 'auto';
    todModeBtn.textContent = isAuto ? 'AUTO' : 'MANUAL';
    todModeBtn.classList.toggle('manual', !isAuto);
    todSlider.disabled = isAuto;
    document.getElementById('vis-tod-val').textContent = isAuto
      ? 'auto (' + getTod().toFixed(1) + 'h)'
      : visualConfig.todManual.toFixed(1) + 'h';
  }

  todModeBtn.addEventListener('click', () => {
    visualConfig.todMode = visualConfig.todMode === 'auto' ? 'manual' : 'auto';
    if (visualConfig.todMode === 'manual') {
      visualConfig.todManual = getTod();
      todSlider.value = visualConfig.todManual;
    }
    updateTodUI();
    localStorage.setItem('yamabruh_visual', JSON.stringify(visualConfig));
    if (window.markShaderDirty) window.markShaderDirty();
  });

  todSlider.value = visualConfig.todManual;
  todSlider.addEventListener('input', () => {
    visualConfig.todManual = parseFloat(todSlider.value);
    updateTodUI();
    localStorage.setItem('yamabruh_visual', JSON.stringify(visualConfig));
    if (window.markShaderDirty) window.markShaderDirty();
  });

  updateTodUI();

  visualReset.addEventListener('click', () => {
    Object.assign(visualConfig, { ...DEFAULT_VISUAL });
    localStorage.removeItem('yamabruh_visual');
    visIds.forEach((id, i) => {
      document.getElementById(id).value = DEFAULT_VISUAL[visKeys[i]];
      document.getElementById(id + '-val').textContent = DEFAULT_VISUAL[visKeys[i]].toFixed(2);
    });
    todSlider.value = DEFAULT_VISUAL.todManual;
    updateTodUI();
    if (window.markShaderDirty) window.markShaderDirty();
  });

  window.exportYamaState = () => JSON.parse(JSON.stringify({
    version: 1,
    currentPreset,
    voiceBankEdits,
    customPresetNames,
    sequenceDefs,
    drumPads,
    drumPattern,
    drumBpm,
    midiChannelMap: window.midiManager ? window.midiManager.channelMap.slice() : [],
  }));

  window.importYamaState = (state) => {
    if (!state || typeof state !== 'object') return false;

    Object.keys(voiceBankEdits).forEach((key) => delete voiceBankEdits[key]);
    if (state.voiceBankEdits && typeof state.voiceBankEdits === 'object') {
      Object.entries(state.voiceBankEdits).forEach(([key, params]) => {
        if (Array.isArray(params)) {
          voiceBankEdits[key] = params.slice();
          window.synth._presetCache.set(Number(key), params.slice());
        }
      });
    }
    persistVoiceBankEdits();

    Object.keys(sequenceDefs).forEach((key) => delete sequenceDefs[key]);
    if (state.sequenceDefs && typeof state.sequenceDefs === 'object') {
      Object.entries(state.sequenceDefs).forEach(([key, def]) => {
        sequenceDefs[key] = def;
      });
    }
    persistSequenceDefs();
    Object.keys(DEFAULT_SEQUENCE_DEFS).forEach((key) => syncSequenceToSynth(Number(key)));
    Object.keys(sequenceDefs).forEach((key) => syncSequenceToSynth(Number(key)));

    if (Array.isArray(state.drumPads) && state.drumPads.length) {
      drumPads.length = 0;
      state.drumPads.forEach((pad, i) => {
        drumPads.push(makePadConfig({ ...DEFAULT_DRUM_PADS[i % DEFAULT_DRUM_PADS.length], ...pad }));
      });
      saveDrumPads();
      renderDrumPads();
      updateDrumEditor();
    }

    if (Number.isFinite(state.drumPattern)) {
      drumPattern = Math.max(0, Math.min(window.drums.getPatternCount() - 1, state.drumPattern));
      window.drums.setPattern(drumPattern);
    }
    if (Number.isFinite(state.drumBpm)) {
      drumBpm = Math.max(60, Math.min(240, state.drumBpm));
      window.drums.setBpm(drumBpm);
      window.synth.setBpm(drumBpm);
      document.getElementById('tempo-display').innerHTML = drumBpm + ' <span class="tempo-label">BPM</span>';
    }

    if (Array.isArray(state.midiChannelMap) && state.midiChannelMap.length === 16 && window.midiManager) {
      window.midiManager.channelMap = state.midiChannelMap.slice();
      window.midiManager.saveChannelMap();
      chNameEls.forEach((el, i) => {
        if (el) el.textContent = getChDisplayName(i);
      });
    }

    if (Number.isFinite(state.currentPreset)) {
      selectPreset(state.currentPreset);
    } else {
      updateDisplay();
      window.synth._sendPreset();
    }

    if (tweakBody.classList.contains('open')) {
      loadTweakFromPreset();
      loadSequenceEditor();
    }

    return true;
  };

  } // end synth page guard
})();
