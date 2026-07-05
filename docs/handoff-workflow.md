# Agent Handoff Workflow

Atlas Loop handoff is the local workflow for passing a Simulator run from a
coding agent to a human operator, reviewer, or another local agent. In v1 the
scope is macOS plus iOS Simulator, with daemon, viewer, artifacts, and exports
all staying on the local machine. There is no cloud sharing, hosted auth, team
workspace, Android automation, Revyl runtime, serve-sim runtime, or
XcodeBuildMCP runtime dependency in this workflow.

## Current Multi-command Flow

Start the daemon on loopback:

```sh
npm run daemon -- --port 4317
```

Start the local viewer in another terminal when live inspection is useful:

```sh
npm run viewer
```

Create a new Simulator session:

```sh
npm run cli -- session start --simulator "iPhone 16" --viewer
```

Or reuse local evidence from an existing session:

```sh
npm run cli -- session list
npm run cli -- session status --session latest
```

For a live session, build, install, and launch the app before handing it off:

```sh
npm run cli -- build --session latest --project apps/ios-commerce-demo/CommerceDemo.xcodeproj --scheme CommerceDemo
npm run cli -- install --session latest --app <path-to-built-app>
npm run cli -- launch --session latest --bundle-id app.atlasloop.CommerceDemo
npm run cli -- screenshot --session latest --reason handoff
```

If the app is already installed or the session was recovered from disk, skip
only the steps that do not apply. Mutation commands such as build, install,
launch, tap, type, swipe, screenshot, and stop require a live in-memory session.
Disk-backed sessions are useful for inspection and evidence export, not for new
Simulator actions.

Before handoff, ask the daemon for the compact readiness view:

```sh
npm run cli -- session ready --session latest
```

The readiness JSON is the operator's first checkpoint. It resolves `latest` to
a concrete `sessionId`, reports the storage source, returns `canMutate`,
includes the local artifact directory, and links the viewer URL. Treat
`canMutate: false` as evidence-only mode, even if the persisted session status
looks like `running`.

Check artifact health through the daemon:

```sh
npm run cli -- artifacts health --session latest
```

Health validates the resolved local artifact directory and returns structured
warnings or errors. Warnings are non-fatal but should be copied into the
handoff note when evidence is incomplete.

Open or copy the viewer URL:

```sh
npm run cli -- viewer url --session latest
npm run cli -- viewer open --session latest --launch
```

Use the viewer to inspect the latest screenshot, action timeline, and artifact
list together. Timeline entries are correlated with trace events and recovered
artifact references, so the operator can move from an action to the screenshot,
log, or metadata file that proves what happened. The Agent handoff panel can
copy a compact note, next steps, local CLI commands, and read-only daemon
checks for the next operator or coding agent. The viewer stays local; the
durable source of truth remains `artifacts/sessions/<session-id>/`.

When the handoff needs exact trace JSON rather than visual correlation, read
events through the daemon route, CLI wrapper, or MCP tool:

```sh
curl -s "http://127.0.0.1:4317/v1/sessions/latest/events"
atlas-loop events list --session latest --type action.completed --limit 20
atlas-loop events export --session latest --type action.completed --limit 20 --out artifacts/events/latest-actions.json
```

Use the viewer timeline for human "what happened?" inspection, especially when
the proof depends on seeing the screenshot, artifact list, action status, and
health warnings together. Use raw events for agent or script inspection,
especially when the proof depends on exact event ordering, event counts,
action ids, or payload fields from `trace.jsonl`. MCP clients can call
`atlas.listEvents` with the same `sessionId`, optional exact `type`, and
optional newest-event `limit`, or `atlas.exportEvents` with `outPath` when the
handoff should include a durable local JSON event file.

Export local evidence for review or manual archival:

```sh
npm run cli -- evidence report --session latest --out artifacts/reports/<session-id>.md
npm run cli -- evidence export --session latest --out artifacts/exports/<session-id>
npm run cli -- events export --session latest --out artifacts/events/<session-id>.json
npm run cli -- session handoff --session latest --bundle artifacts/handoffs/<session-id>
```

Use the concrete `sessionId` from `session ready` for final report and export
paths when possible. Do not commit `artifacts/`, generated reports, or exported
bundles unless a maintainer explicitly asks for them.

## Single-command Alignment

The preferred operator shortcut is:

```sh
atlas-loop session handoff --session latest
atlas-loop session handoff --session latest --format markdown --out artifacts/handoffs/<session-id>.md
atlas-loop session handoff --session latest --bundle artifacts/handoffs/<session-id>
```

It aligns with the same local-first contract as the multi-command flow:

- Resolve `latest` to a concrete session id.
- Include the `session ready` data, especially `storage.source`, `canMutate`,
  `hasScreenshot`, `artifactDir`, `latestScreenshotPath`, and `viewerUrl`.
- Include daemon-backed `artifacts health` status and warning/error counts.
- Point to a local viewer URL, without requiring a hosted dashboard.
- Include next commands for local report, evidence export, and raw event export
  when the evidence needs to be packaged separately or handed to another agent.
- Optionally persist the selected JSON or Markdown handoff output to a local
  path with `--out`.
- Optionally write a local bundle with `--bundle <dir>`. The bundle contains
  `handoff.json`, `handoff.md`, optional `events.json`, optional
  `evidence-report.md`, and `manifest.json` with `schemaVersion:
  "atlas-loop.handoff-bundle.v1"`, `localOnly: true`, `uploaded: false`, file
  paths, readiness, the resolved session id, and warnings for optional exports
  that could not be generated.
- Avoid mutating disk-backed sessions and avoid uploading, committing, or
  sharing artifacts.

For MCP callers, the matching shortcut is `atlas.getSessionHandoff`. Compose
the same response from `atlas.sessionReady`, `atlas.getArtifactHealth`,
`atlas.getViewerUrl`, `atlas.listEvents`, `atlas.exportEvents`,
`atlas.getEvidenceReport`, and `atlas.exportEvidence` when an agent needs those
individual pieces instead of the aggregate handoff.

## Handoff Note Checklist

A useful handoff note should include:

- Concrete `sessionId` and whether the requested id was `latest`.
- Daemon URL and viewer URL.
- Whether `storage.source` is `memory` or `disk`.
- Whether `canMutate` is true.
- App build, install, and launch status, if those steps were run.
- Latest screenshot path, if present.
- Artifact health result, including any warnings or errors.
- Evidence report path, event export path, or export bundle path, if generated.
- Timeline or artifact correlation notes when a specific action, screenshot,
  log, or metadata file is the important proof.
- Any host-gated limitations, especially Accessibility permission, visible
  Simulator window requirements, or smoke paths that prove launch state rather
  than primitive HID success.

## Restarted Daemon Recovery

After a daemon restart, read-only routes can still recover persisted sessions
from `artifacts/sessions`:

```sh
npm run cli -- session list
npm run cli -- session ready --session latest
npm run cli -- artifacts health --session latest
npm run cli -- viewer open --session latest --launch
```

That recovery path is intentionally evidence-only. Start a fresh session when
the next agent or operator needs to build, install, launch, or drive new input.
