# Artifact Format

Atlas Loop writes one directory per session under an artifact root such as `artifacts/sessions`.

```text
artifacts/sessions/
  session_abc/
    session.json
    actions.jsonl
    trace.jsonl
    manifest.json
    screenshots/
      latest.png
    logs/
      daemon.log
    metadata/
      environment.json
    video/
    build/
```

## Required Session Record

`session.json` stores the current session object using `schemaVersion: "atlas-loop.session.v1"`. The session `id` should match the directory name. `artifactDir` should resolve to the session directory or a child path inside it.
Modern sessions also include a recognized `status`, ISO `createdAt` and
`updatedAt` timestamps, and a `simulator` object. A malformed session record is
an error because the artifact tree can no longer be tied to one local run.

## Action Records

`actions.jsonl` is append-only. Each line is a JSON object with:

```json
{
  "action": {
    "id": "act_123",
    "sessionId": "session_abc",
    "kind": "screenshot",
    "createdAt": "2026-07-04T00:00:00.000Z"
  },
  "result": {
    "actionId": "act_123",
    "ok": true,
    "startedAt": "2026-07-04T00:00:00.000Z",
    "endedAt": "2026-07-04T00:00:00.100Z",
    "artifacts": []
  }
}
```

Partially completed sessions may contain action lines without results. Invalid JSONL lines are validator errors.
When a result is present, `actionId` must match `action.id`, `ok` must be a
boolean, `startedAt` and `endedAt` must be ISO timestamps, and `artifacts` must
be an array. Result `error` values, when present, should include string `code`
and `message` fields; incomplete legacy error payloads are reported as warnings.

## Manifest

`manifest.json`, when present, is an object using
`schemaVersion: "atlas-loop.manifest.v1"` with an `artifacts` array. Modern
manifests write `updatedAt`; `createdAt` and `updatedAt` are validated as ISO
timestamps when present. Manifest artifact entries use the same artifact
reference rules as action-result artifacts.

## Artifact References

Artifact references are stored in action results and may also appear in `manifest.json`.
The daemon can recover artifact references from both places when it reads a
session after restart. Duplicate references are collapsed by artifact id and
path.

Artifact path containment rules:

- `screenshot` paths must be inside `screenshots/`.
- `log` paths must be inside `logs/`.
- `metadata` paths must be inside `metadata/`.
- `video` paths must be inside `video/`.
- `app-bundle` paths must be inside `build/`.
- `trace` and `action` paths must remain inside the session directory.

The validator checks both the string path and the filesystem realpath so symlinks cannot escape the session directory.
Artifact references must include an ISO `createdAt`. If `sha256` is present, it
must be a 64-character hex SHA-256 digest and the validator recomputes it
against the referenced local file. Hashes are optional so old artifacts remain
readable, but a present mismatched hash is an error.

Artifact `metadata`, when present, must be an object.

## Optional Proof File References

Session records, manifests, and artifact metadata may reference already-written
local proof files using `summaryPath`, `reportPath`, `proofPath`,
`evidenceReportPath`, or a `proofFiles` object with `summary`, `report`,
`proof`, or `evidenceReport` string fields. These fields are optional. When one
is present, the validator checks that the referenced file exists and remains
inside the session directory as a regular file; absent proof references are not
warnings or errors.

## HID Action Metadata

Primitive HID actions (`tap`, `typeText`, `swipe`, and `edgeGesture`) write a
metadata artifact for both success and failure:

```text
metadata/hid-action-<sequence>.json
```

The artifact uses `schemaVersion: "atlas-loop.hid-action.v1"` and records the
helper path, selected backend, helper target string, Simulator metadata, attach
options, materialized action, and final result/error. This is intentionally
local diagnostic evidence; it does not claim that the Simulator guest consumed a
host-posted event.

## Persisted Discovery

`GET /v1/sessions`, `GET /v1/sessions/:id`, summary, artifact, event, and latest
screenshot read routes can hydrate sessions directly from this layout after a
daemon restart. Persisted sessions are read-only: mutation routes still require a
live in-memory session.

Malformed session records are skipped. Malformed artifact references are dropped
from the recovered artifact list and reported as summary storage warnings when a
valid session can still be loaded.

The local viewer uses these same read routes. It can follow `latest` or a
concrete session id, show recovered screenshots and artifacts, and surface stale
or incomplete evidence without requiring a cloud service.

## Local Export Bundles

The artifacts package can export one persisted session into a local bundle
outside the session artifact root. By default the bundle path is:

```text
<destination>/<session-id>/
```

Callers may also provide an exact output directory. Export is local-only: it
does not upload, authenticate, or create a zip archive.

Exported bundles preserve the session layout and include `session.json`,
`actions.jsonl`, `trace.jsonl`, `manifest.json`, and the
`screenshots/`, `logs/`, `metadata/`, `video/`, and `build/` subtrees when
present. To keep the bundle portable, `session.json` uses `artifactDir: "."`.
Artifact references in `manifest.json`, `actions.jsonl`, and `trace.jsonl` are
rewritten to relative paths inside the bundle, as are install action `appPath`
values that point at copied build artifacts.

Each bundle also contains an `export.json` file:

```json
{
  "schemaVersion": "atlas-loop.export.v1",
  "sessionId": "session_abc",
  "sourceSessionDir": "/absolute/path/to/artifacts/sessions/session_abc",
  "exportedAt": "2026-07-04T00:00:00.000Z",
  "fileCount": 4,
  "byteCount": 1234,
  "files": [
    {
      "path": "session.json",
      "sizeBytes": 512,
      "sha256": "..."
    }
  ]
}
```

`fileCount`, `byteCount`, and `files` describe the copied session files and do
not include `export.json` itself. Symlinks are checked with realpaths during
export; a symlink that escapes the source session fails the export instead of
being followed.

## Validator

Run:

```sh
npm run verify:artifacts -- artifacts/sessions/session_abc
```

or validate all direct child sessions:

```sh
npm run verify:artifacts -- artifacts/sessions
```

If no target is supplied and `artifacts/sessions` does not exist, the command prints a skip message and exits successfully for fast CI paths.

Warnings are non-fatal. They are meant to keep old or minimal persisted sessions
inspectable while still calling out incomplete evidence such as missing
`actions.jsonl`, `screenshots/`, `logs/`, or `metadata/`. Errors fail the
validator and should be fixed before using the artifact tree as proof. Integrity
checks are local-only: the validator never requires cloud or network access.
