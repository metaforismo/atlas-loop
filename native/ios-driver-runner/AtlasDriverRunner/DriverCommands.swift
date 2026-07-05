import Foundation
import XCTest

/// Executes /target and /command requests. Every entry point must run on the
/// main thread: the driver loop's XCTWaiter keeps the main run loop spinning,
/// and XCUITest queries are only safe there.
final class DriverController {
    private var targetApp: XCUIApplication?
    private var targetBundleId: String?

    private static let defaultElementTimeout: TimeInterval = 5.0

    func handleTarget(body: Data) -> DriverResponse {
        guard let json = parseJson(body), let bundleId = json["bundleId"] as? String, !bundleId.isEmpty else {
            return .failure(id: requestId(from: body), type: "target", error: DriverError(.invalidRequest, "target requires a non-empty bundleId"))
        }

        let app = XCUIApplication(bundleIdentifier: bundleId)
        if app.state != .runningForeground {
            app.activate()
        }
        targetApp = app
        targetBundleId = bundleId

        return .success(id: requestId(from: body), type: "target", data: [
            "bundleId": bundleId,
            "state": String(describing: app.state.rawValue)
        ])
    }

    func handleCommand(body: Data) -> DriverResponse {
        guard let json = parseJson(body) else {
            return .failure(id: nil, type: nil, error: DriverError(.invalidRequest, "command body must be a JSON object"))
        }
        let id = json["id"] as? String
        guard let kind = json["kind"] as? String, !kind.isEmpty else {
            return .failure(id: id, type: nil, error: DriverError(.invalidRequest, "command requires a kind"))
        }

        do {
            let data = try execute(kind: kind, json: json)
            return .success(id: id, type: kind, data: data)
        } catch let error as DriverError {
            return .failure(id: id, type: kind, error: error)
        } catch {
            return .failure(id: id, type: kind, error: DriverError(.internalError, String(describing: error)))
        }
    }

    private func execute(kind: String, json: [String: Any]) throws -> [String: Any]? {
        switch kind {
        case "tap":
            let point = try normalizedPoint(x: json["x"], y: json["y"], label: "tap")
            let app = try requireTargetApp()
            app.coordinate(withNormalizedOffset: point).tap()
            return nil
        case "typeText":
            guard let text = json["text"] as? String, !text.isEmpty else {
                throw DriverError(.invalidRequest, "typeText requires non-empty text")
            }
            let app = try requireTargetApp()
            guard app.keyboards.count > 0 else {
                throw DriverError(.keyboardNotVisible, "no keyboard is visible; focus a text input before typeText")
            }
            app.typeText(text)
            return nil
        case "swipe":
            let from = try normalizedPoint(from: json["from"], label: "swipe.from")
            let to = try normalizedPoint(from: json["to"], label: "swipe.to")
            let durationMs = (json["durationMs"] as? NSNumber)?.doubleValue ?? 350
            guard durationMs >= 0 else {
                throw DriverError(.invalidRequest, "swipe duration must be non-negative")
            }
            let app = try requireTargetApp()
            try performDrag(app: app, from: from, to: to, durationMs: durationMs)
            return nil
        case "edgeGesture":
            guard let edge = json["edge"] as? String, let start = edgeStartVector(edge: edge) else {
                throw DriverError(.invalidRequest, "edgeGesture edge must be left, right, top, or bottom")
            }
            let distanceValue = (json["distance"] as? NSNumber)?.doubleValue ?? 0.5
            guard distanceValue >= 0, distanceValue <= 1 else {
                throw DriverError(.invalidCoordinates, "edgeGesture distance must be 0..1")
            }
            let durationMs = (json["durationMs"] as? NSNumber)?.doubleValue ?? 350
            let end = edgeEndVector(edge: edge, start: start, distance: distanceValue)
            let app = try requireTargetApp()
            try performDrag(app: app, from: start, to: end, durationMs: durationMs)
            return nil
        case "tapElement":
            let (element, frame) = try resolveElement(json: json, kind: kind)
            guard frame.width > 0, frame.height > 0 else {
                throw DriverError(.elementNotHittable, "element \(identifierText(json)) exists but has an empty frame", details: ["frame": frameDictionary(frame)])
            }
            // XCUIElement.tap() silently drops events for apps this test did
            // not launch itself (the daemon launches via simctl); synthesized
            // coordinate taps always land, so tap the element's frame center.
            // isHittable is recorded as evidence but not required: it flaps on
            // SwiftUI list rows even when the coordinate tap succeeds.
            let wasHittable = element.isHittable
            let app = try requireTargetApp()
            let tapPoint = try normalizedOffset(of: CGPoint(x: frame.midX, y: frame.midY), in: app)
            app.coordinate(withNormalizedOffset: tapPoint).tap()
            return ["identifier": identifierText(json), "frame": frameDictionary(frame), "wasHittable": wasHittable]
        case "assertVisible":
            let (element, frame) = try resolveElement(json: json, kind: kind)
            return [
                "identifier": identifierText(json),
                "exists": true,
                "isHittable": element.isHittable,
                "label": element.label,
                "frame": frameDictionary(frame)
            ]
        default:
            throw DriverError(.unknownCommand, "unknown command kind: \(kind)")
        }
    }

    private func requireTargetApp() throws -> XCUIApplication {
        guard let app = targetApp else {
            throw DriverError(.noTargetApp, "no target app set; POST /target with a bundleId first")
        }
        if app.state != .runningForeground {
            app.activate()
        }
        return app
    }

    private func resolveElement(json: [String: Any], kind: String) throws -> (XCUIElement, CGRect) {
        guard let identifier = json["identifier"] as? String, !identifier.trimmingCharacters(in: .whitespaces).isEmpty else {
            throw DriverError(.invalidRequest, "\(kind) requires a non-empty identifier")
        }
        let timeoutMs = (json["timeoutMs"] as? NSNumber)?.doubleValue
        let timeout = timeoutMs.map { max(0, $0 / 1000) } ?? Self.defaultElementTimeout

        let app = try requireTargetApp()
        let element = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
        guard element.waitForExistence(timeout: timeout) else {
            throw DriverError(.elementNotFound, "no element with identifier \(identifier) appeared within \(Int(timeout * 1000))ms", details: ["identifier": identifier, "timeoutMs": Int(timeout * 1000)])
        }
        return (element, element.frame)
    }

    private func performDrag(app: XCUIApplication, from: CGVector, to: CGVector, durationMs: Double) throws {
        let start = app.coordinate(withNormalizedOffset: from)
        let end = app.coordinate(withNormalizedOffset: to)
        let frame = app.frame
        let dx = (to.dx - from.dx) * frame.width
        let dy = (to.dy - from.dy) * frame.height
        let distance = (dx * dx + dy * dy).squareRoot()
        let seconds = max(0.05, durationMs / 1000)
        let velocity = XCUIGestureVelocity(rawValue: max(100, min(5000, distance / seconds)))
        start.press(forDuration: 0.05, thenDragTo: end, withVelocity: velocity, thenHoldForDuration: 0.05)
    }

    private func normalizedPoint(x: Any?, y: Any?, label: String) throws -> CGVector {
        guard let xValue = (x as? NSNumber)?.doubleValue, let yValue = (y as? NSNumber)?.doubleValue else {
            throw DriverError(.invalidRequest, "\(label) requires numeric x and y")
        }
        return try validatedVector(x: xValue, y: yValue, label: label)
    }

    private func normalizedPoint(from json: Any?, label: String) throws -> CGVector {
        guard let point = json as? [String: Any] else {
            throw DriverError(.invalidRequest, "\(label) requires an object with x and y")
        }
        return try normalizedPoint(x: point["x"], y: point["y"], label: label)
    }

    private func normalizedOffset(of point: CGPoint, in app: XCUIApplication) throws -> CGVector {
        let appFrame = app.frame
        guard appFrame.width > 0, appFrame.height > 0 else {
            throw DriverError(.internalError, "target app frame is empty; cannot compute tap coordinates")
        }
        let dx = min(1, max(0, (point.x - appFrame.minX) / appFrame.width))
        let dy = min(1, max(0, (point.y - appFrame.minY) / appFrame.height))
        return CGVector(dx: dx, dy: dy)
    }

    private func validatedVector(x: Double, y: Double, label: String) throws -> CGVector {
        guard x >= 0, x <= 1, y >= 0, y <= 1, x.isFinite, y.isFinite else {
            throw DriverError(.invalidCoordinates, "\(label) must use normalized coordinates between 0 and 1")
        }
        return CGVector(dx: x, dy: y)
    }

    private func edgeStartVector(edge: String) -> CGVector? {
        switch edge {
        case "left": return CGVector(dx: 0.001, dy: 0.5)
        case "right": return CGVector(dx: 0.999, dy: 0.5)
        case "top": return CGVector(dx: 0.5, dy: 0.001)
        case "bottom": return CGVector(dx: 0.5, dy: 0.999)
        default: return nil
        }
    }

    private func edgeEndVector(edge: String, start: CGVector, distance: Double) -> CGVector {
        switch edge {
        case "left": return CGVector(dx: min(1, start.dx + distance), dy: start.dy)
        case "right": return CGVector(dx: max(0, start.dx - distance), dy: start.dy)
        case "top": return CGVector(dx: start.dx, dy: min(1, start.dy + distance))
        default: return CGVector(dx: start.dx, dy: max(0, start.dy - distance))
        }
    }

    private func frameDictionary(_ frame: CGRect) -> [String: Any] {
        [
            "x": Double(frame.origin.x),
            "y": Double(frame.origin.y),
            "width": Double(frame.size.width),
            "height": Double(frame.size.height)
        ]
    }

    private func identifierText(_ json: [String: Any]) -> String {
        (json["identifier"] as? String) ?? ""
    }

    private func parseJson(_ body: Data) -> [String: Any]? {
        guard !body.isEmpty else { return [:] }
        return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }

    private func requestId(from body: Data) -> String? {
        parseJson(body)?["id"] as? String
    }
}
