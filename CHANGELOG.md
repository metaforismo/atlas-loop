# Changelog

## 0.2.0 — 2026-07-05

The v0.2 milestone closes the gap between "observer" and "driver": real
headless input, deep replayable evidence, the namesake Atlas map, and app
metrics — delivered as 24 individually tested and merged PRs.

### Reliable real input (xcuitest backend)

- Repo-owned XCUITest driver runner (`native/ios-driver-runner`), the
  WebDriverAgent pattern: an idle-loop UI test serving HTTP on shared
  localhost. No Simulator window, no Accessibility permission.
- `--input-backend xcuitest` sessions drive coordinate taps, swipes, typing,
  and element actions (`tap-element`, `assert-visible`) through a per-UDID
  runner lifecycle manager with build caching, health polling, keep-alive,
  and one-shot self-healing restart.
- The smoke proof is now a real tap-driven checkout
  (`ATLAS_LOOP_SMOKE_INPUT_BACKEND=xcuitest npm run smoke:ios`): eleven
  verified steps from catalog to confirmation with per-step accessibility
  assertions, replacing the launch-argument shortcut. Every input-action
  artifact records its backend.
- Real input immediately caught a real bug: the demo app's
  `navigationDestination` captured stale `@State` (empty cart after
  add-to-cart) — invisible to launch-argument proofs, fixed with bindings.

### Evidence depth

- Automatic post-action screenshots (`role: "after"`) linking every input
  action to what the screen looked like afterwards.
- Session video recording (`--record`, `recording start|stop`) built on a
  start/stop `simctl recordVideo` handle; videos are artifacts anchored by
  `videoStartedAt` for replay alignment.
- Viewer: video replay panel with action markers and click-to-seek, and a
  before/after action evidence panel with tap-coordinate overlays.
- Daemon artifact content route with HTTP Range support (video seeking,
  image previews) and a real SSE trace-event stream.

### Atlas map

- `packages/atlas-map`: zero-dependency PNG decoding + dHash perceptual
  hashing with a sha256-keyed cache.
- Deterministic map derivation from session evidence: screens clustered by
  hash (explicit `screenId` metadata wins), transitions labeled by the
  causing action's signature, `__launch__` entry node, stable output.
- Surfaces everywhere: CLI `map build`/`map show`, daemon
  `GET /v1/atlas/map` (+ rebuild + screen image routes), MCP `atlas.getMap`,
  and a viewer Atlas view (`?view=atlas`) with a screens grid and a
  pan/zoom transition graph.

### Metrics and reporting

- Per-session CPU/RSS sampling of the launched app pid into
  `metadata/metrics-*.jsonl`, exposed via `GET /v1/sessions/:id/metrics`
  and viewer sparklines with action markers.
- Self-contained HTML evidence reports (`evidence report --format html`):
  one dark-themed file with inlined screenshots, action table, metrics
  sparklines, and a relative video reference. No external requests.

### Fixed

- Error fidelity: spreading `Error`-subclass AtlasLoopErrors dropped their
  non-enumerable `message` (surfacing as `COMMAND_FAILED "[object Object]"`).
- Daemon shutdown now closes spawned driver runners (no orphaned
  `xcodebuild` children); stale runners are killed before restart.
- The artifact validator accepts the element action kinds.
- Demo app stale-`@State` cart bug (see above).

## 0.1.0

Initial public release: local-first daemon, CLI, MCP server, React viewer,
evidence + handoff bundle pipeline, CGEvent input backend, deterministic
SwiftUI commerce demo.
