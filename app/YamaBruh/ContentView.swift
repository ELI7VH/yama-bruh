import SwiftUI

struct ContentView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            PresetBrowserView()
                .tabItem {
                    Image(systemName: "pianokeys")
                    Text("SYNTH")
                }
                .tag(0)

            ToneGeneratorView()
                .tabItem {
                    Image(systemName: "waveform")
                    Text("CREATE")
                }
                .tag(1)

            PresetEditorView()
                .tabItem {
                    Image(systemName: "slider.horizontal.3")
                    Text("EDIT")
                }
                .tag(2)

            ToneListView()
                .tabItem {
                    Image(systemName: "list.bullet")
                    Text("TONES")
                }
                .tag(3)

            StoreView()
                .tabItem {
                    Image(systemName: "bag")
                    Text("STORE")
                }
                .tag(4)
        }
        .tint(YBTheme.cyan)
    }
}

struct StoreView: View {
    @EnvironmentObject var storeManager: StoreManager

    var body: some View {
        NavigationStack {
            ZStack {
                YBTheme.background.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        StoreProductCard(
                            title: "Full Synth",
                            description: "Unlock all 99 FM presets across 10 categories — Piano, Organ, Brass, Strings, Bass, Lead, Bell, Reed, SFX, and Retro.",
                            price: storeManager.price(for: .fullSynth),
                            purchased: storeManager.isUnlocked(.fullSynth)
                        ) {
                            Task { await storeManager.purchase(.fullSynth) }
                        }

                        StoreProductCard(
                            title: "AUv3 Instrument",
                            description: "Use YamaBruh as a real-time polyphonic instrument in GarageBand, Logic, AUM, and any AUv3 host.",
                            price: storeManager.price(for: .auv3),
                            purchased: storeManager.isUnlocked(.auv3)
                        ) {
                            Task { await storeManager.purchase(.auv3) }
                        }

                        StoreProductCard(
                            title: "Complete Bundle",
                            description: "Everything — all 99 presets plus the AUv3 instrument. Best value.",
                            price: storeManager.price(for: .bundle),
                            purchased: storeManager.isUnlocked(.bundle)
                        ) {
                            Task { await storeManager.purchase(.bundle) }
                        }

                        Button("Restore Purchases") {
                            Task { await storeManager.restorePurchases() }
                        }
                        .font(YBTheme.body)
                        .foregroundColor(YBTheme.cyan)
                        .padding(.top, 12)
                    }
                    .padding()
                }
            }
            .navigationTitle("Store")
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

struct StoreProductCard: View {
    let title: String
    let description: String
    let price: String
    let purchased: Bool
    let onPurchase: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(title)
                    .font(YBTheme.heading)
                    .foregroundColor(YBTheme.cyan)
                Spacer()
                if purchased {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundColor(YBTheme.green)
                }
            }

            Text(description)
                .font(YBTheme.body)
                .foregroundColor(.gray)

            if !purchased {
                Button(action: onPurchase) {
                    Text(price)
                        .font(YBTheme.heading)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(YBTheme.green)
                        .foregroundColor(.black)
                        .cornerRadius(8)
                }
            }
        }
        .padding()
        .background(YBTheme.surface)
        .cornerRadius(12)
    }
}
