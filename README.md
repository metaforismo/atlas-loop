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
- Headless real input through the `xcuitest` driver runner backend
  (`--input-backend xcuitest`): coordinate taps, swipes, typing, and element
  actions (`tap-element`, `assert-visible`) with no Simulator window or
  Accessibility permission, proven by a tap-driven checkout smoke.
- Automatic post-action screenshots (`role: "after"`, disable with
  `skipScreenshot` or the `autoScreenshot` config) that power before/after
  evidence pairs in the viewer.
- Session video recording (`session start --record`, `recording start|stop`)
  with a viewer replay panel: action markers on the scrubber, click-to-seek.
- The Atlas map: screens and transitions derived from local session evidence
  (`map build`, `GET /v1/atlas/map`, MCP `atlas.getMap`) with a screens grid
  and transition graph in the viewer (`?view=atlas`). Screens are named by
  screen-level assertions (`assert-visible --screen`), and map details deep
  link back into the sessions and actions that produced them
  (`?actionId=` / `?artifactId=` preselect evidence in the session view).
- Visual regression baselines: `baseline save|compare|list` pixel-diffs a
  session screenshot against a named local baseline and exits non-zero on
  failure (CI-gate friendly); MCP agents get the same via
  `atlas.compareBaseline`.
- Screenshot inspection: zoom/pan lightbox and a before/after pixel diff view
  for action evidence pairs.
- Per-session app metrics (CPU/RSS sampled from the launched pid) with viewer
  sparklines and a `GET /v1/sessions/:id/metrics` route.
- Self-contained HTML evidence reports (`evidence report --format html`) with
  inlined screenshots, action table, metrics, and the session's slice of the
  Atlas map; shareable as a single file.
- CLI commands for session lifecycle, app build/install/launch, tap/type/swipe,
  screenshots, and viewer startup.
- Local MCP-compatible stdio server exposing the same runtime controls.
- Screenshot-based live viewer built with React and Vite.
- Compact viewer action presets for common tap targets and waits.
- Disk-backed session discovery after daemon restarts.
- Timeline and artifact navigation that correlates trace events, action results,
  screenshots, logs, metadata, and persisted artifact references.
- Read-only trace event inspection through the daemon events route for live and
  persisted sessions.
- Agent/operator handoff command that summarizes readiness, artifact health,
  viewer URL, blockers, and next local evidence commands.
- Local handoff bundle output with JSON, Markdown, raw events, report, and a
  manifest verifier for next-agent context.
- Viewer handoff copy controls for a compact note, next steps, CLI commands,
  and read-only daemon checks.
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

## Evidence Navigation

Atlas Loop treats the files under `artifacts/sessions/<session-id>/` as the
source of truth. The daemon and viewer read that local evidence back through
session, event, artifact, and latest-screenshot routes. The viewer timeline
merges `action.started`, `action.completed`, and `artifact.created` trace events
with manifest and action-result artifacts, so a reviewer can move from an
action to the screenshots, logs, or metadata produced by that action. When a
daemon restarts, disk-backed sessions remain inspectable by id or `latest`, but
they are evidence-only and cannot receive new build, launch, screenshot, or
input commands.

Use the viewer timeline when a human needs to correlate actions with
screenshots, logs, metadata, artifact health, and the current app image in one
local UI. Use the raw event/trace surface when an agent, script, or reviewer
needs exact JSON events, event counts, action ids, or ordering independent of
the visual timeline:

```bash
curl -s "http://127.0.0.1:4317/v1/sessions/latest/events"
npm run cli -- events list --session latest --type action.completed --limit 20
npm run cli -- events export --session latest --type action.completed --limit 20 --out artifacts/events/latest-actions.json
```

That route is read-only, accepts concrete session ids or `latest`, and reads
the local `trace.jsonl` through the daemon. The TypeScript daemon client has
`events(sessionId)` for internal callers, the CLI exposes `events list`, and
the MCP server exposes `atlas.listEvents` for agents that need structured,
read-only trace inspection. Use `events export` or MCP `atlas.exportEvents`
when the handoff needs a local JSON file with filter metadata, counts, and raw
events. Event exports are local files only; they do not upload or mutate the
session.

Use session history when an agent or reviewer needs a local evidence index
across active daemon sessions and persisted artifact-backed sessions:

```bash
curl -s "http://127.0.0.1:4317/v1/sessions/history?limit=20"
npm run cli -- session history --limit 20
```

`/v1/sessions/history`, `atlas-loop session history`, its `session hist` alias,
and MCP `atlas.listSessionHistory` return structured local evidence history.
They do not create cloud storage, provenance signing, hosted audit trails, or
team sharing.

## Agent Handoff Quick Path

For an agent-to-operator handoff, keep the daemon and viewer local, resolve the
session, check artifact health, then export local evidence:

Terminal 1:

```bash
npm run daemon -- --port 4317
```

Terminal 2:

```bash
npm run viewer
```

Terminal 3:

```bash
npm run cli -- session start --simulator "iPhone 16" --viewer
npm run cli -- build --session latest --project apps/ios-commerce-demo/CommerceDemo.xcodeproj --scheme CommerceDemo
npm run cli -- install --session latest --app <path-to-built-app>
npm run cli -- launch --session latest --bundle-id app.atlasloop.CommerceDemo
npm run cli -- screenshot --session latest --reason handoff
npm run cli -- session ready --session latest
npm run cli -- artifacts health --session latest
npm run cli -- viewer open --session latest --launch
npm run cli -- evidence report --session latest --out artifacts/reports/<session-id>.md
npm run cli -- evidence export --session latest --out artifacts/exports/<session-id>
npm run cli -- events export --session latest --out artifacts/events/<session-id>.json
npm run cli -- session handoff --session latest --bundle artifacts/handoffs/<session-id>
npm run cli -- handoff verify --bundle artifacts/handoffs/<session-id>
```

If a session already exists, begin with `session list`, `session status`, and
`session ready` instead of creating a new one. Read the `canMutate` field from
`session ready`: live in-memory sessions can still receive build, install,
launch, screenshot, and input commands, while disk-backed sessions are
evidence-only.

The shortcut command is `atlas-loop session handoff --session latest`. It
aggregates the readiness, health, viewer URL, blockers, and copy-paste next
commands that otherwise come from the explicit commands above, including a raw
event export for agent-readable trace handoff. JSON remains the default output;
use `--format markdown` for a readable local note and `--out <path>` to persist
the selected output. Use `--bundle <dir>` when the next agent should receive a
single local directory containing `handoff.json`, `handoff.md`, `README.md`,
`manifest.json` with SHA-256/size integrity for generated files, optional
`events.json`, and optional `evidence-report.md`; optional exports that fail
are recorded as warnings in the manifest instead of breaking the handoff
bundle. Run `atlas-loop handoff verify --bundle <dir>` to check a bundle's
local self-consistency; it re-checks the manifest, contained paths, regular
files, and SHA-256/size integrity without daemon or network access. MCP
callers can run the same local check with `atlas.verifyHandoffBundle` and a
`bundleDir` argument; the tool does not call the daemon or upload data. See
[docs/handoff-workflow.md](docs/handoff-workflow.md) for the full local
handoff checklist. The handoff output is a local operator note, not a share
link or hosted workspace.

## Main Commands

```bash
atlas-loop doctor
atlas-loop daemon start --port 4317
atlas-loop session start --simulator "iPhone 16" --viewer [--input-backend cgevent|xcuitest] [--record]
atlas-loop session list
atlas-loop session history [--limit 20]
atlas-loop session latest
atlas-loop session status --session latest
atlas-loop session ready --session latest
atlas-loop build --session <id> --project apps/ios-commerce-demo/CommerceDemo.xcodeproj --scheme CommerceDemo
atlas-loop install --session <id> --app <path-to-app>
atlas-loop launch --session <id> --bundle-id app.atlasloop.CommerceDemo
atlas-loop tap --session <id> --x 0.5 --y 0.8
atlas-loop tap-element --session <id> --id cart.continue [--timeout-ms 5000]
atlas-loop assert-visible --session <id> --id confirmation [--timeout-ms 5000] [--screen]
atlas-loop recording start --session <id|latest>
atlas-loop recording stop --session <id|latest>
atlas-loop map build [--sessions id,id] [--threshold 10] [--json]
atlas-loop map show [--json]
atlas-loop baseline save --session <id|latest> --name <name> [--artifact <artifactId>]
atlas-loop baseline compare --session <id|latest> --name <name> [--threshold 24] [--max-diff-ratio 0.005] [--out mask.png]
atlas-loop baseline list
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
atlas-loop events list --session <id|latest> [--type action.completed] [--limit 20]
atlas-loop events export --session <id|latest> --out events.json [--type action.completed] [--limit 20]
atlas-loop evidence --session <id>
atlas-loop evidence report --session <id> [--out report.md] [--format markdown|html] [--max-screenshots 20]
atlas-loop evidence export --session <id> --out <dir>
atlas-loop session handoff --session <id|latest> [--format json|markdown] [--out handoff.md]
atlas-loop session handoff --session <id|latest> --bundle <dir>
atlas-loop handoff verify --bundle <dir>
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
`atlas.takeScreenshot`, `atlas.build`, `atlas.install`, `atlas.launch`,
`atlas.listArtifacts`, `atlas.getArtifactPath`,
`atlas.getLatestScreenshotPath`, `atlas.getArtifactHealth`, and
`atlas.getViewerUrl`, forward to the local daemon at `ATLAS_LOOP_DAEMON_URL` or
`http://127.0.0.1:4317` by default. `atlas.listSessionHistory` returns the
daemon's local evidence history across active and persisted sessions, with an
optional `limit`. `atlas.listEvents` returns structured, read-only trace events
for agent handoffs and audits. `atlas.exportEvents`
writes the same filtered event view to a caller-chosen local JSON file and
returns the file metadata. `atlas.getMap` returns the Atlas screen map (or a
compact summary) derived from local evidence; `atlas.compareBaseline`
pixel-diffs a session screenshot against a saved local baseline and reports
pass/fail; `atlas.startRecording` and
`atlas.stopRecording` control session video capture; `atlas.getEvidenceReport`
accepts `format: "html"` for a self-contained report with inlined screenshots
and the session's Atlas map slice.
`atlas.getArtifactHealth` validates the daemon-resolved local artifact
directory for one readable session, including persisted sessions discovered
after a restart. It does not upload artifacts. `atlas.verifyArtifacts`
validates an explicit local `path` without daemon I/O; with `sessionId`, it
reads the session summary from the daemon and validates `paths.artifactDir`.
`atlas.verifyHandoffBundle` validates a local handoff `bundleDir` without
daemon I/O or uploads and returns the same structured verification report as
`atlas-loop handoff verify --bundle <dir>`.
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
Action ids and artifact ids are the correlation keys used by the daemon,
viewer, report/export commands, and validators.
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
npm run cli -- session history --limit 20
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
For a raw event read, use the daemon events route, CLI event wrapper, or MCP
event tool:

```bash
curl -s "http://127.0.0.1:4317/v1/sessions/<session-id>/events"
npm run cli -- events list --session <session-id> --type action.completed --limit 20
npm run cli -- events export --session <session-id> --type action.completed --limit 20 --out artifacts/events/<session-id>-actions.json
```

`evidence report` writes a local Markdown summary that can be pasted into a PR,
issue, or debugging note without uploading screenshots or logs anywhere.
`evidence export` creates a local copy of the session artifact directory and
writes `atlas-evidence-export.json` metadata in the export bundle. The export is
for local inspection, handoff, or manual archival; it does not commit or upload
the copied artifacts.

Do not commit `artifacts/` or exported evidence bundles; they may contain
screenshots or logs from local apps.

For agent/operator handoff notes, include the resolved session id, whether the
session came from memory or disk, the viewer URL, artifact health warnings or
errors, and any evidence report or export path. `session handoff --session
latest --format markdown --out artifacts/handoffs/<session-id>.md` writes this
note locally. Keep the note explicit about host-gated input behavior so a
launch-argument smoke proof is not mistaken for primitive HID success.
Use `session handoff --session latest --bundle artifacts/handoffs/<session-id>`
when the next agent needs a local directory with both the note and machine
readable trace context. The bundle `README.md` is for humans, while
`manifest.json` records local-only metadata, generated file paths, warnings,
and file integrity. Run `handoff verify --bundle artifacts/handoffs/<session-id>`
after creating or receiving the directory to catch local path, file type, and
hash inconsistencies before handoff, or call MCP `atlas.verifyHandoffBundle`
with the same bundle directory when working from an MCP runtime.

## Verification

Use the non-Simulator path for CI and most PRs:

```bash
bash scripts/verify-local.sh --no-smoke
# or
npm run verify:local
```

This runs dependency installation when needed, TypeScript checks, unit tests,
viewer tests when present, the workspace build, and artifact validation. It
does not boot or drive a Simulator unless smoke is explicitly enabled.

Equivalent direct commands:

```bash
npm run typecheck
npm test
npm run test:viewer
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

Real input has two backends. The default `cgevent` backend remains host-gated:
it needs a visible Simulator window, Accessibility permission, and a host
configuration where posted macOS events are actually consumed by the guest app.
The `xcuitest` backend drives the app headlessly through a repo-owned XCUITest
driver runner (no window, no Accessibility permission) and supports element
actions (`tap-element`, `assert-visible`) in addition to coordinates.

The real proof path is the checkout-by-tap smoke:

```bash
ATLAS_LOOP_SMOKE_INPUT_BACKEND=xcuitest npm run smoke:ios
```

It taps through the demo checkout (catalog → product-detail → cart → shipping
→ payment-review → confirmation) with per-step accessibility assertions and
screenshots, then verifies that every input-action artifact records
`inputBackend: "xcuitest"`. Set `ATLAS_LOOP_SMOKE_UDID` to pin a specific
booted simulator. The launch-argument demo route proof still exists for the
cgevent lane, but it is a fixture shortcut, not input evidence.

Native helper protocol compatibility can be checked without a booted Simulator:

```bash
swift build --package-path native/ios-hid-helper
node scripts/check-hid-helper-protocol.mjs native/ios-hid-helper/.build/debug/ios-hid-helper
```

See [docs/verification.md](docs/verification.md) for the PR checklist, CI/local
split, and how to interpret warning-only artifact validation.

## Objective Function

See [docs/objective-function.md](docs/objective-function.md) for the prompt and
review checklist used to guide future agent work on this repo.

## Security

The daemon binds to `127.0.0.1` by default and is intended for local development.
Do not expose it to a public network.

See [SECURITY.md](SECURITY.md) for reporting guidance.
