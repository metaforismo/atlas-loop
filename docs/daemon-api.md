# Daemon API

The daemon is the local process that owns Simulator state, action execution, and artifact writes. Clients may be CLI commands, the viewer, or an MCP server that translates tool calls into daemon requests.

## HTTP Contract

The daemon should expose JSON endpoints on `ATLAS_LOOP_DAEMON_URL`, defaulting to `http://127.0.0.1:4317`.

Recommended endpoints:

- `GET /healthz`: Returns daemon readiness and version metadata.
- `POST /v1/sessions`: Creates a session from a `CreateSessionRequest`.
- `GET /v1/sessions`: Lists active in-memory sessions plus persisted
  artifact-backed sessions discovered under the artifact root.
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
- `GET /v1/sessions/:id/events`: Returns parsed trace events as JSON.

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
- `atlas.getLatestSession`
- `atlas.sessionReady`
- `atlas.build`
- `atlas.install`
- `atlas.launch`
- `atlas.listArtifacts`
- `atlas.getArtifactHealth`
- `atlas.latestScreenshot`
- `atlas.getArtifactPath`
- `atlas.getLatestScreenshotPath`
- `atlas.verifyArtifacts`
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

Use health for the daemon session view and `latest` alias resolution. Use
verification for direct local validation, especially CI checks and explicit
filesystem targets. Both use local filesystem validation and neither implies
cloud storage, hosted auth, Android support, Revyl compatibility, serve-sim, or
XcodeBuildMCP runtime dependencies.

## Local Safety

The daemon is intended for local use. Bind to loopback by default, reject non-normalized coordinates, keep artifact paths inside the session directory, and never expose Simulator logs or screenshots over a public interface unless the caller explicitly configures that behavior.
