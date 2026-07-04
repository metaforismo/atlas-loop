import Foundation

let runtime = HelperRuntime()
let encoder = JSONEncoder()

while let line = readLine(strippingNewline: true) {
    guard !line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        continue
    }

    let response = runtime.handle(line: line)

    do {
        let data = try encoder.encode(response)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        logStderr("Unable to encode response: \(error)")
        let fallback = #"{"id":"","type":"error","ok":false,"error":{"code":"internalError","message":"Unable to encode response","retryable":true}}"#
        FileHandle.standardOutput.write(Data((fallback + "\n").utf8))
    }

    if runtime.shouldShutdown {
        break
    }
}
