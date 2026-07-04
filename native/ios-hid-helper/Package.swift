// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "ios-hid-helper",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "ios-hid-helper", targets: ["ios-hid-helper"])
    ],
    targets: [
        .executableTarget(
            name: "ios-hid-helper",
            path: "Sources/ios-hid-helper"
        )
    ]
)
