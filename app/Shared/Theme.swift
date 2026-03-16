import SwiftUI

/// PSS-470 inspired color scheme and typography
enum YBTheme {
    // MARK: - Colors
    static let background = Color(red: 0.1, green: 0.1, blue: 0.1)
    static let surface = Color(red: 0.14, green: 0.14, blue: 0.14)
    static let cyan = Color(red: 0.133, green: 0.8, blue: 0.667)
    static let green = Color(red: 0.235, green: 0.784, blue: 0.541)
    static let greenDark = Color(red: 0.102, green: 0.47, blue: 0.314)
    static let red = Color(red: 1.0, green: 0.267, blue: 0.267)
    static let yellow = Color(red: 0.8, green: 0.6, blue: 0.133)

    // MARK: - Typography
    static let led = Font.system(size: 32, weight: .bold, design: .monospaced)
    static let ledSmall = Font.system(size: 18, weight: .semibold, design: .monospaced)
    static let heading = Font.system(size: 16, weight: .bold, design: .monospaced)
    static let body = Font.system(size: 14, weight: .regular, design: .monospaced)
    static let caption = Font.system(size: 11, weight: .regular, design: .monospaced)

    // MARK: - Preset Info

    static let presetNames: [String] = [
        "Grand Piano", "Bright Piano", "Honky-Tonk", "E.Piano 1", "E.Piano 2",
        "Clav", "Harpsichord", "DX Piano", "Stage Piano", "Vintage Keys",
        "Jazz Organ", "Rock Organ", "Church Organ", "Reed Organ", "Pipe Organ",
        "Drawbar 1", "Drawbar 2", "Perc Organ", "Rotary Organ", "Full Organ",
        "Trumpet", "Trombone", "French Horn", "Brass Sect", "Synth Brass 1",
        "Synth Brass 2", "Mute Trumpet", "Brass Pad", "Power Brass", "Fanfare",
        "Strings", "Slow Strings", "Syn Strings 1", "Syn Strings 2", "Warm Pad",
        "Choir Pad", "Atmosphere", "Brightness Pad", "Sweep Pad", "Ice Pad",
        "Finger Bass", "Pick Bass", "Slap Bass", "Fretless", "Synth Bass 1",
        "Synth Bass 2", "Acid Bass", "Rubber Bass", "Sub Bass", "Wobble Bass",
        "Square Lead", "Saw Lead", "Sync Lead", "Calliope", "Chiffer",
        "Charang", "Solo Vox", "Fifth Lead", "Bass+Lead", "Poly Lead",
        "Tubular Bell", "Glockenspiel", "Music Box", "Vibraphone", "Marimba",
        "Xylophone", "Steel Drums", "Crystal", "Kalimba", "Tinkle Bell",
        "Harmonica", "Accordion", "Clarinet", "Oboe", "Bassoon",
        "Flute", "Recorder", "Pan Flute", "Bottle", "Shakuhachi",
        "Rain", "Soundtrack", "Sci-Fi", "Atmosphere 2", "Goblin",
        "Echo Drop", "Star Theme", "Sitar", "Telephone", "Helicopter",
        "Chiptune 1", "Chiptune 2", "Chiptune 3", "Retro Beep", "Bit Crush",
        "Arcade", "Game Over", "Power Up", "Digital Vox",
    ]

    static let categories: [(name: String, range: ClosedRange<Int>)] = [
        ("Piano / Keys", 0...9),
        ("Organ", 10...19),
        ("Brass", 20...29),
        ("Strings / Pads", 30...39),
        ("Bass", 40...49),
        ("Lead", 50...59),
        ("Bell / Mallet", 60...69),
        ("Reed / Pipe", 70...79),
        ("SFX / Atmosphere", 80...89),
        ("Retro / Digital", 90...98),
    ]

    static let freePresets: Set<Int> = Set(0...14)

    static func presetName(at index: Int) -> String {
        guard index >= 0, index < presetNames.count else { return "Unknown" }
        return presetNames[index]
    }

    static func categoryName(for presetIndex: Int) -> String {
        categories.first { $0.range.contains(presetIndex) }?.name ?? "Unknown"
    }
}

struct VintageButtonStyle: ButtonStyle {
    var isActive: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(YBTheme.heading)
            .foregroundColor(isActive ? YBTheme.cyan : .gray)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isActive ? YBTheme.greenDark : YBTheme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(isActive ? YBTheme.cyan.opacity(0.4) : Color.gray.opacity(0.2), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.95 : 1.0)
    }
}
