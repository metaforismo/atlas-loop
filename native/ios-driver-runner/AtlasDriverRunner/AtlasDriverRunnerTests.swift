import XCTest

/// Atlas Loop driver runner.
///
/// This is not a conventional test: `testRunDriverLoop` starts a local HTTP
/// server inside the simulator and blocks until a `POST /shutdown` arrives.
/// The daemon launches it with `xcodebuild test-without-building` and drives
/// input through the HTTP surface, following the WebDriverAgent pattern.
final class AtlasDriverRunnerTests: XCTestCase {
    func testRunDriverLoop() throws {
        let environment = ProcessInfo.processInfo.environment
        let port = UInt16(environment["ATLAS_DRIVER_PORT"] ?? "") ?? 4700

        let server = DriverHTTPServer(port: port)
        let shutdownExpectation = expectation(description: "atlas-driver-shutdown")
        server.onShutdown = { shutdownExpectation.fulfill() }

        try server.start()
        defer { server.stop() }

        // Serve until an explicit shutdown. The timeout is a safety backstop so a
        // forgotten runner does not survive for weeks; the daemon always shuts the
        // runner down (or kills the xcodebuild child) long before this fires.
        let sevenDays: TimeInterval = 7 * 24 * 60 * 60
        let result = XCTWaiter.wait(for: [shutdownExpectation], timeout: sevenDays)
        XCTAssertTrue(
            result == .completed || result == .timedOut,
            "driver loop ended unexpectedly: \(result)"
        )
    }
}
