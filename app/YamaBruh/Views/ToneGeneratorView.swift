import SwiftUI
import YamaBruh

struct ToneGeneratorView: View {
    @EnvironmentObject var audioEngine: AudioEngine
    @EnvironmentObject var storeManager: StoreManager
    @EnvironmentObject var toneStore: ToneStore

    @State private var seedText = ""
    @State private var selectedPreset: Int = 0
    @State private var bpm: Float = 120
    @State private var toneName = ""
    @State private var showSaveSheet = false
    @State private var showShareSheet = false
    @State private var exportURL: URL?

    private var seed: UInt32 {
        if seedText.isEmpty { return UInt32.random(in: 1...UInt32.max) }
        return SequenceGenerator.djb2Hash(seedText)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                YBTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Seed input
                        VStack(alignment: .leading, spacing: 6) {
                            Text("SEED")
                                .font(YBTheme.caption)
                                .foregroundColor(YBTheme.cyan.opacity(0.6))

                            HStack {
                                TextField("contact name, phone #, anything...", text: $seedText)
                                    .font(YBTheme.body)
                                    .foregroundColor(YBTheme.cyan)
                                    .padding(10)
                                    .background(YBTheme.surface)
                                    .cornerRadius(8)

                                Button(action: { seedText = randomWord() }) {
                                    Image(systemName: "dice")
                                        .foregroundColor(YBTheme.cyan)
                                        .frame(width: 40, height: 40)
                                        .background(YBTheme.surface)
                                        .cornerRadius(8)
                                }
                            }
                        }

                        // Preset selector
                        VStack(alignment: .leading, spacing: 6) {
                            Text("PRESET")
                                .font(YBTheme.caption)
                                .foregroundColor(YBTheme.cyan.opacity(0.6))

                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 6) {
                                    ForEach(0..<99, id: \.self) { i in
                                        let unlocked = storeManager.isPresetUnlocked(i)
                                        Button(action: { if unlocked { selectedPreset = i } }) {
                                            VStack(spacing: 2) {
                                                Text(String(format: "%02d", i))
                                                    .font(.system(size: 10, design: .monospaced))
                                                Text(YBTheme.presetName(at: i))
                                                    .font(.system(size: 7, design: .monospaced))
                                                    .lineLimit(1)
                                            }
                                            .foregroundColor(
                                                selectedPreset == i ? .black :
                                                unlocked ? YBTheme.cyan : .gray.opacity(0.4)
                                            )
                                            .frame(width: 56, height: 36)
                                            .background(selectedPreset == i ? YBTheme.cyan : YBTheme.surface)
                                            .cornerRadius(4)
                                        }
                                    }
                                }
                            }
                        }

                        // BPM
                        VStack(alignment: .leading, spacing: 6) {
                            HStack {
                                Text("BPM")
                                    .font(YBTheme.caption)
                                    .foregroundColor(YBTheme.cyan.opacity(0.6))
                                Spacer()
                                Text("\(Int(bpm))")
                                    .font(YBTheme.ledSmall)
                                    .foregroundColor(YBTheme.red)
                            }
                            Slider(value: $bpm, in: 60...200, step: 4)
                                .tint(YBTheme.cyan)
                        }

                        // Preview waveform
                        WaveformPreview(seed: seed, presetIndex: selectedPreset, bpm: bpm)
                            .frame(height: 80)

                        // Action buttons
                        HStack(spacing: 12) {
                            Button(action: preview) {
                                Label(audioEngine.isPlaying ? "Stop" : "Play",
                                      systemImage: audioEngine.isPlaying ? "stop.fill" : "play.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(VintageButtonStyle(isActive: audioEngine.isPlaying))

                            Button(action: { showSaveSheet = true }) {
                                Label("Save", systemImage: "square.and.arrow.down")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(VintageButtonStyle())

                            Button(action: exportTone) {
                                Label("Export", systemImage: "square.and.arrow.up")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(VintageButtonStyle())
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Create Tone")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .alert("Save Tone", isPresented: $showSaveSheet) {
                TextField("Tone name", text: $toneName)
                Button("Save") { saveTone() }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Give your tone a name")
            }
            .sheet(isPresented: $showShareSheet) {
                if let url = exportURL {
                    ShareSheet(items: [url])
                }
            }
        }
    }

    private func preview() {
        if audioEngine.isPlaying {
            audioEngine.stopPlayback()
        } else {
            audioEngine.playTone(seed: seed, presetIndex: selectedPreset, bpm: bpm)
        }
    }

    private func saveTone() {
        let name = toneName.isEmpty ? "Tone \(seedText)" : toneName
        let tone = SavedTone(
            name: name,
            seed: seed,
            presetIndex: selectedPreset,
            bpm: bpm
        )
        toneStore.save(tone)
        toneName = ""
    }

    private func exportTone() {
        let name = toneName.isEmpty ? "yamabruh-\(seedText.isEmpty ? "random" : seedText)" : toneName
        do {
            exportURL = try ToneExporter.export(
                seed: seed,
                presetIndex: selectedPreset,
                bpm: bpm,
                name: name
            )
            showShareSheet = true
        } catch {
            print("Export failed: \(error)")
        }
    }

    private func randomWord() -> String {
        let words = ["cyberpunk", "vaporwave", "neon", "retro", "pixel", "synth",
                     "chrome", "laser", "arcade", "cassette", "floppy", "dial-up"]
        return words.randomElement() ?? "random"
    }
}

struct WaveformPreview: View {
    let seed: UInt32
    let presetIndex: Int
    let bpm: Float

    var body: some View {
        let samples = generateSamples()

        Canvas { context, size in
            let midY = size.height / 2
            let step = max(1, samples.count / Int(size.width))

            var path = Path()
            path.move(to: CGPoint(x: 0, y: midY))

            for x in 0..<Int(size.width) {
                let sampleIndex = min(x * step, samples.count - 1)
                let y = midY - CGFloat(samples[sampleIndex]) * midY * 0.9
                path.addLine(to: CGPoint(x: CGFloat(x), y: y))
            }

            context.stroke(path, with: .color(YBTheme.cyan), lineWidth: 1)
        }
        .background(YBTheme.surface)
        .cornerRadius(8)
    }

    private func generateSamples() -> [Float] {
        let wavData = Ringtone.generate(seed: seed, presetIndex: presetIndex, bpm: bpm)
        guard wavData.count > 44 else { return [] }

        let pcmData = wavData.dropFirst(44)
        var samples: [Float] = []
        samples.reserveCapacity(pcmData.count / 2)

        for i in stride(from: 0, to: pcmData.count - 1, by: 2) {
            let low = UInt16(pcmData[pcmData.startIndex + i])
            let high = UInt16(pcmData[pcmData.startIndex + i + 1])
            let int16 = Int16(bitPattern: low | (high << 8))
            samples.append(Float(int16) / 32767.0)
        }
        return samples
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
