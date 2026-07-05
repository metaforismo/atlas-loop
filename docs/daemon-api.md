# Daemon API

The daemon is the local process that owns Simulator state, action execution, and artifact writes. Clients may be CLI commands, the viewer, or an MCP server that translates tool calls into daemon requests.

## HTTP Contract

The daemon should expose JSON endpoints on `ATLAS_LOOP_DAEMON_URL`, defaulting to `http://127.0.0.1:4317`.

Recommended endpoints:

- `GET /healthz`: Returns daemon readiness and version metadata.
- `POST /v1/sessions`: Creates a session from a `CreateSessionRequest`.
- `GET /v1/sessions`: Lists active in-memory sessions plus persisted
  artifact-backed sessions discovered under the artifact root.
- `GET /v1/sessions/history`: Returns local evidence history across active
  sessions and persisted artifact-backed sessions. Accepts optional
  non-negative integer `limit`.
- `GET /v1/sessions/:id`: Returns the current session object.
- `GET /v1/sessions/:id/summary`: Returns session status, artifact paths, artifact counts, latest action/error, and latest screenshot metadata.
- `POST /v1/sessions/:id/build`: Builds an app for the target Simulator.
- `POST /v1/sessions/:id/install`: Installs an app bundle.
- `POST /v1/sessions/:id/launch`: Launches an installed app.
- `POST /v1/sessions/:id/actions`: Performs one action and returns an `ActionResult`.
- `POST /v1/sessions/:id/end`: Ends the session and flushes artifacts.
- `GET /v1/sessions/:id/artifacts`: Lists known artifact references.
- `GET /v1/sessions/:id/artifacts/health`: Validates the session artifact
  directory through the daemon and returns a structured health report.
- `GET /v1/sessions/:id/latest-screenshot`: Returns the latest screenshot image.
- `GET /v1/sessions/:id/artifacts/latest-screenshot`: Returns the latest screenshot artifact reference as JSON.
- `GET /v1/sessions/:id/artifacts/:artifactId/content`: Streams artifact bytes
  with the artifact's media type and single-range HTTP Range support (used for
  image previews and seekable video replay). Artifact list and summary
  responses populate `ArtifactRef.url` with this route; urls are never
  persisted to disk.
- `GET /v1/sessions/:id/events`: Returns parsed trace events as JSON. With
  `Accept: text/event-stream` the same route serves an SSE stream that replays
  existing events and follows appends.
- `POST /v1/sessions/:id/recording/start` / `POST /v1/sessions/:id/recording/stop`:
  Controls session video recording; stop registers the video artifact with a
  `videoStartedAt` alignment anchor. `record: true` on session create starts
  recording immediately, and recordings auto-stop when the session ends.
- `GET /v1/sessions/:id/metrics`: Returns sampled app CPU/RSS metrics
  (`atlas-loop.metrics.v1`) for live and persisted sessions.
- `GET /v1/atlas/map`: Returns `{ source, map, warnings }` where `map` is the
  Atlas screen map (`atlas-loop.atlas-map.v1`) derived from local session
  evidence; served from cache while no session evidence changed.
- `POST /v1/atlas/map/rebuild`: Forces a rebuild of the Atlas map.
- `GET /v1/atlas/screens/:screenId/image`: Streams a screen's representative
  screenshot; `?variant=N` selects a variant.

The daemon also accepts the same session routes without the `/v1` prefix for
older local clients.

Read-only session routes accept `latest` anywhere `:id` is shown. The alias
prefers the most recently updated active in-memory session, then the most
recently updated persisted session. Persisted sessions are read-only evidence,
even if their saved status is not `ended` or `failed`. Mutation routes such as
build, install, launch, actions, screenshot, and end require an active in-memory
session. When no sessions exist, the daemon returns `NOT_FOUND`.

Responses should use the protocol envelope:

```json
{
  "ok": true,
  "data": {}
}
```

Session summaries include a storage block so clients can distinguish live
daemon state from read-only persisted evidence:

```json
{
  "storage": {
    "source": "disk",
    "artifactBacked": true,
    "warnings": [
      {
        "path": "artifacts/sessions/sess_123/manifest.json",
        "message": "artifact shot_1 path is missing or escapes the session directory"
      }
    ]
  }
}
```

On failure:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "tap must use normalized coordinates between 0 and 1",
    "retryable": false
  }
}
```

## MCP Contract Basics

The MCP server should not require a real daemon for `tools/list`. It should publish the daemon-backed tool surface and connect to the daemon only when a tool is called.

Required JSON-RPC methods:

- `tools/list`
- `tools/call`

Required tool names:

- `atlas.createSession`
- `atlas.getSession`
- `atlas.getSessionSummary`
- `atlas.performAction`
- `atlas.endSession`

Recommended additional tool names:

- `atlas.health`
- `atlas.listSessions`
- `atlas.listSessionHistory`
- `atlas.getLatestSession`
- `atlas.sessionReady`
- `atlas.getSessionHandoff`
- `atlas.listEvents`
- `atlas.exportEvents`
- `atlas.build`
- `atlas.install`
- `atlas.launch`
- `atlas.listArtifacts`
- `atlas.getArtifactHealth`
- `atlas.latestScreenshot`
- `atlas.takeScreenshot`
- `atlas.getArtifactPath`
- `atlas.getLatestScreenshotPath`
- `atlas.verifyArtifacts`
- `atlas.verifyHandoffBundle`
- `atlas.getViewerUrl`
- `atlas.getEvidence`
- `atlas.getEvidenceReport`
- `atlas.exportEvidence`

Tool calls should return structured JSON content:

```json
{
  "ok": true,
  "data": {}
}
```

`atlas.sessionReady` is the compact pre-action helper for agents. It reads
`GET /sessions/:id/summary`, resolves aliases such as `latest`, and combines
the summary with a local viewer URL. It should not call the session list route
or add a daemon endpoint. The response is structured JSON:

```json
{
  "ok": true,
  "data": {
    "sessionId": "sess_123",
    "requestedSessionId": "latest",
    "status": "running",
    "storage": {
      "source": "memory",
      "artifactBacked": true,
      "warningCount": 0
    },
    "artifactDir": "artifacts/sessions/sess_123",
    "latestScreenshotPath": "artifacts/sessions/sess_123/screenshots/latest.png",
    "latestAction": {
      "id": "act_123",
      "ok": true
    },
    "viewerUrl": "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess_123",
    "daemonUrl": "http://127.0.0.1:4317",
    "viewerBaseUrl": "http://127.0.0.1:5173",
    "canMutate": true,
    "hasScreenshot": true
  }
}
```

`latestError` is included when the session summary contains one. `canMutate`
must only be true when the summary reports `storage.source` as `memory` and the
status is not terminal (`ended` or `failed`). Disk-backed sessions are readable
evidence only, even when their persisted status says `running`.

`atlas.listSessionHistory` is the MCP wrapper for
`GET /v1/sessions/history`. Its input accepts optional `limit` and optional
`daemonUrl`; it returns the daemon's structured `SessionHistoryResult` JSON in
the normal MCP envelope. The history is local evidence across active daemon
sessions and persisted sessions recovered from artifacts. It is not cloud
storage, provenance signing, a hosted audit trail, or team sharing.

Daemon and validation failures should return structured tool errors with the
Atlas Loop error code and message preserved:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "session not found: sess_missing"
  }
}
```

## Session History

The session-history route is the local evidence index for active daemon
sessions and persisted artifact-backed sessions:

```sh
curl -s "http://127.0.0.1:4317/v1/sessions/history?limit=20"
atlas-loop session history --limit 20
atlas-loop session hist --limit 20
```

The optional `limit` must be a non-negative integer and returns the newest
history entries according to the daemon's `SessionHistoryResult` read model.
The CLI prints that JSON result directly. MCP callers can use
`atlas.listSessionHistory` with optional `limit` and `daemonUrl`.

This is a local read-only evidence surface. It does not upload artifacts,
sign provenance, create hosted audit trails, or share sessions with a team.

## Event And Trace Inspection

The stable read-only inspection surface is the daemon events route:

```sh
curl -s "http://127.0.0.1:4317/v1/sessions/latest/events"
atlas-loop events list --session latest --type action.completed --limit 20
atlas-loop events export --session latest --type action.completed --limit 20 --out artifacts/events/latest-actions.json
```

It accepts a concrete session id or `latest`, resolves the session through the
same readable-session rules as summary, artifact, health, and screenshot reads,
and returns the parsed `TraceEvent[]` payload from that session's local
`trace.jsonl` in the normal protocol envelope:

```json
{
  "ok": true,
  "data": [
    {
      "type": "action.started",
      "at": "2026-07-04T09:00:02.000Z",
      "action": {
        "id": "act_123",
        "sessionId": "sess_123",
        "kind": "tap",
        "x": 0.5,
        "y": 0.75,
        "createdAt": "2026-07-04T09:00:02.000Z",
        "sequence": 1
      }
    }
  ]
}
```

This route does not mutate the session, re-run actions, copy artifacts, upload
files, or imply that disk-backed evidence can receive new input. For live
in-memory sessions, malformed trace JSON is an `ARTIFACT_WRITE_FAILED` error
because the current run's trace is expected to be well-formed. For recovered
disk sessions, malformed trace lines are skipped so legacy evidence can remain
inspectable while artifact validators still report structural problems.

Use this route, the CLI `events list` command, the MCP `atlas.listEvents` tool,
or the daemon client's `events(sessionId)` method when an agent needs exact raw
JSON, ordering, action ids, or event counts. Use `atlas-loop events export` or
MCP `atlas.exportEvents` when the next agent needs a local JSON file containing
the same filtered event view plus `schemaVersion`, `exportedAt`, `outPath`,
`localOnly: true`, and `uploaded: false` metadata. Event exports create parent
directories, write one local JSON file, and do not upload, mutate the session,
or copy the session artifact tree.

Use the viewer timeline when a human needs to inspect event, screenshot, log,
metadata, and artifact health context together. The CLI and MCP wrappers are
thin, read-only convenience layers over the daemon event read model.

## Request Semantics

Session creation accepts:

```json
{
  "simulator": {
    "name": "iPhone 16"
  },
  "artifactRoot": "artifacts/sessions",
  "viewer": true
}
```

Action execution accepts:

```json
{
  "action": {
    "kind": "tap",
    "x": 0.5,
    "y": 0.5
  }
}
```

The daemon materializes action IDs, sequence numbers, timestamps, action results, traces, and artifact references.

Evidence export accepts a session id and a local output directory:

```json
{
  "sessionId": "latest",
  "outDir": "artifacts/exports/sess_123"
}
```

`atlas.exportEvidence` reads the session summary, resolves
`paths.artifactDir` as a local filesystem directory, copies that directory into
`outDir`, and writes `atlas-evidence-export.json` metadata into the export
bundle. It should not call upload services or download artifact bytes from the
daemon. The only daemon read needed is the summary call that provides local
session and artifact paths.

Artifact health accepts a session id or `latest`:

```json
{
  "sessionId": "latest"
}
```

The CLI command is:

```sh
atlas-loop artifacts health --session latest
```

The daemon route is `GET /v1/sessions/:id/artifacts/health`; the MCP tool is
`atlas.getArtifactHealth`. Health is daemon-backed but still local-only: the
daemon resolves the readable session, including disk-backed persisted sessions,
validates that session's artifact directory on the local filesystem, and
returns a structured report. It does not upload, copy, archive, or mutate
artifacts, and it is not a signal that a persisted session can still receive
build/install/action calls.

Example data payload:

```json
{
  "ok": true,
  "target": "/absolute/path/to/artifacts/sessions/sess_123",
  "sessionId": "sess_123",
  "requestedSessionId": "latest",
  "source": "disk",
  "artifactDir": "/absolute/path/to/artifacts/sessions/sess_123",
  "summary": {
    "sessionCount": 1,
    "issueCount": 0,
    "warningCount": 0,
    "errorCount": 0
  },
  "report": {
    "target": "/absolute/path/to/artifacts/sessions/sess_123",
    "sessionCount": 1,
    "issues": [],
    "ok": true
  }
}
```

`ok` is false when validation finds errors. Warnings should remain visible in
the `report` and summary counts but do not make the artifact tree unreadable.
`source` is the daemon storage source for the resolved session, currently
`memory` for live sessions or `disk` for persisted evidence.

Artifact verification accepts exactly one of `sessionId` or `path`:

```json
{
  "sessionId": "latest"
}
```

```json
{
  "path": "artifacts/sessions/sess_123"
}
```

`atlas.verifyArtifacts` returns a structured JSON report from the local
artifact validator plus top-level request metadata:

```json
{
  "ok": true,
  "target": "/absolute/path/to/artifacts/sessions/sess_123",
  "source": "session",
  "requestedSessionId": "latest",
  "sessionId": "sess_123",
  "artifactDir": "/absolute/path/to/artifacts/sessions/sess_123",
  "report": {
    "target": "/absolute/path/to/artifacts/sessions/sess_123",
    "sessionCount": 1,
    "issues": [],
    "ok": true
  }
}
```

For `sessionId`, the tool reads only the session summary and validates
`paths.artifactDir`. For `path`, it validates the local target directly and
does not call the daemon. The top-level `target` and `report.target` values are
the resolved absolute target paths; `requestedPath` preserves the caller's
original path input when `path` mode is used. Supplying both fields or neither
field is an `INVALID_REQUEST`.

`atlas.verifyHandoffBundle` validates a local handoff bundle directory using
the same structured verifier as `atlas-loop handoff verify --bundle <dir>`:

```json
{
  "ok": true,
  "schemaVersion": "atlas-loop.handoff-verify.v1",
  "bundleDir": "/absolute/path/to/artifacts/handoffs/sess_123",
  "manifestPath": "/absolute/path/to/artifacts/handoffs/sess_123/manifest.json",
  "sessionId": "sess_123",
  "checkedAt": "2026-07-05T12:00:00.000Z",
  "filesChecked": 5,
  "summary": {
    "errorCount": 0,
    "warningCount": 0,
    "issueCount": 0
  },
  "issues": [],
  "localOnly": true,
  "uploaded": false
}
```

The only input is required `bundleDir`. It must be a local filesystem path.
The MCP call does not call the daemon, open network connections, or upload
data. A corrupt bundle still returns a successful MCP envelope with
`data.ok: false` and structured `issues`; malformed URL-like inputs are
rejected before verification.

Use health for the daemon session view and `latest` alias resolution. Use
verification for direct local validation, especially CI checks and explicit
filesystem targets. Both use local filesystem validation and neither implies
cloud storage, hosted auth, Android support, Revyl compatibility, serve-sim, or
XcodeBuildMCP runtime dependencies.

## Agent Handoff Semantics

Agent/operator handoff is built from local daemon reads and local filesystem
artifacts. The current available command sequence is:

```sh
atlas-loop session ready --session latest
atlas-loop artifacts health --session latest
atlas-loop viewer url --session latest
atlas-loop viewer open --session latest --launch
atlas-loop events export --session latest --type action.completed --limit 20 --out artifacts/events/latest-actions.json
atlas-loop evidence report --session latest --out artifacts/reports/<session-id>.md
atlas-loop evidence export --session latest --out artifacts/exports/<session-id>
```

`session ready` is the authoritative pre-handoff read because it resolves
`latest`, reports whether the session came from live memory or disk, and
returns `canMutate`. `artifacts health` validates the resolved artifact
directory through the daemon without mutating it. Viewer URLs point at the
local Vite viewer and local daemon only. Evidence reports and exports are
filesystem artifacts for local review or manual archival; they are not uploads.

The single-command form is:

```sh
atlas-loop session handoff --session latest
atlas-loop session handoff --session latest --format markdown --out artifacts/handoffs/<session-id>.md
atlas-loop session handoff --session latest --bundle artifacts/handoffs/<session-id>
atlas-loop handoff verify --bundle artifacts/handoffs/<session-id>
```

The shortcut aggregates the same readiness, health, viewer URL, blockers, and
copy-paste next commands, including a local bundle command and a local
`events export` command for raw trace JSON. JSON is the compatibility default;
Markdown is for readable local notes. `--bundle` writes a local directory with
`handoff.json`, `handoff.md`, `README.md`, optional `events.json`, optional
`evidence-report.md`, and `manifest.json` containing generated file paths,
warnings, and SHA-256/size integrity for non-manifest files. `handoff verify`
is a local filesystem check for that derived bundle; it does not call the
daemon. MCP callers can run the same check with `atlas.verifyHandoffBundle`
and `bundleDir`. None of these forms creates a new cloud, provenance signing,
team sharing, Android, or hosted-dashboard contract.

For MCP runtimes, the matching helper is `atlas.getSessionHandoff`. Agents can
still call `atlas.sessionReady`, `atlas.getArtifactHealth`,
`atlas.getViewerUrl`, `atlas.listEvents`, `atlas.exportEvents`,
`atlas.getEvidenceReport`, and `atlas.exportEvidence` as separate local tools
when they need individual pieces.

## Local Safety

The daemon is intended for local use. Bind to loopback by default, reject non-normalized coordinates, keep artifact paths inside the session directory, and never expose Simulator logs or screenshots over a public interface unless the caller explicitly configures that behavior.
