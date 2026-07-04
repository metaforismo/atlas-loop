import AppKit
import ApplicationServices
import CoreGraphics
import Darwin
import Foundation

final class CGEventSimulatorWindowBackend: HIDBackend {
    let name = "macos-cgevent-simulator-window"
    let privateBackendAvailable = false

    private(set) var currentAttachment: WindowAttachment?
    private let eventSource = CGEventSource(stateID: .hidSystemState)

    func attach(options: AttachOptions) throws -> JSONValue {
        guard let attachment = findBestWindow(options: options) else {
            throw HelperError.windowNotFound(
                "No visible \(options.appName) window matched attach options",
                details: attachFailureDetails(options: options)
            )
        }

        currentAttachment = attachment
        activateAttachedApplication()

        return .object([
            "backend": .string(name),
            "attachment": attachment.json,
            "accessibilityTrusted": .bool(AXIsProcessTrusted())
        ])
    }

    func metrics() -> JSONValue {
        let trusted = AXIsProcessTrusted()
        var payload: [String: JSONValue] = [
            "backend": .string(name),
            "privateBackendAvailable": .bool(privateBackendAvailable),
            "accessibilityTrusted": .bool(trusted),
            "process": .object([
                "pid": .number(Double(ProcessInfo.processInfo.processIdentifier)),
                "executable": .string(CommandLine.arguments.first ?? "ios-hid-helper")
            ]),
            "diagnostics": diagnostics(accessibilityTrusted: trusted)
        ]

        if let currentAttachment {
            payload["attachment"] = currentAttachment.json
        }

        return .object(payload)
    }

    func tap(_ command: TapCommand) throws {
        try requireAccessibilityTrust()
        let location = try screenPoint(for: command.point)
        let button = command.button.cgMouseButton
        let downType = command.button.downEventType
        let upType = command.button.upEventType

        postMouse(type: .mouseMoved, location: location, button: button)

        for clickIndex in 1...command.clickCount {
            postMouse(type: downType, location: location, button: button, clickState: clickIndex)
            usleep(35_000)
            postMouse(type: upType, location: location, button: button, clickState: clickIndex)
            if clickIndex < command.clickCount {
                usleep(70_000)
            }
        }
    }

    func typeText(_ command: TypeTextCommand) throws {
        try requireAccessibilityTrust()
        _ = try requireAttachment()

        for character in command.text {
            let utf16 = Array(String(character).utf16)
            try utf16.withUnsafeBufferPointer { buffer in
                guard let baseAddress = buffer.baseAddress else {
                    return
                }
                guard let keyDown = CGEvent(keyboardEventSource: eventSource, virtualKey: 0, keyDown: true),
                      let keyUp = CGEvent(keyboardEventSource: eventSource, virtualKey: 0, keyDown: false) else {
                    throw HelperError.internalError("Unable to create keyboard event")
                }

                keyDown.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: baseAddress)
                postEvent(keyDown)

                keyUp.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: baseAddress)
                postEvent(keyUp)
            }
            usleep(8_000)
        }
    }

    func swipe(_ command: SwipeCommand) throws {
        try requireAccessibilityTrust()
        let start = try screenPoint(for: command.start)
        let end = try screenPoint(for: command.end)

        postMouse(type: .mouseMoved, location: start, button: .left)
        usleep(20_000)
        postMouse(type: .leftMouseDown, location: start, button: .left, clickState: 1)

        let steps = max(2, min(120, max(1, command.durationMs / 16)))
        let sleepMicros = command.durationMs == 0 ? 0 : UInt32((command.durationMs * 1_000) / steps)

        for index in 1...steps {
            let progress = CGFloat(index) / CGFloat(steps)
            let location = CGPoint(
                x: start.x + ((end.x - start.x) * progress),
                y: start.y + ((end.y - start.y) * progress)
            )
            postMouse(type: .leftMouseDragged, location: location, button: .left, clickState: 1)
            if sleepMicros > 0 {
                usleep(sleepMicros)
            }
        }

        postMouse(type: .leftMouseUp, location: end, button: .left, clickState: 1)
    }

    func shutdown() {
        currentAttachment = nil
    }
}

private extension CGEventSimulatorWindowBackend {
    func findBestWindow(options: AttachOptions) -> WindowAttachment? {
        return matchingWindows(options: options).max { first, second in
            (first.bounds.width * first.bounds.height) < (second.bounds.width * second.bounds.height)
        }
    }

    func matchingWindows(options: AttachOptions) -> [WindowAttachment] {
        guard let rawWindows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            return []
        }

        return rawWindows.compactMap { windowInfo -> WindowAttachment? in
            guard let ownerName = windowInfo.stringValue(kCGWindowOwnerName),
                  ownerName.localizedCaseInsensitiveContains(options.appName),
                  windowInfo.intValue(kCGWindowLayer) == 0,
                  let windowID = windowInfo.uint32Value(kCGWindowNumber),
                  let ownerPID = windowInfo.pidValue(kCGWindowOwnerPID),
                  let bounds = windowInfo.cgRectValue(kCGWindowBounds),
                  bounds.width >= 40,
                  bounds.height >= 40 else {
                return nil
            }

            let title = windowInfo.stringValue(kCGWindowName) ?? ""
            if let titleFilter = options.windowTitleContains,
               !title.localizedCaseInsensitiveContains(titleFilter) {
                return nil
            }

            return WindowAttachment(
                windowID: windowID,
                ownerPID: ownerPID,
                ownerName: ownerName,
                title: title,
                bounds: bounds
            )
        }
    }

    func activateAttachedApplication() {
        guard let currentAttachment,
              let app = NSRunningApplication(processIdentifier: currentAttachment.ownerPID) else {
            return
        }
        app.activate(options: [.activateIgnoringOtherApps])
    }

    func requireAttachment() throws -> WindowAttachment {
        guard let currentAttachment else {
            throw HelperError.notAttached()
        }
        return currentAttachment
    }

    func requireAccessibilityTrust() throws {
        guard AXIsProcessTrusted() else {
            throw HelperError.permissionDenied("Enable Accessibility permission for this helper process to post events")
        }
    }

    func diagnostics(accessibilityTrusted: Bool) -> JSONValue {
        var checks: [JSONValue] = [
            .object([
                "name": .string("accessibility"),
                "ok": .bool(accessibilityTrusted),
                "message": .string(accessibilityTrusted ? "Accessibility permission is granted" : "Accessibility permission is required before posting CGEvents")
            ]),
            .object([
                "name": .string("attachment"),
                "ok": .bool(currentAttachment != nil),
                "message": .string(currentAttachment == nil ? "No Simulator window is attached" : "Simulator window is attached")
            ]),
            .object([
                "name": .string("delivery"),
                "ok": .bool(accessibilityTrusted && currentAttachment != nil),
                "message": .string("CGEvent posting is host-gated; successful posting does not prove the guest app consumed input")
            ])
        ]

        if let currentAttachment,
           let app = NSRunningApplication(processIdentifier: currentAttachment.ownerPID) {
            checks.append(.object([
                "name": .string("applicationActive"),
                "ok": .bool(app.isActive),
                "message": .string(app.isActive ? "Attached Simulator application is active" : "Attached Simulator application is not frontmost")
            ]))
        }

        return .object([
            "readyForInput": .bool(accessibilityTrusted && currentAttachment != nil),
            "hostGated": .bool(true),
            "checks": .array(checks)
        ])
    }

    func attachFailureDetails(options: AttachOptions) -> [String: JSONValue] {
        var requested: [String: JSONValue] = [
            "appName": .string(options.appName)
        ]
        if let windowTitleContains = options.windowTitleContains {
            requested["windowTitleContains"] = .string(windowTitleContains)
        }

        let matchesWithoutTitle = matchingWindows(options: AttachOptions(
            appName: options.appName,
            windowTitleContains: nil
        ))

        return [
            "category": .string("windowDiscovery"),
            "requested": .object(requested),
            "accessibilityTrusted": .bool(AXIsProcessTrusted()),
            "matchingWindowCount": .number(Double(matchesWithoutTitle.count)),
            "remediation": .string("Open a visible Simulator window on the active desktop, or relax windowTitleContains")
        ]
    }

    func screenPoint(for point: NormalizedPoint) throws -> CGPoint {
        let attachment = try requireAttachment()
        return CGPoint(
            x: attachment.bounds.origin.x + (attachment.bounds.width * CGFloat(point.x)),
            y: attachment.bounds.origin.y + (attachment.bounds.height * CGFloat(point.y))
        )
    }

    func postMouse(type: CGEventType, location: CGPoint, button: CGMouseButton, clickState: Int = 0) {
        guard let event = CGEvent(
            mouseEventSource: eventSource,
            mouseType: type,
            mouseCursorPosition: location,
            mouseButton: button
        ) else {
            logStderr("Unable to create mouse event \(type.rawValue)")
            return
        }

        if clickState > 0 {
            event.setIntegerValueField(.mouseEventClickState, value: Int64(clickState))
        }

        postEvent(event)
    }

    func postEvent(_ event: CGEvent) {
        event.post(tap: .cgSessionEventTap)
        if let currentAttachment {
            event.postToPid(currentAttachment.ownerPID)
        } else {
            event.post(tap: .cghidEventTap)
        }
    }
}

private extension MouseButton {
    var cgMouseButton: CGMouseButton {
        switch self {
        case .left:
            return .left
        case .right:
            return .right
        }
    }

    var downEventType: CGEventType {
        switch self {
        case .left:
            return .leftMouseDown
        case .right:
            return .rightMouseDown
        }
    }

    var upEventType: CGEventType {
        switch self {
        case .left:
            return .leftMouseUp
        case .right:
            return .rightMouseUp
        }
    }
}

private extension Dictionary where Key == String, Value == Any {
    func stringValue(_ key: CFString) -> String? {
        self[key as String] as? String
    }

    func intValue(_ key: CFString) -> Int? {
        if let value = self[key as String] as? Int {
            return value
        }
        return (self[key as String] as? NSNumber)?.intValue
    }

    func uint32Value(_ key: CFString) -> UInt32? {
        if let value = self[key as String] as? UInt32 {
            return value
        }
        return (self[key as String] as? NSNumber)?.uint32Value
    }

    func pidValue(_ key: CFString) -> pid_t? {
        if let value = self[key as String] as? pid_t {
            return value
        }
        return (self[key as String] as? NSNumber)?.int32Value
    }

    func cgRectValue(_ key: CFString) -> CGRect? {
        guard let dictionary = self[key as String] as? NSDictionary else {
            return nil
        }
        return CGRect(dictionaryRepresentation: dictionary)
    }
}
