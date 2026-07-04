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
- Disk-backed session discovery after daemon restarts.
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
- A booted iOS Simulator for Simulator smoke runs
- Accessibility permission for the native helper process when driving CGEvent
  input into the visible Simulator window

## Quick Start

```bash
npm install
npm run typecheck
npm test
npm run verify:artifacts
```

Start the local daemon:

```bash
npm run daemon -- --port 4317
```

In another terminal, check connectivity and create a session:

```bash
npm run cli -- doctor
npm run cli -- session start --simulator "iPhone 16"
```

Open the viewer in a third terminal when you want live screenshot updates:

```bash
npm run viewer
```

The viewer is a local Vite app served on loopback. It reads the daemon session
state, screenshots, artifacts, and timeline events; it is not a hosted
dashboard.

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
atlas-loop artifacts list --session <id>
atlas-loop artifacts latest-screenshot --session <id>
atlas-loop viewer url --session <id>
atlas-loop viewer open --session <id> [--launch]
atlas-loop session stop --session <id>
```

Coordinates are normalized from `0.0` to `1.0`, with origin at the top-left of
the latest screenshot.

## MCP Server

Atlas Loop includes a local stdio MCP server for agents that can call tools but
should not know the daemon HTTP details directly.

```bash
npm run mcp
```

The MCP server lists its tool surface without requiring a daemon process. Tool
calls such as `atlas.createSession`, `atlas.performAction`, `atlas.build`,
`atlas.install`, `atlas.launch`, `atlas.listArtifacts`,
`atlas.getArtifactPath`, `atlas.getLatestScreenshotPath`, and
`atlas.getViewerUrl` forward to the local daemon at `ATLAS_LOOP_DAEMON_URL` or
`http://127.0.0.1:4317` by default. See [docs/daemon-api.md](docs/daemon-api.md)
for the JSON-RPC and daemon contract.

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

Evidence is local filesystem state. `session.json` records the selected
Simulator and backend, `actions.jsonl` records requested actions and results,
`manifest.json` indexes known artifacts, and screenshots/logs/metadata remain
under the session directory. The daemon can read prior session directories after
a restart, so evidence remains inspectable when the runtime process exits.
Validate a single session or the whole artifact root with:

```bash
npm run verify:artifacts -- artifacts/sessions/<session-id>
npm run verify:artifacts -- artifacts/sessions
```

Do not commit `artifacts/`; it may contain screenshots or logs from local apps.

## Verification

Fast local checks that are safe for CI:

```bash
npm run verify:local
```

This runs dependency installation when needed, TypeScript checks, unit/viewer/MCP
tests, and artifact validation. It skips Simulator smoke unless explicitly
enabled.

Equivalent direct commands:

```bash
npm run typecheck
npm test
npm run verify:artifacts
```

Simulator smoke is macOS/Xcode gated:

```bash
npm run smoke:ios
# or
bash scripts/verify-local.sh --smoke-ios
```

The smoke script verifies the local loop that is reliable without private
Simulator APIs: build the helper, build the demo app, create a daemon session,
install, launch, capture a screenshot, optionally launch the demo into a
deterministic route such as `confirmation`, and validate artifacts. It exits
with a clear `SKIP` message when macOS, Xcode, `simctl`, a booted Simulator, or
source paths are unavailable. Set `ATLAS_LOOP_SMOKE_REQUIRE=1` in a dedicated
Simulator environment to turn those skips into failures.

Primitive coordinate input is available through the CLI, MCP, daemon, and native
helper protocol. A full checkout-by-tap smoke is still host-gated: the v1 CGEvent
backend needs a visible Simulator window, Accessibility permission, and a host
configuration where posted macOS events are actually consumed by the guest app.
The demo route proof is a launch-argument proof path, not evidence that HID
input succeeded.

## Objective Function

See [docs/objective-function.md](docs/objective-function.md) for the prompt and
review checklist used to guide future agent work on this repo.

## Security

The daemon binds to `127.0.0.1` by default and is intended for local development.
Do not expose it to a public network.

See [SECURITY.md](SECURITY.md) for reporting guidance.
