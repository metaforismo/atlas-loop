import Foundation
import XCTest
#if canImport(UIKit)
import UIKit
#endif

/// Keeps the runner process from being suspended while it sits in the
/// background behind the app under automation.
///
/// Two complementary mechanisms:
/// - a UIKit background task that is renewed whenever it is about to expire,
///   which is the documented way to extend background execution; and
/// - a repeating main-run-loop timer that performs a trivial XCUITest query,
///   keeping the testmanagerd session demonstrably active. XCTWaiter services
///   the main run loop while the driver loop waits, so the timer fires.
final class DriverKeepAlive {
    #if canImport(UIKit)
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    #endif
    private var heartbeatTimer: Timer?

    func start() {
        renewBackgroundTask()
        let timer = Timer(timeInterval: 15, repeats: true) { _ in
            // A cheap device read keeps the automation session warm.
            _ = XCUIDevice.shared.orientation
        }
        RunLoop.main.add(timer, forMode: .common)
        heartbeatTimer = timer
    }

    func stop() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
        #if canImport(UIKit)
        if backgroundTask != .invalid {
            UIApplication.shared.endBackgroundTask(backgroundTask)
            backgroundTask = .invalid
        }
        #endif
    }

    private func renewBackgroundTask() {
        #if canImport(UIKit)
        let previous = backgroundTask
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "atlas-driver-loop") { [weak self] in
            self?.renewBackgroundTask()
        }
        if previous != .invalid {
            UIApplication.shared.endBackgroundTask(previous)
        }
        #endif
    }
}
