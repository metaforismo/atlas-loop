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
- `screenshot`: optional `reason`.
- `install`: `appPath`.
- `launch`: `bundleId`, optional `arguments`, optional `environment`.
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

Known error codes include Simulator discovery failures, build/install/launch failures, HID failures, action timeouts, artifact write failures, invalid requests, command failures, and not-found cases.

## Trace Events

Trace JSONL records use these event types:

- `session.created`
- `session.statusChanged`
- `action.started`
- `action.completed`
- `artifact.created`
- `error`

Trace lines are append-only JSON objects. Consumers should ignore unknown future fields and preserve the original order.

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
