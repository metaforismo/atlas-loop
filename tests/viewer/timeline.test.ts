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
});
