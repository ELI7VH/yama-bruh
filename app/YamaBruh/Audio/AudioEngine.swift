import AVFoundation
import YamaBruh

/// Audio engine for previewing tones and real-time synth playback in the main app.
final class AudioEngine: ObservableObject {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let kernel = DSPKernel()
    private var srcNode: AVAudioSourceNode?

    @Published var isPlaying = false
    @Published var currentPresetIndex: Int = 0 {
        didSet { kernel.presetIndex = currentPresetIndex }
    }

    init() {
        setupEngine()
    }

    private func setupEngine() {
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 1)!
        kernel.sampleRate = 44100

        let src = AVAudioSourceNode(format: format) { [weak self] _, _, frameCount, audioBufferList -> OSStatus in
            guard let self else { return noErr }
            let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
            guard let buffer = ablPointer[0].mData?.assumingMemoryBound(to: Float.self) else {
                return noErr
            }
            self.kernel.render(frameCount: Int(frameCount), buffer: buffer)
            return noErr
        }
        srcNode = src

        engine.attach(playerNode)
        engine.attach(src)
        engine.connect(src, to: engine.mainMixerNode, format: format)
        engine.connect(playerNode, to: engine.mainMixerNode, format: format)
    }

    func start() {
        guard !engine.isRunning else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            try engine.start()
        } catch {
            print("AudioEngine start failed: \(error)")
        }
    }

    func stop() {
        engine.stop()
        kernel.allNotesOff()
        isPlaying = false
    }

    // MARK: - Real-time synth (for AUv3 preview / keyboard)

    func noteOn(_ note: UInt8, velocity: UInt8 = 100) {
        start()
        kernel.noteOn(note: note, velocity: velocity)
    }

    func noteOff(_ note: UInt8) {
        kernel.noteOff(note: note)
    }

    /// Apply custom params to the kernel (for the preset editor / bank presets).
    func setCustomPatch(_ patch: PresetParams) {
        kernel.setCustomPatch(patch)
    }

    // MARK: - Tone preview (offline-rendered WAV)

    func playTone(seed: UInt32, appSeed: UInt32 = 0, presetIndex: Int? = nil, bpm: Float = 120) {
        start()
        isPlaying = true

        let wavData = Ringtone.generate(
            seed: seed,
            appSeed: appSeed,
            presetIndex: presetIndex,
            bpm: bpm
        )

        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("preview.wav")
        try? wavData.write(to: tempURL)

        guard let file = try? AVAudioFile(forReading: tempURL) else {
            isPlaying = false
            return
        }

        let frameCount = AVAudioFrameCount(file.length)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frameCount) else {
            isPlaying = false
            return
        }

        do {
            try file.read(into: buffer)
            playerNode.stop()
            playerNode.scheduleBuffer(buffer) { [weak self] in
                DispatchQueue.main.async { self?.isPlaying = false }
            }
            playerNode.play()
        } catch {
            isPlaying = false
        }
    }

    /// Play raw WAV data directly (used by the editor for custom-param previews).
    func playWavData(_ wavData: Data) {
        start()
        isPlaying = true

        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("editor-preview.wav")
        try? wavData.write(to: tempURL)

        guard let file = try? AVAudioFile(forReading: tempURL) else {
            isPlaying = false
            return
        }

        let frameCount = AVAudioFrameCount(file.length)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frameCount) else {
            isPlaying = false
            return
        }

        do {
            try file.read(into: buffer)
            playerNode.stop()
            playerNode.scheduleBuffer(buffer) { [weak self] in
                DispatchQueue.main.async { self?.isPlaying = false }
            }
            playerNode.play()
        } catch {
            isPlaying = false
        }
    }

    func stopPlayback() {
        playerNode.stop()
        kernel.allNotesOff()
        isPlaying = false
    }
}
