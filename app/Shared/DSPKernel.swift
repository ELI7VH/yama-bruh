import Foundation
import YamaBruh

/// Real-time polyphonic FM synthesis kernel with per-operator OPLL envelopes.
/// Used by both the AUv3 instrument and the app's audio preview engine.
/// All render-path methods avoid allocation and locks for audio-thread safety.
final class DSPKernel {

    static let maxVoices = 8
    private let twoPi: Float = .pi * 2

    struct Voice {
        var active: Bool = false
        var midiNote: UInt8 = 0
        var velocity: Float = 0
        var frequency: Float = 0
        var carrierPhase: Float = 0
        var modPhase: Float = 0
        var prevMod: Float = 0
        var sampleIndex: Int = 0
        var released: Bool = false
        var releaseSampleIndex: Int = 0
    }

    private var voices = (0..<8).map { _ in Voice() }
    private var _patch = PresetParams.default

    // Global LFOs (OPLL: vibrato 6.4 Hz, tremolo 3.7 Hz)
    private var vibratoPhase: Float = 0
    private var tremoloPhase: Float = 0

    var sampleRate: Float = 44100

    var presetIndex: Int = 0 {
        didSet {
            let clamped = max(0, min(98, presetIndex))
            _patch = PresetParams(FMPresets.preset(at: clamped))
        }
    }

    var currentPatch: PresetParams { _patch }

    /// Override with custom parameters (for the editor / bank presets).
    func setCustomPatch(_ patch: PresetParams) {
        _patch = patch
    }

    // MARK: - MIDI

    func noteOn(note: UInt8, velocity: UInt8) {
        var targetIndex = 0
        var oldestAge = -1

        for i in 0..<Self.maxVoices {
            if !voices[i].active {
                targetIndex = i
                oldestAge = Int.max
                break
            }
            if voices[i].sampleIndex > oldestAge {
                oldestAge = voices[i].sampleIndex
                targetIndex = i
            }
        }

        voices[targetIndex] = Voice(
            active: true,
            midiNote: note,
            velocity: Float(velocity) / 127.0,
            frequency: FMSynth.midiToFreq(Float(note)),
            carrierPhase: 0,
            modPhase: 0,
            prevMod: 0,
            sampleIndex: 0,
            released: false,
            releaseSampleIndex: 0
        )
    }

    func noteOff(note: UInt8) {
        for i in 0..<Self.maxVoices {
            if voices[i].active && voices[i].midiNote == note && !voices[i].released {
                voices[i].released = true
                voices[i].releaseSampleIndex = 0
            }
        }
    }

    func allNotesOff() {
        for i in 0..<Self.maxVoices {
            voices[i].active = false
        }
    }

    // MARK: - Envelope

    /// Compute operator envelope level for a single sample.
    /// Returns 0 when the envelope is finished (voice can be killed if carrier returns 0).
    @inline(__always)
    private func envelope(
        op: OperatorParams, sampleIndex: Int,
        noteReleased: Bool, releaseSampleIndex: Int, sr: Float
    ) -> Float {
        let aS = max(Int(op.attack * sr), 1)
        let dS = max(Int(op.decay * sr), 1)
        let rS = max(Int(op.release * sr), 1)

        // Determine if in release phase
        let inRelease: Bool
        let rOffset: Int

        if op.sustained {
            inRelease = noteReleased
            rOffset = releaseSampleIndex
        } else {
            // Percussive: auto-release after attack+decay
            let autoStart = aS + dS
            inRelease = sampleIndex >= autoStart
            rOffset = sampleIndex - autoStart
        }

        if inRelease {
            let t = Float(rOffset) / Float(rS)
            if t >= 1.0 { return 0 }
            return op.sustainLevel * (1.0 - t)
        } else if sampleIndex < aS {
            return Float(sampleIndex) / Float(aS)
        } else if sampleIndex < aS + dS {
            let t = Float(sampleIndex - aS) / Float(dS)
            return 1.0 - (1.0 - op.sustainLevel) * t
        } else {
            return op.sustainLevel
        }
    }

    /// Waveform: 0=sine, 1=half-rectified sine
    @inline(__always)
    private func wave(_ phase: Float, _ wf: Int) -> Float {
        let s = sinf(phase)
        return wf == 1 ? max(s, 0) : s
    }

    // MARK: - Render

    func render(frameCount: Int, buffer: UnsafeMutablePointer<Float>) {
        // Clear
        for i in 0..<frameCount { buffer[i] = 0 }

        let p = _patch
        let sr = sampleRate
        let mOp = p.modulator
        let cOp = p.carrier

        for v in 0..<Self.maxVoices {
            guard voices[v].active else { continue }

            let freq = voices[v].frequency
            let vel = voices[v].velocity
            let released = voices[v].released

            var cPhase = voices[v].carrierPhase
            var mPhase = voices[v].modPhase
            var pMod = voices[v].prevMod
            var sIdx = voices[v].sampleIndex
            var rIdx = voices[v].releaseSampleIndex
            var vPhase = vibratoPhase
            var tPhase = tremoloPhase
            var voiceDone = false

            for i in 0..<frameCount {
                // Global LFOs
                let vibMod = sinf(vPhase) * 0.008   // ±14 cents
                let tremMod = 1.0 - (1.0 + sinf(tPhase)) * 0.055  // ±1 dB

                // Per-operator envelopes
                let modEnv = envelope(op: mOp, sampleIndex: sIdx,
                                      noteReleased: released, releaseSampleIndex: rIdx, sr: sr)
                let carEnv = envelope(op: cOp, sampleIndex: sIdx,
                                      noteReleased: released, releaseSampleIndex: rIdx, sr: sr)

                if carEnv <= 0 && modEnv <= 0 {
                    voiceDone = true
                    break
                }

                // Frequencies with vibrato
                let mFreq = freq * mOp.mult * (mOp.vibrato ? (1.0 + vibMod) : 1.0)
                let cFreq = freq * cOp.mult * (cOp.vibrato ? (1.0 + vibMod) : 1.0)

                // Modulator
                let modRaw = wave(mPhase + p.feedback * pMod, mOp.waveform)
                let modTrem = mOp.tremolo ? tremMod : 1.0
                let modOut = modRaw * modEnv * modTrem
                pMod = modRaw

                // Carrier
                let carRaw = wave(cPhase + p.modDepth * modOut, cOp.waveform)
                let carTrem = cOp.tremolo ? tremMod : 1.0

                buffer[i] += carRaw * carEnv * carTrem * vel * 0.45

                // Phase advance
                cPhase += twoPi * cFreq / sr
                mPhase += twoPi * mFreq / sr
                if cPhase > twoPi { cPhase -= twoPi }
                if mPhase > twoPi { mPhase -= twoPi }

                vPhase += twoPi * 6.4 / sr
                tPhase += twoPi * 3.7 / sr
                if vPhase > twoPi { vPhase -= twoPi }
                if tPhase > twoPi { tPhase -= twoPi }

                sIdx += 1
                if released { rIdx += 1 }
            }

            voices[v].carrierPhase = cPhase
            voices[v].modPhase = mPhase
            voices[v].prevMod = pMod
            voices[v].sampleIndex = sIdx
            voices[v].releaseSampleIndex = rIdx

            if voiceDone {
                voices[v].active = false
            }
        }

        // Store global LFO phase (advance by frameCount)
        vibratoPhase += twoPi * 6.4 * Float(frameCount) / sr
        tremoloPhase += twoPi * 3.7 * Float(frameCount) / sr
        if vibratoPhase > twoPi { vibratoPhase -= twoPi }
        if tremoloPhase > twoPi { tremoloPhase -= twoPi }
    }
}
