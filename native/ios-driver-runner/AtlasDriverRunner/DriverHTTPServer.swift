import Foundation
import Network
#if canImport(UIKit)
import UIKit
#endif

let driverRunnerVersion = "0.1.0"

struct HTTPRequest {
    let method: String
    let path: String
    let body: Data

    /// Parses a buffered HTTP/1.1 request once the head and the full
    /// Content-Length body are available. Returns nil while incomplete.
    static func parse(from buffer: Data) -> HTTPRequest? {
        guard let headEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        guard let head = String(data: buffer[..<headEnd.lowerBound], encoding: .utf8) else { return nil }

        let lines = head.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }
        let requestParts = requestLine.split(separator: " ")
        guard requestParts.count >= 2 else { return nil }

        var contentLength = 0
        for line in lines.dropFirst() {
            let headerParts = line.split(separator: ":", maxSplits: 1)
            guard headerParts.count == 2 else { continue }
            if headerParts[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
                contentLength = Int(headerParts[1].trimmingCharacters(in: .whitespaces)) ?? 0
            }
        }

        let bodyStart = headEnd.upperBound
        let availableBody = buffer.count - bodyStart
        guard availableBody >= contentLength else { return nil }
        let body = buffer.subdata(in: bodyStart..<(bodyStart + contentLength))

        var path = String(requestParts[1])
        if let queryIndex = path.firstIndex(of: "?") {
            path = String(path[..<queryIndex])
        }

        return HTTPRequest(method: String(requestParts[0]).uppercased(), path: path, body: body)
    }
}

final class DriverHTTPServer {
    private let port: UInt16
    private let queue = DispatchQueue(label: "app.atlasloop.driver.http")
    private let startedAt = Date()
    private let screenInfo: [String: Any]
    private var listener: NWListener?

    var onShutdown: (() -> Void)?
    var controller: DriverController?

    init(port: UInt16) {
        self.port = port
        #if canImport(UIKit)
        // Captured once on the test thread; UIScreen must not be touched from
        // the listener queue.
        let screen = UIScreen.main
        self.screenInfo = [
            "width": Double(screen.bounds.width),
            "height": Double(screen.bounds.height),
            "scale": Double(screen.scale)
        ]
        #else
        self.screenInfo = [:]
        #endif
    }

    func start() throws {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw NSError(
                domain: "app.atlasloop.driver",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "invalid driver port \(port)"]
            )
        }

        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true

        let listener = try NWListener(using: parameters, on: nwPort)
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection: connection)
        }
        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func accept(connection: NWConnection) {
        connection.start(queue: queue)
        receiveRequest(on: connection, buffered: Data())
    }

    private func receiveRequest(on connection: NWConnection, buffered: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }

            var buffer = buffered
            if let data { buffer.append(data) }

            if let request = HTTPRequest.parse(from: buffer) {
                self.respond(to: request, on: connection)
                return
            }

            let oversized = buffer.count > 1_048_576
            if error != nil || isComplete || oversized {
                connection.cancel()
                return
            }

            self.receiveRequest(on: connection, buffered: buffer)
        }
    }

    private func respond(to request: HTTPRequest, on connection: NWConnection) {
        switch (request.method, request.path) {
        case ("GET", "/health"):
            send(status: "200 OK", payload: healthPayload(), on: connection)
        case ("POST", "/target"):
            guard let controller else {
                send(status: "503 Service Unavailable", payload: ["ok": false, "error": ["code": "internalError", "message": "driver controller is not attached", "retryable": true]], on: connection)
                return
            }
            // XCUITest APIs must run on the main thread; the driver loop's
            // XCTWaiter keeps the main run loop serviced while we block here.
            let response = DispatchQueue.main.sync { controller.handleTarget(body: request.body) }
            send(status: "200 OK", payload: response.payload, on: connection)
        case ("POST", "/command"):
            guard let controller else {
                send(status: "503 Service Unavailable", payload: ["ok": false, "error": ["code": "internalError", "message": "driver controller is not attached", "retryable": true]], on: connection)
                return
            }
            let response = DispatchQueue.main.sync { controller.handleCommand(body: request.body) }
            send(status: "200 OK", payload: response.payload, on: connection)
        case ("POST", "/shutdown"):
            send(status: "200 OK", payload: ["ok": true, "shuttingDown": true], on: connection)
            queue.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.onShutdown?()
            }
        default:
            send(
                status: "404 Not Found",
                payload: [
                    "ok": false,
                    "error": [
                        "code": "notFound",
                        "message": "route not found: \(request.method) \(request.path)",
                        "retryable": false
                    ]
                ],
                on: connection
            )
        }
    }

    private func healthPayload() -> [String: Any] {
        [
            "ok": true,
            "runnerVersion": driverRunnerVersion,
            "uptimeMs": Int(Date().timeIntervalSince(startedAt) * 1000),
            "screen": screenInfo
        ]
    }

    private func send(status: String, payload: [String: Any], on connection: NWConnection) {
        let body = (try? JSONSerialization.data(withJSONObject: payload)) ?? Data("{}".utf8)
        var response = Data("HTTP/1.1 \(status)\r\n".utf8)
        response.append(Data("content-type: application/json\r\n".utf8))
        response.append(Data("content-length: \(body.count)\r\n".utf8))
        response.append(Data("connection: close\r\n".utf8))
        response.append(Data("\r\n".utf8))
        response.append(body)

        connection.send(content: response, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
