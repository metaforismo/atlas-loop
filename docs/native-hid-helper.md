# Native HID Helper

The native HID helper is the optional macOS component that can send low-level input to a booted iOS Simulator when higher-level automation is not enough.

## Expected Location

The default config points to:

```text
native/ios-hid-helper/.build/debug/ios-hid-helper
```

If `native/ios-hid-helper/Package.swift` exists, `scripts/smoke-ios.sh` attempts:

```sh
swift build --package-path native/ios-hid-helper
```

When the helper source is absent, the smoke script reports a clear skip for the helper build and continues with other available checks.

## Operating Model

The helper should:

- Run only on macOS.
- Target a caller-supplied booted Simulator UDID.
- Accept normalized or pixel coordinates from the daemon after validation.
- Return structured NDJSON errors for failed HID operations.
- Avoid writing outside the active session artifact directory.

The v1 backend attaches to the visible Simulator app window and posts CGEvents to
that process. The host must allow Accessibility control for the helper process,
and the Simulator window must be visible on an active desktop. Some Simulator,
display, or permission combinations can report successful event posting while the
guest app does not consume the click; Atlas Loop records those actions as local
evidence rather than hiding the host limitation.

## Smoke Requirements

Simulator smoke is gated off by default from `scripts/verify-local.sh`. Run it explicitly with:

```sh
bash scripts/verify-local.sh --smoke-ios
```

or:

```sh
ATLAS_LOOP_RUN_IOS_SMOKE=1 npm run verify:local
```

By default, `scripts/smoke-ios.sh` exits successfully with a `SKIP` message when macOS, Xcode, `simctl`, a booted Simulator, or daemon/CLI sources are unavailable. Set `ATLAS_LOOP_SMOKE_REQUIRE=1` to turn those skips into failures for dedicated Simulator environments.

The default smoke validates build/install/launch/screenshot artifacts. Primitive
coordinate actions are exposed by the daemon, CLI, MCP server, and helper
protocol, but a full checkout-by-tap smoke is intentionally left host-gated until
the private backend is implemented.

## Demo App Build

Set these variables when a demo app exists:

```sh
ATLAS_LOOP_DEMO_SCHEME=Demo
ATLAS_LOOP_DEMO_WORKSPACE=apps/demo/Demo.xcworkspace
```

or:

```sh
ATLAS_LOOP_DEMO_SCHEME=Demo
ATLAS_LOOP_DEMO_PROJECT=apps/demo/Demo.xcodeproj
```

The destination is the booted Simulator selected by `xcrun simctl list devices booted`.
