import { describe, expect, it } from "vitest";
import {
  artifactHealthIssuePreview,
  artifactHealthPresentation,
  artifactHealthTone,
  artifactDetailRows,
  artifactDisplayName,
  artifactTypeOptions,
  buildAgentHandoffBrief,
  eventModeTone,
  filterArtifacts,
  filterTimelineItems,
  healthTone,
  latestArtifactOfType,
  latestSessionEmptyState,
  sessionEvidenceChips,
  sessionSignal,
  sessionTone,
  sessionUpdatedAt,
  sortSessionList,
  summarizeArtifacts,
  timelineFilterOptions,
  visibleArtifactHealth
} from "../../apps/viewer/src/viewerPresentation.js";
import type { AgentHandoffInput } from "../../apps/viewer/src/viewerPresentation.js";
import type { ArtifactHealth, ArtifactRef, Session, SessionHistoryItem, SessionListItem, SessionSummary, TraceEvent } from "../../apps/viewer/src/types.js";
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

  it("derives a ready agent handoff brief from loaded session evidence", () => {
    const brief = buildAgentHandoffBrief(handoffInput());
    const bundleCommand =
      "atlas-loop session handoff --session 'sess_1' --bundle './atlas-loop-handoffs/sess_1' --viewer-base-url 'http://127.0.0.1:5173' --daemon-url 'http://127.0.0.1:4317'";
    const bundleVerifyCommand = "atlas-loop handoff verify --bundle './atlas-loop-handoffs/sess_1'";
    const mcpVerifyToolCall = 'atlas.verifyHandoffBundle({"bundleDir":"./atlas-loop-handoffs/sess_1"})';

    expect(brief).toMatchObject({
      readiness: "ready",
      title: "Ready for handoff",
      tone: "good",
      latestScreenshot: {
        path: "screenshots/latest.png",
        source: "blob",
        tone: "good"
      },
      latestAction: {
        label: "Last action passed",
        tone: "good"
      },
      notices: []
    });
    expect(brief.identifiers).toEqual(
      expect.arrayContaining([
        { label: "Viewer", value: "latest", mono: true },
        { label: "Session", value: "sess_1", mono: true },
        { label: "Daemon", value: "http://127.0.0.1:4317", mono: true }
      ])
    );
    expect(brief.nextSteps).toContain("Pass the daemon URL and resolved session id to the next agent.");
    expect(brief.copyPayloads.map((payload) => payload.id)).toEqual(["note", "nextSteps", "commands"]);
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toEqual(expect.stringContaining("Atlas Loop handoff"));
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toEqual(expect.stringContaining("Status: ready"));
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toEqual(expect.stringContaining("Session: sess_1"));
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toEqual(expect.stringContaining("Blockers/warnings:\n- none"));
    expect(brief.copyPayloads.find((payload) => payload.id === "nextSteps")?.value).toContain(
      "1. Pass the daemon URL and resolved session id to the next agent."
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "nextSteps")?.value).toContain(
      `Bundle verify command:\n${bundleVerifyCommand}`
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "nextSteps")?.value).toContain(
      `MCP verify tool:\n${mcpVerifyToolCall}`
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "commands")?.value).toContain(
      bundleCommand
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "commands")?.value).toContain(
      bundleVerifyCommand
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "commands")?.value).toContain(
      mcpVerifyToolCall
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "commands")?.value).toContain(
      "atlas-loop events export --session 'sess_1' --out './atlas-loop-events/sess_1.json' --daemon-url 'http://127.0.0.1:4317'"
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "commands")?.value).toContain(
      "curl -fsS 'http://127.0.0.1:4317/v1/sessions/sess_1/summary'"
    );
    expect(brief.bundleSummary).toMatchObject({
      label: "Bundle output",
      directory: "./atlas-loop-handoffs/sess_1",
      manifestPath: "./atlas-loop-handoffs/sess_1/manifest.json",
      command: bundleCommand,
      verifyCommand: bundleVerifyCommand,
      mcpVerifyToolCall,
      detail: expect.stringContaining("Local-only output")
    });
    expect(brief.bundleSummary?.detail).toContain("writes handoff.json");
    expect(brief.bundleSummary?.detail).toContain("README.md");
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toContain(
      "Bundle directory: ./atlas-loop-handoffs/sess_1"
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toContain(
      "Bundle manifest: ./atlas-loop-handoffs/sess_1/manifest.json"
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toContain(
      `Bundle verify: ${bundleVerifyCommand}`
    );
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toContain(
      `MCP verify: ${mcpVerifyToolCall}`
    );
    expect(brief.commandPreview).toMatchObject({
      label: "Local handoff command preview",
      hiddenLineCount: 6,
      totalLineCount: 14
    });
    expect(brief.commandPreview?.visibleLines).toEqual(
      expect.arrayContaining([
        bundleCommand,
        bundleVerifyCommand,
        mcpVerifyToolCall,
        "atlas-loop events export --session 'sess_1' --out './atlas-loop-events/sess_1.json' --daemon-url 'http://127.0.0.1:4317'"
      ])
    );
    expect(brief.commandPreview?.hiddenLines).toEqual(
      expect.arrayContaining([
        "curl -fsS 'http://127.0.0.1:4317/healthz'",
        "curl -fsS 'http://127.0.0.1:4317/v1/sessions/sess_1/summary'"
      ])
    );
  });

  it("marks the handoff brief waiting while session, screenshot, and health data are still loading", () => {
    const brief = buildAgentHandoffBrief(
      handoffInput({
        health: "checking",
        session: undefined,
        sessionSummary: undefined,
        artifactHealth: undefined,
        artifactHealthStatus: "loading",
        screenshot: { status: "loading" },
        artifacts: [],
        events: []
      })
    );

    expect(brief.readiness).toBe("waiting");
    expect(brief.tone).toBe("warn");
    expect(brief.notices.map((notice) => notice.title)).toEqual(
      expect.arrayContaining(["Daemon check pending", "No session loaded", "Artifact health loading", "Screenshot loading"])
    );
    expect(brief.latestScreenshot).toMatchObject({
      path: "--",
      source: "loading",
      tone: "neutral"
    });
    expect(brief.bundleSummary).toBeUndefined();
  });

  it("keeps long resolved session ids readable in bundle handoff summaries", () => {
    const longSessionId = "sess_checkout_flow_with_a_very_long_runtime_identifier_20260705T115900Z";
    const longSession: Session = { ...baseSession, id: longSessionId };
    const longSummary: SessionSummary = {
      ...baseSummary,
      session: longSession,
      paths: {
        ...baseSummary.paths,
        artifactDir: `/tmp/atlas-loop/${longSessionId}`
      }
    };
    const brief = buildAgentHandoffBrief(
      handoffInput({
        session: longSession,
        sessionSummary: longSummary
      })
    );

    expect(brief.bundleSummary).toMatchObject({
      directory: `./atlas-loop-handoffs/${longSessionId}`,
      manifestPath: `./atlas-loop-handoffs/${longSessionId}/manifest.json`,
      verifyCommand: `atlas-loop handoff verify --bundle './atlas-loop-handoffs/${longSessionId}'`,
      mcpVerifyToolCall: `atlas.verifyHandoffBundle({"bundleDir":"./atlas-loop-handoffs/${longSessionId}"})`,
      detail: expect.stringContaining("README.md")
    });
    expect(brief.bundleSummary?.command).toContain(`--session '${longSessionId}'`);
    expect(brief.bundleSummary?.verifyCommand).toContain(`--bundle './atlas-loop-handoffs/${longSessionId}'`);
    expect(brief.bundleSummary?.mcpVerifyToolCall).toContain(`./atlas-loop-handoffs/${longSessionId}`);
    expect(brief.copyPayloads.find((payload) => payload.id === "note")?.value).toContain(
      `Bundle manifest: ./atlas-loop-handoffs/${longSessionId}/manifest.json`
    );
  });

  it("promotes failed actions and artifact health errors into handoff blockers", () => {
    const events: TraceEvent[] = [
      {
        type: "action.completed",
        at: "2026-07-04T09:00:08.000Z",
        result: {
          actionId: "act_failed",
          ok: false,
          endedAt: "2026-07-04T09:00:08.000Z",
          error: { code: "TAP_MISSED", message: "Tap target was not visible" }
        }
      }
    ];
    const artifactHealth: ArtifactHealth = {
      ok: false,
      report: {
        issues: [{ severity: "error", path: "/tmp/atlas-loop/sess_1/session.json", message: "session manifest missing latest screenshot" }]
      },
      summary: { sessionCount: 1, errorCount: 1, warningCount: 0, issueCount: 1 }
    };
    const brief = buildAgentHandoffBrief(
      handoffInput({
        artifactHealth,
        events,
        sessionSummary: {
          ...baseSummary,
          events: {
            total: 3,
            latestAction: {
              actionId: "act_failed",
              ok: false,
              endedAt: "2026-07-04T09:00:08.000Z",
              artifactCount: 0,
              error: { code: "TAP_MISSED", message: "Tap target was not visible" }
            }
          }
        }
      })
    );

    expect(brief.readiness).toBe("blocked");
    expect(brief.tone).toBe("bad");
    expect(brief.latestAction).toMatchObject({
      label: "Last action failed",
      tone: "bad",
      error: "Tap target was not visible"
    });
    expect(brief.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: "Latest action failed", detail: "Tap target was not visible", tone: "bad" }),
        expect.objectContaining({ title: "Artifact health errors", detail: "1 error and 0 warnings reported.", tone: "bad" })
      ])
    );
    expect(brief.nextSteps).toEqual(
      expect.arrayContaining([
        "Fix artifact health errors before treating the evidence set as complete.",
        "Inspect the failed action in the timeline, correct the UI state, then retry locally."
      ])
    );
  });

  it("keeps hidden handoff warnings in the copied note", () => {
    const failedSession: Session = {
      ...baseSession,
      status: "failed",
      error: { code: "BOOT_FAILED", message: "Simulator did not boot." }
    };
    const brief = buildAgentHandoffBrief(
      handoffInput({
        health: "offline",
        session: failedSession,
        sessionSummary: {
          ...baseSummary,
          session: failedSession,
          artifacts: { total: 0, byType: {} },
          events: {
            total: 4,
            latestAction: {
              actionId: "act_failed",
              ok: false,
              endedAt: "2026-07-04T09:00:08.000Z",
              artifactCount: 0,
              error: { code: "TAP_MISSED", message: "Tap target was not visible" }
            },
            latestError: { code: "TRACE_ERROR", message: "Trace stream ended early." }
          },
          storage: {
            source: "disk",
            artifactBacked: true,
            warnings: [{ path: "trace.jsonl", message: "trace.jsonl was recovered from a partial write" }]
          }
        },
        artifactHealth: {
          ok: false,
          report: {
            issues: [{ severity: "error", path: "/tmp/atlas-loop/sess_1/session.json", message: "manifest missing" }]
          },
          summary: { sessionCount: 1, errorCount: 1, warningCount: 1, issueCount: 2 }
        },
        screenshot: { status: "error", message: "Screenshot route returned 404." },
        artifacts: []
      })
    );

    expect(brief.notices).toHaveLength(6);

    const note = brief.copyPayloads.find((payload) => payload.id === "note")?.value ?? "";
    expect(note).toContain("- Storage warnings: 1 persisted storage warning reported in the summary.");
    expect(note).toContain("- Screenshot unavailable: Screenshot route returned 404.");
    expect(note).toContain("- No artifacts listed: The session has no loaded screenshots, logs, traces, or metadata artifacts yet.");
  });

  it("does not mark handoff ready without a completed action result", () => {
    const brief = buildAgentHandoffBrief(
      handoffInput({
        sessionSummary: {
          ...baseSummary,
          events: { total: 0 }
        },
        events: []
      })
    );

    expect(brief.readiness).toBe("waiting");
    expect(brief.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "No action result", tone: "warn" })
    ]));
    expect(brief.nextSteps).toContain("Run one meaningful action or capture a screenshot before another agent takes over.");
  });

  it("treats a newer started action as running even when an older action passed", () => {
    const brief = buildAgentHandoffBrief(
      handoffInput({
        events: [
          {
            type: "action.started",
            at: "2026-07-04T09:00:05.000Z",
            action: {
              id: "act_running",
              kind: "tap",
              createdAt: "2026-07-04T09:00:05.000Z",
              input: { kind: "tap", x: 0.5, y: 0.5 }
            }
          }
        ]
      })
    );

    expect(brief.readiness).toBe("waiting");
    expect(brief.latestAction).toMatchObject({
      label: "Action running",
      tone: "warn"
    });
    expect(brief.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Action still running", tone: "warn" })
    ]));
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

  it("formats session history evidence chips for compact rail rows", () => {
    const sessions: SessionHistoryItem[] = [
      {
        id: "older-disk",
        status: "ended",
        updatedAt: "2026-07-04T08:00:00.000Z",
        storage: { source: "disk", artifactBacked: true, warningCount: 2 },
        artifacts: { total: 3 },
        events: { total: 9, latestAction: { actionId: "act_old", ok: false, artifactCount: 0, error: { message: "tap missed" } } },
        hasScreenshot: false
      },
      {
        id: "newer-memory",
        status: "running",
        updatedAt: "2026-07-04T09:00:00.000Z",
        storage: { source: "memory", artifactBacked: true, warningCount: 0 },
        artifacts: { total: 12, latestScreenshotPath: "screenshots/latest.png" },
        events: { total: 21, latestAction: { actionId: "act_new", ok: true, artifactCount: 1 } },
        hasScreenshot: true
      }
    ];

    expect(sortSessionList(sessions).map((session) => session.id)).toEqual(["newer-memory", "older-disk"]);
    expect(sessionEvidenceChips(sessions[1]).map(({ id, value, tone, ariaLabel }) => ({ id, value, tone, ariaLabel }))).toEqual([
      { id: "source", value: "mem", tone: "good", ariaLabel: "Evidence source memory" },
      { id: "artifacts", value: "12", tone: "neutral", ariaLabel: "Artifact count 12" },
      { id: "events", value: "21", tone: "neutral", ariaLabel: "Event count 21" },
      { id: "warnings", value: "0", tone: "neutral", ariaLabel: "Warning count 0" },
      { id: "screenshot", value: "yes", tone: "good", ariaLabel: "Latest screenshot available" },
      { id: "action", value: "pass", tone: "good", ariaLabel: "Latest action passed" }
    ]);
    expect(sessionEvidenceChips(sessions[0]).map(({ id, value, tone }) => ({ id, value, tone }))).toEqual([
      { id: "source", value: "disk", tone: "neutral" },
      { id: "artifacts", value: "3", tone: "neutral" },
      { id: "events", value: "9", tone: "neutral" },
      { id: "warnings", value: "2", tone: "warn" },
      { id: "screenshot", value: "none", tone: "neutral" },
      { id: "action", value: "fail", tone: "bad" }
    ]);
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

const baseSession: Session = {
  id: "sess_1",
  status: "running",
  createdAt: "2026-07-04T09:00:00.000Z",
  updatedAt: "2026-07-04T09:00:05.000Z",
  simulator: { name: "iPhone 16 Pro", runtime: "iOS 19.0" },
  app: { bundleId: "com.example.demo" },
  artifactDir: "/tmp/atlas-loop/sess_1"
};

const baseSummary: SessionSummary = {
  session: baseSession,
  paths: {
    artifactDir: "/tmp/atlas-loop/sess_1",
    manifest: "/tmp/atlas-loop/sess_1/session.json",
    trace: "/tmp/atlas-loop/sess_1/trace.jsonl",
    screenshots: "/tmp/atlas-loop/sess_1/screenshots"
  },
  artifacts: {
    total: 2,
    byType: { screenshot: 1, log: 1 },
    latestScreenshotId: "shot_1",
    latestScreenshotPath: "screenshots/latest.png",
    latestScreenshotCreatedAt: "2026-07-04T09:00:04.000Z"
  },
  events: {
    total: 2,
    latestAction: {
      actionId: "act_1",
      ok: true,
      endedAt: "2026-07-04T09:00:03.000Z",
      artifacts: [{ id: "shot_1", type: "screenshot", path: "screenshots/latest.png" }],
      artifactCount: 1
    }
  },
  storage: {
    source: "memory",
    artifactBacked: true,
    warnings: []
  }
};

function handoffInput(overrides: Partial<AgentHandoffInput> = {}): AgentHandoffInput {
  return {
    health: "online",
    params: { daemonUrl: "http://127.0.0.1:4317", sessionId: "latest", viewerBaseUrl: "http://127.0.0.1:5173" },
    session: baseSession,
    sessionSummary: baseSummary,
    artifactHealth: {
      ok: true,
      report: { ok: true, target: "/tmp/atlas-loop/sess_1", sessionCount: 1, issues: [] },
      summary: { sessionCount: 1, errorCount: 0, warningCount: 0, issueCount: 0 }
    },
    artifactHealthStatus: "ready",
    screenshot: {
      status: "ready",
      src: "blob:latest",
      source: "blob",
      mediaType: "image/png",
      updatedAt: "2026-07-04T09:00:04.000Z"
    },
    artifacts: [
      { id: "shot_1", type: "screenshot", path: "screenshots/latest.png", createdAt: "2026-07-04T09:00:04.000Z" },
      { id: "log_1", type: "log", path: "logs/run.log", createdAt: "2026-07-04T09:00:02.000Z" }
    ],
    events: [],
    ...overrides
  };
}
