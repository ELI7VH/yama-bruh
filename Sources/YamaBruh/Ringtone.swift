import Foundation

/// High-level API for generating ringtones as WAV data.
public enum Ringtone {

    /// Default sample rate for notification sounds (44.1kHz)
    public static let defaultSampleRate: Float = 44100

    /// Default BPM for generated ringtones
    public static let defaultBPM: Float = 120

    /// Maximum duration in seconds (iOS notification sounds must be ≤ 30s)
    public static let maxDuration: Float = 5.0

    /// Generate a complete ringtone as WAV `Data`.
    ///
    /// Two-tier seeding: `appSeed` selects the timbre (preset), `seed` selects the melody.
    /// Same app + same ID = identical audio across restarts/reinstalls.
    ///
    /// - Parameters:
    ///   - seed: Per-item seed (e.g. hash of task ID) — determines the note sequence
    ///   - appSeed: Per-app seed (e.g. hash of bundle ID) — determines the preset/timbre family
    ///   - presetIndex: Explicit preset override. If nil, derived from appSeed.
    ///   - bpm: Tempo in beats per minute
    ///   - sampleRate: Output sample rate in Hz
    /// - Returns: WAV file data
    public static func generate(
        seed: UInt32,
        appSeed: UInt32 = 0,
        presetIndex: Int? = nil,
        bpm: Float = defaultBPM,
        sampleRate: Float = defaultSampleRate
    ) -> Data {
        // App seed determines preset if not explicitly overridden
        let effectivePreset: Int
        if let presetIndex {
            effectivePreset = presetIndex
        } else if appSeed != 0 {
            effectivePreset = Int(appSeed % UInt32(FMPresets.all.count))
        } else {
            effectivePreset = 0
        }

        // Combine seeds for the melody — same app+id always produces same sequence
        // Knuth multiplicative hash mixing
        let melodySeed = appSeed == 0 ? seed : seed ^ (appSeed &* 2654435761)

        let preset = FMPresets.preset(at: effectivePreset)
        let beatDuration = 60.0 / bpm
        let notes = SequenceGenerator.generate(seed: melodySeed)

        // Calculate total duration
        var totalDuration: Float = 0
        for note in notes {
            totalDuration += note.durationBeats * beatDuration
        }
        totalDuration += preset.release
        totalDuration = min(totalDuration, maxDuration)

        let totalSamples = Int(totalDuration * sampleRate)
        var buffer = [Float](repeating: 0, count: totalSamples)

        var offset = 0
        for note in notes {
            let freq = FMSynth.midiToFreq(note.midiNote)
            let durationSecs = note.durationBeats * beatDuration

            FMSynth.renderNote(
                freq: freq,
                duration: durationSecs,
                preset: preset,
                sampleRate: sampleRate,
                buffer: &buffer,
                offset: offset,
                velocity: 0.8
            )
            offset += Int(durationSecs * sampleRate)
        }

        return WavWriter.encode(samples: buffer, sampleRate: Int(sampleRate))
    }

    /// Generate a ringtone from string identifiers.
    ///
    /// - Parameters:
    ///   - identifier: Per-item ID (task ID, message ID, etc.)
    ///   - appIdentifier: Per-app ID (bundle ID, app name, etc.). Determines timbre.
    ///   - presetIndex: Explicit preset override. If nil, derived from appIdentifier hash.
    ///   - bpm: Tempo in beats per minute
    ///   - sampleRate: Output sample rate in Hz
    public static func generate(
        from identifier: String,
        appIdentifier: String = "",
        presetIndex: Int? = nil,
        bpm: Float = defaultBPM,
        sampleRate: Float = defaultSampleRate
    ) -> Data {
        let seed = SequenceGenerator.djb2Hash(identifier)
        let appSeed = appIdentifier.isEmpty ? 0 : SequenceGenerator.djb2Hash(appIdentifier)
        return generate(seed: seed, appSeed: appSeed, presetIndex: presetIndex, bpm: bpm, sampleRate: sampleRate)
    }
}
