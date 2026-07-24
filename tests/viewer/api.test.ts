import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildViewerActionRequest,
  createViewerSession,
  fetchArtifactHealth,
  fetchSessionHistory,
  fetchSessions,
  markScreenshotFetchFailed,
  mergeScreenshotFetchResult,
  normalizeArtifactHealth,
  normalizeArtifactList,
  normalizeEventList,
  normalizeScreenshotPayload,
  normalizeSessionHistory,
  normalizeSessionList,
  performViewerAction,
  screenshotArtifactIdentity,
  screenshotObjectUrl,
  toResourceUrl
} from "../../apps/viewer/src/api.js";
import type { ArtifactRef, ScreenshotState, SessionSummary } from "../../apps/viewer/src/types.js";

describe("viewer api normalizers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serializes viewer primitive action drafts for daemon endpoints", () => {
    expect(buildViewerActionRequest({ kind: "screenshot", reason: " manual check " })).toEqual({
      endpoint: "screenshot",
      body: { reason: "manual check" }
    });
    expect(buildViewerActionRequest({ kind: "wait", durationMs: "250" })).toEqual({
      endpoint: "actions",
      body: { action: { kind: "wait", durationMs: 250 } }
    });
    expect(buildViewerActionRequest({ kind: "tap", x: "0.25", y: "0.75" })).toEqual({
      endpoint: "actions",
      body: { action: { kind: "tap", x: 0.25, y: 0.75 } }
    });
    expect(buildViewerActionRequest({ kind: "typeText", text: " hello " })).toEqual({
      endpoint: "actions",
      body: { action: { kind: "typeText", text: " hello " } }
    });
    expect(
      buildViewerActionRequest({
        kind: "swipe",
        from: { x: "0.5", y: "0.8" },
        to: { x: "0.5", y: "0.2" },
        durationMs: "300"
      })
    ).toEqual({
      endpoint: "actions",
      body: {
        action: {
          kind: "swipe",
          from: { x: 0.5, y: 0.8 },
          to: { x: 0.5, y: 0.2 },
          durationMs: 300
        }
      }
    });
    expect(buildViewerActionRequest({ kind: "edgeGesture", edge: "left", distance: "0.55", durationMs: "320" })).toEqual({
      endpoint: "actions",
      body: { action: { kind: "edgeGesture", edge: "left", distance: 0.55, durationMs: 320 } }
    });
  });

  it("serializes element action drafts with trimmed identifiers and optional timeouts", () => {
    expect(buildViewerActionRequest({ kind: "tapElement", identifier: " cart.continue ", timeoutMs: "4000" })).toEqual({
      endpoint: "actions",
      body: { action: { kind: "tapElement", identifier: "cart.continue", timeoutMs: 4000 } }
    });
    expect(buildViewerActionRequest({ kind: "assertVisible", identifier: "confirmation", timeoutMs: "" })).toEqual({
      endpoint: "actions",
      body: { action: { kind: "assertVisible", identifier: "confirmation" } }
    });
    expect(() => buildViewerActionRequest({ kind: "tapElement", identifier: "  " })).toThrow(
      "tapElement requires an accessibility identifier"
    );
    expect(() => buildViewerActionRequest({ kind: "assertVisible", identifier: "x", timeoutMs: "-1" })).toThrow(
      "assertVisible timeout must be"
    );
  });

  it("rejects invalid local viewer action values before posting", () => {
    expect(() => buildViewerActionRequest({ kind: "tap", x: "1.2", y: "0.5" })).toThrow("tap x must be between 0 and 1");
    expect(() => buildViewerActionRequest({ kind: "tap", x: "", y: "0.5" })).toThrow("tap x is required");
    expect(() => buildViewerActionRequest({ kind: "typeText", text: "" })).toThrow("type text must not be empty");
    expect(buildViewerActionRequest({ kind: "typeText", text: "   " })).toEqual({
      endpoint: "actions",
      body: { action: { kind: "typeText", text: "   " } }
    });
    expect(() =>
      buildViewerActionRequest({
        kind: "swipe",
        from: { x: "0.5", y: "0.8" },
        to: { x: "0.5", y: "-0.1" },
        durationMs: "300"
      })
    ).toThrow("swipe to y must be between 0 and 1");
    expect(() => buildViewerActionRequest({ kind: "edgeGesture", edge: "right", distance: "1.1", durationMs: "320" })).toThrow(
      "edge gesture distance must be between 0 and 1"
    );
  });

  it("posts viewer actions and preserves daemon error messages", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ ok: true, data: { actionId: "act_1", ok: true, artifacts: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const result = await performViewerAction(
      { daemonUrl: "http://127.0.0.1:4317/", sessionId: "sess 1" },
      { kind: "tap", x: "0.25", y: "0.75" }
    );

    expect(result).toEqual({ actionId: "act_1", ok: true, artifacts: [] });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/v1/sessions/sess%201/actions",
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ action: { kind: "tap", x: 0.25, y: 0.75 } });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "active session not found: sess_old" } }), {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "application/json" }
      })
    );

    await expect(
      performViewerAction({ daemonUrl: "http://127.0.0.1:4317", sessionId: "sess_old" }, { kind: "screenshot" })
    ).rejects.toMatchObject({ message: "active session not found: sess_old", status: 404 });
  });

  it("creates a viewer session with normalized local runtime options", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ ok: true, data: { id: "sess_new", status: "created", inputBackend: "xcuitest" } }), {
        status: 201,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createViewerSession("http://127.0.0.1:4317/", {
        simulatorName: "  iPhone 16 Pro  ",
        inputBackend: "xcuitest",
        record: true
      })
    ).resolves.toMatchObject({ id: "sess_new", status: "created" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/v1/sessions",
      expect.objectContaining({ method: "POST" })
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      simulator: { name: "iPhone 16 Pro" },
      viewer: true,
      inputBackend: "xcuitest",
      record: true
    });
  });

  it("fetches artifact health from the session-scoped daemon endpoint", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            ok: true,
            target: "/tmp/atlas-loop/sess_1",
            sessionId: "sess_1",
            requestedSessionId: "latest",
            source: "disk",
            artifactDir: "/tmp/atlas-loop/sess_1",
            report: { ok: true, target: "/tmp/atlas-loop/sess_1", sessionCount: 1, issues: [] },
            summary: { sessionCount: 1, errorCount: 0, warningCount: 0, issueCount: 0 }
          }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchArtifactHealth({ daemonUrl: "http://127.0.0.1:4317/", sessionId: "latest" })).resolves.toMatchObject({
      ok: true,
      sessionId: "sess_1",
      requestedSessionId: "latest",
      source: "disk",
      summary: { sessionCount: 1, errorCount: 0, warningCount: 0, issueCount: 0 }
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/v1/sessions/latest/artifacts/health",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("normalizes artifact health and infers counts from validation issues", () => {
    expect(
      normalizeArtifactHealth({
        ok: false,
        target: "/tmp/atlas-loop/sess_bad",
        sessionId: "sess_bad",
        report: {
          ok: false,
          sessionCount: 1,
          issues: [
            { severity: "error", path: "/tmp/atlas-loop/sess_bad/session.json", message: "session status is not recognized" },
            { severity: "warning", path: "/tmp/atlas-loop/sess_bad/logs", message: "logs directory is missing" },
            "loose validator note"
          ]
        },
        summary: { sessionCount: "1" }
      })
    ).toEqual({
      ok: false,
      target: "/tmp/atlas-loop/sess_bad",
      sessionId: "sess_bad",
      requestedSessionId: undefined,
      source: undefined,
      artifactDir: undefined,
      report: {
        ok: false,
        target: undefined,
        sessionCount: 1,
        issues: [
          { severity: "error", path: "/tmp/atlas-loop/sess_bad/session.json", message: "session status is not recognized" },
          { severity: "warning", path: "/tmp/atlas-loop/sess_bad/logs", message: "logs directory is missing" },
          { message: "loose validator note" }
        ]
      },
      summary: {
        sessionCount: 1,
        errorCount: 1,
        warningCount: 1,
        issueCount: 3
      }
    });

    expect(normalizeArtifactHealth(null)).toBeUndefined();
    expect(normalizeArtifactHealth({})).toBeUndefined();
    expect(normalizeArtifactHealth({ ok: true })).toBeUndefined();
    expect(normalizeArtifactHealth({ ok: true, summary: {} })).toBeUndefined();
    expect(normalizeArtifactHealth({ ok: true, report: {} })).toBeUndefined();
  });

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
        sessionId: "session_1",
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

  it("normalizes session history envelopes, wrapped lists, raw arrays, and raw objects", () => {
    const historyItem = {
      sessionId: "sess_history",
      session: {
        id: "sess_history",
        status: "running",
        createdAt: "2026-07-04T09:00:00.000Z",
        updatedAt: "2026-07-04T09:00:08.000Z",
        simulator: { name: "iPhone 16" },
        app: { bundleId: "dev.atlas.loop" }
      },
      storage: { source: "memory", artifactBacked: true, warningCount: 0 },
      artifacts: {
        total: 2,
        byType: { screenshot: 1, log: 1 },
        latestScreenshotPath: "/tmp/atlas-loop/sess_history/screenshots/latest.png"
      },
      events: {
        total: 7,
        latestAction: { actionId: "act_1", ok: true, artifactCount: 1 }
      },
      canMutate: true,
      hasScreenshot: true,
      ready: true
    };

    expect(
      normalizeSessionHistory({
        schemaVersion: "atlas-loop.session-history.v1",
        generatedAt: "2026-07-05T10:00:00.000Z",
        total: 1,
        count: 1,
        limit: 30,
        sessions: [historyItem]
      })
    ).toEqual([
      expect.objectContaining({
        id: "sess_history",
        sessionId: "sess_history",
        status: "running",
        updatedAt: "2026-07-04T09:00:08.000Z",
        storage: { source: "memory", artifactBacked: true, warningCount: 0, warnings: undefined },
        artifacts: expect.objectContaining({ total: 2, latestScreenshotPath: "/tmp/atlas-loop/sess_history/screenshots/latest.png" }),
        events: {
          total: 7,
          latestAction: {
            actionId: "act_1",
            ok: true,
            artifactCount: 1,
            artifacts: undefined,
            endedAt: undefined,
            error: undefined,
            startedAt: undefined
          },
          latestError: undefined
        },
        canMutate: true,
        hasScreenshot: true,
        ready: true
      })
    ]);

    expect(normalizeSessionHistory({ sessions: [historyItem] }).map((session) => session.id)).toEqual(["sess_history"]);
    expect(normalizeSessionHistory([historyItem]).map((session) => session.id)).toEqual(["sess_history"]);
    expect(normalizeSessionHistory({ id: "raw_session", status: "ended" })).toEqual([
      expect.objectContaining({ id: "raw_session", status: "ended" })
    ]);
  });

  it("prefers session history and falls back to the old sessions endpoint on a missing history route", async () => {
    const history = {
      schemaVersion: "atlas-loop.session-history.v1",
      generatedAt: "2026-07-05T10:00:00.000Z",
      total: 1,
      count: 1,
      limit: 12,
      sessions: [
        {
          sessionId: "sess_history",
          session: { id: "sess_history", status: "running", updatedAt: "2026-07-05T10:00:00.000Z" },
          storage: { source: "disk", warningCount: 1 },
          artifacts: { total: 4, latestScreenshotPath: "screenshots/latest.png" },
          events: { total: 9, latestAction: { actionId: "act_last", ok: false, artifactCount: 0 } },
          hasScreenshot: true
        }
      ]
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "http://127.0.0.1:4317/v1/sessions/history?limit=12") return jsonResponse(history);
      if (url === "http://127.0.0.1:4317/v1/sessions/history") {
        return new Response(JSON.stringify({ ok: false, error: { message: "route not found" } }), {
          status: 500,
          statusText: "Internal Server Error",
          headers: { "content-type": "application/json" }
        });
      }
      if (url === "http://127.0.0.1:4317/v1/sessions") {
        return jsonResponse({ sessions: [{ id: "sess_legacy", status: "ended" }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSessionHistory("http://127.0.0.1:4317", 12)).resolves.toEqual([
      expect.objectContaining({
        id: "sess_history",
        status: "running",
        storage: expect.objectContaining({ source: "disk", warningCount: 1 }),
        artifacts: expect.objectContaining({ total: 4, latestScreenshotPath: "screenshots/latest.png" }),
        events: expect.objectContaining({
          total: 9,
          latestAction: expect.objectContaining({ actionId: "act_last", ok: false, artifactCount: 0 })
        }),
        hasScreenshot: true
      })
    ]);

    await expect(fetchSessions("http://127.0.0.1:4317")).resolves.toEqual([
      expect.objectContaining({ id: "sess_legacy", status: "ended" })
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/v1/sessions/history",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/v1/sessions",
      expect.objectContaining({ cache: "no-store" })
    );
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

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
