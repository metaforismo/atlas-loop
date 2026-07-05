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

## HTTP surface (v0.1)

- `GET /health` → `{ ok, runnerVersion, uptimeMs, screen: { width, height, scale } }`
- `POST /shutdown` → `{ ok, shuttingDown }`, then the driver loop ends and
  `xcodebuild` exits.

Command routes (`/target`, `/command` for tap/typeText/swipe/edgeGesture/
tapElement/assertVisible) land in the next iteration; see
`docs/protocol.md` for the action contract they will mirror.

## Check it manually

```bash
curl -s http://127.0.0.1:4701/health
curl -s -X POST http://127.0.0.1:4701/shutdown
```
