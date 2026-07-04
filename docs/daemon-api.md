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
- `atlas.build`
- `atlas.install`
- `atlas.launch`
- `atlas.listArtifacts`
- `atlas.latestScreenshot`
- `atlas.getArtifactPath`
- `atlas.getLatestScreenshotPath`
- `atlas.getViewerUrl`
- `atlas.getEvidence`
- `atlas.getEvidenceReport`

Tool calls should return structured JSON content:

```json
{
  "ok": true,
  "data": {}
}
```

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

## Local Safety

The daemon is intended for local use. Bind to loopback by default, reject non-normalized coordinates, keep artifact paths inside the session directory, and never expose Simulator logs or screenshots over a public interface unless the caller explicitly configures that behavior.
