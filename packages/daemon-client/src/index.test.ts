import { describe, expect, it } from "vitest";
import {
  buildEvidenceMarkdownReport,
  buildSessionHandoff,
  buildSessionHandoffMarkdownNote,
  DaemonClient,
  evidenceReportDataFromSessionSummary,
  type SessionSummary
} from "./index.ts";

describe("DaemonClient", () => {
  it("sends typed JSON requests and unwraps ApiEnvelope data", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({ ok: true, data: { id: "sess_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await expect(client.createSession({ viewer: true })).resolves.toEqual({ id: "sess_1" });
    expect(calls[0].url).toBe("http://127.0.0.1:4317/sessions");
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ viewer: true });
  });

  it("throws structured errors from failed envelopes", async () => {
    const client = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "missing" } }), {
          status: 404,
          headers: { "content-type": "application/json" }
        })
    });

    await expect(client.getSession("missing")).rejects.toMatchObject({ code: "NOT_FOUND", message: "missing" });
  });

  it("throws clear errors when typed methods receive ok envelopes without data", async () => {
    const client = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });
    const cases: Array<{ dataLabel: string; call: (client: DaemonClient) => Promise<unknown> }> = [
      { dataLabel: "health", call: (client) => client.health() },
      { dataLabel: "session list", call: (client) => client.listSessions() },
      { dataLabel: "created session", call: (client) => client.createSession() },
      { dataLabel: "session", call: (client) => client.getSession("sess_1") },
      { dataLabel: "session summary", call: (client) => client.getSessionSummary("sess_1") },
      { dataLabel: "session artifact health", call: (client) => client.getSessionArtifactHealth("sess_1") },
      { dataLabel: "ended session", call: (client) => client.endSession("sess_1") },
      { dataLabel: "build result", call: (client) => client.build("sess_1", { scheme: "AtlasLoop" }) },
      { dataLabel: "install result", call: (client) => client.install("sess_1", { appPath: "/tmp/App.app" }) },
      { dataLabel: "launch result", call: (client) => client.launch("sess_1", { bundleId: "com.example.App" }) },
      { dataLabel: "action result", call: (client) => client.performAction("sess_1", { kind: "wait", durationMs: 1 }) },
      { dataLabel: "screenshot action result", call: (client) => client.screenshot("sess_1") },
      { dataLabel: "latest screenshot artifact", call: (client) => client.latestScreenshot("sess_1") },
      { dataLabel: "artifact list", call: (client) => client.listArtifacts("sess_1") },
      { dataLabel: "trace events", call: (client) => client.events("sess_1") }
    ];

    for (const entry of cases) {
      await expect(entry.call(client)).rejects.toMatchObject({
        code: "COMMAND_FAILED",
        message: `daemon returned ok:true without required data for ${entry.dataLabel}`,
        details: expect.objectContaining({ status: 200 })
      });
    }
  });

  it("rejects malformed success envelopes before typed callers unwrap data", async () => {
    const malformedOkClient = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: "true", data: { id: "sess_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });
    const nullDataClient = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, data: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });

    await expect(malformedOkClient.getSession("sess_1")).rejects.toMatchObject({
      code: "COMMAND_FAILED",
      message: "daemon returned a malformed response"
    });
    await expect(nullDataClient.getSession("sess_1")).rejects.toMatchObject({
      code: "COMMAND_FAILED",
      message: "daemon returned ok:true without required data for session"
    });
  });

  it("still allows generic requests to return explicit null data", async () => {
    const client = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true, data: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });

    await expect(client.request<null>("GET", "/debug-null")).resolves.toBeNull();
  });

  it("allows explicit void requests to succeed without response data", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(null, { status: 204 });
      }
    });

    await expect(client.request<void>("OPTIONS", "/sessions")).resolves.toBeUndefined();
    expect(calls[0].url).toBe("http://127.0.0.1:4317/sessions");
    expect(calls[0].init.method).toBe("OPTIONS");
  });

  it("requests session summaries from the daemon summary endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          ok: true,
          data: {
            session: { id: "sess_1", artifactDir: "/tmp/sess_1", status: "running" },
            paths: {
              artifactDir: "/tmp/sess_1",
              manifest: "/tmp/sess_1/manifest.json",
              trace: "/tmp/sess_1/trace.jsonl",
              screenshots: "/tmp/sess_1/screenshots"
            },
            artifacts: { total: 1, byType: { screenshot: 1 } },
            events: { total: 3 }
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await expect(client.getSessionSummary("sess_1")).resolves.toMatchObject({
      session: { id: "sess_1" },
      paths: { artifactDir: "/tmp/sess_1" },
      artifacts: { total: 1 },
      events: { total: 3 }
    });
    expect(calls[0].url).toBe("http://127.0.0.1:4317/sessions/sess_1/summary");
    expect(calls[0].init.method).toBe("GET");
  });

  it("requests session artifact health from the daemon artifact health endpoint", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = new DaemonClient({
      baseUrl: "http://127.0.0.1:4317",
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify({
          ok: true,
          data: {
            ok: false,
            target: "/tmp/sess_1",
            sessionId: "sess_1",
            requestedSessionId: "latest",
            source: "disk",
            artifactDir: "/tmp/sess_1",
            report: {
              target: "/tmp/sess_1",
              sessionCount: 1,
              ok: false,
              issues: [
                { severity: "error", path: "/tmp/sess_1/session.json", message: "bad platform" },
                { severity: "warning", path: "/tmp/sess_1/actions.jsonl", message: "missing actions" }
              ]
            },
            summary: {
              sessionCount: 1,
              errorCount: 1,
              warningCount: 1,
              issueCount: 2
            }
          }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    await expect(client.getSessionArtifactHealth("latest")).resolves.toMatchObject({
      ok: false,
      sessionId: "sess_1",
      requestedSessionId: "latest",
      source: "disk",
      summary: {
        sessionCount: 1,
        errorCount: 1,
        warningCount: 1,
        issueCount: 2
      },
      report: {
        issues: [
          { severity: "error", path: "/tmp/sess_1/session.json", message: "bad platform" },
          { severity: "warning", path: "/tmp/sess_1/actions.jsonl", message: "missing actions" }
        ]
      }
    });
    expect(calls[0].url).toBe("http://127.0.0.1:4317/sessions/latest/artifacts/health");
    expect(calls[0].init.method).toBe("GET");
  });

  it("builds agent-readable handoffs with artifact health and local next commands", async () => {
    const summary: SessionSummary = {
      session: {
        id: "sess_handoff",
        schemaVersion: "atlas-loop.session.v1",
        platform: "ios-simulator",
        status: "running",
        createdAt: "2026-07-04T12:00:00.000Z",
        updatedAt: "2026-07-04T12:00:10.000Z",
        simulator: { name: "iPhone 16" },
        artifactDir: "/tmp/atlas-loop/sess-handoff"
      },
      paths: {
        artifactDir: "/tmp/atlas-loop/sess-handoff",
        manifest: "/tmp/atlas-loop/sess-handoff/manifest.json",
        trace: "/tmp/atlas-loop/sess-handoff/trace.jsonl",
        screenshots: "/tmp/atlas-loop/sess-handoff/screenshots"
      },
      artifacts: {
        total: 1,
        byType: { screenshot: 1 },
        latestScreenshot: {
          id: "shot_1",
          sessionId: "sess_handoff",
          type: "screenshot",
          path: "/tmp/atlas-loop/sess-handoff/screenshots/latest.png",
          createdAt: "2026-07-04T12:00:09.000Z"
        }
      },
      events: {
        total: 1,
        latestAction: {
          actionId: "act_1",
          ok: true,
          startedAt: "2026-07-04T12:00:08.000Z",
          endedAt: "2026-07-04T12:00:09.000Z",
          artifactCount: 1
        }
      },
      storage: {
        source: "disk",
        artifactBacked: true,
        warnings: []
      }
    };

    const handoff = await buildSessionHandoff({
      getSessionSummary: async (sessionId: string) => {
        expect(sessionId).toBe("latest");
        return summary;
      },
      getSessionArtifactHealth: async (sessionId: string) => {
        expect(sessionId).toBe("sess_handoff");
        return {
          ok: true,
          target: "/tmp/atlas-loop/sess-handoff",
          sessionId: "sess_handoff",
          requestedSessionId: "sess_handoff",
          source: "disk",
          artifactDir: "/tmp/atlas-loop/sess-handoff",
          report: {
            target: "/tmp/atlas-loop/sess-handoff",
            sessionCount: 1,
            ok: true,
            issues: []
          },
          summary: {
            sessionCount: 1,
            errorCount: 0,
            warningCount: 0,
            issueCount: 0
          }
        };
      }
    }, {
      sessionId: "latest",
      daemonUrl: "http://127.0.0.1:4317",
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(handoff).toEqual({
      sessionId: "sess_handoff",
      requestedSessionId: "latest",
      status: "running",
      daemonUrl: "http://127.0.0.1:4317",
      viewerBaseUrl: "http://127.0.0.1:5173",
      viewerUrl: "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess_handoff",
      artifactDir: "/tmp/atlas-loop/sess-handoff",
      storage: {
        source: "disk",
        artifactBacked: true,
        warningCount: 0
      },
      latestScreenshotPath: "/tmp/atlas-loop/sess-handoff/screenshots/latest.png",
      latestAction: {
        actionId: "act_1",
        ok: true,
        startedAt: "2026-07-04T12:00:08.000Z",
        endedAt: "2026-07-04T12:00:09.000Z",
        artifactCount: 1
      },
      artifactHealth: {
        ok: true,
        target: "/tmp/atlas-loop/sess-handoff",
        source: "disk",
        summary: {
          sessionCount: 1,
          errorCount: 0,
          warningCount: 0,
          issueCount: 0
        }
      },
      canMutate: false,
      hasScreenshot: true,
      ready: true,
      blockingReasons: [],
      nextCommands: [
        "atlas-loop artifacts health --session sess_handoff --daemon-url http://127.0.0.1:4317",
        "atlas-loop session handoff --session sess_handoff --bundle ./atlas-loop-handoffs/sess_handoff --viewer-base-url http://127.0.0.1:5173 --daemon-url http://127.0.0.1:4317",
        "atlas-loop evidence report --session sess_handoff --daemon-url http://127.0.0.1:4317",
        "atlas-loop evidence export --session sess_handoff --out ./atlas-loop-evidence/sess_handoff --daemon-url http://127.0.0.1:4317",
        "atlas-loop events export --session sess_handoff --out ./atlas-loop-events/sess_handoff.json --daemon-url http://127.0.0.1:4317",
        "atlas-loop viewer url --session sess_handoff --viewer-base-url http://127.0.0.1:5173 --daemon-url http://127.0.0.1:4317"
      ]
    });

    const note = buildSessionHandoffMarkdownNote(handoff);
    expect(note).toContain("# Atlas Loop Session Handoff");
    expect(note).toContain("- Resolved session: `sess_handoff`");
    expect(note).toContain("- Requested session: `latest`");
    expect(note).toContain("- Ready: yes");
    expect(note).toContain("- Storage: `disk` (artifact-backed: yes, warnings: 0)");
    expect(note).toContain("- Latest screenshot: `/tmp/atlas-loop/sess-handoff/screenshots/latest.png`");
    expect(note).toContain("- Artifact health: ok (disk, sessions: 1, errors: 0, warnings: 0, issues: 0)");
    expect(note).toContain("- Latest action: `act_1` (passed)");
    expect(note).toContain("atlas-loop session handoff --session sess_handoff --bundle ./atlas-loop-handoffs/sess_handoff --viewer-base-url http://127.0.0.1:5173 --daemon-url http://127.0.0.1:4317");
    expect(note).toContain("atlas-loop events export --session sess_handoff --out ./atlas-loop-events/sess_handoff.json --daemon-url http://127.0.0.1:4317");
  });

  it("keeps handoffs structured when artifact health is unavailable", async () => {
    const handoff = await buildSessionHandoff({
      getSessionSummary: async () => ({
        session: {
          id: "sess_no_health",
          schemaVersion: "atlas-loop.session.v1",
          platform: "ios-simulator",
          status: "running",
          createdAt: "2026-07-04T12:00:00.000Z",
          updatedAt: "2026-07-04T12:00:10.000Z",
          simulator: { name: "iPhone 16" },
          artifactDir: "/tmp/atlas-loop/sess-no-health"
        },
        paths: {
          artifactDir: "/tmp/atlas-loop/sess-no-health",
          manifest: "/tmp/atlas-loop/sess-no-health/manifest.json",
          trace: "/tmp/atlas-loop/sess-no-health/trace.jsonl",
          screenshots: "/tmp/atlas-loop/sess-no-health/screenshots"
        },
        artifacts: { total: 0, byType: {} },
        events: {
          total: 2,
          latestAction: {
            actionId: "act_bad",
            ok: false,
            startedAt: "2026-07-04T12:00:08.000Z",
            endedAt: "2026-07-04T12:00:09.000Z",
            artifactCount: 0,
            error: { code: "HID_FAILED", message: "tap failed\n*target moved*" }
          },
          latestError: { code: "COMMAND_FAILED", message: "trace broke\n_retry needed_" }
        },
        storage: { source: "memory", artifactBacked: false, warnings: [] }
      }),
      getSessionArtifactHealth: async () => {
        throw new Error("health endpoint unavailable\nwith *markdown*");
      }
    }, {
      sessionId: "latest",
      daemonUrl: "http://127.0.0.1:4317"
    });

    expect(handoff).toMatchObject({
      sessionId: "sess_no_health",
      requestedSessionId: "latest",
      artifactHealth: null,
      canMutate: true,
      hasScreenshot: false,
      ready: false,
      blockingReasons: expect.arrayContaining([
        "latest action failed: tap failed\n*target moved*",
        "latest error: trace broke\n_retry needed_",
        "artifact health unavailable: health endpoint unavailable\nwith *markdown*"
      ])
    });

    const note = buildSessionHandoffMarkdownNote(handoff);
    expect(note).toContain("- Action error: HID\\_FAILED: tap failed \\*target moved\\*");
    expect(note).toContain("- Latest error: COMMAND\\_FAILED: trace broke \\_retry needed\\_");
    expect(note).toContain("- latest action failed: tap failed \\*target moved\\*");
    expect(note).toContain("- artifact health unavailable: health endpoint unavailable with \\*markdown\\*");
    expect(note).not.toContain("tap failed\n*target moved*");
  });

  it("builds paste-ready Markdown evidence reports from session summaries", () => {
    const summary: SessionSummary = {
      session: {
        id: "sess_report",
        schemaVersion: "atlas-loop.session.v1",
        platform: "ios-simulator",
        status: "ended",
        createdAt: "2026-07-04T12:00:00.000Z",
        updatedAt: "2026-07-04T12:00:10.000Z",
        simulator: { name: "iPhone 16" },
        artifactDir: "/tmp/atlas-loop/sess-report"
      },
      paths: {
        artifactDir: "/tmp/atlas-loop/sess-report",
        manifest: "/tmp/atlas-loop/sess-report/manifest.json",
        trace: "/tmp/atlas-loop/sess-report/trace.jsonl",
        screenshots: "/tmp/atlas-loop/sess-report/screenshots"
      },
      artifacts: {
        total: 2,
        byType: { screenshot: 1, log: 1 },
        latestScreenshot: {
          id: "shot_1",
          sessionId: "sess_report",
          type: "screenshot",
          path: "/tmp/atlas-loop/sess-report/screenshots/latest.png",
          createdAt: "2026-07-04T12:00:09.000Z",
          metadata: { actionId: "act_1", operation: "screenshot", sizeBytes: 2048 }
        }
      },
      events: {
        total: 5,
        latestAction: {
          actionId: "act_1",
          ok: true,
          startedAt: "2026-07-04T12:00:08.000Z",
          endedAt: "2026-07-04T12:00:09.000Z",
          artifactCount: 1
        }
      },
      storage: {
        source: "disk",
        artifactBacked: true,
        warnings: []
      }
    };

    const evidence = evidenceReportDataFromSessionSummary(summary, {
      requestedSessionId: "latest",
      daemonUrl: "http://127.0.0.1:4317",
      viewerBaseUrl: "http://127.0.0.1:5173",
      viewerUrl: "http://127.0.0.1:5173?sessionId=sess_report",
      artifactHighlights: [
        {
          id: "log_1",
          sessionId: "sess_report",
          type: "log",
          path: "/tmp/atlas-loop/sess-report/logs/install.log",
          createdAt: "2026-07-04T12:00:08.000Z",
          metadata: { actionId: "act_install", operation: "install", sizeBytes: 512 }
        }
      ]
    });

    expect(evidence).toMatchObject({
      sessionId: "sess_report",
      requestedSessionId: "latest",
      artifactTotal: 2,
      artifactCounts: { screenshot: 1, log: 1 },
      artifactHighlights: [
        expect.objectContaining({ id: "shot_1" }),
        expect.objectContaining({ id: "log_1" })
      ],
      eventTotal: 5
    });
    expect(buildEvidenceMarkdownReport(evidence)).toContain("# Atlas Loop Evidence Report");
    expect(buildEvidenceMarkdownReport(evidence)).toContain("Latest screenshot");
    expect(buildEvidenceMarkdownReport(evidence)).toContain("act_1");
    expect(buildEvidenceMarkdownReport(evidence)).toContain("Artifact Highlights");
    expect(buildEvidenceMarkdownReport(evidence)).toContain("log_1");
    expect(buildEvidenceMarkdownReport(evidence)).toContain("512 B");
  });
});
