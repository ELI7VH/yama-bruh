import AudioToolbox
import AVFoundation
import CoreAudioKit
import YamaBruh

/// AUv3 Instrument — polyphonic FM synth playable in GarageBand, Logic, AUM, etc.
final class YamaBruhAudioUnit: AUAudioUnit {

    private let kernel = DSPKernel()
    private var outputBus: AUAudioUnitBus!
    private var _outputBusses: AUAudioUnitBusArray!
    private var _parameterTree: AUParameterTree!
    private var presetParam: AUParameter!

    private static let componentDescription = AudioComponentDescription(
        componentType: kAudioUnitType_MusicDevice,
        componentSubType: fourCC("ymbr"),
        componentManufacturer: fourCC("LLab"),
        componentFlags: 0,
        componentFlagsMask: 0
    )

    override init(
        componentDescription: AudioComponentDescription,
        options: AudioComponentInstantiationOptions = []
    ) throws {
        try super.init(componentDescription: componentDescription, options: options)

        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        outputBus = try AUAudioUnitBus(format: format)
        _outputBusses = AUAudioUnitBusArray(audioUnit: self, busType: .output, busses: [outputBus])

        presetParam = AUParameterTree.createParameter(
            withIdentifier: "preset",
            name: "Preset",
            address: 0,
            min: 0,
            max: 98,
            unit: .indexed,
            unitName: nil,
            flags: [.flag_IsWritable, .flag_IsReadable],
            valueStrings: YBTheme.presetNames,
            dependentParameters: nil
        )

        _parameterTree = AUParameterTree.createTree(withChildren: [presetParam])

        _parameterTree.implementorValueObserver = { [weak self] param, value in
            if param.address == 0 {
                self?.kernel.presetIndex = Int(value)
            }
        }

        _parameterTree.implementorValueProvider = { [weak self] param in
            guard let self else { return 0 }
            if param.address == 0 { return AUValue(self.kernel.presetIndex) }
            return 0
        }

        // Display names are provided via valueStrings in createParameter above
    }

    override var parameterTree: AUParameterTree? {
        get { _parameterTree }
        set { /* required override */ }
    }

    override var outputBusses: AUAudioUnitBusArray { _outputBusses }

    override func allocateRenderResources() throws {
        try super.allocateRenderResources()
        kernel.sampleRate = Float(outputBus.format.sampleRate)
    }

    override func deallocateRenderResources() {
        super.deallocateRenderResources()
        kernel.allNotesOff()
    }

    override var internalRenderBlock: AUInternalRenderBlock {
        let kernel = self.kernel

        return { actionFlags, timestamp, frameCount, outputBusNumber, outputData, realtimeEventListHead, pullInputBlock in

            // Process MIDI events from the event list
            var eventPtr = realtimeEventListHead
            while let event = eventPtr {
                if event.pointee.head.eventType == .MIDI {
                    let midi = event.pointee.MIDI
                    let status = midi.data.0 & 0xF0
                    let note = midi.data.1
                    let vel = midi.data.2

                    switch status {
                    case 0x90 where vel > 0:
                        kernel.noteOn(note: note, velocity: vel)
                    case 0x80, 0x90:
                        kernel.noteOff(note: note)
                    case 0xB0:
                        if note == 123 { kernel.allNotesOff() }
                    default:
                        break
                    }
                } else if event.pointee.head.eventType == .parameter {
                    let paramEvent = event.pointee.parameter
                    if paramEvent.parameterAddress == 0 {
                        kernel.presetIndex = Int(paramEvent.value)
                    }
                }
                eventPtr = .init(event.pointee.head.next)
            }

            // Render audio
            let ablPointer = UnsafeMutableAudioBufferListPointer(outputData)
            guard let leftBuffer = ablPointer[0].mData?.assumingMemoryBound(to: Float.self) else {
                return noErr
            }

            kernel.render(frameCount: Int(frameCount), buffer: leftBuffer)

            // Copy mono to right channel
            if ablPointer.count > 1,
               let rightBuffer = ablPointer[1].mData?.assumingMemoryBound(to: Float.self) {
                memcpy(rightBuffer, leftBuffer, Int(frameCount) * MemoryLayout<Float>.size)
            }

            return noErr
        }
    }

    // MARK: - Factory Presets

    override var factoryPresets: [AUAudioUnitPreset]? {
        (0..<99).map { i in
            let preset = AUAudioUnitPreset()
            preset.number = i
            preset.name = YBTheme.presetName(at: i)
            return preset
        }
    }

    override var currentPreset: AUAudioUnitPreset? {
        get {
            let preset = AUAudioUnitPreset()
            preset.number = kernel.presetIndex
            preset.name = YBTheme.presetName(at: kernel.presetIndex)
            return preset
        }
        set {
            if let preset = newValue {
                kernel.presetIndex = preset.number
                presetParam.value = AUValue(preset.number)
            }
        }
    }
}

// MARK: - AUv3 Registration

extension YamaBruhAudioUnit {
    static func registerSubclass() {
        AUAudioUnit.registerSubclass(
            YamaBruhAudioUnit.self,
            as: componentDescription,
            name: "Lucian Labs: YamaBruh",
            version: 1
        )
    }
}

// MARK: - FourCharCode helper

private func fourCC(_ string: String) -> FourCharCode {
    let chars = Array(string.utf8)
    return UInt32(chars[0]) << 24 | UInt32(chars[1]) << 16 | UInt32(chars[2]) << 8 | UInt32(chars[3])
}
