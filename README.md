# Atlas Loop

Atlas Loop is a local-first iOS Simulator verification loop for coding agents.
It starts a Simulator session, installs or launches an app, drives primitive UI
actions, streams fresh screenshots into a local viewer, and writes evidence that
can be inspected after the run.

This repository is intentionally scoped to macOS and iOS Simulator for v1. It
does not use a cloud backend, hosted auth, Revyl, serve-sim, or XcodeBuildMCP as
runtime dependencies.

## What Works In V1

- Local daemon bound to `127.0.0.1`.
- CLI commands for session lifecycle, app build/install/launch, tap/type/swipe,
  screenshots, and viewer startup.
- Local MCP-compatible stdio server exposing the same runtime controls.
- Screenshot-based live viewer built with React and Vite.
- Repo-owned Swift HID helper with a stable NDJSON protocol.
- Deterministic SwiftUI commerce checkout demo app.
- Local evidence under `artifacts/sessions/<session-id>/`.

## Important Native Input Note

The native helper owns Atlas Loop's action protocol and backend boundary. The v1
implementation includes a macOS CGEvent Simulator-window backend that requires a
visible Simulator window and Accessibility permission for the helper process. It
also includes a private backend interface placeholder. Private Simulator HID APIs
are intentionally kept behind that interface because they are brittle across
Xcode releases. Evidence always records the selected backend.

## Requirements

- macOS
- Xcode command line tools
- Node.js 20+
- Swift toolchain
- GitHub CLI only for publishing the repository

## Quick Start

```bash
npm install
npm run typecheck
npm test
npm run daemon -- --port 4317
```

In another terminal:

```bash
npm run cli -- doctor
npm run cli -- session start --simulator "iPhone 16"
```

Open the viewer:

```bash
npm run viewer
```

## Main Commands

```bash
atlas-loop doctor
atlas-loop daemon start --port 4317
atlas-loop session start --simulator "iPhone 16" --viewer
atlas-loop build --session <id> --project apps/ios-commerce-demo/CommerceDemo.xcodeproj --scheme CommerceDemo
atlas-loop install --session <id> --app <path-to-app>
atlas-loop launch --session <id> --bundle-id app.atlasloop.CommerceDemo
atlas-loop tap --session <id> --x 0.5 --y 0.8
atlas-loop type --session <id> --text "Ada Lovelace"
atlas-loop swipe --session <id> --from 0.5,0.8 --to 0.5,0.2 --duration-ms 450
atlas-loop screenshot --session <id> --reason confirmation
atlas-loop session stop --session <id>
```

Coordinates are normalized from `0.0` to `1.0`, with origin at the top-left of
the latest screenshot.

## Evidence Layout

```text
artifacts/sessions/<session-id>/
  session.json
  manifest.json
  actions.jsonl
  trace.jsonl
  screenshots/
  logs/
  metadata/
  video/
```

## Verification

Fast local checks:

```bash
npm run typecheck
npm test
```

Full local verification:

```bash
./scripts/verify-local.sh
```

Simulator smoke is macOS/Xcode gated:

```bash
npm run smoke:ios
```

The smoke script verifies the local proof loop that is reliable without private
Simulator APIs: build the helper, build the demo app, create a daemon session,
install, launch, capture a screenshot, and validate artifacts. Coordinate input
is available through the CLI/MCP action APIs, but full checkout-by-tap smoke
depends on the Simulator GUI accepting macOS CGEvents on the host.

## Security

The daemon binds to `127.0.0.1` by default and is intended for local development.
Do not expose it to a public network.

See [SECURITY.md](SECURITY.md) for reporting guidance.
