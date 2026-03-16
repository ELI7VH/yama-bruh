import SwiftUI

@main
struct YamaBruhApp: App {
    @StateObject private var store = ToneStore()
    @StateObject private var storeManager = StoreManager()
    @StateObject private var audioEngine = AudioEngine()
    @StateObject private var bankManager = PresetBankManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
                .environmentObject(storeManager)
                .environmentObject(audioEngine)
                .environmentObject(bankManager)
                .preferredColorScheme(.dark)
        }
    }
}
