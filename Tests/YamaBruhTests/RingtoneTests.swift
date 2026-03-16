import XCTest
@testable import YamaBruh

final class RingtoneTests: XCTestCase {
    func testDeterministic() {
        let a = Ringtone.generate(seed: 42, presetIndex: 0)
        let b = Ringtone.generate(seed: 42, presetIndex: 0)
        XCTAssertEqual(a, b, "Same seed must produce identical WAV data")
    }

    func testDifferentSeeds() {
        let a = Ringtone.generate(seed: 42, presetIndex: 0)
        let b = Ringtone.generate(seed: 99, presetIndex: 0)
        XCTAssertNotEqual(a, b, "Different seeds must produce different audio")
    }

    func testAppSeedChangesTimbre() {
        let a = Ringtone.generate(seed: 42, appSeed: 100)
        let b = Ringtone.generate(seed: 42, appSeed: 200)
        XCTAssertNotEqual(a, b, "Different app seeds must produce different audio")
    }

    func testAppSeedDeterministic() {
        let a = Ringtone.generate(seed: 42, appSeed: 100)
        let b = Ringtone.generate(seed: 42, appSeed: 100)
        XCTAssertEqual(a, b, "Same app seed + id seed must be identical")
    }

    func testWavHeader() {
        let wav = Ringtone.generate(seed: 1)
        XCTAssertGreaterThan(wav.count, 44, "WAV must have at least a header")
        let riff = String(data: wav[0..<4], encoding: .ascii)
        XCTAssertEqual(riff, "RIFF")
        let wave = String(data: wav[8..<12], encoding: .ascii)
        XCTAssertEqual(wave, "WAVE")
    }

    func testDJB2Hash() {
        let hash = SequenceGenerator.djb2Hash("test")
        XCTAssertEqual(hash, 2090756197, "DJB2 hash must match known value")
    }

    func testStringGeneration() {
        let a = Ringtone.generate(from: "task-abc-123", appIdentifier: "com.example.app")
        let b = Ringtone.generate(from: "task-abc-123", appIdentifier: "com.example.app")
        XCTAssertEqual(a, b)
    }

    func testDifferentAppsFromString() {
        let a = Ringtone.generate(from: "task-1", appIdentifier: "ca.lucianlabs.groundcontrol")
        let b = Ringtone.generate(from: "task-1", appIdentifier: "ca.lucianlabs.thinamp")
        XCTAssertNotEqual(a, b, "Different apps must sound different")
    }
}
