# Atlas Loop Protocol

Atlas Loop uses a small JSON-compatible protocol for iOS Simulator sessions, actions, action results, and artifacts. The TypeScript source of truth is `packages/protocol/src/index.ts`; this document describes the wire-level shape expected by daemon, CLI, MCP, viewer, and artifact tooling.

## Session

A session represents one local verification loop against an iOS Simulator.

Required fields:

- `id`: Stable session identifier. Artifact directories are expected to use the same name.
- `schemaVersion`: `atlas-loop.session.v1`.
- `platform`: `ios-simulator`.
- `status`: One of `created`, `booting`, `booted`, `building`, `installing`, `installed`, `launching`, `running`, `ended`, or `failed`.
- `createdAt` and `updatedAt`: ISO timestamps.
- `simulator`: A simulator reference with optional `udid`, `name`, `runtime`, and `booted`.
- `artifactDir`: Absolute or session-relative path to the session artifact directory.

Optional fields:

- `app`: Bundle, scheme, workspace, project, or built app path metadata.
- `viewerUrl`: URL for a local viewer.
- `backend`: Name of the automation backend in use.
- `inputBackend`: Input backend selected for the session, `cgevent` (default) or `xcuitest`.
- `error`: Structured Atlas Loop error when the session failed.

## Actions

Every action has:

- `id`
- `sessionId`
- `kind`
- `createdAt`
- optional `sequence`

Supported action kinds:

- `tap`: `x` and `y` are normalized coordinates from `0` to `1`.
- `typeText`: `text` must be non-empty.
- `swipe`: `from`, `to`, and non-negative `durationMs`.
- `edgeGesture`: `edge`, `distance` from `0` to `1`, and non-negative `durationMs`.
- `longPress`: normalized `x` and `y` plus non-negative `durationMs`. Requires `xcuitest`.
- `pinch`: positive, non-`1` `scale`, non-zero `velocity`, and optional `identifier` / non-negative `timeoutMs` element target. A scale below `1` pinches closed; a scale above `1` pinches open. Requires `xcuitest`.
- `rotate`: non-zero `rotation` in radians, non-zero `velocity` in radians per second, and optional `identifier` / non-negative `timeoutMs` element target. Requires `xcuitest`.
- `twoFingerTap`: optional `identifier` / non-negative `timeoutMs` element target. Requires `xcuitest`.
- `tapElement`: `identifier` is a non-empty accessibility identifier; optional non-negative `timeoutMs` bounds the wait for the element. Requires an element-capable input backend (`xcuitest`).
- `assertVisible`: same fields as `tapElement`, plus optional `markScreen` to declare the asserted element a screen-level container; asserts the element exists and reports its visibility state (including whether it covers most of the app window) as evidence. Screen-level assertions name the corresponding Atlas map screen, either explicitly via `markScreen` or automatically when the element covers >= 70% of the window. Requires an element-capable input backend (`xcuitest`).
- `screenshot`: optional `reason`.
- `install`: `appPath`.
- `launch`: `bundleId`, optional `arguments`, optional `environment`. The local Simulator adapter terminates an already-running instance before launching so arguments and environment are reapplied deterministically.
- `wait`: non-negative `durationMs`.

Coordinates are normalized so clients do not need to know the physical Simulator resolution before issuing an action.

## Results

An action result records:

- `actionId`
- `ok`
- `startedAt`
- `endedAt`
- `artifacts`
- optional `error`

Artifacts produced by an action must carry `sessionId`, `type`, `path`, `createdAt`, and optionally `sha256` and metadata.

## Errors

Errors use:

- `code`
- `message`
- optional `retryable`
- optional `details`

Known error codes include Simulator discovery failures, build/install/launch failures, HID failures, action timeouts, artifact write failures, invalid requests, command failures, and not-found cases. Element-driven input adds `ELEMENT_NOT_FOUND` (the accessibility identifier did not resolve to a hittable element; not retryable) and `DRIVER_UNAVAILABLE` (the XCUITest driver runner is not reachable or died; retryable, mapped to HTTP 503).

## Trace Events

Trace JSONL records use these event types:

- `session.created`
- `session.statusChanged`
- `action.started`
- `action.completed`
- `artifact.created`
- `error`

Trace lines are append-only JSON objects. Consumers should ignore unknown future fields and preserve the original order.

The daemon read model exposes parsed trace events through
`GET /v1/sessions/:id/events`. The route accepts a concrete session id or
`latest`, is read-only, and returns the same event objects that are stored in
`trace.jsonl`. It is the right surface for exact event ordering, event counts,
action ids, and scriptable JSON inspection.

The viewer timeline is a derived presentation over trace events plus manifest
and action-result artifacts. Use it for human inspection when the important
question is "what happened and which screenshot, log, or metadata file proves
it?" Use the raw events route when the important question is "what exact event
payload did the daemon record?"

## Session Summary

The daemon exposes a convenience summary view at `GET /v1/sessions/:id/summary`.
It is not a replacement for the core protocol objects above; it is an
ergonomic read model for CLIs, MCP tools, and local agents that need a quick
status check.

For daemon read routes, clients may use the session id `latest` to follow the
newest local run. The daemon prefers active in-memory sessions while a daemon
process is running. After restart, persisted sessions are read-only evidence, so
`latest` resolves by the most recent persisted `updatedAt` timestamp rather than
by saved status alone.

The summary includes:

- `session`: The current `Session`.
- `paths`: Local artifact directory, manifest, trace, and screenshots paths.
- `artifacts`: Total artifact count, counts by artifact type, and optional latest screenshot artifact.
- `events`: Total trace event count, optional latest action result summary, and optional latest error.
- `storage`: Whether the summary came from live daemon memory or disk-backed
  artifact recovery, plus any warnings produced while reading persisted
  artifacts.

Consumers should treat the summary as derived state. If a field is absent, use
the underlying session, artifacts, and trace endpoints for more detail.

## Session History

The daemon exposes `GET /v1/sessions/history` as the local evidence-history
read model for active daemon sessions and persisted artifact-backed sessions.
It accepts optional non-negative integer `limit` and returns the protocol
`SessionHistoryResult` JSON. CLI callers can use
`atlas-loop session history --limit 20` or the `session hist` alias; MCP callers
can use `atlas.listSessionHistory`.

Session history is broader than `GET /v1/sessions/:id/summary` because it is an
index across sessions, but it is still local derived evidence. It should not be
described as cloud storage, provenance signing, hosted audit logging, or team
sharing. Consumers should ignore unknown future fields and use concrete
session ids from the history result for summary, artifact, event, and viewer
reads.

## Handoff Read Model

The agent/operator handoff workflow is derived from the session summary rather
than a separate persisted object. A handoff helper should preserve the
summary's concrete `session.id`, original requested id, artifact paths, latest
action and error state, and storage source.

The `canMutate` decision used by CLI and MCP readiness helpers is intentionally
stricter than the saved session status. It is true only when the resolved
summary came from live daemon memory and the session status is not terminal.
Persisted disk sessions remain read-only evidence for viewer inspection,
artifact health, reports, and local exports.

The CLI shortcut is `atlas-loop session handoff --session latest`. Clients can
also compose handoff state from `session ready`, `artifacts health`, the viewer
URL, optional evidence report/export commands, and a raw `events export` file
for exact trace JSON. CLI callers can request `--format markdown` or persist
either selected format with `--out`. They can also request `--bundle <dir>` to
write `handoff.json`, `handoff.md`, `README.md`, optional `events.json`,
optional `evidence-report.md`, and `manifest.json` with
`schemaVersion: "atlas-loop.handoff-bundle.v1"`. The manifest includes
local-only metadata plus SHA-256/size integrity for generated non-manifest
files. `atlas-loop handoff verify --bundle <dir>` checks that bundle contract
locally by reading `manifest.json`, enforcing contained regular files, and
recomputing SHA-256/size integrity without daemon or network access. MCP
callers can use `atlas.verifyHandoffBundle` with `bundleDir` for the same local
check. The bundle is still derived local state; no handoff field should imply
provenance signing, cloud sharing, hosted authentication, Android support, or a
remote viewer in v1.
