# Atlas Loop iOS Driver Runner

An XCUITest bundle that acts as Atlas Loop's headless input driver inside the
iOS Simulator, following the WebDriverAgent pattern: a single never-ending
"test" (`testRunDriverLoop`) starts a loopback HTTP server and serves commands
until an explicit shutdown. Because the simulator shares `localhost` with the
host, the daemon talks to the runner on `127.0.0.1:<port>` with no window,
no Accessibility permission, and no private APIs.

## Build once (cacheable)

```bash
xcodebuild \
  -project native/ios-driver-runner/AtlasDriverRunner.xcodeproj \
  -scheme AtlasDriverRunner \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath artifacts/build/driver-runner/DerivedData \
  build-for-testing CODE_SIGNING_ALLOWED=NO
```

This produces `AtlasDriverRunner-Runner.app`, the `.xctest` bundle, and an
`AtlasDriverRunner_*.xctestrun` file under the derived data products
directory.

## Run against a booted simulator

```bash
TEST_RUNNER_ATLAS_DRIVER_PORT=4701 xcodebuild \
  test-without-building \
  -xctestrun artifacts/build/driver-runner/DerivedData/Build/Products/AtlasDriverRunner_*.xctestrun \
  -destination "id=<booted-simulator-udid>"
```

`TEST_RUNNER_`-prefixed variables are forwarded into the runner process, so
the server listens on `ATLAS_DRIVER_PORT` (default 4700).

## HTTP surface (v0.2)

- `GET /health` → `{ ok, runnerVersion, uptimeMs, screen: { width, height, scale } }`
- `POST /target` with `{ bundleId }` → sets and foregrounds the app under
  automation (`XCUIApplication(bundleIdentifier:)`).
- `POST /command` with `{ id?, kind, ... }` → executes one action and returns
  the envelope `{ id, type, ok, data?, error? { code, message, retryable, details? } }`:
  - `tap { x, y }` — normalized 0..1 coordinates on the target app window
  - `typeText { text }` — requires a visible keyboard (`keyboardNotVisible` otherwise)
  - `swipe { from: {x,y}, to: {x,y}, durationMs }`
  - `edgeGesture { edge, distance, durationMs }`
  - `longPress { x, y, durationMs }` — normalized coordinate press-and-hold
  - `pinch { scale, velocity, identifier?, timeoutMs? }` — two-touch pinch on the app or one accessibility element
  - `rotate { rotation, velocity, identifier?, timeoutMs? }` — two-touch rotation in radians on the app or one accessibility element
  - `twoFingerTap { identifier?, timeoutMs? }` — two-touch tap on the app or one accessibility element
  - `tapElement { identifier, timeoutMs? }` — waits for the accessibility id and synthesizes a center-coordinate tap anchored to that resolved element
  - `assertVisible { identifier, timeoutMs? }` — returns `{ exists, isHittable, label, value, frame }`
- `POST /shutdown` → `{ ok, shuttingDown }`, then the driver loop ends and
  `xcodebuild` exits.

Error codes: `invalidRequest`, `unknownCommand`, `invalidCoordinates`,
`elementNotFound`, `elementNotHittable`, `noTargetApp`, `keyboardNotVisible`,
`internalError`. Coordinates are normalized against the target app window,
matching the Atlas Loop action protocol (`docs/protocol.md`).

The daemon uses the cache under `artifacts/build/driver-runner/DerivedData`.
After changing runner commands, rebuild into that exact derived-data path before
live validation; a runner already active in a daemon process must be restarted.

## Check it manually

```bash
curl -s http://127.0.0.1:4701/health
node scripts/check-driver-runner-protocol.mjs --url http://127.0.0.1:4701 \
  --bundle-id app.atlasloop.CommerceDemo --shutdown
```
