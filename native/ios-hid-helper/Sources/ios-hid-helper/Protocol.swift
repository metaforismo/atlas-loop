import Foundation

enum CommandType: String, CaseIterable {
    case hello
    case attach
    case metrics
    case tap
    case typeText
    case swipe
    case edgeGesture
    case shutdown
}

struct CommandRequest {
    let id: String
    let type: String
    let command: CommandType
    let data: [String: JSONValue]
}

struct ParseFailure: Error {
    let id: String
    let type: String
    let error: HelperError
}

struct CommandResponse: Encodable {
    let id: String
    let type: String
    let ok: Bool
    let data: JSONValue?
    let error: ResponseError?

    static func success(id: String, type: String, data: JSONValue? = nil) -> CommandResponse {
        CommandResponse(id: id, type: type, ok: true, data: data, error: nil)
    }

    static func failure(id: String, type: String, error: HelperError) -> CommandResponse {
        CommandResponse(
            id: id,
            type: type,
            ok: false,
            data: nil,
            error: ResponseError(code: error.code, message: error.message, retryable: error.retryable)
        )
    }
}

struct ResponseError: Encodable {
    let code: String
    let message: String
    let retryable: Bool
}

struct HelperError: Error {
    let code: String
    let message: String
    let retryable: Bool

    static func invalidRequest(_ message: String) -> HelperError {
        HelperError(code: "invalidRequest", message: message, retryable: false)
    }

    static func invalidCoordinates(_ message: String) -> HelperError {
        HelperError(code: "invalidCoordinates", message: message, retryable: false)
    }

    static func unknownCommand(_ type: String) -> HelperError {
        HelperError(code: "unknownCommand", message: "Unknown command type '\(type)'", retryable: false)
    }

    static func windowNotFound(_ message: String) -> HelperError {
        HelperError(code: "windowNotFound", message: message, retryable: true)
    }

    static func notAttached() -> HelperError {
        HelperError(code: "notAttached", message: "Attach to a Simulator window before sending input", retryable: true)
    }

    static func permissionDenied(_ message: String) -> HelperError {
        HelperError(code: "permissionDenied", message: message, retryable: true)
    }

    static func backendUnavailable(_ message: String) -> HelperError {
        HelperError(code: "backendUnavailable", message: message, retryable: true)
    }

    static func internalError(_ message: String) -> HelperError {
        HelperError(code: "internalError", message: message, retryable: true)
    }
}

enum RequestParser {
    static func parse(_ line: String) -> Result<CommandRequest, ParseFailure> {
        guard let data = line.data(using: .utf8) else {
            return .failure(ParseFailure(id: "", type: "error", error: HelperError.invalidRequest("Request line is not valid UTF-8")))
        }

        let decodedValue: JSONValue
        do {
            decodedValue = try JSONDecoder().decode(JSONValue.self, from: data)
        } catch {
            return .failure(ParseFailure(id: "", type: "error", error: HelperError.invalidRequest("Request line is not valid JSON")))
        }

        guard let object = decodedValue.objectValue else {
            return .failure(ParseFailure(id: "", type: "error", error: HelperError.invalidRequest("Request must be a JSON object")))
        }

        let id = object.string("id") ?? ""
        let type = object.string("type") ?? "error"

        guard !id.isEmpty else {
            return .failure(ParseFailure(id: id, type: type, error: HelperError.invalidRequest("Request field 'id' must be a non-empty string")))
        }

        guard let typeValue = object.string("type"), !typeValue.isEmpty else {
            return .failure(ParseFailure(id: id, type: type, error: HelperError.invalidRequest("Request field 'type' must be a non-empty string")))
        }

        guard let command = CommandType(rawValue: typeValue) else {
            return .failure(ParseFailure(id: id, type: typeValue, error: HelperError.unknownCommand(typeValue)))
        }

        let payload: [String: JSONValue]
        if let dataValue = object["data"], dataValue != .null {
            guard let dataObject = dataValue.objectValue else {
                return .failure(ParseFailure(id: id, type: typeValue, error: HelperError.invalidRequest("Request field 'data' must be an object when present")))
            }
            payload = dataObject
        } else {
            payload = [:]
        }

        return .success(CommandRequest(id: id, type: typeValue, command: command, data: payload))
    }
}
