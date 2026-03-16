import AVFoundation
import YamaBruh

enum ToneExporter {

    enum ExportFormat {
        case wav
        case m4r
    }

    enum ExportError: LocalizedError {
        case formatError
        case conversionFailed

        var errorDescription: String? {
            switch self {
            case .formatError: return "Could not create audio format"
            case .conversionFailed: return "Audio conversion failed"
            }
        }
    }

    /// Generate a tone and write it to a temporary file.
    /// Returns the file URL for sharing via UIActivityViewController.
    static func export(
        seed: UInt32,
        appSeed: UInt32 = 0,
        presetIndex: Int? = nil,
        bpm: Float = 120,
        name: String,
        format: ExportFormat = .m4r
    ) throws -> URL {
        let wavData = Ringtone.generate(
            seed: seed,
            appSeed: appSeed,
            presetIndex: presetIndex,
            bpm: bpm
        )

        let tempDir = FileManager.default.temporaryDirectory
        let wavURL = tempDir.appendingPathComponent("\(name).wav")
        try wavData.write(to: wavURL)

        switch format {
        case .wav:
            return wavURL
        case .m4r:
            return try convertToM4R(wavURL: wavURL, name: name)
        }
    }

    private static func convertToM4R(wavURL: URL, name: String) throws -> URL {
        let inputFile = try AVAudioFile(forReading: wavURL)
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(name).m4r")

        try? FileManager.default.removeItem(at: outputURL)

        let outputSettings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: inputFile.fileFormat.sampleRate,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 128_000,
        ]

        let outputFile = try AVAudioFile(
            forWriting: outputURL,
            settings: outputSettings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )

        let frameCount = AVAudioFrameCount(inputFile.length)
        guard let inputFormat = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: inputFile.fileFormat.sampleRate,
            channels: 1,
            interleaved: false
        ) else {
            throw ExportError.formatError
        }

        guard let buffer = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: frameCount) else {
            throw ExportError.formatError
        }

        try inputFile.read(into: buffer)
        try outputFile.write(from: buffer)

        return outputURL
    }

    /// Write a WAV to the app's Library/Sounds directory for UNNotificationSound usage.
    static func installAsNotificationSound(
        seed: UInt32,
        appSeed: UInt32 = 0,
        presetIndex: Int? = nil,
        name: String
    ) throws -> URL {
        let wavData = Ringtone.generate(
            seed: seed,
            appSeed: appSeed,
            presetIndex: presetIndex
        )

        let soundsDir = FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Sounds")

        try FileManager.default.createDirectory(at: soundsDir, withIntermediateDirectories: true)

        let fileURL = soundsDir.appendingPathComponent("\(name).wav")
        try wavData.write(to: fileURL)
        return fileURL
    }
}
