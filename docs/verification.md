# Verification Guide

Atlas Loop has two verification lanes. The default lane is safe for CI and does
not require a booted Simulator. The Simulator lane is local and host-gated
because it depends on macOS, Xcode, `xcrun simctl`, a booted iOS Simulator, and
sometimes Accessibility permission for native input.

The scope remains v1 local-only: macOS plus iOS Simulator, loopback daemon,
local viewer, local MCP server, and filesystem artifacts. Verification should
not require cloud execution, hosted auth, team sharing, Android automation,
Revyl, serve-sim, or XcodeBuildMCP runtime dependencies.

## Non-Simulator Checks

Run this before opening a PR and in CI:

```sh
bash scripts/verify-local.sh --no-smoke
```

It performs:

- Dependency install when `node_modules` is missing.
- `npm run typecheck`.
- `npm test`.
- `npm run test:viewer` when viewer tests exist.
- `npm run build`.
- `npm run verify:artifacts`.

These checks validate TypeScript contracts, daemon/client/MCP behavior covered
by unit tests, viewer presentation logic, workspace builds, and artifact format
integrity. They do not prove that a Simulator can boot, install an app, or
consume HID input.

Viewer tests also cover the local interaction path that does not need a
Simulator: primitive action draft serialization, local validation before
posting, daemon error propagation, event normalization, timeline merging,
timeline filters, and artifact health presentation. Treat that as viewer
interaction coverage only; it does not prove the macOS CGEvent backend was
accepted by the guest app.

## Simulator Smoke

Run this on a macOS/Xcode host when the change touches Simulator runtime,
SwiftUI demo behavior, app build/install/launch, screenshots, native helper
integration, or smoke scripts:

```sh
npm run smoke:ios
# or
bash scripts/verify-local.sh --smoke-ios
```

By default the smoke path builds the helper, builds the deterministic commerce
demo, creates a daemon session, installs and launches the app, captures a local
screenshot, and validates artifacts. It uses
`ATLAS_LOOP_SMOKE_DEMO_ROUTE=confirmation` unless overridden. Set it to `none`
to disable the demo route proof, or to another supported demo route when a
focused screen proof is needed.

The smoke script prints `SKIP` and exits successfully when the required host
pieces are unavailable. In a dedicated Simulator environment, set:

```sh
ATLAS_LOOP_SMOKE_REQUIRE=1
```

That turns host-gated skips into failures.

## Native Input Proof

The headless proof is the xcuitest checkout-by-tap smoke:

```sh
ATLAS_LOOP_SMOKE_INPUT_BACKEND=xcuitest npm run smoke:ios
```

It drives the demo checkout end to end with real element taps through the
XCUITest driver runner (no Simulator window or Accessibility permission),
asserts each screen by accessibility identifier, captures per-step
screenshots, and verifies that every `metadata/input-action-*.json` artifact
records `inputBackend: "xcuitest"`. Set `ATLAS_LOOP_SMOKE_UDID` to pin a
booted simulator when several are running.

The CGEvent backend remains host-gated: it needs a visible Simulator window
and Accessibility permission for the helper process, and a demo-route
screenshot only proves launch state, not consumed input.

For native multi-touch proof, launch the demo's instrumented Gesture Lab and
target its accessibility element:

```sh
npm run cli -- session start --udid "$ATLAS_LOOP_SMOKE_UDID" --input-backend xcuitest
npm run cli -- launch --session latest --bundle-id app.atlasloop.CommerceDemo \
  --args=--atlas-demo-route,gesture-lab
npm run cli -- assert-visible --session latest --id gesture-lab.canvas
npm run cli -- pinch --session latest --scale 1.3 --velocity 0.8 --id gesture-lab.canvas
npm run cli -- rotate --session latest --radians 1.57 --velocity 1 --id gesture-lab.canvas
npm run cli -- two-finger-tap --session latest --id gesture-lab.canvas
```

The after-screenshots and `metadata/input-action-*.json` records must name the
gesture kind, `xcuitest` backend, target identifier when supplied, and `ok: true`.

For protocol compatibility checks without a booted Simulator:

```sh
swift build --package-path native/ios-hid-helper
node scripts/check-hid-helper-protocol.mjs native/ios-hid-helper/.build/debug/ios-hid-helper
node scripts/check-driver-runner-protocol.mjs --url http://127.0.0.1:4700   # against a running runner
```

For a CGEvent primitive-input proof, include the host setup in the PR notes:

- Simulator model and runtime.
- Whether the Simulator window was visible.
- Whether Accessibility permission was granted.
- CLI or MCP actions issued.
- Latest screenshot path and artifact health result.
- Any input-action metadata artifact path under `metadata/`.

## Evidence And Handoff Checklist

For a human or next-agent handoff, run:

```sh
npm run cli -- session ready --session latest
npm run cli -- session history --limit 20
npm run cli -- artifacts health --session latest
npm run cli -- viewer url --session latest
npm run cli -- evidence report --session latest --out artifacts/reports/<session-id>.md
npm run cli -- evidence export --session latest --out artifacts/exports/<session-id>
npm run cli -- events export --session latest --out artifacts/events/<session-id>.json
npm run cli -- session handoff --session latest --bundle artifacts/handoffs/<session-id>
npm run cli -- handoff verify --bundle artifacts/handoffs/<session-id>
```

MCP runtimes can run the same bundle check with `atlas.verifyHandoffBundle`
and `bundleDir`; it is local self-consistency verification and does not call
the daemon or upload data.

Or use the aggregate command:

```sh
npm run cli -- session handoff --session latest
npm run cli -- session handoff --session latest --format markdown --out artifacts/handoffs/<session-id>.md
npm run cli -- session handoff --session latest --bundle artifacts/handoffs/<session-id>
npm run cli -- handoff verify --bundle artifacts/handoffs/<session-id>
```

The handoff note should include the concrete session id, `storage.source`,
`canMutate`, viewer URL, latest screenshot path, artifact health warning/error
counts, and any report or export path. Disk-backed sessions are readable
evidence only; start a fresh live session before issuing new build, launch,
screenshot, or input commands.

Use the viewer timeline for human inspection of action, screenshot, log,
metadata, and artifact-health context. Use the daemon events route when the
handoff needs exact trace JSON, event counts, action ids, or event ordering:

```sh
curl -s "http://127.0.0.1:4317/v1/sessions/latest/events"
atlas-loop events list --session latest --type action.completed --limit 20
atlas-loop events export --session latest --type action.completed --limit 20 --out artifacts/events/latest-actions.json
```

MCP clients can use `atlas.listEvents` for the same read-only trace inspection
or `atlas.exportEvents` when the verification handoff needs a local JSON event
file. MCP clients can use `atlas.verifyHandoffBundle` after a handoff bundle is
created or received. Do not treat `artifacts health`, `session ready`, or
`evidence report` as raw event dumps; they are summary and handoff read models.
Use `session history` or MCP `atlas.listSessionHistory` when the handoff needs
the local evidence history across active and persisted sessions. It is not
cloud storage, provenance signing, or team sharing.

## Reading Artifact Results

`npm run verify:artifacts` and `atlas-loop artifacts verify` are local
filesystem validators. Warnings are non-fatal and usually mean a legacy or
minimal session is still readable but lacks optional evidence such as logs,
metadata, screenshots, or action traces. Errors mean the session record or
artifact references should not be used as proof until fixed.

`atlas-loop artifacts health --session <id|latest>` asks the daemon to resolve
one readable session and validate its local artifact directory. It is useful for
handoff because it also reports whether the session came from live memory or
disk-backed persisted evidence. It does not upload, copy, archive, or mutate
artifacts.

## PR Evidence

A PR should say which lane ran:

- Non-Simulator checks: command and result.
- Simulator smoke: command/result, or why it was not applicable.
- Native input proof: command/result when primitive HID behavior changed.
- Artifact validation: warning-only versus error-free status.
- Viewer interaction coverage: `npm run test:viewer` when viewer action forms,
  event loading, timeline behavior, or artifact inspector behavior changed.
- Docs: any README/docs/API updates required by the behavior change.
