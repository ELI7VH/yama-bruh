import StoreKit

enum YBProduct: String, CaseIterable {
    case fullSynth = "ca.lucianlabs.yamabruh.fullsynth"
    case auv3 = "ca.lucianlabs.yamabruh.auv3"
    case bundle = "ca.lucianlabs.yamabruh.bundle"
}

@MainActor
final class StoreManager: ObservableObject {
    @Published private(set) var products: [Product] = []
    @Published private(set) var purchasedProducts: Set<String> = []
    @Published private(set) var isLoading = false

    /// Additional bank product IDs discovered from loaded bank JSON files.
    /// Set by PresetBankManager after banks are loaded.
    @Published var bankProductIDs: [String] = []

    private var updateListenerTask: Task<Void, Error>?

    init() {
        updateListenerTask = listenForTransactions()
        Task { await loadProducts() }
    }

    deinit {
        updateListenerTask?.cancel()
    }

    // MARK: - Public

    func isUnlocked(_ product: YBProduct) -> Bool {
        if purchasedProducts.contains(product.rawValue) { return true }
        if product == .fullSynth || product == .auv3 {
            return purchasedProducts.contains(YBProduct.bundle.rawValue)
        }
        return false
    }

    func isPresetUnlocked(_ index: Int) -> Bool {
        if YBTheme.freePresets.contains(index) { return true }
        return isUnlocked(.fullSynth)
    }

    /// Check if a bank (by its IAP product ID) is purchased.
    func isBankUnlocked(_ productID: String?) -> Bool {
        guard let productID else { return true }
        return purchasedProducts.contains(productID)
            || purchasedProducts.contains(YBProduct.bundle.rawValue)
    }

    func price(for product: YBProduct) -> String {
        products.first { $0.id == product.rawValue }?.displayPrice ?? "..."
    }

    func price(forProductID id: String) -> String {
        products.first { $0.id == id }?.displayPrice ?? "..."
    }

    func purchase(_ product: YBProduct) async {
        await purchaseByID(product.rawValue)
    }

    func purchaseBank(_ productID: String) async {
        await purchaseByID(productID)
    }

    func restorePurchases() async {
        try? await AppStore.sync()
        await refreshPurchasedProducts()
    }

    // MARK: - Product loading

    /// Reload products including any newly registered bank IDs.
    func reloadProducts() async {
        await loadProducts()
    }

    private func loadProducts() async {
        isLoading = true
        do {
            var allIDs = YBProduct.allCases.map(\.rawValue)
            allIDs.append(contentsOf: bankProductIDs)
            products = try await Product.products(for: allIDs)
            await refreshPurchasedProducts()
        } catch {
            print("Failed to load products: \(error)")
        }
        isLoading = false
    }

    // MARK: - Private

    private func purchaseByID(_ productID: String) async {
        guard let storeProduct = products.first(where: { $0.id == productID }) else { return }
        do {
            let result = try await storeProduct.purchase()
            switch result {
            case .success(let verification):
                if let transaction = try? verification.payloadValue {
                    purchasedProducts.insert(transaction.productID)
                    await transaction.finish()
                    syncToAppGroup()
                }
            case .pending, .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            print("Purchase failed: \(error)")
        }
    }

    private func refreshPurchasedProducts() async {
        var purchased = Set<String>()
        for await result in Transaction.currentEntitlements {
            if let transaction = try? result.payloadValue {
                purchased.insert(transaction.productID)
            }
        }
        purchasedProducts = purchased
        syncToAppGroup()
    }

    private func listenForTransactions() -> Task<Void, Error> {
        Task.detached { [weak self] in
            for await result in Transaction.updates {
                if let transaction = try? result.payloadValue {
                    await MainActor.run {
                        self?.purchasedProducts.insert(transaction.productID)
                        self?.syncToAppGroup()
                    }
                    await transaction.finish()
                }
            }
        }
    }

    private func syncToAppGroup() {
        guard let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.ca.lucianlabs.yamabruh"
        ) else { return }

        let data = try? JSONEncoder().encode(Array(purchasedProducts))
        let url = container.appendingPathComponent("entitlements.json")
        try? data?.write(to: url)
    }
}
