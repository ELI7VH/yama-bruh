import SwiftUI
import YamaBruh

struct PresetEditorView: View {
    @EnvironmentObject var audioEngine: AudioEngine
    @EnvironmentObject var bankManager: PresetBankManager

    @State private var params = PresetParams.default
    @State private var presetName = ""
    @State private var category = "Custom"
    @State private var sourcePresetIndex: Int = 0
    @State private var showSaveAlert = false
    @State private var isAuditionHeld = false

    private let categories = [
        "Custom", "Piano", "Organ", "Brass", "Strings", "Bass",
        "Lead", "Bell", "Reed", "SFX", "Retro", "Voice", "Percussion",
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                YBTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        sourcePickerSection

                        // FM routing
                        parameterSection("FM ROUTING") {
                            ParamSlider(label: "Mod Depth", value: $params.modDepth, range: 0...13.0)
                            ParamSlider(label: "Feedback", value: $params.feedback, range: 0...4.0)
                        }

                        // Modulator operator
                        operatorSection("MODULATOR", op: $params.modulator, color: YBTheme.cyan)

                        // Carrier operator
                        operatorSection("CARRIER", op: $params.carrier, color: YBTheme.green)

                        auditionSection
                        saveSection
                    }
                    .padding()
                }
            }
            .navigationTitle("Preset Editor")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .alert("Save Preset", isPresented: $showSaveAlert) {
                TextField("Preset name", text: $presetName)
                Button("Save") { savePreset() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Name your custom preset")
            }
        }
    }

    // MARK: - Sections

    private var sourcePickerSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("START FROM")
                .font(YBTheme.caption)
                .foregroundColor(YBTheme.cyan.opacity(0.6))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(0..<99, id: \.self) { i in
                        Button(action: { loadPreset(i) }) {
                            VStack(spacing: 2) {
                                Text(String(format: "%02d", i))
                                    .font(.system(size: 10, design: .monospaced))
                                Text(YBTheme.presetName(at: i))
                                    .font(.system(size: 7, design: .monospaced))
                                    .lineLimit(1)
                            }
                            .foregroundColor(sourcePresetIndex == i ? .black : YBTheme.cyan)
                            .frame(width: 56, height: 36)
                            .background(sourcePresetIndex == i ? YBTheme.cyan : YBTheme.surface)
                            .cornerRadius(4)
                        }
                    }
                }
            }
        }
    }

    private func operatorSection(_ title: String, op: Binding<OperatorParams>, color: Color) -> some View {
        parameterSection(title) {
            ParamSlider(label: "Mult", value: op.mult, range: 0.5...15.0)
            ParamSlider(label: "Attack", value: op.attack, range: 0.001...5.0)
            ParamSlider(label: "Decay", value: op.decay, range: 0.005...30.0)
            ParamSlider(label: "Sustain Level", value: op.sustainLevel, range: 0...1.0)
            ParamSlider(label: "Release", value: op.release, range: 0.005...30.0)

            HStack(spacing: 8) {
                OPLLToggle(label: "SINE", isOn: .constant(op.waveform.wrappedValue == 0), color: color) {
                    op.waveform.wrappedValue = 0
                }
                OPLLToggle(label: "HALF", isOn: .constant(op.waveform.wrappedValue == 1), color: color) {
                    op.waveform.wrappedValue = 1
                }
                Spacer()
                OPLLToggle(label: "VIB", isOn: op.vibrato, color: color)
                OPLLToggle(label: "TREM", isOn: op.tremolo, color: color)
                OPLLToggle(label: "SUST", isOn: op.sustained, color: color)
            }
        }
    }

    private var auditionSection: some View {
        VStack(spacing: 8) {
            Text("AUDITION")
                .font(YBTheme.caption)
                .foregroundColor(YBTheme.cyan.opacity(0.6))

            HStack(spacing: 12) {
                Button {} label: {
                    Label("Hold to Play", systemImage: "speaker.wave.2")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(VintageButtonStyle(isActive: isAuditionHeld))
                .simultaneousGesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in
                            if !isAuditionHeld {
                                isAuditionHeld = true
                                applyAndPlay()
                            }
                        }
                        .onEnded { _ in
                            isAuditionHeld = false
                            audioEngine.noteOff(66)
                        }
                )

                Button(action: previewAsTone) {
                    Label("Ringtone", systemImage: "bell")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(VintageButtonStyle())
            }
        }
    }

    private var saveSection: some View {
        VStack(spacing: 8) {
            HStack {
                Text("CATEGORY")
                    .font(YBTheme.caption)
                    .foregroundColor(YBTheme.cyan.opacity(0.6))
                Spacer()
                Picker("", selection: $category) {
                    ForEach(categories, id: \.self) { cat in
                        Text(cat).tag(cat)
                    }
                }
                .tint(YBTheme.cyan)
            }

            Button(action: { showSaveAlert = true }) {
                Label("Save to My Presets", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(VintageButtonStyle(isActive: true))
        }
    }

    private func parameterSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(YBTheme.caption)
                .foregroundColor(YBTheme.cyan.opacity(0.6))
            content()
        }
        .padding()
        .background(YBTheme.surface)
        .cornerRadius(10)
    }

    // MARK: - Actions

    private func loadPreset(_ index: Int) {
        sourcePresetIndex = index
        params = PresetParams(FMPresets.preset(at: index))
    }

    private func applyAndPlay() {
        audioEngine.start()
        audioEngine.setCustomPatch(params)
        audioEngine.noteOn(66, velocity: 80)
    }

    private func previewAsTone() {
        let fmPreset = params.toFMPreset()
        let beatDuration: Float = 60.0 / 120.0
        let notes = SequenceGenerator.generate(seed: UInt32.random(in: 1...UInt32.max))

        var totalDuration: Float = 0
        for note in notes {
            totalDuration += note.durationBeats * beatDuration
        }
        totalDuration += fmPreset.release
        totalDuration = min(totalDuration, 5.0)

        let sampleRate: Float = 44100
        let totalSamples = Int(totalDuration * sampleRate)
        var buffer = [Float](repeating: 0, count: totalSamples)

        var offset = 0
        for note in notes {
            let freq = FMSynth.midiToFreq(note.midiNote)
            let durationSecs = note.durationBeats * beatDuration
            FMSynth.renderNote(
                freq: freq, duration: durationSecs, preset: fmPreset,
                sampleRate: sampleRate, buffer: &buffer, offset: offset
            )
            offset += Int(durationSecs * sampleRate)
        }

        let wavData = WavWriter.encode(samples: buffer, sampleRate: Int(sampleRate))
        audioEngine.playWavData(wavData)
    }

    private func savePreset() {
        let name = presetName.isEmpty ? "Custom \(Date().formatted(.dateTime.hour().minute()))" : presetName
        let preset = BankPreset(
            id: "user-\(UUID().uuidString.prefix(8))",
            name: name,
            category: category,
            params: params
        )
        bankManager.saveUserPreset(preset)
        presetName = ""
    }
}

// MARK: - Parameter Slider

struct ParamSlider: View {
    let label: String
    @Binding var value: Float
    let range: ClosedRange<Float>

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Text(label)
                    .font(YBTheme.caption)
                    .foregroundColor(.gray)
                Spacer()
                Text(String(format: "%.3f", value))
                    .font(YBTheme.caption)
                    .foregroundColor(YBTheme.red)
                    .monospacedDigit()
            }
            Slider(value: $value, in: range)
                .tint(YBTheme.cyan)
        }
    }
}

// MARK: - OPLL Toggle Chip

struct OPLLToggle: View {
    let label: String
    @Binding var isOn: Bool
    var color: Color = YBTheme.cyan
    var action: (() -> Void)? = nil

    var body: some View {
        Button {
            if let action {
                action()
            } else {
                isOn.toggle()
            }
        } label: {
            Text(label)
                .font(.system(size: 9, weight: .bold, design: .monospaced))
                .foregroundColor(isOn ? .black : color.opacity(0.5))
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background(isOn ? color : YBTheme.surface)
                .cornerRadius(3)
                .overlay(
                    RoundedRectangle(cornerRadius: 3)
                        .stroke(color.opacity(0.3), lineWidth: 1)
                )
        }
    }
}
