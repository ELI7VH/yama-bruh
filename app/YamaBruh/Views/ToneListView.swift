import SwiftUI

struct ToneListView: View {
    @EnvironmentObject var toneStore: ToneStore
    @EnvironmentObject var audioEngine: AudioEngine
    @State private var shareURL: URL?
    @State private var showShareSheet = false

    var body: some View {
        NavigationStack {
            ZStack {
                YBTheme.background.ignoresSafeArea()

                if toneStore.tones.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "waveform")
                            .font(.system(size: 48))
                            .foregroundColor(.gray.opacity(0.3))
                        Text("No saved tones")
                            .font(YBTheme.body)
                            .foregroundColor(.gray.opacity(0.5))
                        Text("Create tones in the CREATE tab")
                            .font(YBTheme.caption)
                            .foregroundColor(.gray.opacity(0.3))
                    }
                } else {
                    List {
                        ForEach(toneStore.tones) { tone in
                            ToneRow(tone: tone) {
                                audioEngine.playTone(
                                    seed: tone.seed,
                                    appSeed: tone.appSeed,
                                    presetIndex: tone.presetIndex,
                                    bpm: tone.bpm
                                )
                            } onExport: {
                                exportTone(tone)
                            }
                            .listRowBackground(YBTheme.surface)
                        }
                        .onDelete { offsets in
                            toneStore.delete(at: offsets)
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationTitle("My Tones")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .sheet(isPresented: $showShareSheet) {
                if let url = shareURL {
                    ShareSheet(items: [url])
                }
            }
        }
    }

    private func exportTone(_ tone: SavedTone) {
        do {
            shareURL = try ToneExporter.export(
                seed: tone.seed,
                appSeed: tone.appSeed,
                presetIndex: tone.presetIndex,
                bpm: tone.bpm,
                name: tone.name
            )
            showShareSheet = true
        } catch {
            print("Export failed: \(error)")
        }
    }
}

struct ToneRow: View {
    let tone: SavedTone
    let onPlay: () -> Void
    let onExport: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onPlay) {
                Image(systemName: "play.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(YBTheme.cyan)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 4) {
                Text(tone.name)
                    .font(YBTheme.heading)
                    .foregroundColor(YBTheme.cyan)
                HStack(spacing: 8) {
                    Text(YBTheme.presetName(at: tone.presetIndex))
                        .font(YBTheme.caption)
                        .foregroundColor(.gray)
                    Text("\(Int(tone.bpm)) BPM")
                        .font(YBTheme.caption)
                        .foregroundColor(.gray.opacity(0.6))
                }
            }

            Spacer()

            Button(action: onExport) {
                Image(systemName: "square.and.arrow.up")
                    .foregroundColor(YBTheme.green)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 4)
    }
}
