# YAMA-BRUH UI Handoff

## Reference
Target aesthetic: **Yamaha PortaSound PSS-470** (photos provided by user). Dark charcoal plastic body, cyan/teal text, green rectangular buttons, 7-segment LED display, air vents/speaker grille, ridged case edges.

## Current File Structure
```
www/
  index.html      ← page structure
  style.css       ← all styling
  app.js          ← UI logic, GLSL shader, keyboard, voice bank, tweak section, visual config, effect switches
  synth.js        ← audio engine (DO NOT MODIFY — WASM agent owns this)
  synth-worklet.js← AudioWorklet processor (DO NOT MODIFY — WASM agent owns this)
  midi.js         ← MIDI handler (DO NOT MODIFY — WASM agent owns this)
  yama_bruh.wasm  ← compiled Rust binary (DO NOT MODIFY)
```

## What the UI Agent Should Touch
- `index.html` — structure, layout, elements
- `style.css` — all styling
- `app.js` — ONLY the following sections:
  - GLSL shader source (`fsSource` string)
  - DOM building (voice bank, keyboard, ID sections)
  - CSS class toggling, UI event handlers
  - Visual Config UI section
  - **DO NOT** modify: synth init, preset logic, MIDI logic, worklet communication, effect switch logic (`applyFxState`, `fxState`, etc.)

## Key UI Sections (top to bottom)
1. **Air vents** — speaker grille slats at top (`.air-vents`, `.vent-slat`)
2. **Header** — "YAMA-BRUH PortaSound" + "YB-99FM" (`.plate-header`)
3. **Voice Bank** — 99 preset names in cyan text, 3-column scrollable grid (`.voice-bank-panel`)
4. **Controls Row** — 7-segment display + voice selector buttons (`.controls-row`)
   - Display: red LED digits + preset name + status line (`.display-unit`)
   - Voice selector: 2 columns of 5 buttons, number labels above each (`.voice-selector`)
5. **Effect Switches** — SUSTAIN / VIBRATO / PORTAMENTO toggle buttons (`.effects-row`) ← **NEW**
6. **ID Section** — 5 random + 5 custom ringtone IDs with play buttons (`.id-section`)
7. **Keyboard Section** — MIDI button/dropdown + piano keys (`.keyboard-section`)
8. **Sound Editor** — collapsible, 8 FM parameter sliders (`.tweak-section`)
9. **Visual Config** — collapsible, dust/wear/patina/light/grain/scratches/TOD sliders (`.tweak-section`)

## NEW: Effect Switches (WASM agent added — needs UI styling)

The WASM agent added three effect toggle buttons matching the PSS-470's physical switches. The **HTML and JS logic are already wired** — the UI agent just needs to make sure they're **visible and styled**.

### What exists already
- **HTML** (`index.html` lines 75-80): `<div class="effects-row">` with three `<button class="fx-btn">` elements
- **CSS** (`style.css`): `.effects-row` and `.fx-btn` styles are defined (dark buttons, green glow when `.active`)
- **JS** (`app.js`): Click handlers toggle `.active` class, call `window.synth.setVibrato()` / `.setPortamento()` / `.setSustain()`, persist to localStorage as `yamabruh_fx`

### What the UI agent needs to do
1. **Verify the effects-row is visible** — it sits between `.controls-row` and `.id-section` in the DOM. If it's not showing, check that `.effects-row` CSS isn't being overridden or hidden
2. **Style to match PSS-470 switch row** — the real keyboard has a row of small rectangular toggle switches between the voice selector and the keyboard. Current styling is basic dark buttons with green active state. Make them look like physical toggle switches:
   - Flat rectangular shape (wider than tall), similar proportion to `.sel-btn`
   - Recessed/inset appearance when inactive
   - Raised/lit appearance when active (green glow or cyan highlight)
   - PSS-470 switches have labels printed above them in cyan text — consider adding `.panel-label` text "EFFECTS" above the row
3. **Mobile responsive** — buttons should stack or shrink gracefully at 480px

### Don't break these IDs
- `id="fx-sustain"` — sustain toggle
- `id="fx-vibrato"` — vibrato toggle
- `id="fx-portamento"` — portamento toggle
- CSS class `.active` on `.fx-btn` — JS toggles this; controls the on/off state

### How the effects work (for context)
- **SUSTAIN** — extends note release time 3x (notes ring out longer after key release)
- **VIBRATO** — adds pitch wobble (5.5Hz sine LFO, ~7 cents depth) to all notes
- **PORTAMENTO** — smooth pitch glide between consecutive notes (80ms glide time)
- All three persist in localStorage and restore on page load

## GLSL Background
The fragment shader in `app.js` (`fsSource`) renders a full-page plastic texture. Uniforms:
- `u_time` — animation time
- `u_resolution` — viewport size
- `u_mouse` — mouse position (specular highlight)
- `u_flash` — key press flash (decays in render loop)
- `u_tod` — time of day (0-24, from visual config)
- `u_dust`, `u_wear`, `u_patina`, `u_light`, `u_grain`, `u_scratches` — visual config params

## User Requests Still Pending (UI)
- Buttons should look more like PSS-470 (wider, flatter green rectangles)
- Air vents should look more like the actual speaker grille
- General polish to match the reference photos more closely
- The ridged edges on the sides of the case
- **Effect switches need to be visible and styled** (see above)

## Colors (current)
- Body: `#1a1a1a` (dark charcoal)
- Cyan text: `#22ccaa`
- Active/highlight: `#77ffdd`
- Green buttons: `#3cc88a` → `#1a7850`
- 7-seg display: `#ff4444` with glow
- Number labels: `#22ccaa`
- Panel borders: `#2a2a2a`
- Text fields: `rgba(255,255,255,0.88)` on dark
- FX button active: `#1a5038` → `#0d3020` bg, `#77ffdd` text, `#22ccaa` border

## Interaction Notes
- Arrow Up/Down changes preset
- Number keys (0-9) enter preset directly (2-digit, auto-complete after 1.5s)
- Click voice bank entry to select
- QWERTY keys play piano (A=F#3, S=G#3, etc.)
- Sound Editor toggle opens/closes slider panel
- Visual Config toggle opens/closes visual slider panel
- Effect buttons toggle on/off (SUSTAIN, VIBRATO, PORTAMENTO)
- Preset + MIDI + FX + visual settings persist in localStorage

## Don't Break
- `id="voice-bank-grid"` — app.js populates this
- `id="seg-digits"`, `id="preset-readout"`, `id="lcd-info"` — display updates
- `id="keyboard"` — app.js builds piano keys here
- `id="random-ids"`, `id="custom-ids"` — app.js builds ID rows here
- `id="midi-btn"`, `id="midi-select"` — MIDI logic binds to these
- `id="tweak-toggle"`, `id="tweak-body"`, `id="tweak-reset"` — tweak section logic
- `id="tw-carrier"` through `id="tw-feedback"` — slider IDs used by JS
- `id="fx-sustain"`, `id="fx-vibrato"`, `id="fx-portamento"` — effect toggle buttons
- `id="visual-toggle"`, `id="visual-body"`, `id="visual-reset"` — visual config section
- `id="tod-mode-btn"`, `id="vis-tod"` — TOD controls
- `id="vis-dust"` through `id="vis-scratches"` — visual slider IDs
- `.sel-btn[data-num]` — voice selector buttons
- `.vb-entry[data-preset]` — voice bank entries
- `#bg-canvas` — GLSL renders here
