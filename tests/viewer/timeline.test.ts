import { describe, expect, it } from "vitest";
import { buildTimelineItems, mergeTraceEvents, sortArtifacts } from "../../apps/viewer/src/timeline.js";
import type { ArtifactRef, TraceEvent } from "../../apps/viewer/src/types.js";

const screenshotArtifact: ArtifactRef = {
  id: "art_1",
  sessionId: "session_1",
  type: "screenshot",
  path: "screenshots/one.png",
  createdAt: "2026-07-04T09:00:03.000Z"
};

describe("timeline helpers", () => {
  it("orders events and artifacts chronologically while deduping artifact events", () => {
    const events: TraceEvent[] = [
      {
        type: "artifact.created",
        at: "2026-07-04T09:00:03.000Z",
        artifact: screenshotArtifact
      },
      {
        type: "action.started",
        at: "2026-07-04T09:00:02.000Z",
        action: {
          id: "act_1",
          sessionId: "session_1",
          kind: "tap",
          x: 0.5,
          y: 0.75,
          createdAt: "2026-07-04T09:00:02.000Z",
          sequence: 1
        }
      }
    ];

    const items = buildTimelineItems(events, [screenshotArtifact]);

    expect(items.map((item) => item.title)).toEqual(["Tap", "screenshot artifact"]);
    expect(items[0].detail).toBe("0.500, 0.750");
  });

  it("presents element actions as human-readable flow steps", () => {
    const items = buildTimelineItems(
      [
        {
          type: "action.started",
          at: "2026-07-04T09:00:01.000Z",
          action: { id: "act_tap", kind: "tapElement", identifier: "cart.continue" }
        },
        {
          type: "action.started",
          at: "2026-07-04T09:00:02.000Z",
          action: { id: "act_assert", kind: "assertVisible", identifier: "checkout.confirmation" }
        }
      ],
      []
    );

    expect(items.map(({ title, detail }) => ({ title, detail }))).toEqual([
      { title: "Tap element", detail: "cart.continue" },
      { title: "Assert visible", detail: "checkout.confirmation" }
    ]);
  });

  it("merges SSE and polling events by stable event identity", () => {
    const first: TraceEvent = {
      type: "action.completed",
      at: "2026-07-04T09:00:04.000Z",
      result: {
        actionId: "act_1",
        ok: true,
        endedAt: "2026-07-04T09:00:04.000Z",
        artifacts: []
      }
    };
    const second: TraceEvent = {
      type: "session.statusChanged",
      at: "2026-07-04T09:00:01.000Z",
      sessionId: "session_1",
      from: "launching",
      to: "running"
    };

    expect(mergeTraceEvents([first], [second, first]).map((event) => event.type)).toEqual([
      "session.statusChanged",
      "action.completed"
    ]);
  });

  it("sorts artifacts newest first for the metadata panel", () => {
    const artifacts: ArtifactRef[] = [
      {
        id: "old",
        type: "log",
        path: "logs/old.log",
        createdAt: "2026-07-04T08:59:00.000Z"
      },
      {
        id: "new",
        type: "metadata",
        path: "metadata/new.json",
        createdAt: "2026-07-04T09:01:00.000Z"
      }
    ];

    expect(sortArtifacts(artifacts).map((artifact) => artifact.id)).toEqual(["new", "old"]);
  });

  it("annotates completed actions with duration and related artifact metadata", () => {
    const logArtifact: ArtifactRef = {
      id: "log_1",
      sessionId: "session_1",
      type: "log",
      path: "logs/action.log",
      createdAt: "2026-07-04T09:00:01.275Z",
      metadata: { actionId: "act_checkout", actionKind: "tap" }
    };
    const screenshot: ArtifactRef = {
      id: "shot_checkout",
      sessionId: "session_1",
      type: "screenshot",
      path: "screenshots/checkout.png",
      createdAt: "2026-07-04T09:00:01.270Z",
      metadata: { actionId: "act_checkout" }
    };

    const items = buildTimelineItems([
      {
        type: "action.completed",
        at: "2026-07-04T09:00:01.275Z",
        result: {
          actionId: "act_checkout",
          ok: true,
          startedAt: "2026-07-04T09:00:01.000Z",
          endedAt: "2026-07-04T09:00:01.275Z",
          artifacts: [screenshot, logArtifact]
        }
      }
    ], []);

    const completed = items.find((item) => item.id === "event:action.completed:act_checkout");
    expect(completed).toMatchObject({
      actionId: "act_checkout",
      detail: "Passed in 275ms · 2 artifacts: log, screenshot",
      relatedArtifactIds: ["log_1", "shot_checkout"]
    });

    const artifact = items.find((item) => item.id === "artifact:shot_checkout");
    expect(artifact).toMatchObject({
      actionId: "act_checkout",
      artifactId: "shot_checkout",
      artifactType: "screenshot",
      artifactPath: "screenshots/checkout.png",
      detail: "screenshots/checkout.png · action act_checkout"
    });
  });

  it("infers artifact action linkage from action completion payload when metadata is legacy", () => {
    const legacyScreenshot: ArtifactRef = {
      id: "shot_legacy",
      sessionId: "session_1",
      type: "screenshot",
      path: "screenshots/legacy.png",
      createdAt: "2026-07-04T09:00:02.000Z"
    };

    const items = buildTimelineItems([
      {
        type: "action.completed",
        at: "2026-07-04T09:00:02.000Z",
        result: {
          actionId: "act_legacy",
          ok: true,
          endedAt: "2026-07-04T09:00:02.000Z",
          artifacts: [legacyScreenshot]
        }
      }
    ], []);

    expect(items.find((item) => item.id === "artifact:shot_legacy")).toMatchObject({
      actionId: "act_legacy",
      detail: "screenshots/legacy.png · action act_legacy"
    });
  });

  it("keeps legacy artifacts without action metadata backward compatible", () => {
    const legacyArtifact: ArtifactRef = {
      id: "legacy_log",
      type: "log",
      path: "logs/legacy.log",
      createdAt: "2026-07-04T09:00:03.000Z"
    };

    expect(buildTimelineItems([], [legacyArtifact])).toEqual([
      expect.objectContaining({
        id: "artifact:legacy_log",
        title: "log artifact",
        detail: "logs/legacy.log",
        artifactId: "legacy_log",
        artifactType: "log",
        artifactPath: "logs/legacy.log",
        actionId: undefined,
        relatedArtifactIds: undefined
      })
    ]);
  });

  it("dedupes artifact events consistently while preserving richer action correlation", () => {
    const bareArtifact: ArtifactRef = {
      id: "shot_dedupe",
      sessionId: "session_1",
      type: "screenshot",
      path: "screenshots/dedupe.png",
      createdAt: "2026-07-04T09:00:04.000Z"
    };
    const completedEvent: TraceEvent = {
      type: "action.completed",
      at: "2026-07-04T09:00:04.000Z",
      result: {
        actionId: "act_dedupe",
        ok: false,
        startedAt: "2026-07-04T09:00:03.000Z",
        endedAt: "2026-07-04T09:00:04.000Z",
        error: { message: "Button not visible" },
        artifacts: [bareArtifact]
      }
    };
    const artifactEvent: TraceEvent = {
      type: "artifact.created",
      at: "2026-07-04T09:00:04.000Z",
      artifact: bareArtifact
    };

    const artifactFirst = buildTimelineItems([artifactEvent, completedEvent], [bareArtifact]).find(
      (item) => item.id === "artifact:shot_dedupe"
    );
    const completionFirst = buildTimelineItems([completedEvent, artifactEvent], [bareArtifact]).find(
      (item) => item.id === "artifact:shot_dedupe"
    );

    expect(artifactFirst).toEqual(completionFirst);
    expect(artifactFirst).toMatchObject({
      actionId: "act_dedupe",
      detail: "screenshots/dedupe.png · action act_dedupe"
    });
  });

  it("preserves artifact event chronology when manifest artifacts are missing createdAt", () => {
    const recoveredArtifact: ArtifactRef = {
      id: "shot_recovered",
      sessionId: "session_1",
      type: "screenshot",
      path: "screenshots/recovered.png"
    };

    const items = buildTimelineItems([
      {
        type: "session.statusChanged",
        at: "2026-07-04T09:00:01.000Z",
        sessionId: "session_1",
        from: "launching",
        to: "running"
      },
      {
        type: "artifact.created",
        at: "2026-07-04T09:00:05.000Z",
        artifact: recoveredArtifact
      }
    ], [recoveredArtifact]);

    expect(items.map((item) => item.id)).toEqual([
      "event:session.status:session_1:2026-07-04T09:00:01.000Z:running",
      "artifact:shot_recovered"
    ]);
    expect(items[1]).toMatchObject({
      artifactId: "shot_recovered",
      sortKey: Date.parse("2026-07-04T09:00:05.000Z")
    });
  });
});
