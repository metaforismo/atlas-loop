# ios-hid-helper

Repo-owned macOS executable for driving an iOS Simulator window through a stable NDJSON protocol.

## Build

```sh
swift build --package-path native/ios-hid-helper
```

## Protocol

Each request is one JSON object per line on stdin:

```json
{"id":"1","type":"hello","data":{}}
```

Each response is one JSON object per line on stdout:

```json
{"id":"1","type":"hello","ok":true,"data":{"protocolVersion":1}}
```

Failures keep the same envelope:

```json
{"id":"2","type":"tap","ok":false,"error":{"code":"invalidCoordinates","message":"x must be in the closed range 0...1","retryable":false}}
```

Diagnostics are written to stderr only.

## Commands

- `hello`
- `attach`
- `metrics`
- `tap`
- `typeText`
- `swipe`
- `edgeGesture`
- `shutdown`

Coordinates are normalized to the attached Simulator window and must be finite values in the closed range `0...1`.

The v1 backend is `macos-cgevent-simulator-window`. It requires a visible
Simulator window and Accessibility permission for this executable. A private
Simulator HID backend slot is represented in the code and protocol metadata, but
is intentionally unavailable in v1.
