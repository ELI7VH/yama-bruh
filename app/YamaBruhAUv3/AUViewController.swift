import AudioToolbox
import CoreAudioKit
import SwiftUI
import YamaBruh

/// AUv3 extension view controller — hosts a SwiftUI view inside the Audio Unit UI.
/// Conforms to AUAudioUnitFactory (required for AUv3 extensions on iOS).
class YamaBruhAUViewController: AUViewController, AUAudioUnitFactory {

    var audioUnit: YamaBruhAudioUnit?
    private var hostingController: UIHostingController<AUv3ContentView>?

    // MARK: - AUAudioUnitFactory

    func createAudioUnit(with componentDescription: AudioComponentDescription) throws -> AUAudioUnit {
        let au = try YamaBruhAudioUnit(componentDescription: componentDescription)
        audioUnit = au
        DispatchQueue.main.async { [weak self] in
            self?.connectUI()
        }
        return au
    }

    // MARK: - View Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(YBTheme.background)

        let auView = AUv3ContentView()
        let hosting = UIHostingController(rootView: auView)
        hostingController = hosting

        addChild(hosting)
        view.addSubview(hosting.view)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    private func connectUI() {
        guard let au = audioUnit, let hosting = hostingController else { return }
        hosting.rootView = AUv3ContentView(presetParam: au.parameterTree?.parameter(withAddress: 0))
    }
}

// MARK: - AUv3 SwiftUI View

struct AUv3ContentView: View {
    var presetParam: AUParameter?
    @State private var selectedPreset: Int = 0

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 3), count: 10)

    var body: some View {
        VStack(spacing: 12) {
            // Header
            HStack {
                Text("YAMA-BRUH")
                    .font(YBTheme.heading)
                    .foregroundColor(YBTheme.cyan)
                Spacer()
                Text("YB-99FM")
                    .font(YBTheme.caption)
                    .foregroundColor(.gray)
            }
            .padding(.horizontal)

            // LED
            HStack {
                Text(String(format: "%02d", selectedPreset))
                    .font(YBTheme.led)
                    .foregroundColor(YBTheme.red)
                    .shadow(color: YBTheme.red.opacity(0.5), radius: 4)
                Text(YBTheme.presetName(at: selectedPreset))
                    .font(YBTheme.ledSmall)
                    .foregroundColor(YBTheme.red.opacity(0.8))
                Spacer()
            }
            .padding(.horizontal)

            // Preset grid
            ScrollView {
                LazyVGrid(columns: columns, spacing: 3) {
                    ForEach(0..<99, id: \.self) { i in
                        Button(action: { selectPreset(i) }) {
                            Text(String(format: "%02d", i))
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(selectedPreset == i ? .black : YBTheme.cyan)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 4)
                                .background(selectedPreset == i ? YBTheme.cyan : YBTheme.surface)
                                .cornerRadius(3)
                        }
                    }
                }
                .padding(.horizontal)
            }
        }
        .padding(.vertical, 8)
        .background(YBTheme.background)
    }

    private func selectPreset(_ index: Int) {
        selectedPreset = index
        presetParam?.value = AUValue(index)
    }
}
