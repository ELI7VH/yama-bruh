import SwiftUI
import YamaBruh

struct PresetBrowserView: View {
    @EnvironmentObject var audioEngine: AudioEngine
    @EnvironmentObject var storeManager: StoreManager
    @State private var selectedPreset: Int = 0
    @State private var isKeyboardActive = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 5)

    var body: some View {
        NavigationStack {
            ZStack {
                YBTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 16) {
                        // LED Display
                        LEDDisplayView(
                            presetNumber: selectedPreset,
                            presetName: YBTheme.presetName(at: selectedPreset),
                            category: YBTheme.categoryName(for: selectedPreset)
                        )
                        .padding(.horizontal)

                        // Category sections
                        ForEach(YBTheme.categories, id: \.name) { category in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(category.name)
                                    .font(YBTheme.caption)
                                    .foregroundColor(YBTheme.cyan.opacity(0.6))
                                    .padding(.horizontal)

                                LazyVGrid(columns: columns, spacing: 4) {
                                    ForEach(category.range, id: \.self) { index in
                                        PresetCell(
                                            index: index,
                                            isSelected: selectedPreset == index,
                                            isLocked: !storeManager.isPresetUnlocked(index)
                                        ) {
                                            selectPreset(index)
                                        }
                                    }
                                }
                                .padding(.horizontal)
                            }
                        }

                        // Mini keyboard
                        if isKeyboardActive {
                            MiniKeyboardView(audioEngine: audioEngine)
                                .frame(height: 120)
                                .padding(.horizontal)
                                .transition(.move(edge: .bottom).combined(with: .opacity))
                        }
                    }
                    .padding(.vertical)
                }
            }
            .navigationTitle("YamaBruh")
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { withAnimation { isKeyboardActive.toggle() } }) {
                        Image(systemName: isKeyboardActive ? "pianokeys.inverse" : "pianokeys")
                            .foregroundColor(isKeyboardActive ? YBTheme.cyan : .gray)
                    }
                }
            }
        }
    }

    private func selectPreset(_ index: Int) {
        guard storeManager.isPresetUnlocked(index) else { return }
        selectedPreset = index
        audioEngine.currentPresetIndex = index
        // Play a quick preview note
        audioEngine.noteOn(66, velocity: 80)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            audioEngine.noteOff(66)
        }
    }
}

struct PresetCell: View {
    let index: Int
    let isSelected: Bool
    let isLocked: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 2) {
                Text(String(format: "%02d", index))
                    .font(YBTheme.caption)
                    .foregroundColor(isSelected ? .black : isLocked ? .gray.opacity(0.4) : YBTheme.cyan)
                Text(YBTheme.presetName(at: index))
                    .font(.system(size: 7, design: .monospaced))
                    .foregroundColor(isSelected ? .black.opacity(0.7) : isLocked ? .gray.opacity(0.3) : .gray)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 4)
                    .fill(isSelected ? YBTheme.cyan : YBTheme.surface)
            )
            .overlay {
                if isLocked {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 8))
                        .foregroundColor(.gray.opacity(0.5))
                        .offset(x: 20, y: -12)
                }
            }
        }
    }
}

struct MiniKeyboardView: View {
    let audioEngine: AudioEngine
    private let noteRange: ClosedRange<UInt8> = 54...78 // F#3 to F#5

    var body: some View {
        GeometryReader { geo in
            let whiteNotes = noteRange.filter { !isBlack($0) }
            let keyWidth = geo.size.width / CGFloat(whiteNotes.count)

            ZStack(alignment: .topLeading) {
                // White keys
                HStack(spacing: 1) {
                    ForEach(whiteNotes, id: \.self) { note in
                        KeyView(isBlack: false, width: keyWidth - 1, height: geo.size.height) {
                            audioEngine.noteOn(note)
                        } onRelease: {
                            audioEngine.noteOff(note)
                        }
                    }
                }

                // Black keys
                ForEach(Array(noteRange), id: \.self) { note in
                    if isBlack(note) {
                        let xOffset = blackKeyOffset(note: note, keyWidth: keyWidth)
                        KeyView(isBlack: true, width: keyWidth * 0.6, height: geo.size.height * 0.6) {
                            audioEngine.noteOn(note)
                        } onRelease: {
                            audioEngine.noteOff(note)
                        }
                        .offset(x: xOffset)
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func isBlack(_ note: UInt8) -> Bool {
        let n = note % 12
        return [1, 3, 6, 8, 10].contains(n)
    }

    private func blackKeyOffset(note: UInt8, keyWidth: CGFloat) -> CGFloat {
        let whitesBefore = (54...note).filter { !isBlack($0) }.count
        return CGFloat(whitesBefore) * keyWidth - keyWidth * 0.3
    }
}

struct KeyView: View {
    let isBlack: Bool
    let width: CGFloat
    let height: CGFloat
    let onPress: () -> Void
    let onRelease: () -> Void

    @State private var isPressed = false

    var body: some View {
        Rectangle()
            .fill(isPressed ? YBTheme.cyan : (isBlack ? Color.black : Color.white))
            .frame(width: width, height: height)
            .cornerRadius(isBlack ? 2 : 4, corners: [.bottomLeft, .bottomRight])
            .shadow(color: .black.opacity(0.3), radius: isBlack ? 2 : 0)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in
                        if !isPressed {
                            isPressed = true
                            onPress()
                        }
                    }
                    .onEnded { _ in
                        isPressed = false
                        onRelease()
                    }
            )
    }
}

extension View {
    func cornerRadius(_ radius: CGFloat, corners: UIRectCorner) -> some View {
        clipShape(RoundedCorner(radius: radius, corners: corners))
    }
}

struct RoundedCorner: Shape {
    var radius: CGFloat
    var corners: UIRectCorner

    func path(in rect: CGRect) -> Path {
        let path = UIBezierPath(
            roundedRect: rect,
            byRoundingCorners: corners,
            cornerRadii: CGSize(width: radius, height: radius)
        )
        return Path(path.cgPath)
    }
}
