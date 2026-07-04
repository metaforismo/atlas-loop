import { describe, expect, it } from "vitest";
import {
  artifactHealthIssuePreview,
  artifactHealthPresentation,
  artifactHealthTone,
  artifactDetailRows,
  artifactDisplayName,
  artifactTypeOptions,
  eventModeTone,
  filterArtifacts,
  filterTimelineItems,
  healthTone,
  latestArtifactOfType,
  latestSessionEmptyState,
  sessionSignal,
  sessionTone,
  sessionUpdatedAt,
  sortSessionList,
  summarizeArtifacts,
  timelineFilterOptions,
  visibleArtifactHealth
} from "../../apps/viewer/src/viewerPresentation.js";
import type { ArtifactHealth, ArtifactRef, SessionListItem } from "../../apps/viewer/src/types.js";
import type { TimelineItem } from "../../apps/viewer/src/timeline.js";

describe("viewer presentation helpers", () => {
  it("maps runtime states to UI tones", () => {
    expect(healthTone("online")).toBe("good");
    expect(healthTone("checking")).toBe("warn");
    expect(healthTone("offline")).toBe("bad");

    expect(eventModeTone("sse")).toBe("good");
    expect(eventModeTone("polling")).toBe("warn");
    expect(eventModeTone("connecting")).toBe("neutral");

    expect(sessionTone("running")).toBe("good");
    expect(sessionTone("building")).toBe("warn");
    expect(sessionTone("failed")).toBe("bad");
    expect(sessionTone("ended")).toBe("neutral");
  });

  it("maps artifact health states to operational presentation copy and tones", () => {
    const healthy: ArtifactHealth = {
      ok: true,
      sessionId: "sess_ok",
      source: "disk",
      artifactDir: "/tmp/atlas-loop/sess_ok",
      report: { ok: true, target: "/tmp/atlas-loop/sess_ok", sessionCount: 1, issues: [] },
      summary: { sessionCount: 1, errorCount: 0, warningCount: 0, issueCount: 0 }
    };
    const warning: ArtifactHealth = {
      ...healthy,
      ok: true,
      report: {
        issues: [{ severity: "warning", path: "/tmp/atlas-loop/sess_ok/logs", message: "logs directory is missing" }]
      },
      summary: { sessionCount: 1, errorCount: 0, warningCount: 1, issueCount: 1 }
    };
    const failed: ArtifactHealth = {
      ...warning,
      ok: false,
      report: {
        issues: [{ severity: "error", path: "/tmp/atlas-loop/sess_bad/session.json", message: "session status is not recognized" }]
      },
      summary: { sessionCount: 1, errorCount: 1, warningCount: 0, issueCount: 1 }
    };

    expect(artifactHealthTone(undefined, "loading")).toBe("neutral");
    expect(artifactHealthTone(undefined, "offline")).toBe("bad");
    expect(artifactHealthTone(healthy, "ready")).toBe("good");
    expect(artifactHealthTone(warning, "ready")).toBe("warn");
    expect(artifactHealthTone(failed, "ready")).toBe("bad");

    expect(artifactHealthPresentation(healthy, "ready")).toMatchObject({
      title: "Evidence healthy",
      statusText: "ok",
      tone: "good"
    });
    expect(artifactHealthPresentation(warning, "ready")).toMatchObject({
      title: "Evidence warnings",
      statusText: "ok",
      tone: "warn"
    });
    expect(artifactHealthPresentation(undefined, "error", "404 Not Found")).toMatchObject({
      title: "Health unavailable",
      detail: "404 Not Found",
      statusText: "error",
      tone: "bad"
    });
    expect(visibleArtifactHealth(healthy, "ready")).toBe(healthy);
    expect(visibleArtifactHealth(healthy, "error")).toBeUndefined();
    expect(visibleArtifactHealth(healthy, "loading")).toBeUndefined();
  });

  it("formats artifact health issue previews for compact inspector display", () => {
    const health: ArtifactHealth = {
      ok: false,
      report: {
        issues: [
          { severity: "error", path: "/tmp/atlas-loop/sess_bad/session.json", message: "session status is not recognized" },
          { severity: "warning", path: "/tmp/atlas-loop/sess_bad/logs", message: "logs directory is missing" },
          { message: "unknown validator issue" }
        ]
      },
      summary: { sessionCount: 1, errorCount: 1, warningCount: 1, issueCount: 3 }
    };

    expect(artifactHealthIssuePreview(health, 2)).toEqual([
      {
        severity: "error",
        tone: "bad",
        message: "session status is not recognized",
        path: "/tmp/atlas-loop/sess_bad/session.json"
      },
      {
        severity: "warning",
        tone: "warn",
        message: "logs directory is missing",
        path: "/tmp/atlas-loop/sess_bad/logs"
      }
    ]);
    expect(artifactHealthIssuePreview(health, 3)[2]).toMatchObject({ severity: "issue", tone: "neutral" });
  });

  it("summarizes artifacts by frequency and type", () => {
    const artifacts: ArtifactRef[] = [
      { id: "log-1", type: "log", path: "logs/one.txt" },
      { id: "shot-1", type: "screenshot", path: "screenshots/one.png" },
      { id: "log-2", type: "log", path: "logs/two.txt" },
      { id: "meta-1", type: "metadata", path: "metadata/session.json" }
    ];

    expect(summarizeArtifacts(artifacts)).toEqual([
      { type: "log", count: 2 },
      { type: "metadata", count: 1 },
      { type: "screenshot", count: 1 }
    ]);
  });

  it("sorts and labels session browser rows with missing fields", () => {
    const sessions: SessionListItem[] = [
      { id: "older", createdAt: "2026-07-04T08:00:00.000Z" },
      {
        id: "newer",
        status: "running",
        updatedAt: "2026-07-04T09:00:00.000Z",
        simulator: { name: "iPhone 16 Pro" },
        app: { bundleId: "com.example.demo" }
      },
      { id: "middle", updatedAt: "2026-07-04T08:30:00.000Z", app: { scheme: "Demo" } }
    ];

    expect(sortSessionList(sessions).map((session) => session.id)).toEqual(["newer", "middle", "older"]);
    expect(sessionSignal(sessions[1])).toBe("iPhone 16 Pro / com.example.demo");
    expect(sessionSignal(sessions[2])).toBe("Demo");
    expect(sessionSignal(sessions[0])).toBe("No simulator or app metadata");
    expect(sessionUpdatedAt(sessions[0])).toBe("2026-07-04T08:00:00.000Z");
  });

  it("finds the newest artifact of a type from the sorted artifact list", () => {
    const artifacts: ArtifactRef[] = [
      { id: "new-shot", type: "screenshot", path: "screenshots/new.png" },
      { id: "log", type: "log", path: "logs/run.txt" },
      { id: "old-shot", type: "screenshot", path: "screenshots/old.png" }
    ];

    expect(latestArtifactOfType(artifacts, "screenshot")?.id).toBe("new-shot");
    expect(latestArtifactOfType(artifacts, "video")).toBeUndefined();
  });

  it("builds artifact filters, searches metadata, and formats artifact details", () => {
    const artifacts: ArtifactRef[] = [
      {
        id: "shot-login",
        sessionId: "session_1",
        type: "screenshot",
        path: "screenshots/login.png",
        createdAt: "2026-07-04T09:00:03.000Z",
        sha256: "abcdef1234567890abcdef1234567890",
        metadata: { screen: "login", actionId: "act_9" }
      },
      { id: "trace-1", type: "trace", path: "traces/run.json" },
      { id: "log-1", type: "log", path: "logs/run.log" }
    ];

    expect(artifactTypeOptions(artifacts)).toEqual([
      { value: "all", label: "All", count: 3 },
      { value: "log", label: "log", count: 1 },
      { value: "screenshot", label: "screenshot", count: 1 },
      { value: "trace", label: "trace", count: 1 }
    ]);
    expect(filterArtifacts(artifacts, { type: "screenshot", query: "login" }).map((artifact) => artifact.id)).toEqual(["shot-login"]);
    expect(filterArtifacts(artifacts, { type: "all", query: "act_9" }).map((artifact) => artifact.id)).toEqual(["shot-login"]);
    expect(artifactDisplayName(artifacts[0])).toBe("login.png");
    expect(artifactDetailRows(artifacts[0])).toEqual(
      expect.arrayContaining([
        { label: "ID", value: "shot-login", mono: true },
        { label: "Session", value: "session_1", mono: true },
        { label: "Path", value: "screenshots/login.png", mono: true },
        { label: "SHA-256", value: "abcdef1234567890abcdef1234567890", mono: true },
        { label: "Metadata", value: "actionId, screen" }
      ])
    );
  });

  it("filters timeline items by source class and search text", () => {
    const items: TimelineItem[] = [
      {
        id: "event:action.started:act_1",
        at: "2026-07-04T09:00:01.000Z",
        sourceType: "event",
        title: "Tap",
        detail: "0.500, 0.750",
        tone: "accent",
        sortKey: 1
      },
      {
        id: "artifact:shot_1",
        at: "2026-07-04T09:00:02.000Z",
        sourceType: "artifact",
        title: "screenshot artifact",
        detail: "screenshots/login.png",
        tone: "good",
        sortKey: 2
      },
      {
        id: "event:session.status:session_1:2026-07-04T09:00:03.000Z:running",
        at: "2026-07-04T09:00:03.000Z",
        sourceType: "event",
        title: "Status running",
        detail: "launching -> running",
        tone: "good",
        sortKey: 3
      },
      {
        id: "event:error:session_1:2026-07-04T09:00:04.000Z:Element missing",
        at: "2026-07-04T09:00:04.000Z",
        sourceType: "event",
        title: "E_UI",
        detail: "Element missing",
        tone: "bad",
        sortKey: 4
      }
    ];

    expect(timelineFilterOptions(items).map(({ value, count }) => [value, count])).toEqual([
      ["all", 4],
      ["actions", 1],
      ["artifacts", 1],
      ["sessions", 1],
      ["errors", 1]
    ]);
    expect(filterTimelineItems(items, { filter: "actions", query: "tap" }).map((item) => item.id)).toEqual([
      "event:action.started:act_1"
    ]);
    expect(filterTimelineItems(items, { filter: "artifacts", query: "login" }).map((item) => item.id)).toEqual(["artifact:shot_1"]);
    expect(filterTimelineItems(items, { filter: "errors", query: "element" }).map((item) => item.id)).toEqual([
      "event:error:session_1:2026-07-04T09:00:04.000Z:Element missing"
    ]);
  });

  it("describes the latest-session first-run state by daemon health", () => {
    expect(latestSessionEmptyState("online").title).toBe("Following latest session");
    expect(latestSessionEmptyState("checking").title).toBe("Checking latest session");
    expect(latestSessionEmptyState("offline").title).toBe("Daemon offline");
  });
});
