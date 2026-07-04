import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildViewerUrl, callToolWithEnvelope, tools } from "../../apps/mcp-server/src/index.ts";

describe("MCP contract documentation", () => {
  it("documents the daemon-backed MCP tool surface without requiring a daemon process", async () => {
    const daemonApi = await readFile(resolve("docs", "daemon-api.md"), "utf8");

    for (const requiredText of [
      "tools/list",
      "tools/call",
      "atlas.createSession",
      "atlas.performAction",
      "atlas.getSession",
      "atlas.endSession"
    ]) {
      expect(daemonApi).toContain(requiredText);
    }
  });

  it("publishes agent-friendly artifact and viewer helper tools", () => {
    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "atlas.getLatestSession",
      "atlas.getArtifactPath",
      "atlas.getLatestScreenshotPath",
      "atlas.getViewerUrl",
      "atlas.getEvidence",
      "atlas.getEvidenceReport"
    ]));
    expect(tools.find((tool) => tool.name === "atlas.listSessions")?.description).toContain("active and persisted");
  });

  it("publishes concrete input schemas for agent-authored runtime calls", () => {
    const createSession = schemaFor("atlas.createSession");
    const build = schemaFor("atlas.build");
    const action = schemaFor("atlas.performAction");

    expect(createSession.properties).toMatchObject({
      simulator: {
        type: "object",
        properties: expect.objectContaining({
          name: { type: "string" },
          udid: { type: "string" },
          runtime: { type: "string" }
        })
      },
      artifactRoot: { type: "string" },
      viewer: { type: "boolean" }
    });
    expect(build).toMatchObject({
      required: ["sessionId", "scheme"],
      properties: {
        sessionId: { type: "string", description: "Session id or latest." },
        scheme: { type: "string" },
        configuration: { type: "string", enum: ["Debug", "Release"] }
      }
    });
    expect(action).toMatchObject({
      required: ["sessionId", "action"],
      properties: {
        action: {
          oneOf: expect.arrayContaining([
            expect.objectContaining({ required: ["kind", "x", "y"] }),
            expect.objectContaining({ required: ["kind", "durationMs"] }),
            expect.objectContaining({
              required: ["kind", "edge", "distance", "durationMs"],
              properties: expect.objectContaining({
                edge: { type: "string", enum: ["left", "right", "top", "bottom"] }
              })
            })
          ])
        }
      }
    });
  });

  it("returns the daemon latest session through a dedicated MCP helper", async () => {
    const result = await callToolWithEnvelope("atlas.getLatestSession", {}, {
      client: {
        getSession: async (sessionId: string) => ({ id: "sess_latest", requested: sessionId })
      } as never
    });

    expect(result).toEqual({
      ok: true,
      data: { id: "sess_latest", requested: "latest" }
    });
  });

  it("returns the artifact directory path through the structured MCP envelope", async () => {
    const result = await callToolWithEnvelope("atlas.getArtifactPath", { sessionId: "sess_1" }, {
      client: {
        getSessionSummary: async (sessionId: string) => ({
          paths: { artifactDir: `/tmp/atlas-loop/${sessionId}` }
        })
      } as never
    });

    expect(result).toEqual({
      ok: true,
      data: { path: "/tmp/atlas-loop/sess_1" }
    });
  });

  it("returns the latest screenshot path without discarding artifact metadata", async () => {
    const artifact = {
      id: "artifact_1",
      sessionId: "sess_1",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess_1/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:00.000Z",
      metadata: { reason: "assertion" }
    };

    const result = await callToolWithEnvelope("atlas.getLatestScreenshotPath", { sessionId: "sess_1" }, {
      client: {
        latestScreenshot: async () => artifact
      } as never
    });

    expect(result).toEqual({
      ok: true,
      data: { path: artifact.path, artifact }
    });
  });

  it("builds viewer URLs locally for agents without requiring daemon I/O", async () => {
    const result = await callToolWithEnvelope("atlas.getViewerUrl", { sessionId: "sess/with slash" }, {
      loadConfig: async () => ({ daemonUrl: "http://127.0.0.1:4317" }),
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(result).toEqual({
      ok: true,
      data: {
        url: "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess%2Fwith%20slash",
        sessionId: "sess/with slash",
        daemonUrl: "http://127.0.0.1:4317",
        viewerBaseUrl: "http://127.0.0.1:5173"
      }
    });
    expect(buildViewerUrl({
      daemonUrl: "http://127.0.0.1:4317",
      sessionId: "sess/with slash",
      viewerBaseUrl: "http://127.0.0.1:5173/"
    })).toBe("http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess%2Fwith%20slash");
  });

  it("returns compact evidence for agents from persisted session summaries", async () => {
    const artifact = {
      id: "artifact_1",
      sessionId: "sess/with slash",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess-with-slash/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:00.000Z"
    };

    const result = await callToolWithEnvelope("atlas.getEvidence", { sessionId: "latest" }, {
      client: {
        getSessionSummary: async (sessionId: string) => {
          expect(sessionId).toBe("latest");
          return {
            session: { id: "sess/with slash" },
            paths: { artifactDir: "/tmp/atlas-loop/sess-with-slash" },
            artifacts: { latestScreenshot: artifact }
          };
        }
      } as never,
      loadConfig: async () => ({ daemonUrl: "http://127.0.0.1:4317" }),
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(result).toEqual({
      ok: true,
      data: {
        sessionId: "sess/with slash",
        requestedSessionId: "latest",
        artifactDir: "/tmp/atlas-loop/sess-with-slash",
        latestScreenshotPath: "/tmp/atlas-loop/sess-with-slash/screenshots/latest.png",
        latestScreenshot: artifact,
        viewerUrl: "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess%2Fwith%20slash",
        daemonUrl: "http://127.0.0.1:4317",
        viewerBaseUrl: "http://127.0.0.1:5173"
      }
    });
  });

  it("uses configured daemon URL for default MCP evidence clients and viewer URLs", async () => {
    const requestedPaths: string[] = [];
    const server = await startFakeMcpDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return {
        session: { id: "sess_configured" },
        paths: { artifactDir: "/tmp/atlas-loop/sess-configured" },
        artifacts: {
          latestScreenshot: {
            id: "artifact_configured",
            sessionId: "sess_configured",
            type: "screenshot",
            path: "/tmp/atlas-loop/sess-configured/screenshots/latest.png",
            createdAt: "2026-07-04T12:00:00.000Z"
          }
        }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    try {
      const result = await callToolWithEnvelope("atlas.getEvidence", { sessionId: "latest" }, {
        loadConfig: async () => ({ daemonUrl }),
        viewerBaseUrl: "http://127.0.0.1:5176/"
      });

      expect(requestedPaths).toEqual(["/sessions/latest/summary"]);
      expect(result).toMatchObject({
        ok: true,
        data: {
          sessionId: "sess_configured",
          requestedSessionId: "latest",
          daemonUrl,
          viewerUrl: `http://127.0.0.1:5176?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=sess_configured`
        }
      });
    } finally {
      await server.close();
    }
  });

  it("returns a Markdown report without changing the compact evidence tool", async () => {
    const artifact = {
      id: "artifact_report",
      sessionId: "sess_report",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess-report/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:00.000Z"
    };

    const result = await callToolWithEnvelope("atlas.getEvidenceReport", { sessionId: "latest" }, {
      client: {
        getSessionSummary: async () => ({
          session: {
            id: "sess_report",
            status: "ended",
            createdAt: "2026-07-04T12:00:00.000Z",
            updatedAt: "2026-07-04T12:00:01.000Z"
          },
          paths: { artifactDir: "/tmp/atlas-loop/sess-report" },
          artifacts: { total: 1, byType: { screenshot: 1 }, latestScreenshot: artifact },
          events: { total: 3 },
          storage: { source: "disk", artifactBacked: true, warnings: [] }
        })
      } as never,
      loadConfig: async () => ({ daemonUrl: "http://127.0.0.1:4317" }),
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        evidence: {
          sessionId: "sess_report",
          requestedSessionId: "latest",
          artifactTotal: 1,
          eventTotal: 3
        },
        report: expect.stringContaining("# Atlas Loop Evidence Report")
      }
    });
  });

  it("keeps evidence available when the session has no screenshots yet", async () => {
    const result = await callToolWithEnvelope("atlas.getEvidence", { sessionId: "sess_empty" }, {
      client: {
        getSessionSummary: async () => ({
          session: { id: "sess_empty" },
          paths: { artifactDir: "/tmp/atlas-loop/sess-empty" },
          artifacts: {}
        }),
        latestScreenshot: async () => {
          throw { code: "NOT_FOUND", message: "no screenshot" };
        }
      } as never,
      loadConfig: async () => ({ daemonUrl: "http://127.0.0.1:4317" })
    });

    expect(result).toEqual({
      ok: true,
      data: {
        sessionId: "sess_empty",
        requestedSessionId: "sess_empty",
        artifactDir: "/tmp/atlas-loop/sess-empty",
        latestScreenshotPath: null,
        latestScreenshot: null,
        viewerUrl: "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess_empty",
        daemonUrl: "http://127.0.0.1:4317",
        viewerBaseUrl: "http://127.0.0.1:5173"
      }
    });
  });
});

async function startFakeMcpDaemon(summaryForPath: (requestPath: string) => unknown): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/sessions/latest/summary") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: `unexpected route ${request.method} ${request.url}` }
      }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, data: summaryForPath(request.url) }));
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake MCP daemon did not bind a TCP port");

  return {
    port: address.port,
    close: () => closeServer(server)
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    });
  });
}

function schemaFor(name: string): Record<string, any> {
  const schema = tools.find((tool) => tool.name === name)?.inputSchema;
  if (!schema || typeof schema !== "object") throw new Error(`missing schema for ${name}`);
  return schema as Record<string, any>;
}
