# Atlas Loop Objective Function

Use this prompt when assigning an agent to improve Atlas Loop.

```text
Build Atlas Loop as a public, local-first, iOS-first verification loop for coding agents.

Primary objective:
Given a macOS machine with Xcode installed, Atlas Loop should let an agent create an iOS
Simulator session, install or launch a build, observe the running app through local
screenshots, perform primitive runtime actions, and leave behind durable filesystem
evidence that proves what happened.

A change improves the project only if it increases at least one of these scores without
weakening the others:

1. Local proof quality
   - Evidence is written under artifacts/sessions/<session-id>/.
   - session.json, manifest.json, actions.jsonl, trace.jsonl, screenshots, logs, and
     metadata are readable after the daemon exits.
   - Persisted sessions remain discoverable by id and by `latest` after daemon
     restarts, with incomplete legacy evidence labeled as warnings rather than
     hidden.
   - Failures are recorded as evidence, not hidden in terminal output.
   - Any host-gated behavior is labeled honestly.

2. Agent operability
   - The CLI and MCP server expose the same core runtime capabilities.
   - Commands return structured data that a coding agent can parse.
   - The daemon binds to loopback and has predictable /v1 routes.
   - A session can be addressed by id, and convenience aliases must not make state
     ambiguous.

3. Simulator fidelity
   - Build, boot, install, launch, screenshot, video, privacy, location, and app control
     use xcodebuild or xcrun simctl.
   - UI input flows through the repo-owned native Swift HID helper and its NDJSON
     protocol.
   - Demo-only shortcuts may exist for deterministic smoke proofs, but they must never
     be described as proof that primitive HID input succeeded.

4. Human inspection
   - The viewer makes the current session, latest screenshot, action timeline, and
     artifacts easy to inspect locally.
   - Disk-backed evidence can be inspected without rerunning the app, while
     mutation commands still require a live session.
   - Empty, offline, failed, and stale-session states are explicit.
   - UI surfaces are operational and dense enough for repeated debugging work.

5. Repository trust
   - The repo stays public-safe: no secrets, no cloud dependency, no hosted auth, no
     Android scope in v1.
   - Tests cover protocol contracts, artifact validation, daemon routes, MCP tools,
     viewer presentation logic, and smoke scripts where practical.
   - Documentation states limitations before marketing benefits.

Non-goals for v1:
- Cloud execution, team sharing, SaaS dashboards, hosted authentication, Android
  automation, Revyl compatibility, serve-sim runtime dependency, or XcodeBuildMCP
  runtime dependency.

Preferred implementation style:
- Keep contracts explicit and versionable.
- Prefer small, typed modules over implicit shell glue.
- Keep artifacts append-only where possible.
- Make every fallback observable.
- Improve one loop end to end before adding broad new surface area.
```

## Review Checklist

- Does the change improve local proof, agent operability, simulator fidelity, human
  inspection, or repository trust?
- Does it keep all v1 non-goals out of the runtime?
- Can a fresh agent discover the behavior from CLI help, MCP tools, daemon responses, or
  docs?
- Can a failed run still be inspected from local artifacts?
- Did verification run far enough to justify the claim in the final answer?
