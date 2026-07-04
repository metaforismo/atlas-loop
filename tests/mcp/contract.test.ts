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
      "atlas.getArtifactPath",
      "atlas.getLatestScreenshotPath",
      "atlas.getViewerUrl"
    ]));
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
});
