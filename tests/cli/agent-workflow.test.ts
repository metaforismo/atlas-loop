import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidenceSummary, buildViewerUrl, main } from "../../apps/cli/src/index.ts";
import type { SessionSummary } from "@atlas-loop/daemon-client";
import type { ArtifactRef, Session } from "@atlas-loop/protocol";

describe("CLI agent workflow helpers", () => {
  it("builds compact evidence with a resolved latest session id", async () => {
    const latestScreenshot: ArtifactRef = {
      id: "artifact_1",
      sessionId: "sess/agent",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess-agent/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:00.000Z"
    };
    let latestScreenshotCalls = 0;

    const result = await buildEvidenceSummary({
      getSessionSummary: async (sessionId: string) => {
        expect(sessionId).toBe("latest");
        return sessionSummary("sess/agent", {
          latestScreenshot,
          artifactDir: "/tmp/atlas-loop/sess-agent"
        });
      },
      latestScreenshot: async () => {
        latestScreenshotCalls += 1;
        throw new Error("summary already included a latest screenshot");
      }
    }, {
      sessionId: "latest",
      daemonUrl: "http://127.0.0.1:4317",
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(latestScreenshotCalls).toBe(0);
    expect(result).toEqual({
      sessionId: "sess/agent",
      requestedSessionId: "latest",
      artifactDir: "/tmp/atlas-loop/sess-agent",
      latestScreenshotPath: "/tmp/atlas-loop/sess-agent/screenshots/latest.png",
      latestScreenshot,
      viewerUrl: "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess%2Fagent",
      daemonUrl: "http://127.0.0.1:4317",
      viewerBaseUrl: "http://127.0.0.1:5173"
    });
  });

  it("keeps evidence useful when no screenshot has been captured yet", async () => {
    const result = await buildEvidenceSummary({
      getSessionSummary: async () => sessionSummary("sess_empty", {
        artifactDir: "/tmp/atlas-loop/sess-empty"
      }),
      latestScreenshot: async () => {
        throw { code: "NOT_FOUND", message: "no screenshot" };
      }
    }, {
      sessionId: "sess_empty",
      daemonUrl: "http://127.0.0.1:4317"
    });

    expect(result).toMatchObject({
      sessionId: "sess_empty",
      requestedSessionId: "sess_empty",
      artifactDir: "/tmp/atlas-loop/sess-empty",
      latestScreenshotPath: null,
      latestScreenshot: null,
      viewerBaseUrl: "http://127.0.0.1:5173"
    });
  });

  it("builds viewer URLs with trimmed bases and encoded session ids", () => {
    expect(buildViewerUrl({
      daemonUrl: "http://127.0.0.1:4317",
      sessionId: "latest/session",
      viewerBaseUrl: "http://127.0.0.1:5173/"
    })).toBe("http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=latest%2Fsession");
  });

  it("uses the configured daemon URL for both evidence reads and viewer output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-config-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const server = await startFakeDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return sessionSummary("sess_configured", {
        artifactDir: "/tmp/atlas-loop/sess-configured",
        latestScreenshot: {
          id: "artifact_configured",
          sessionId: "sess_configured",
          type: "screenshot",
          path: "/tmp/atlas-loop/sess-configured/screenshots/latest.png",
          createdAt: "2026-07-04T12:00:00.000Z"
        }
      });
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["evidence", "--session", "latest", "--viewer-base-url", "http://127.0.0.1:5176/"])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual(["/sessions/latest/summary"]);
    expect(JSON.parse(logged[0])).toMatchObject({
      sessionId: "sess_configured",
      requestedSessionId: "latest",
      daemonUrl,
      viewerUrl: `http://127.0.0.1:5176?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=sess_configured`
    });
  });

  it("prints and writes Markdown evidence reports", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-report-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const server = await startFakeDaemon(() => sessionSummary("sess_report", {
      artifactDir: "/tmp/atlas-loop/sess-report",
      latestScreenshot: {
        id: "artifact_report",
        sessionId: "sess_report",
        type: "screenshot",
        path: "/tmp/atlas-loop/sess-report/screenshots/latest.png",
        createdAt: "2026-07-04T12:00:00.000Z"
      }
    }));
    const daemonUrl = `http://127.0.0.1:${server.port}`;
    const reportPath = join(tempDir, "reports", "evidence.md");
    let reportText = "";

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["evidence", "report", "--session", "latest", "--viewer-base-url", "http://127.0.0.1:5176/"])).resolves.toBe(0);
      await expect(main(["evidence", "report", "--session", "latest", "--viewer-base-url", "http://127.0.0.1:5176/", "--out", reportPath])).resolves.toBe(0);
      reportText = await readFile(reportPath, "utf8");
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(logged[0]).toContain("# Atlas Loop Evidence Report");
    expect(logged[0]).toContain("sess_report");
    const writeResult = JSON.parse(logged[1]);
    expect(writeResult).toMatchObject({ ok: true, reportPath, sessionId: "sess_report" });
    expect(reportText).toContain("Latest screenshot");
  });

  it("serializes primitive action commands to daemon action requests", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-actions-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = await startRecordingDaemon(requests);
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["tap", "--session", "sess_cli", "--x", "0.25", "--y", "0.75"])).resolves.toBe(0);
      await expect(main(["type", "--session", "sess_cli", "--text", "Ada"])).resolves.toBe(0);
      await expect(main(["swipe", "--session", "sess_cli", "--from", "0.5,0.8", "--to", "0.5,0.2", "--duration-ms", "450"])).resolves.toBe(0);
      await expect(main(["edge", "--session", "sess_cli", "--edge", "left", "--distance", "0.5", "--duration-ms", "300"])).resolves.toBe(0);
      await expect(main(["wait", "--session", "sess_cli", "--duration-ms", "1200"])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(logged).toHaveLength(5);
    expect(requests.map((request) => request.path)).toEqual(Array.from({ length: 5 }, () => "/sessions/sess_cli/actions"));
    expect(requests.map((request) => request.body)).toEqual([
      { action: { kind: "tap", x: 0.25, y: 0.75 } },
      { action: { kind: "typeText", text: "Ada" } },
      { action: { kind: "swipe", from: { x: 0.5, y: 0.8 }, to: { x: 0.5, y: 0.2 }, durationMs: 450 } },
      { action: { kind: "edgeGesture", edge: "left", distance: 0.5, durationMs: 300 } },
      { action: { kind: "wait", durationMs: 1200 } }
    ]);
  });

  it("serializes build, install, and launch commands to daemon runtime requests", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-runtime-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = await startRecordingDaemon(requests);
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main([
        "build",
        "--session",
        "sess_cli",
        "--project",
        "apps/ios-commerce-demo/CommerceDemo.xcodeproj",
        "--scheme",
        "CommerceDemo",
        "--configuration",
        "Debug",
        "--derived-data",
        "artifacts/DerivedData"
      ])).resolves.toBe(0);
      await expect(main(["install", "--session", "sess_cli", "--app", "artifacts/Build/CommerceDemo.app"])).resolves.toBe(0);
      await expect(main(["launch", "--session", "sess_cli", "--bundle-id", "dev.atlas-loop.CommerceDemo", "--args", "-UITest,checkout"])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(logged).toHaveLength(3);
    expect(requests.map((request) => request.path)).toEqual([
      "/sessions/sess_cli/build",
      "/sessions/sess_cli/install",
      "/sessions/sess_cli/launch"
    ]);
    expect(requests.map((request) => request.body)).toEqual([
      {
        projectPath: "apps/ios-commerce-demo/CommerceDemo.xcodeproj",
        scheme: "CommerceDemo",
        configuration: "Debug",
        derivedDataPath: "artifacts/DerivedData"
      },
      { appPath: "artifacts/Build/CommerceDemo.app" },
      { bundleId: "dev.atlas-loop.CommerceDemo", arguments: ["-UITest", "checkout"] }
    ]);
  });

  it("rejects invalid build configuration values before daemon I/O", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-invalid-config-"));
    const originalCwd = process.cwd();
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = await startRecordingDaemon(requests);
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));

    try {
      process.chdir(tempDir);
      await expect(main([
        "build",
        "--session",
        "sess_cli",
        "--project",
        "apps/ios-commerce-demo/CommerceDemo.xcodeproj",
        "--scheme",
        "CommerceDemo",
        "--configuration",
        "Beta"
      ])).rejects.toThrow("--configuration must be Debug or Release");
    } finally {
      process.chdir(originalCwd);
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requests).toEqual([]);
  });
});

async function startFakeDaemon(summaryForPath: (requestPath: string) => SessionSummary): Promise<{
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
  if (!address || typeof address === "string") throw new Error("fake daemon did not bind a TCP port");

  return {
    port: address.port,
    close: () => closeServer(server)
  };
}

async function startRecordingDaemon(requests: Array<{ path: string; body: unknown }>): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.startsWith("/sessions/")) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: `unexpected route ${request.method} ${request.url}` }
      }));
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ path: request.url, body });
    response.writeHead(200, { "content-type": "application/json" });
    const data = request.url.endsWith("/actions")
      ? {
        actionId: "act_cli",
        ok: true,
        startedAt: "2026-07-04T12:00:00.000Z",
        endedAt: "2026-07-04T12:00:00.100Z",
        artifacts: []
      }
      : { ok: true, route: request.url.split("/").at(-1) };
    response.end(JSON.stringify({ ok: true, data }));
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("recording daemon did not bind a TCP port");

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

function sessionSummary(
  sessionId: string,
  options: { artifactDir: string; latestScreenshot?: ArtifactRef }
): SessionSummary {
  return {
    session: sessionRecord(sessionId, options.artifactDir),
    paths: {
      artifactDir: options.artifactDir,
      manifest: `${options.artifactDir}/manifest.json`,
      trace: `${options.artifactDir}/trace.jsonl`,
      screenshots: `${options.artifactDir}/screenshots`
    },
    artifacts: {
      total: options.latestScreenshot ? 1 : 0,
      byType: options.latestScreenshot ? { screenshot: 1 } : {},
      latestScreenshot: options.latestScreenshot
    },
    events: { total: 0 },
    storage: { source: "disk", artifactBacked: true, warnings: [] }
  };
}

function sessionRecord(sessionId: string, artifactDir: string): Session {
  return {
    id: sessionId,
    schemaVersion: "atlas-loop.session.v1",
    platform: "ios-simulator",
    status: "running",
    createdAt: "2026-07-04T12:00:00.000Z",
    updatedAt: "2026-07-04T12:00:01.000Z",
    simulator: { name: "iPhone 16" },
    artifactDir
  };
}
