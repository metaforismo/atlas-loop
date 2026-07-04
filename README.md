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
- Local evidence under `artifacts/sessions/<session-id>/`, with optional local
  export bundles for inspection.

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
atlas-loop session list
atlas-loop session latest
atlas-loop session status --session latest
atlas-loop session ready --session latest
atlas-loop build --session <id> --project apps/ios-commerce-demo/CommerceDemo.xcodeproj --scheme CommerceDemo
atlas-loop install --session <id> --app <path-to-app>
atlas-loop launch --session <id> --bundle-id app.atlasloop.CommerceDemo
atlas-loop tap --session <id> --x 0.5 --y 0.8
atlas-loop type --session <id> --text "Ada Lovelace"
atlas-loop swipe --session <id> --from 0.5,0.8 --to 0.5,0.2 --duration-ms 450
atlas-loop edge --session <id> --edge left --distance 0.75 --duration-ms 350
atlas-loop wait --session <id> --duration-ms 1000
atlas-loop screenshot --session <id> --reason confirmation
atlas-loop artifacts list --session <id>
atlas-loop artifacts latest-screenshot --session <id>
atlas-loop artifacts path --session <id>
atlas-loop artifacts health --session <id|latest>
atlas-loop artifacts verify --session <id>
atlas-loop artifacts verify --path <dir>
atlas-loop artifacts open --session <id> [--latest-screenshot]
atlas-loop evidence --session <id>
atlas-loop evidence report --session <id> [--out report.md]
atlas-loop evidence export --session <id> --out <dir>
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

The MCP server lists its tool surface without requiring a daemon process. Most
runtime calls, including `atlas.createSession`, `atlas.performAction`,
`atlas.build`, `atlas.install`, `atlas.launch`, `atlas.listArtifacts`,
`atlas.getArtifactPath`, `atlas.getLatestScreenshotPath`, and
`atlas.getArtifactHealth`, and `atlas.getViewerUrl`, forward to the local
daemon at `ATLAS_LOOP_DAEMON_URL` or `http://127.0.0.1:4317` by default.
`atlas.getArtifactHealth` validates the daemon-resolved local artifact
directory for one readable session, including persisted sessions discovered
after a restart. It does not upload artifacts. `atlas.verifyArtifacts`
validates an explicit local `path` without daemon I/O; with `sessionId`, it
reads the session summary from the daemon and validates `paths.artifactDir`.
Before acting, agents can call `atlas.sessionReady` to resolve `latest` into a
concrete session id and get a compact JSON status with storage source, warning
count, artifact directory, latest screenshot path, latest action id/result,
latest error, viewer URL,
`hasScreenshot`, and `canMutate`. `canMutate` is true only for live in-memory
sessions, never for disk-backed evidence discovered after a daemon restart.
`atlas.exportEvidence` reads the session summary and copies the referenced
local artifact directory into a caller-chosen local directory; it does not
upload artifacts. See
[docs/daemon-api.md](docs/daemon-api.md) for the JSON-RPC and daemon contract.

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
atlas-loop artifacts health --session latest
atlas-loop artifacts verify --session latest
atlas-loop artifacts verify --path artifacts/sessions/<session-id>
```

Use `artifacts health` when you want the daemon's read-only health view for a
session id or `latest`. It calls
`GET /v1/sessions/:id/artifacts/health`, resolves the session through the
daemon, validates that session's local artifact directory, and returns
structured JSON with `ok`, `target`, `sessionId`, `requestedSessionId`,
`artifactDir`, `source`, `report`, and validation summary counts. It is
readable for disk-backed persisted sessions and does not upload, copy, or
mutate artifacts.

Use `artifacts verify` when you want the local validation helper. With `--path`
it validates a filesystem target without daemon I/O; with `--session` it reads
the daemon summary only to find `paths.artifactDir`, then validates that local
directory. Warnings from the validators are non-fatal. They usually mean a
legacy or minimal persisted session is still readable, but some expected
evidence such as `actions.jsonl`, screenshots, logs, or metadata was never
written. Errors mean the session record or artifact references should not be
trusted until fixed.

## Inspecting Persisted Evidence

Keep the daemon on loopback and start the viewer locally:

```bash
npm run daemon -- --port 4317
npm run viewer
```

After a daemon restart, read-only routes can discover sessions from
`artifacts/sessions`:

```bash
npm run cli -- session list
npm run cli -- session status --session latest
npm run cli -- session ready --session latest
npm run cli -- artifacts path --session <session-id>
npm run cli -- artifacts health --session <session-id>
npm run cli -- artifacts verify --session <session-id>
npm run cli -- artifacts verify --path artifacts/sessions/<session-id>
npm run cli -- artifacts open --session <session-id>
npm run cli -- viewer url --session <session-id>
npm run cli -- evidence report --session <session-id> --out artifacts/report.md
npm run cli -- evidence export --session <session-id> --out artifacts/exports/<session-id>
```

The viewer URL can point at a concrete session id or `latest`. Persisted
sessions are evidence for inspection only: build, install, launch, coordinate
actions, screenshots, and session stop still require a live in-memory session.
`evidence report` writes a local Markdown summary that can be pasted into a PR,
issue, or debugging note without uploading screenshots or logs anywhere.
`evidence export` creates a local copy of the session artifact directory and
writes `atlas-evidence-export.json` metadata in the export bundle. The export is
for local inspection, handoff, or manual archival; it does not commit or upload
the copied artifacts.

Do not commit `artifacts/` or exported evidence bundles; they may contain
screenshots or logs from local apps.

## Verification

Fast local checks that are safe for CI:

```bash
npm run verify:local
```

This runs dependency installation when needed, TypeScript checks, unit/viewer/MCP
tests, the workspace build, and artifact validation. It skips Simulator smoke
unless explicitly enabled.

Equivalent direct commands:

```bash
npm run typecheck
npm test
npm run build
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

Native helper protocol compatibility can be checked without a booted Simulator:

```bash
swift build --package-path native/ios-hid-helper
node scripts/check-hid-helper-protocol.mjs native/ios-hid-helper/.build/debug/ios-hid-helper
```

## Objective Function

See [docs/objective-function.md](docs/objective-function.md) for the prompt and
review checklist used to guide future agent work on this repo.

## Security

The daemon binds to `127.0.0.1` by default and is intended for local development.
Do not expose it to a public network.

See [SECURITY.md](SECURITY.md) for reporting guidance.
