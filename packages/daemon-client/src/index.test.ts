import { describe, expect, it } from "vitest";
import { DaemonClient } from "./index.ts";

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
});
