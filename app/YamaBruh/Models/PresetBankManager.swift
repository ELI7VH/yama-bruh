import Foundation
import YamaBruh

/// Manages all preset banks: built-in classic, bundled add-on banks (JSON), and user presets.
@MainActor
final class PresetBankManager: ObservableObject {

    @Published private(set) var banks: [PresetBank] = []
    @Published var userBank: PresetBank

    private let userBankKey = "ca.lucianlabs.yamabruh.userbank"

    init() {
        userBank = Self.loadUserBank()
        banks = Self.loadAllBanks(userBank: userBank)
    }

    // MARK: - Lookup

    func bank(_ id: String) -> PresetBank? {
        banks.first { $0.id == id }
    }

    func preset(ref: PresetReference) -> BankPreset? {
        bank(ref.bankID)?.presets.first { $0.id == ref.presetID }
    }

    func params(ref: PresetReference) -> PresetParams {
        preset(ref: ref)?.params ?? .default
    }

    func fmPreset(ref: PresetReference) -> FMPreset {
        params(ref: ref).toFMPreset()
    }

    /// All banks that the user can access (free + purchased)
    func accessibleBanks(purchasedProducts: Set<String>) -> [PresetBank] {
        banks.filter { bank in
            bank.isFree || purchasedProducts.contains(bank.iapProductID ?? "")
        }
    }

    // MARK: - User presets

    func saveUserPreset(_ preset: BankPreset) {
        if let idx = userBank.presets.firstIndex(where: { $0.id == preset.id }) {
            userBank.presets[idx] = preset
        } else {
            userBank.presets.append(preset)
        }
        persistUserBank()
        reloadBanks()
    }

    func deleteUserPreset(_ presetID: String) {
        userBank.presets.removeAll { $0.id == presetID }
        persistUserBank()
        reloadBanks()
    }

    // MARK: - Bank loading

    private static func loadAllBanks(userBank: PresetBank) -> [PresetBank] {
        var result: [PresetBank] = [.classic]
        result.append(contentsOf: loadBundledBanks())
        result.append(userBank)
        result.sort { $0.sortOrder < $1.sortOrder }
        return result
    }

    /// Load add-on banks from Banks/*.json in the app bundle
    private static func loadBundledBanks() -> [PresetBank] {
        guard let banksURL = Bundle.main.url(forResource: "Banks", withExtension: nil) else {
            // Try individual bank files at bundle root
            return loadBankFiles(in: Bundle.main.bundleURL)
        }
        return loadBankFiles(in: banksURL)
    }

    private static func loadBankFiles(in directory: URL) -> [PresetBank] {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else {
            return []
        }
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { url -> PresetBank? in
                guard let data = try? Data(contentsOf: url) else { return nil }
                return try? JSONDecoder().decode(PresetBank.self, from: data)
            }
    }

    // MARK: - User bank persistence

    private func persistUserBank() {
        guard let data = try? JSONEncoder().encode(userBank) else { return }

        // App group container (shared with AUv3 extension)
        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.ca.lucianlabs.yamabruh"
        ) {
            let url = container.appendingPathComponent("user_bank.json")
            try? data.write(to: url)
        }

        UserDefaults.standard.set(data, forKey: userBankKey)
    }

    private static func loadUserBank() -> PresetBank {
        // Try shared container first
        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.ca.lucianlabs.yamabruh"
        ) {
            let url = container.appendingPathComponent("user_bank.json")
            if let data = try? Data(contentsOf: url),
               let bank = try? JSONDecoder().decode(PresetBank.self, from: data) {
                return bank
            }
        }

        // Fallback to UserDefaults
        if let data = UserDefaults.standard.data(forKey: "ca.lucianlabs.yamabruh.userbank"),
           let bank = try? JSONDecoder().decode(PresetBank.self, from: data) {
            return bank
        }

        return .userBank
    }

    private func reloadBanks() {
        banks = Self.loadAllBanks(userBank: userBank)
    }
}
