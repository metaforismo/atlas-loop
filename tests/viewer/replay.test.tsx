// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReplayPanel } from "../../apps/viewer/src/components/ReplayPanel.js";
import type { ArtifactRef, TraceEvent } from "../../apps/viewer/src/types.js";
import { buildVideoReplayModel } from "../../apps/viewer/src/viewerPresentation.js";

const VIDEO_STARTED_AT = "2026-07-05T10:00:00.000Z";

function videoArtifact(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
  return {
    id: "video_1",
    sessionId: "sess_replay",
    type: "video",
    path: "video/run.mp4",
    createdAt: "2026-07-05T10:01:00.000Z",
    url: "http://127.0.0.1:4317/v1/sessions/sess_replay/artifacts/video_1/content",
    metadata: { videoStartedAt: VIDEO_STARTED_AT, videoEndedAt: "2026-07-05T10:01:00.000Z" },
    ...overrides
  };
}

function actionEvents(): TraceEvent[] {
  return [
    { type: "action.started", at: "2026-07-05T09:59:59.000Z", action: { id: "act_before", kind: "tap", x: 0.5, y: 0.5 } },
    { type: "action.started", at: "2026-07-05T10:00:05.000Z", action: { id: "act_tap", kind: "tapElement", identifier: "cart.continue" } },
    { type: "action.completed", at: "2026-07-05T10:00:06.000Z", result: { actionId: "act_tap", ok: true } },
    { type: "action.started", at: "2026-07-05T10:00:30.500Z", action: { id: "act_fail", kind: "assertVisible", identifier: "missing" } },
    { type: "action.completed", at: "2026-07-05T10:00:31.000Z", result: { actionId: "act_fail", ok: false } },
    { type: "action.started", at: "2026-07-05T10:02:00.000Z", action: { id: "act_after_end", kind: "tap", x: 0.1, y: 0.1 } }
  ];
}

describe("buildVideoReplayModel", () => {
  it("maps action starts to clamped offsets with result tones", () => {
    const model = buildVideoReplayModel([videoArtifact()], actionEvents());

    expect(model).toBeDefined();
    expect(model!.artifact.id).toBe("video_1");
    expect(model!.markers).toHaveLength(2);
    expect(model!.markers[0]).toMatchObject({ actionId: "act_tap", offsetSeconds: 5, ok: true, label: "tap cart.continue" });
    expect(model!.markers[1]).toMatchObject({ actionId: "act_fail", offsetSeconds: 30.5, ok: false, label: "assert missing" });
  });

  it("returns undefined without a video artifact carrying videoStartedAt", () => {
    expect(buildVideoReplayModel([], actionEvents())).toBeUndefined();
    expect(buildVideoReplayModel([videoArtifact({ metadata: {} })], actionEvents())).toBeUndefined();
  });

  it("picks the newest video when several were recorded", () => {
    const older = videoArtifact();
    const newer = videoArtifact({ id: "video_2", createdAt: "2026-07-05T11:00:00.000Z", metadata: { videoStartedAt: "2026-07-05T10:59:00.000Z" } });

    const model = buildVideoReplayModel([older, newer], []);

    expect(model!.artifact.id).toBe("video_2");
  });
});

describe("ReplayPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("seeks the video when a marker is clicked", () => {
    const model = buildVideoReplayModel([videoArtifact()], actionEvents())!;

    act(() => {
      root.render(<ReplayPanel replay={model} />);
    });

    const video = container.querySelector<HTMLVideoElement>("video.replay-video");
    expect(video).not.toBeNull();
    expect(video!.src).toBe(model.artifact.url);

    const markers = container.querySelectorAll<HTMLButtonElement>("button.replay-marker");
    expect(markers).toHaveLength(2);

    act(() => {
      markers[1].click();
    });

    expect(video!.currentTime).toBeCloseTo(30.5, 3);
  });
});
