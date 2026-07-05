import Foundation

enum DriverErrorCode: String {
    case invalidRequest
    case unknownCommand
    case invalidCoordinates
    case elementNotFound
    case elementNotHittable
    case noTargetApp
    case keyboardNotVisible
    case internalError

    var defaultRetryable: Bool {
        switch self {
        case .keyboardNotVisible:
            return true
        case .invalidRequest, .unknownCommand, .invalidCoordinates, .elementNotFound,
             .elementNotHittable, .noTargetApp, .internalError:
            return false
        }
    }
}

struct DriverError: Error {
    let code: DriverErrorCode
    let message: String
    let retryable: Bool
    let details: [String: Any]

    init(_ code: DriverErrorCode, _ message: String, retryable: Bool? = nil, details: [String: Any] = [:]) {
        self.code = code
        self.message = message
        self.retryable = retryable ?? code.defaultRetryable
        self.details = details
    }

    var payload: [String: Any] {
        var body: [String: Any] = [
            "code": code.rawValue,
            "message": message,
            "retryable": retryable
        ]
        if !details.isEmpty {
            body["details"] = details
        }
        return body
    }
}

struct DriverResponse {
    let id: String?
    let type: String?
    let ok: Bool
    let data: [String: Any]?
    let error: DriverError?

    static func success(id: String?, type: String?, data: [String: Any]? = nil) -> DriverResponse {
        DriverResponse(id: id, type: type, ok: true, data: data, error: nil)
    }

    static func failure(id: String?, type: String?, error: DriverError) -> DriverResponse {
        DriverResponse(id: id, type: type, ok: false, data: nil, error: error)
    }

    var payload: [String: Any] {
        var body: [String: Any] = ["ok": ok]
        if let id { body["id"] = id }
        if let type { body["type"] = type }
        if let data { body["data"] = data }
        if let error { body["error"] = error.payload }
        return body
    }
}
