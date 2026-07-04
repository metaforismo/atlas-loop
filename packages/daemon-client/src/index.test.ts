import { describe, expect, it } from "vitest";
import { buildEvidenceMarkdownReport, DaemonClient, evidenceReportDataFromSessionSummary, type SessionSummary } from "./index.ts";

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
          createdAt: "2026-07-04T12:00:09.000Z"
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
      viewerUrl: "http://127.0.0.1:5173?sessionId=sess_report"
    });

    expect(evidence).toMatchObject({
      sessionId: "sess_report",
      requestedSessionId: "latest",
      artifactTotal: 2,
      artifactCounts: { screenshot: 1, log: 1 },
      eventTotal: 5
    });
    expect(buildEvidenceMarkdownReport(evidence)).toContain("# Atlas Loop Evidence Report");
    expect(buildEvidenceMarkdownReport(evidence)).toContain("Latest screenshot");
    expect(buildEvidenceMarkdownReport(evidence)).toContain("act_1");
  });
});
