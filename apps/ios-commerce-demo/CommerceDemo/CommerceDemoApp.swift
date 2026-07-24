import Foundation
import SwiftUI

@main
struct CommerceDemoApp: App {
    var body: some Scene {
        WindowGroup {
            CheckoutRootView()
        }
    }
}

private struct CheckoutRootView: View {
    @State private var path: [CheckoutRoute]
    @State private var cartLine: CartLine?

    init(launchRoute: DemoLaunchRoute? = DemoLaunchRoute.current) {
        let launchState = CheckoutLaunchState(route: launchRoute)
        _path = State(initialValue: launchState.path)
        _cartLine = State(initialValue: launchState.cartLine)
    }

    var body: some View {
        NavigationStack(path: $path) {
            CatalogView(
                products: Product.catalog,
                onSelect: { product in path.append(.productDetail(product.id)) },
                onGestureLab: { path.append(.gestureLab) }
            )
            .navigationDestination(for: CheckoutRoute.self) { route in
                switch route {
                case .gestureLab:
                    GestureLabView()
                case .productDetail(let productID):
                    ProductDetailView(product: product(withID: productID)) { product in
                        cartLine = CartLine(product: product, quantity: 1)
                        path.append(.cart)
                    }
                case .cart:
                    // Pass a binding: navigationDestination closures can capture
                    // stale @State when the push happens in the same update as
                    // the state change (real tap-driven checkout exposed this).
                    CartView(cartLine: $cartLine) {
                        path.append(.shipping)
                    }
                case .shipping:
                    ShippingView(details: ShippingDetails.fixture) {
                        path.append(.paymentReview)
                    }
                case .paymentReview:
                    PaymentReviewView(
                        cartLine: $cartLine,
                        shippingDetails: ShippingDetails.fixture,
                        paymentMethod: PaymentMethod.fixture
                    ) {
                        path.append(.confirmation)
                    }
                case .confirmation:
                    ConfirmationView(order: OrderConfirmation.fixture)
                }
            }
        }
    }

    private func product(withID id: String) -> Product {
        Product.catalog.first { $0.id == id } ?? Product.catalog[0]
    }
}

private enum CheckoutRoute: Hashable {
    case gestureLab
    case productDetail(String)
    case cart
    case shipping
    case paymentReview
    case confirmation
}

private enum DemoLaunchRoute {
    case catalog
    case productDetail
    case cart
    case shipping
    case paymentReview
    case confirmation
    case gestureLab

    static let argumentName = "--atlas-demo-route"
    static let environmentName = "ATLAS_LOOP_DEMO_ROUTE"

    static var current: DemoLaunchRoute? {
        let processInfo = ProcessInfo.processInfo
        let rawRoute = argumentValue(named: argumentName, in: processInfo.arguments)
            ?? processInfo.environment[environmentName]
        return rawRoute.flatMap(DemoLaunchRoute.init(rawValue:))
    }

    init?(rawValue: String) {
        switch rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "catalog":
            self = .catalog
        case "product", "product-detail", "detail":
            self = .productDetail
        case "cart":
            self = .cart
        case "shipping":
            self = .shipping
        case "payment", "payment-review", "review":
            self = .paymentReview
        case "confirmation", "confirm", "complete":
            self = .confirmation
        case "gesture", "gesture-lab", "gestures":
            self = .gestureLab
        default:
            return nil
        }
    }

    private static func argumentValue(named name: String, in arguments: [String]) -> String? {
        for (index, argument) in arguments.enumerated() {
            if argument == name, arguments.indices.contains(index + 1) {
                return arguments[index + 1]
            }

            let assignmentPrefix = "\(name)="
            if argument.hasPrefix(assignmentPrefix) {
                return String(argument.dropFirst(assignmentPrefix.count))
            }
        }

        return nil
    }
}

private struct Product: Identifiable, Hashable {
    let id: String
    let name: String
    let subtitle: String
    let details: String
    let priceText: String
    let symbolName: String

    static let catalog = [
        Product(
            id: "atlas-pack",
            name: "Atlas Pack",
            subtitle: "Everyday carry",
            details: "A compact field bag with structured pockets and a padded device sleeve.",
            priceText: "$79.00",
            symbolName: "backpack"
        ),
        Product(
            id: "loop-bottle",
            name: "Loop Bottle",
            subtitle: "Cold for 24 hours",
            details: "A brushed steel bottle with a leakproof cap and measured fill marks.",
            priceText: "$32.00",
            symbolName: "waterbottle"
        ),
        Product(
            id: "signal-wallet",
            name: "Signal Wallet",
            subtitle: "Slim travel wallet",
            details: "A recycled nylon wallet with four card slots and a passport pocket.",
            priceText: "$48.00",
            symbolName: "wallet.pass"
        )
    ]
}

private struct CartLine: Hashable {
    let product: Product
    let quantity: Int

    var subtotalText: String {
        product.priceText
    }

    var totalText: String {
        product.id == "atlas-pack" ? "$85.32" : product.priceText
    }
}

private struct CheckoutLaunchState {
    let path: [CheckoutRoute]
    let cartLine: CartLine?

    init(route: DemoLaunchRoute?) {
        let fixtureLine = CartLine(product: Product.catalog[0], quantity: 1)

        switch route {
        case nil, .catalog?:
            path = []
            cartLine = nil
        case .productDetail?:
            path = [.productDetail(fixtureLine.product.id)]
            cartLine = nil
        case .cart?:
            path = [.cart]
            cartLine = fixtureLine
        case .shipping?:
            path = [.shipping]
            cartLine = fixtureLine
        case .paymentReview?:
            path = [.paymentReview]
            cartLine = fixtureLine
        case .confirmation?:
            path = [.confirmation]
            cartLine = fixtureLine
        case .gestureLab?:
            path = [.gestureLab]
            cartLine = nil
        }
    }
}

private struct ShippingDetails: Hashable {
    let name: String
    let street: String
    let cityLine: String
    let method: String

    static let fixture = ShippingDetails(
        name: "Avery Atlas",
        street: "42 Loop Street",
        cityLine: "San Francisco, CA 94107",
        method: "Standard delivery"
    )
}

private struct PaymentMethod: Hashable {
    let label: String
    let billingLine: String

    static let fixture = PaymentMethod(
        label: "Visa ending in 4242",
        billingLine: "Billing address matches shipping"
    )
}

private struct OrderConfirmation: Hashable {
    let orderNumber: String
    let message: String

    static let fixture = OrderConfirmation(
        orderNumber: "ORDER-ATLAS-0001",
        message: "Your deterministic checkout is complete."
    )
}

private struct CatalogView: View {
    let products: [Product]
    let onSelect: (Product) -> Void
    let onGestureLab: () -> Void

    var body: some View {
        List {
            Section("Test surfaces") {
                Button(action: onGestureLab) {
                    Label("Gesture Lab", systemImage: "hand.draw")
                        .font(.headline)
                        .padding(.vertical, 8)
                }
                .accessibilityIdentifier("catalog.gesture-lab")
            }

            Section("Products") {
                ForEach(products) { product in
                    Button {
                        onSelect(product)
                    } label: {
                        ProductRow(product: product)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("catalog.product.\(product.id)")
                }
            }
        }
        .navigationTitle("Catalog")
        .accessibilityIdentifier("catalog")
    }
}

private struct GestureLabView: View {
    @State private var scale = 1.0
    @State private var rotation = Angle.zero
    @State private var longPressCount = 0

    var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text("Native gesture target")
                    .font(.title2.bold())
                Text("Pinch, rotate, or hold the canvas. Atlas Loop records every action and its after-state.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            ZStack {
                RoundedRectangle(cornerRadius: 34, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [.indigo, .blue, .cyan],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                Circle()
                    .stroke(.white.opacity(0.7), lineWidth: 2)
                    .frame(width: 112, height: 112)
                Image(systemName: "rotate.3d")
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 230, height: 230)
            .scaleEffect(scale)
            .rotationEffect(rotation)
            .shadow(color: .blue.opacity(0.28), radius: 26, y: 16)
            .contentShape(Rectangle())
            .simultaneousGesture(
                MagnificationGesture()
                    .onChanged { scale = min(max($0, 0.55), 2.4) }
            )
            .simultaneousGesture(
                RotationGesture()
                    .onChanged { rotation = $0 }
            )
            .simultaneousGesture(
                LongPressGesture(minimumDuration: 0.55)
                    .onEnded { _ in longPressCount += 1 }
            )
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isButton)
            .accessibilityLabel("Native gesture canvas")
            .accessibilityValue("Scale \(scale, specifier: "%.2f"), rotation \(rotation.radians, specifier: "%.2f") radians, long presses \(longPressCount)")
            .accessibilityIdentifier("gesture-lab.canvas")

            HStack(spacing: 10) {
                GestureMetric(label: "Scale", value: scale.formatted(.number.precision(.fractionLength(2))))
                GestureMetric(label: "Radians", value: rotation.radians.formatted(.number.precision(.fractionLength(2))))
                GestureMetric(label: "Holds", value: String(longPressCount))
            }
            .accessibilityIdentifier("gesture-lab.metrics")

            Button("Reset canvas") {
                withAnimation(.snappy) {
                    scale = 1
                    rotation = .zero
                    longPressCount = 0
                }
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("gesture-lab.reset")

            Spacer(minLength: 0)
        }
        .padding(24)
        .navigationTitle("Gesture Lab")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct GestureMetric: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.headline.monospacedDigit())
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(.secondary.opacity(0.09), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

private struct ProductRow: View {
    let product: Product

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: product.symbolName)
                .font(.title2)
                .frame(width: 34, height: 34)
                .foregroundStyle(.blue)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text(product.name)
                    .font(.headline)
                Text(product.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text(product.priceText)
                .font(.headline)
        }
        .padding(.vertical, 8)
    }
}

private struct ProductDetailView: View {
    let product: Product
    let onAddToCart: (Product) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Image(systemName: product.symbolName)
                    .font(.system(size: 72, weight: .regular))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
                    .foregroundStyle(.blue)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Product Detail")
                        .font(.title.bold())
                    Text(product.name)
                        .font(.title3.weight(.semibold))
                    Text(product.details)
                        .foregroundStyle(.secondary)
                }

                HStack {
                    Text("Price")
                    Spacer()
                    Text(product.priceText)
                        .fontWeight(.semibold)
                }
                .font(.headline)

                Button {
                    onAddToCart(product)
                } label: {
                    Label("Add to Cart", systemImage: "cart.badge.plus")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("product-detail.add-to-cart")
            }
            .padding()
        }
        .navigationTitle(product.name)
        .accessibilityIdentifier("product-detail")
    }
}

private struct CartView: View {
    @Binding var cartLine: CartLine?
    let onContinue: () -> Void

    var body: some View {
        List {
            Section {
                if let cartLine {
                    LabeledContent("Item", value: cartLine.product.name)
                    LabeledContent("Quantity", value: "\(cartLine.quantity)")
                    LabeledContent("Subtotal", value: cartLine.subtotalText)
                    LabeledContent("Estimated tax", value: "$6.32")
                    LabeledContent("Total", value: cartLine.totalText)
                } else {
                    Text("Cart is empty")
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Cart")
            }

            Section {
                Button {
                    onContinue()
                } label: {
                    Label("Continue to Shipping", systemImage: "shippingbox")
                }
                .disabled(cartLine == nil)
                .accessibilityIdentifier("cart.continue")
            }
        }
        .navigationTitle("Cart")
        .accessibilityIdentifier("cart")
    }
}

private struct ShippingView: View {
    let details: ShippingDetails
    let onContinue: () -> Void

    var body: some View {
        List {
            Section("Shipping") {
                LabeledContent("Name", value: details.name)
                LabeledContent("Street", value: details.street)
                LabeledContent("City", value: details.cityLine)
                LabeledContent("Method", value: details.method)
            }

            Section {
                Button {
                    onContinue()
                } label: {
                    Label("Continue to Payment Review", systemImage: "creditcard")
                }
                .accessibilityIdentifier("shipping.continue")
            }
        }
        .navigationTitle("Shipping")
        .accessibilityIdentifier("shipping")
    }
}

private struct PaymentReviewView: View {
    @Binding var cartLine: CartLine?
    let shippingDetails: ShippingDetails
    let paymentMethod: PaymentMethod
    let onPlaceOrder: () -> Void

    var body: some View {
        List {
            Section("Payment Review") {
                LabeledContent("Payment", value: paymentMethod.label)
                LabeledContent("Billing", value: paymentMethod.billingLine)
                LabeledContent("Ship to", value: shippingDetails.name)
                LabeledContent("Total", value: cartLine?.totalText ?? "$0.00")
            }

            Section {
                Button {
                    onPlaceOrder()
                } label: {
                    Label("Place Order", systemImage: "checkmark.seal")
                }
                .disabled(cartLine == nil)
                .accessibilityIdentifier("payment-review.place-order")
            }
        }
        .navigationTitle("Payment Review")
        .accessibilityIdentifier("payment-review")
    }
}

private struct ConfirmationView: View {
    let order: OrderConfirmation

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.green)
                .accessibilityHidden(true)

            Text("Confirmation")
                .font(.largeTitle.bold())

            Text(order.orderNumber)
                .font(.title3.monospacedDigit().weight(.semibold))

            Text(order.message)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .navigationTitle("Confirmation")
        .accessibilityIdentifier("confirmation")
    }
}

#Preview {
    CheckoutRootView()
}
