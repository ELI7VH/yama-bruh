// ── YAMA-BRUH Main App ────────────────────────────────────────────────

(async function () {
  // ── State ─────────────────────────────────────────────────────────
  let currentPreset = parseInt(localStorage.getItem('yamabruh_preset') || '0');
  let presetInput = '';
  let presetTimeout = null;
  let flash = 0;
  let playingSources = new Map();
  const savedMidi = JSON.parse(localStorage.getItem('yamabruh_midi') || 'null');

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
      for (int i = 0; i < 5; i++) {
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

      // Scratches — horizontal bias
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        vec2 suv = uv * vec2(0.8, 50.0 + fi * 12.0) + vec2(fi * 17.3, fi * 31.7);
        float s = noise(suv);
        col += smoothstep(0.49, 0.5, s) * 0.025 * u_scratches;
      }
      // Diagonal micro-scratches
      float diag = noise(uv * vec2(30.0, 30.0) + vec2(uv.y * 20.0, uv.x * 20.0));
      col += smoothstep(0.48, 0.5, diag) * 0.015 * u_scratches;

      // Dust — heavier in corners and edges
      float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float dustBase = fbm(uv * 8.0 + 300.0);
      float dustEdge = 1.0 - smoothstep(0.0, 0.15, edgeDist);
      float dustPattern = dustBase * 0.4 + dustEdge * 0.6;
      vec3 dustCol = vec3(0.15, 0.14, 0.12);
      col = mix(col, dustCol, dustPattern * u_dust * 0.15);
      // Dust specks
      float specks = noise(uv * 200.0 + 500.0);
      col += smoothstep(0.7, 0.72, specks) * vec3(0.04, 0.035, 0.03) * u_dust;

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

      // Breathing
      col += sin(u_time * 0.5) * 0.003;

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
      gl.uniform1f(uTod, getTod());
      gl.uniform1f(uDust, visualConfig.dust);
      gl.uniform1f(uWear, visualConfig.wear);
      gl.uniform1f(uPatina, visualConfig.patina);
      gl.uniform1f(uLight, visualConfig.light);
      gl.uniform1f(uGrain, visualConfig.grain);
      gl.uniform1f(uScratches, visualConfig.scratches);
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
    // Reload tweak sliders if open
    const tb = document.getElementById('tweak-body');
    if (tb && tb.classList.contains('open')) {
      const params = window.synth.getPresetParams(currentPreset);
      document.querySelectorAll('.tweak-param input[type="range"]').forEach((slider, i) => {
        slider.value = params[i];
        slider.nextElementSibling.textContent = params[i].toFixed(2);
      });
    }
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

  // ── Drum Engine Init + Rhythm UI ──────────────────────────────────
  await window.drums.init(window.synth.ctx);

  const savedDrums = JSON.parse(localStorage.getItem('yamabruh_drums') || '{}');
  let drumPattern = savedDrums.pattern || 0;
  let drumBpm = savedDrums.bpm || 120;

  window.drums.setPattern(drumPattern);
  window.drums.setBpm(drumBpm);

  const rhythmDisplay = document.getElementById('rhythm-display');
  const tempoDisplay = document.getElementById('tempo-display');
  const startBtn = document.getElementById('rhythm-start');
  const fillBtn = document.getElementById('rhythm-fill');
  const stepDots = document.querySelectorAll('#rhythm-steps .step-dot');

  function updateRhythmDisplay() {
    const num = String(drumPattern + 1).padStart(2, '0');
    rhythmDisplay.textContent = num + ' ' + window.drums.getPatternName(drumPattern);
    tempoDisplay.textContent = drumBpm;
  }
  updateRhythmDisplay();

  function saveDrumState() {
    localStorage.setItem('yamabruh_drums', JSON.stringify({ pattern: drumPattern, bpm: drumBpm }));
  }

  document.getElementById('rhythm-prev').addEventListener('click', () => {
    drumPattern = (drumPattern - 1 + window.drums.getPatternCount()) % window.drums.getPatternCount();
    window.drums.setPattern(drumPattern);
    updateRhythmDisplay();
    saveDrumState();
  });

  document.getElementById('rhythm-next').addEventListener('click', () => {
    drumPattern = (drumPattern + 1) % window.drums.getPatternCount();
    window.drums.setPattern(drumPattern);
    updateRhythmDisplay();
    saveDrumState();
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
    tempoDisplay.textContent = drumBpm;
    saveDrumState();
  });

  document.getElementById('tempo-up').addEventListener('click', () => {
    drumBpm = Math.min(240, drumBpm + 4);
    window.drums.setBpm(drumBpm);
    tempoDisplay.textContent = drumBpm;
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

  // ── Tweak Section ───────────────────────────────────────────────────
  const tweakToggle = document.getElementById('tweak-toggle');
  const tweakBody = document.getElementById('tweak-body');
  const tweakReset = document.getElementById('tweak-reset');

  const tweakIds = ['tw-carrier','tw-modratio','tw-modindex','tw-attack','tw-decay','tw-sustain','tw-release','tw-feedback'];
  const tweakSliders = tweakIds.map(id => document.getElementById(id));
  const tweakVals = tweakIds.map(id => document.getElementById(id + '-val'));

  tweakToggle.addEventListener('click', () => {
    const open = tweakBody.classList.toggle('open');
    tweakToggle.classList.toggle('open', open);
    tweakToggle.innerHTML = 'SOUND EDITOR ' + (open ? '&#9650;' : '&#9660;');
    if (open) loadTweakFromPreset();
  });

  function loadTweakFromPreset() {
    const params = window.synth.getPresetParams(currentPreset);
    tweakSliders.forEach((slider, i) => {
      slider.value = params[i];
      tweakVals[i].textContent = params[i].toFixed(2);
    });
  }

  function getTweakParams() {
    return tweakSliders.map(s => parseFloat(s.value));
  }

  function sendTweakToWorklet() {
    const params = getTweakParams();
    if (window.synth.workletNode) {
      window.synth.workletNode.port.postMessage({ type: 'preset', params });
    }
    // Update value displays
    tweakSliders.forEach((slider, i) => {
      tweakVals[i].textContent = parseFloat(slider.value).toFixed(2);
    });
  }

  tweakSliders.forEach(slider => {
    slider.addEventListener('input', sendTweakToWorklet);
  });

  tweakReset.addEventListener('click', () => {
    window.synth._presetCache.delete(currentPreset);
    loadTweakFromPreset();
    window.synth._sendPreset();
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
  });

  todSlider.value = visualConfig.todManual;
  todSlider.addEventListener('input', () => {
    visualConfig.todManual = parseFloat(todSlider.value);
    updateTodUI();
    localStorage.setItem('yamabruh_visual', JSON.stringify(visualConfig));
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
  });
})();
