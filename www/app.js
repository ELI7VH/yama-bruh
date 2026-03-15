// ── YAMA-BRUH Main App ────────────────────────────────────────────────

(async function () {
  // ── State ─────────────────────────────────────────────────────────
  let currentPreset = 0;
  let presetInput = '';
  let flash = 0;
  let playingSources = new Map();

  // ── Init synth ────────────────────────────────────────────────────
  await window.synth.init();
  updateLCD();

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

      // Base aged plastic — warm beige/grey
      vec3 col = vec3(0.74, 0.71, 0.66);

      // Large-scale discoloration / yellowing stains
      float stain = fbm(uv * 3.0 + 42.0);
      col += vec3(stain * 0.06, stain * 0.04, -stain * 0.02);

      // Darker wear zones (where hands would grip)
      float wear = fbm(uv * vec2(2.0, 5.0) + 100.0);
      col -= wear * 0.04;

      // Micro-texture: plastic grain
      float grain = noise(uv * 350.0);
      col += (grain - 0.5) * 0.035;

      // Scratches — horizontal bias
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        vec2 suv = uv * vec2(0.8, 40.0 + fi * 8.0) + vec2(fi * 17.3, fi * 31.7);
        float s = noise(suv);
        float scratch = smoothstep(0.49, 0.5, s) * 0.06;
        col += scratch;
      }

      // Deep scratches — fewer, more visible
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 suv = uv * vec2(1.0, 80.0) + vec2(fi * 53.1, fi * 97.3);
        float s = noise(suv);
        float scratch = smoothstep(0.495, 0.5, s) * 0.1;
        col += scratch;
      }

      // Specular highlight from mouse — subtle plastic sheen
      vec2 mUV = u_mouse / u_resolution;
      float highlight = 1.0 - distance(uv, mUV);
      highlight = pow(max(highlight, 0.0), 6.0) * 0.06;
      col += highlight;

      // Edge shadow / bezel illusion
      float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
      float edgeShadow = smoothstep(0.0, 0.04, edgeDist);
      col *= 0.85 + 0.15 * edgeShadow;

      // Corner wear — lighter at edges
      float cornerWear = smoothstep(0.0, 0.08, edgeDist);
      col = mix(col + 0.06, col, cornerWear);

      // Flash response on key press
      col += u_flash * vec3(0.08, 0.06, 0.04);

      // Subtle time-based variation (breathing light)
      col += sin(u_time * 0.5) * 0.005;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compileShader(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(s));
    }
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
      flash *= 0.92; // decay
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
  // Two octaves: C4 to B5 (MIDI 60-83)
  const START_NOTE = 54; // F#3
  const END_NOTE = 78;   // F#5
  const blackPattern = [0,1,0,1,0,0,1,0,1,0,1,0]; // C C# D D# E F F# G G# A A# B

  // Build white keys first, then black keys on top
  const whiteNotes = [];
  const blackNotes = [];

  for (let n = START_NOTE; n <= END_NOTE; n++) {
    const noteInOctave = n % 12;
    if (blackPattern[noteInOctave]) {
      blackNotes.push(n);
    } else {
      whiteNotes.push(n);
    }
  }

  // Create white keys
  whiteNotes.forEach(n => {
    const key = document.createElement('div');
    key.className = 'key-white';
    key.dataset.midi = n;
    keyboard.appendChild(key);
  });

  // Create black keys positioned between whites
  const whiteKeyWidth = 100 / whiteNotes.length;
  blackNotes.forEach(n => {
    const key = document.createElement('div');
    key.className = 'key-black';
    key.dataset.midi = n;

    // Position: find which white key this black key is after
    const prevWhite = whiteNotes.filter(w => w < n).length;
    const leftPos = prevWhite * whiteKeyWidth - whiteKeyWidth * 0.18;
    key.style.left = leftPos + '%';

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
    if (noteId) {
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

  // Generate random IDs
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

  // Custom IDs from localStorage
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

  // Save custom IDs on input
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

    // Determine which ID to use
    let idStr = '';
    if (playBtn.dataset.rid !== undefined) {
      idStr = randomIds[parseInt(playBtn.dataset.rid)];
    } else if (playBtn.dataset.cid !== undefined) {
      const idx = parseInt(playBtn.dataset.cid);
      idStr = savedCustom[idx] || '';
    }

    if (!idStr) return;

    // Stop any existing playback for this button
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

  // ── Keypad Logic ──────────────────────────────────────────────────
  function updateLCD() {
    const num = String(currentPreset + 1).padStart(2, '0');
    document.getElementById('lcd-preset-num').textContent = num;
    document.getElementById('lcd-preset-name').textContent = window.synth.getPresetName(currentPreset);
    window.synth.currentPreset = currentPreset;
  }

  function selectPreset(num) {
    currentPreset = Math.max(0, Math.min(98, num));
    updateLCD();
  }

  document.querySelectorAll('.kp-btn').forEach(btn => {
    btn.addEventListener('pointerdown', () => {
      window.synth.playClick();
      flash = 0.6;

      const key = btn.dataset.key;

      if (key >= '0' && key <= '9') {
        presetInput += key;
        if (presetInput.length >= 2) {
          const num = parseInt(presetInput);
          selectPreset(Math.max(0, num - 1));
          presetInput = '';
        } else {
          document.getElementById('lcd-info').textContent = 'INPUT: ' + presetInput + '_';
        }
      } else if (key === '+') {
        presetInput = '';
        selectPreset(currentPreset + 1);
      } else if (key === '-') {
        presetInput = '';
        selectPreset(currentPreset - 1);
      } else if (key === 'ok') {
        if (presetInput.length > 0) {
          const num = parseInt(presetInput);
          selectPreset(Math.max(0, num - 1));
        }
        presetInput = '';
        document.getElementById('lcd-info').textContent = 'READY';
      } else if (key === 'clr') {
        presetInput = '';
        document.getElementById('lcd-info').textContent = 'READY';
      }
    });
  });

  // ── MIDI Button ───────────────────────────────────────────────────
  const midiBtn = document.getElementById('midi-btn');
  midiBtn.addEventListener('click', async () => {
    if (window.midiManager.connected) {
      window.midiManager.disconnect();
      midiBtn.textContent = 'MIDI: OFF';
      midiBtn.classList.remove('active');
      document.getElementById('lcd-info').textContent = 'MIDI DISCONNECTED';
    } else {
      const ok = await window.midiManager.connect();
      if (ok) {
        midiBtn.textContent = 'MIDI: ON';
        midiBtn.classList.add('active');
        document.getElementById('lcd-info').textContent = 'MIDI CONNECTED';
      } else {
        document.getElementById('lcd-info').textContent = 'MIDI UNAVAILABLE';
      }
    }
  });

  // ── Computer Keyboard → Piano ─────────────────────────────────────
  const qwertyMap = {
    'a': 54, 'w': 55, 's': 56, 'e': 57, 'd': 58,
    'f': 59, 't': 60, 'g': 61, 'y': 62, 'h': 63,
    'u': 64, 'j': 65, 'k': 66, 'o': 67, 'l': 68,
    'p': 69, ';': 70, "'": 71,
  };

  const activeQwerty = new Set();

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    const midi = qwertyMap[e.key.toLowerCase()];
    if (midi !== undefined && !activeQwerty.has(e.key)) {
      activeQwerty.add(e.key);
      const el = document.querySelector(`[data-midi="${midi}"]`);
      if (el) keyDown(el, midi);
    }
  });

  document.addEventListener('keyup', e => {
    if (e.target.tagName === 'INPUT') return;
    const midi = qwertyMap[e.key.toLowerCase()];
    if (midi !== undefined) {
      activeQwerty.delete(e.key);
      const el = document.querySelector(`[data-midi="${midi}"]`);
      if (el) keyUp(el, midi);
    }
  });
})();
