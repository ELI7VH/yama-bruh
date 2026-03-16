import Foundation

struct SavedTone: Codable, Identifiable {
    let id: UUID
    let name: String
    let seed: UInt32
    let appSeed: UInt32
    let presetIndex: Int
    let bpm: Float
    let createdAt: Date

    init(name: String, seed: UInt32, appSeed: UInt32 = 0, presetIndex: Int, bpm: Float = 120) {
        self.id = UUID()
        self.name = name
        self.seed = seed
        self.appSeed = appSeed
        self.presetIndex = presetIndex
        self.bpm = bpm
        self.createdAt = Date()
    }
}

final class ToneStore: ObservableObject {
    @Published var tones: [SavedTone] = []

    private let storageKey = "ca.lucianlabs.yamabruh.savedtones"

    init() {
        load()
    }

    func save(_ tone: SavedTone) {
        tones.insert(tone, at: 0)
        persist()
    }

    func delete(at offsets: IndexSet) {
        tones.remove(atOffsets: offsets)
        persist()
    }

    func delete(_ tone: SavedTone) {
        tones.removeAll { $0.id == tone.id }
        persist()
    }

    var canSaveMore: Bool { true }

    private func persist() {
        guard let data = try? JSONEncoder().encode(tones) else { return }

        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.ca.lucianlabs.yamabruh"
        ) {
            let url = container.appendingPathComponent("saved_tones.json")
            try? data.write(to: url)
        }

        UserDefaults.standard.set(data, forKey: storageKey)
    }

    private func load() {
        // Try shared container first (for extension access)
        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.ca.lucianlabs.yamabruh"
        ) {
            let url = container.appendingPathComponent("saved_tones.json")
            if let data = try? Data(contentsOf: url),
               let decoded = try? JSONDecoder().decode([SavedTone].self, from: data) {
                tones = decoded
                return
            }
        }

        // Fallback to UserDefaults
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let decoded = try? JSONDecoder().decode([SavedTone].self, from: data)
        else { return }
        tones = decoded
    }
}
