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

## Artifact References

Artifact references are stored in action results and may also appear in `manifest.json`.

Artifact path containment rules:

- `screenshot` paths must be inside `screenshots/`.
- `log` paths must be inside `logs/`.
- `metadata` paths must be inside `metadata/`.
- `video` paths must be inside `video/`.
- `app-bundle` paths must be inside `build/`.
- `trace` and `action` paths must remain inside the session directory.

The validator checks both the string path and the filesystem realpath so symlinks cannot escape the session directory.

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
