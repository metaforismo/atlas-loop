import { describe, expect, it } from "vitest";
import {
  markScreenshotFetchFailed,
  mergeScreenshotFetchResult,
  normalizeArtifactList,
  normalizeEventList,
  normalizeScreenshotPayload,
  normalizeSessionList,
  screenshotArtifactIdentity,
  screenshotObjectUrl,
  toResourceUrl
} from "../../apps/viewer/src/api.js";
import type { ArtifactRef, ScreenshotState, SessionSummary } from "../../apps/viewer/src/types.js";

describe("viewer api normalizers", () => {
  it("accepts raw artifact arrays and wrapped artifact collections", () => {
    const artifact = {
      id: "art_1",
      type: "screenshot",
      path: "screenshots/latest.png"
    };

    expect(normalizeArtifactList([artifact])).toEqual([artifact]);
    expect(normalizeArtifactList({ artifacts: [artifact, { bad: true }] })).toEqual([artifact]);
  });

  it("accepts raw event arrays and wrapped event collections", () => {
    const event = { type: "error", at: "2026-07-04T09:00:00.000Z", error: { message: "Nope" } };

    expect(normalizeEventList([event])).toEqual([event]);
    expect(normalizeEventList({ events: [event, null] })).toEqual([event]);
  });

  it("accepts session arrays, wrapped session collections, and partial daemon fields", () => {
    expect(normalizeSessionList(["session_string"])).toEqual([{ id: "session_string" }]);

    expect(
      normalizeSessionList({
        sessions: [
          {
            sessionId: "session_1",
            state: "running",
            lastUpdatedAt: "2026-07-04T09:00:03.000Z",
            simulator: { name: "iPhone 16" },
            app: { scheme: "Demo" }
          },
          { bad: true }
        ]
      })
    ).toEqual([
      {
        id: "session_1",
        status: "running",
        createdAt: undefined,
        updatedAt: "2026-07-04T09:00:03.000Z",
        simulator: { name: "iPhone 16" },
        app: { scheme: "Demo" },
        artifactDir: undefined,
        viewerUrl: undefined,
        backend: undefined,
        platform: undefined,
        error: undefined
      }
    ]);
  });

  it("turns screenshot JSON payloads into displayable data URLs or daemon URLs", () => {
    expect(normalizeScreenshotPayload({ base64: "abc", mediaType: "image/png" }, "http://127.0.0.1:4317")).toMatchObject({
      status: "ready",
      src: "data:image/png;base64,abc",
      source: "data-url"
    });

    expect(normalizeScreenshotPayload({ path: "/v1/sessions/a/latest-screenshot" }, "http://127.0.0.1:4317")).toMatchObject({
      status: "ready",
      src: "http://127.0.0.1:4317/v1/sessions/a/latest-screenshot",
      source: "url"
    });
  });

  it("resolves relative artifact paths against the daemon", () => {
    expect(toResourceUrl("artifacts/session/log.txt", "http://127.0.0.1:4317/")).toBe(
      "http://127.0.0.1:4317/artifacts/session/log.txt"
    );
  });

  it("builds a stable screenshot identity from summary or artifact metadata", () => {
    const summary = {
      artifacts: {
        latestScreenshotId: "shot-2",
        latestScreenshotPath: "screenshots/two.png",
        latestScreenshotCreatedAt: "2026-07-04T09:00:02.000Z"
      }
    } as SessionSummary;
    const artifacts: ArtifactRef[] = [
      {
        id: "shot-1",
        type: "screenshot",
        path: "screenshots/one.png",
        createdAt: "2026-07-04T09:00:01.000Z",
        sha256: "abc"
      }
    ];

    expect(screenshotArtifactIdentity(summary, artifacts)).toBe("summary:shot-2|screenshots/two.png|2026-07-04T09:00:02.000Z");
    expect(screenshotArtifactIdentity(undefined, artifacts)).toBe("artifact|shot-1|screenshots/one.png|2026-07-04T09:00:01.000Z|abc");
    expect(screenshotArtifactIdentity(undefined, [{ id: "log-1", type: "log", path: "logs/run.log" }])).toBeUndefined();
  });

  it("marks the previous displayable screenshot stale after a transient fetch failure", () => {
    const ready: ScreenshotState = {
      status: "ready",
      src: "blob:latest",
      source: "blob",
      mediaType: "image/png",
      updatedAt: "2026-07-04T09:00:00.000Z"
    };

    expect(markScreenshotFetchFailed(ready, "503 Service Unavailable", "2026-07-04T09:00:05.000Z")).toEqual({
      status: "stale",
      src: "blob:latest",
      source: "blob",
      mediaType: "image/png",
      updatedAt: "2026-07-04T09:00:00.000Z",
      message: "503 Service Unavailable",
      staleAt: "2026-07-04T09:00:05.000Z"
    });
    expect(markScreenshotFetchFailed({ status: "loading" }, "network down")).toEqual({ status: "error", message: "network down" });
    expect(screenshotObjectUrl(ready)).toBe("blob:latest");
    expect(screenshotObjectUrl({ ...ready, source: "url", src: "http://127.0.0.1/shot.png" })).toBeUndefined();
  });

  it("keeps a stable latest screenshot stale when the next fetch returns empty", () => {
    const ready: ScreenshotState = {
      status: "ready",
      src: "blob:latest",
      source: "blob",
      mediaType: "image/png",
      updatedAt: "2026-07-04T09:00:00.000Z"
    };
    const empty: ScreenshotState = { status: "empty", message: "No screenshot captured yet." };

    expect(mergeScreenshotFetchResult(ready, empty, {
      hasStableArtifactKey: true,
      staleAt: "2026-07-04T09:00:05.000Z"
    })).toEqual({
      status: "stale",
      src: "blob:latest",
      source: "blob",
      mediaType: "image/png",
      updatedAt: "2026-07-04T09:00:00.000Z",
      message: "No screenshot captured yet.",
      staleAt: "2026-07-04T09:00:05.000Z"
    });
    expect(mergeScreenshotFetchResult(ready, empty, { hasStableArtifactKey: false })).toEqual(empty);
  });
});
