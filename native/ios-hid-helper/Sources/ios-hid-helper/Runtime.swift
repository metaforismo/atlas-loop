import Foundation

final class HelperRuntime {
    private let backend: HIDBackend
    private(set) var shouldShutdown = false

    init(backend: HIDBackend = BackendFactory.makeDefaultBackend()) {
        self.backend = backend
    }

    func handle(line: String) -> CommandResponse {
        switch RequestParser.parse(line) {
        case .success(let request):
            return handle(request: request)
        case .failure(let failure):
            logStderr("Rejected request: \(failure.error.code) \(failure.error.message)")
            return .failure(id: failure.id, type: failure.type, error: failure.error)
        }
    }

    private func handle(request: CommandRequest) -> CommandResponse {
        do {
            switch request.command {
            case .hello:
                return .success(id: request.id, type: request.type, data: helloData())
            case .attach:
                return .success(id: request.id, type: request.type, data: try backend.attach(options: AttachOptions(data: request.data)))
            case .metrics:
                return .success(id: request.id, type: request.type, data: backend.metrics())
            case .tap:
                try backend.tap(TapCommand(data: request.data))
                return .success(id: request.id, type: request.type, data: actionData())
            case .typeText:
                try backend.typeText(TypeTextCommand(data: request.data))
                return .success(id: request.id, type: request.type, data: actionData())
            case .swipe:
                try backend.swipe(SwipeCommand(data: request.data))
                return .success(id: request.id, type: request.type, data: actionData())
            case .edgeGesture:
                let command = try EdgeGestureCommand(data: request.data)
                try backend.swipe(command.asSwipeCommand())
                return .success(id: request.id, type: request.type, data: actionData())
            case .shutdown:
                backend.shutdown()
                shouldShutdown = true
                return .success(
                    id: request.id,
                    type: request.type,
                    data: .object([
                        "backend": .string(backend.name),
                        "shuttingDown": .bool(true)
                    ])
                )
            }
        } catch let error as HelperError {
            logStderr("Command \(request.type) failed: \(error.code) \(error.message)")
            return .failure(id: request.id, type: request.type, error: error)
        } catch {
            logStderr("Command \(request.type) failed with unexpected error: \(error)")
            return .failure(id: request.id, type: request.type, error: .internalError(String(describing: error)))
        }
    }

    private func helloData() -> JSONValue {
        .object([
            "protocolVersion": .number(1),
            "backend": .string(backend.name),
            "privateBackendAvailable": .bool(backend.privateBackendAvailable),
            "commands": .array(CommandType.allCases.map { .string($0.rawValue) })
        ])
    }

    private func actionData() -> JSONValue {
        var payload: [String: JSONValue] = [
            "backend": .string(backend.name)
        ]

        if let attachment = backend.currentAttachment {
            payload["attachment"] = attachment.json
        }

        return .object(payload)
    }
}
