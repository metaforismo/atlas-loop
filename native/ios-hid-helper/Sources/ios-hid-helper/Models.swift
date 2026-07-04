import CoreGraphics
import Foundation

struct NormalizedPoint {
    let x: Double
    let y: Double

    init(x: Double, y: Double) throws {
        guard x.isFinite, y.isFinite else {
            throw HelperError.invalidCoordinates("Coordinates must be finite numbers")
        }
        guard (0.0...1.0).contains(x) else {
            throw HelperError.invalidCoordinates("x must be in the closed range 0...1")
        }
        guard (0.0...1.0).contains(y) else {
            throw HelperError.invalidCoordinates("y must be in the closed range 0...1")
        }
        self.x = x
        self.y = y
    }
}

struct AttachOptions {
    let appName: String
    let windowTitleContains: String?

    init(data: [String: JSONValue]) {
        appName = data.string("appName") ?? "Simulator"
        windowTitleContains = data.string("windowTitleContains")
    }
}

struct TapCommand {
    let point: NormalizedPoint
    let button: MouseButton
    let clickCount: Int

    init(data: [String: JSONValue]) throws {
        point = try NormalizedPoint.required(from: data, xKey: "x", yKey: "y")
        button = try MouseButton.parse(data.string("button") ?? "left")
        clickCount = try CommandValidation.int(data.int("clickCount") ?? 1, name: "clickCount", range: 1...3)
    }
}

struct TypeTextCommand {
    let text: String

    init(data: [String: JSONValue]) throws {
        guard let text = data.string("text") else {
            throw HelperError.invalidRequest("typeText requires data.text")
        }
        guard text.count <= 4_096 else {
            throw HelperError.invalidRequest("typeText data.text must not exceed 4096 characters")
        }
        self.text = text
    }
}

struct SwipeCommand {
    let start: NormalizedPoint
    let end: NormalizedPoint
    let durationMs: Int

    init(start: NormalizedPoint, end: NormalizedPoint, durationMs: Int) {
        self.start = start
        self.end = end
        self.durationMs = durationMs
    }

    init(data: [String: JSONValue]) throws {
        start = try NormalizedPoint.required(from: data, xKey: "startX", yKey: "startY")
        end = try NormalizedPoint.required(from: data, xKey: "endX", yKey: "endY")
        durationMs = try CommandValidation.int(data.int("durationMs") ?? 250, name: "durationMs", range: 0...5_000)
    }
}

struct EdgeGestureCommand {
    let edge: Edge
    let distance: Double
    let position: Double
    let durationMs: Int

    init(data: [String: JSONValue]) throws {
        guard let edgeValue = data.string("edge") else {
            throw HelperError.invalidRequest("edgeGesture requires data.edge")
        }
        edge = try Edge.parse(edgeValue)

        let distance = data.double("distance") ?? 0.75
        guard distance.isFinite, (0.01...1.0).contains(distance) else {
            throw HelperError.invalidCoordinates("edgeGesture distance must be in the closed range 0.01...1")
        }
        self.distance = distance

        let position = data.double("position") ?? 0.5
        guard position.isFinite, (0.0...1.0).contains(position) else {
            throw HelperError.invalidCoordinates("edgeGesture position must be in the closed range 0...1")
        }
        self.position = position

        durationMs = try CommandValidation.int(data.int("durationMs") ?? 300, name: "durationMs", range: 0...5_000)
    }

    func asSwipeCommand() throws -> SwipeCommand {
        let inset = 0.005

        let start: NormalizedPoint
        let end: NormalizedPoint

        switch edge {
        case .left:
            start = try NormalizedPoint(x: inset, y: position)
            end = try NormalizedPoint(x: min(distance, 1.0), y: position)
        case .right:
            start = try NormalizedPoint(x: 1.0 - inset, y: position)
            end = try NormalizedPoint(x: max(1.0 - distance, 0.0), y: position)
        case .top:
            start = try NormalizedPoint(x: position, y: inset)
            end = try NormalizedPoint(x: position, y: min(distance, 1.0))
        case .bottom:
            start = try NormalizedPoint(x: position, y: 1.0 - inset)
            end = try NormalizedPoint(x: position, y: max(1.0 - distance, 0.0))
        }

        return SwipeCommand(start: start, end: end, durationMs: durationMs)
    }
}

struct WindowAttachment {
    let windowID: UInt32
    let ownerPID: pid_t
    let ownerName: String
    let title: String
    let bounds: CGRect
}

enum MouseButton: String {
    case left
    case right

    static func parse(_ rawValue: String) throws -> MouseButton {
        guard let value = MouseButton(rawValue: rawValue) else {
            throw HelperError.invalidRequest("button must be 'left' or 'right'")
        }
        return value
    }
}

enum Edge: String {
    case left
    case right
    case top
    case bottom

    static func parse(_ rawValue: String) throws -> Edge {
        guard let value = Edge(rawValue: rawValue) else {
            throw HelperError.invalidRequest("edge must be one of left, right, top, bottom")
        }
        return value
    }
}

enum CommandValidation {
    static func int(_ value: Int, name: String, range: ClosedRange<Int>) throws -> Int {
        guard range.contains(value) else {
            throw HelperError.invalidRequest("\(name) must be in the closed range \(range.lowerBound)...\(range.upperBound)")
        }
        return value
    }
}

extension NormalizedPoint {
    static func required(from data: [String: JSONValue], xKey: String, yKey: String) throws -> NormalizedPoint {
        guard let x = data.double(xKey) else {
            throw HelperError.invalidRequest("Missing numeric field data.\(xKey)")
        }
        guard let y = data.double(yKey) else {
            throw HelperError.invalidRequest("Missing numeric field data.\(yKey)")
        }
        return try NormalizedPoint(x: x, y: y)
    }
}

extension WindowAttachment {
    var json: JSONValue {
        .object([
            "windowID": .number(Double(windowID)),
            "ownerPID": .number(Double(ownerPID)),
            "ownerName": .string(ownerName),
            "title": .string(title),
            "bounds": .object([
                "x": .number(Double(bounds.origin.x)),
                "y": .number(Double(bounds.origin.y)),
                "width": .number(Double(bounds.size.width)),
                "height": .number(Double(bounds.size.height))
            ])
        ])
    }
}
