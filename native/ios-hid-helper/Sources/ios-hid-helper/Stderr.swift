import Foundation

func logStderr(_ message: String) {
    FileHandle.standardError.write(Data(("[ios-hid-helper] \(message)\n").utf8))
}
