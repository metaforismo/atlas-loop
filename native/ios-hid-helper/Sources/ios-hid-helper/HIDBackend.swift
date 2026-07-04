import Foundation

protocol HIDBackend: AnyObject {
    var name: String { get }
    var privateBackendAvailable: Bool { get }
    var currentAttachment: WindowAttachment? { get }

    func attach(options: AttachOptions) throws -> JSONValue
    func metrics() -> JSONValue
    func tap(_ command: TapCommand) throws
    func typeText(_ command: TypeTextCommand) throws
    func swipe(_ command: SwipeCommand) throws
    func shutdown()
}

enum BackendFactory {
    static func makeDefaultBackend() -> HIDBackend {
        CGEventSimulatorWindowBackend()
    }
}

final class PrivateSimulatorHIDBackendSlot {
    let name = "private-simulator-hid"
    let available = false

    func unavailableError() -> HelperError {
        .backendUnavailable("Private Simulator HID backend is not available in v1")
    }
}
