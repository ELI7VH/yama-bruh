import Foundation
import YamaBruh

// MARK: - Per-operator parameters (OPLL-style)

struct OperatorParams: Codable, Equatable {
    var mult: Float = 1.0           // frequency multiplier (0.5, 1-15)
    var attack: Float = 0.001       // seconds
    var decay: Float = 0.5          // seconds
    var sustainLevel: Float = 1.0   // 0-1 linear amplitude
    var release: Float = 0.5        // seconds
    var waveform: Int = 0           // 0=sine, 1=half-rectified sine
    var vibrato: Bool = false
    var tremolo: Bool = false
    var sustained: Bool = true      // true=sustained, false=percussive

    static let `default` = OperatorParams()

    /// "Always on" modulator (for backward compat from old single-ADSR presets)
    static func staticMod(mult: Float) -> OperatorParams {
        OperatorParams(mult: mult, attack: 0.001, decay: 99.0, sustainLevel: 1.0,
                       release: 99.0, waveform: 0, vibrato: false, tremolo: false, sustained: true)
    }
}

// MARK: - Mutable preset params (full OPLL per-operator format)

struct PresetParams: Equatable {
    var modulator: OperatorParams
    var carrier: OperatorParams
    var modDepth: Float      // radians of max phase deviation (modIndex * TL)
    var feedback: Float      // radians of modulator self-feedback

    // MARK: - Init from SPM FMPreset (backward compat)

    init(_ preset: FMPreset) {
        modulator = .staticMod(mult: preset.modRatio)
        carrier = OperatorParams(
            mult: preset.carrierRatio,
            attack: preset.attack, decay: preset.decay,
            sustainLevel: preset.sustain, release: preset.release
        )
        modDepth = preset.modIndex
        feedback = preset.feedback
    }

    init(
        modulator: OperatorParams = .default,
        carrier: OperatorParams = .default,
        modDepth: Float = 1.0,
        feedback: Float = 0.0
    ) {
        self.modulator = modulator
        self.carrier = carrier
        self.modDepth = modDepth
        self.feedback = feedback
    }

    /// Convert to FMPreset for offline ringtone rendering (lossy — drops per-op detail)
    func toFMPreset() -> FMPreset {
        FMPreset([carrier.mult, modulator.mult, modDepth,
                  carrier.attack, carrier.decay, carrier.sustainLevel,
                  carrier.release, feedback])
    }

    static let `default` = PresetParams()
}

// MARK: - Codable with backward compat

extension PresetParams: Codable {
    enum CodingKeys: String, CodingKey {
        case modulator, carrier, modDepth, feedback
        // Legacy flat keys
        case carrierRatio, modRatio, modIndex, attack, decay, sustain, release
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)

        if let mod = try? c.decode(OperatorParams.self, forKey: .modulator),
           let car = try? c.decode(OperatorParams.self, forKey: .carrier) {
            modulator = mod
            carrier = car
            modDepth = try c.decode(Float.self, forKey: .modDepth)
            feedback = try c.decode(Float.self, forKey: .feedback)
        } else {
            // Legacy flat format
            let cr = try c.decode(Float.self, forKey: .carrierRatio)
            let mr = try c.decode(Float.self, forKey: .modRatio)
            let mi = try c.decode(Float.self, forKey: .modIndex)
            let a = try c.decode(Float.self, forKey: .attack)
            let d = try c.decode(Float.self, forKey: .decay)
            let s = try c.decode(Float.self, forKey: .sustain)
            let r = try c.decode(Float.self, forKey: .release)
            let fb = try c.decode(Float.self, forKey: .feedback)
            modulator = .staticMod(mult: mr)
            carrier = OperatorParams(mult: cr, attack: a, decay: d, sustainLevel: s, release: r)
            modDepth = mi
            feedback = fb
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(modulator, forKey: .modulator)
        try c.encode(carrier, forKey: .carrier)
        try c.encode(modDepth, forKey: .modDepth)
        try c.encode(feedback, forKey: .feedback)
    }
}

// MARK: - OPLL register conversion helpers

extension PresetParams {
    /// Convert raw YM2413 register bytes [R#00..R#07] to PresetParams
    static func fromOPLL(_ r: [UInt8]) -> PresetParams {
        // Rate-to-seconds lookup (approximate mid-octave timing)
        func arTime(_ rate: Int) -> Float {
            let t: [Float] = [99, 5, 3, 1.8, 1.0, 0.6, 0.35, 0.2,
                              0.12, 0.07, 0.04, 0.02, 0.01, 0.005, 0.003, 0.001]
            return t[min(rate, 15)]
        }
        func drTime(_ rate: Int) -> Float {
            let t: [Float] = [99, 30, 18, 10, 6, 3.5, 2.0, 1.0,
                              0.5, 0.3, 0.15, 0.08, 0.04, 0.02, 0.01, 0.005]
            return t[min(rate, 15)]
        }
        func slLevel(_ sl: Int) -> Float {
            powf(10, Float(-3 * sl) / 20.0)
        }
        func multValue(_ m: Int) -> Float {
            m == 0 ? 0.5 : Float(m)
        }

        // Byte 0: Modulator AM|VIB|EG|KSR|MULT
        let modAM   = (r[0] & 0x80) != 0
        let modVIB  = (r[0] & 0x40) != 0
        let modEG   = (r[0] & 0x20) != 0  // 1=sustained
        let modMULT = Int(r[0] & 0x0F)

        // Byte 1: Carrier AM|VIB|EG|KSR|MULT
        let carAM   = (r[1] & 0x80) != 0
        let carVIB  = (r[1] & 0x40) != 0
        let carEG   = (r[1] & 0x20) != 0
        let carMULT = Int(r[1] & 0x0F)

        // Byte 2: Modulator KSL|TL
        let modTL = Int(r[2] & 0x3F)

        // Byte 3: Carrier KSL | DC | DM | FB
        let carWF = (r[3] & 0x20) != 0 ? 1 : 0
        let modWF = (r[3] & 0x10) != 0 ? 1 : 0
        let fbRaw = Int((r[3] >> 1) & 0x07)
        let fbValues: [Float] = [0, .pi/16, .pi/8, .pi/4, .pi/2, .pi, 2 * .pi, 4 * .pi]

        // Byte 4: Modulator AR|DR
        let modAR = Int((r[4] >> 4) & 0x0F)
        let modDR = Int(r[4] & 0x0F)

        // Byte 5: Carrier AR|DR
        let carAR = Int((r[5] >> 4) & 0x0F)
        let carDR = Int(r[5] & 0x0F)

        // Byte 6: Modulator SL|RR
        let modSL = Int((r[6] >> 4) & 0x0F)
        let modRR = Int(r[6] & 0x0F)

        // Byte 7: Carrier SL|RR
        let carSL = Int((r[7] >> 4) & 0x0F)
        let carRR = Int(r[7] & 0x0F)

        // TL → mod depth: OPLL base peak is ~4π radians at TL=0
        let tlLinear = powf(10, Float(-0.75 * Float(modTL)) / 20.0)
        let depth = tlLinear * 4.0 * .pi

        let mod = OperatorParams(
            mult: multValue(modMULT),
            attack: arTime(modAR), decay: drTime(modDR),
            sustainLevel: slLevel(modSL), release: drTime(modRR),
            waveform: modWF, vibrato: modVIB, tremolo: modAM, sustained: modEG
        )
        let car = OperatorParams(
            mult: multValue(carMULT),
            attack: arTime(carAR), decay: drTime(carDR),
            sustainLevel: slLevel(carSL), release: drTime(carRR),
            waveform: carWF, vibrato: carVIB, tremolo: carAM, sustained: carEG
        )
        return PresetParams(modulator: mod, carrier: car, modDepth: depth, feedback: fbValues[fbRaw])
    }
}

// MARK: - Single preset within a bank

struct BankPreset: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var category: String
    var params: PresetParams

    init(id: String, name: String, category: String, params: PresetParams) {
        self.id = id
        self.name = name
        self.category = category
        self.params = params
    }

    /// Create from a classic preset index
    init(classicIndex: Int) {
        self.id = "classic-\(classicIndex)"
        self.name = YBTheme.presetName(at: classicIndex)
        self.category = YBTheme.categoryName(for: classicIndex)
        self.params = PresetParams(FMPresets.preset(at: classicIndex))
    }
}

// MARK: - Preset bank (a sellable/loadable collection)

struct PresetBank: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let description: String
    let author: String
    let sortOrder: Int
    let iapProductID: String?
    var presets: [BankPreset]

    var isFree: Bool { iapProductID == nil }

    /// The built-in "Classic" bank, constructed from the SPM package's 99 presets
    static let classic: PresetBank = {
        let presets = (0..<99).map { BankPreset(classicIndex: $0) }
        return PresetBank(
            id: "classic",
            name: "Classic YB-99",
            description: "The original 99 presets — piano, organ, brass, strings, bass, lead, bells, reeds, SFX, and retro.",
            author: "Elijah Lucian",
            sortOrder: 0,
            iapProductID: nil,
            presets: presets
        )
    }()

    /// Empty "My Presets" bank for user-created sounds
    static let userBank: PresetBank = PresetBank(
        id: "user",
        name: "My Presets",
        description: "Your custom-tweaked sounds.",
        author: "You",
        sortOrder: 999,
        iapProductID: nil,
        presets: []
    )
}

// MARK: - Resolved preset reference (bank + index, for passing around the app)

struct PresetReference: Equatable {
    let bankID: String
    let presetID: String

    var isClassic: Bool { bankID == "classic" }

    /// Convenience for classic presets by index
    static func classic(_ index: Int) -> PresetReference {
        PresetReference(bankID: "classic", presetID: "classic-\(index)")
    }
}
