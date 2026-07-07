import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildEvidenceSummary, buildSessionReadiness, buildViewerUrl, main, parseBootedDevices } from "../../apps/cli/src/index.ts";
import { startDaemonServer } from "../../apps/daemon/src/server.ts";
import type { SessionSummary } from "@atlas-loop/daemon-client";
import type { SessionHandoffBundleVerification } from "@atlas-loop/artifacts";
import type { ArtifactRef, Session, TraceEvent } from "@atlas-loop/protocol";

describe("doctor helpers", () => {
  it("parses booted devices across runtimes and tolerates malformed output", () => {
    const stdout = JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
          { udid: "UDID-A", name: "iPhone 17 Pro", state: "Booted" },
          { udid: "UDID-B", name: "iPhone 17e", state: "Shutdown" }
        ],
        "com.apple.CoreSimulator.SimRuntime.watchOS-26-2": [
          { udid: "UDID-C", name: "Watch", state: "Booted" }
        ]
      }
    });

    expect(parseBootedDevices(stdout)).toEqual([
      { udid: "UDID-A", name: "iPhone 17 Pro" },
      { udid: "UDID-C", name: "Watch" }
    ]);
    expect(parseBootedDevices("not json")).toEqual([]);
    expect(parseBootedDevices("{}")).toEqual([]);
  });
});

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

  it("builds compact readiness from one resolved session summary", async () => {
    const latestScreenshot: ArtifactRef = {
      id: "artifact_ready",
      sessionId: "sess/ready",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess-ready/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:00.000Z"
    };
    const latestError = { code: "HID_FAILED" as const, message: "tap failed" };

    const result = await buildSessionReadiness({
      getSessionSummary: async (sessionId: string) => {
        expect(sessionId).toBe("latest");
        return sessionSummary("sess/ready", {
          artifactDir: "/tmp/atlas-loop/sess-ready",
          latestScreenshot,
          storage: {
            source: "memory",
            artifactBacked: true,
            warnings: [{ path: "/tmp/atlas-loop/sess-ready/manifest.json", message: "legacy warning" }]
          },
          latestAction: {
            actionId: "act_ready",
            ok: false,
            startedAt: "2026-07-04T12:00:01.000Z",
            endedAt: "2026-07-04T12:00:01.100Z",
            artifactCount: 1,
            error: latestError
          },
          latestError
        });
      }
    }, {
      sessionId: "latest",
      daemonUrl: "http://127.0.0.1:4317",
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(result).toEqual({
      sessionId: "sess/ready",
      requestedSessionId: "latest",
      status: "running",
      storage: {
        source: "memory",
        artifactBacked: true,
        warningCount: 1
      },
      artifactDir: "/tmp/atlas-loop/sess-ready",
      latestScreenshotPath: "/tmp/atlas-loop/sess-ready/screenshots/latest.png",
      latestAction: { id: "act_ready", ok: false },
      latestError,
      viewerUrl: "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess%2Fready",
      daemonUrl: "http://127.0.0.1:4317",
      viewerBaseUrl: "http://127.0.0.1:5173",
      canMutate: true,
      hasScreenshot: true
    });
  });

  it("marks disk-backed readiness as non-mutable even for running sessions", async () => {
    const result = await buildSessionReadiness({
      getSessionSummary: async () => sessionSummary("sess_disk_ready", {
        artifactDir: "/tmp/atlas-loop/sess-disk-ready",
        status: "running",
        storage: { source: "disk", artifactBacked: true, warnings: [] }
      })
    }, {
      sessionId: "sess_disk_ready",
      daemonUrl: "http://127.0.0.1:4317"
    });

    expect(result).toMatchObject({
      sessionId: "sess_disk_ready",
      status: "running",
      storage: { source: "disk", artifactBacked: true, warningCount: 0 },
      canMutate: false,
      hasScreenshot: false
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

  it("prints readiness using the configured daemon URL and summary route", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-ready-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const server = await startFakeDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return sessionSummary("sess_ready_cli", {
        artifactDir: "/tmp/atlas-loop/sess-ready-cli",
        storage: { source: "memory", artifactBacked: true, warnings: [] }
      });
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["session", "ready", "--session", "latest", "--viewer-base-url", "http://127.0.0.1:5176/"])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual(["/sessions/latest/summary"]);
    expect(JSON.parse(logged[0])).toMatchObject({
      sessionId: "sess_ready_cli",
      requestedSessionId: "latest",
      status: "running",
      storage: { source: "memory", warningCount: 0 },
      canMutate: true,
      hasScreenshot: false,
      daemonUrl,
      viewerUrl: `http://127.0.0.1:5176?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=sess_ready_cli`
    });
  });

  it("forwards input backend selection and element actions to the daemon", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-xcuitest-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const captured: Array<{ method?: string; url?: string; body?: unknown }> = [];
    const server = createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        captured.push({ method: request.method, url: request.url, body: raw ? JSON.parse(raw) : undefined });
        response.writeHead(200, { "content-type": "application/json" });
        if (request.url === "/sessions") {
          response.end(JSON.stringify({ ok: true, data: { id: "sess_xc_cli", inputBackend: "xcuitest" } }));
          return;
        }
        response.end(JSON.stringify({
          ok: true,
          data: { actionId: "act_cli", ok: true, startedAt: "2026-07-05T12:00:00.000Z", endedAt: "2026-07-05T12:00:00.010Z", artifacts: [] }
        }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fake daemon did not bind a TCP port");
    const daemonUrl = `http://127.0.0.1:${address.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = () => undefined;

    try {
      process.chdir(tempDir);
      await expect(main(["session", "start", "--simulator", "iPhone 16", "--input-backend", "xcuitest"])).resolves.toBe(0);
      await expect(main(["tap-element", "--session", "sess_xc_cli", "--id", "cart.continue", "--timeout-ms", "4000"])).resolves.toBe(0);
      await expect(main(["assert-visible", "--session", "sess_xc_cli", "--identifier", "confirmation"])).resolves.toBe(0);
      await expect(main(["session", "start", "--input-backend", "bogus"])).rejects.toThrow(/--input-backend must be cgevent or xcuitest/);
      await expect(main(["tap-element", "--session", "sess_xc_cli"])).rejects.toThrow(/--id/);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await closeServer(server);
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(captured[0]).toMatchObject({
      method: "POST",
      url: "/sessions",
      body: { simulator: { name: "iPhone 16" }, viewer: false, inputBackend: "xcuitest" }
    });
    expect(captured[1]).toMatchObject({
      method: "POST",
      url: "/sessions/sess_xc_cli/actions",
      body: { action: { kind: "tapElement", identifier: "cart.continue", timeoutMs: 4000 } }
    });
    expect(captured[2]).toMatchObject({
      method: "POST",
      url: "/sessions/sess_xc_cli/actions",
      body: { action: { kind: "assertVisible", identifier: "confirmation" } }
    });
    expect(captured).toHaveLength(3);
  });

  it("saves and compares visual regression baselines end to end", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-baseline-"));
    const artifactRoot = join(tempDir, "artifacts", "sessions");
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const fixturesDir = join(originalCwd, "tests", "fixtures", "atlas", "png");
    const screenA = await readFile(join(fixturesDir, "screen-a.png"));
    const screenB = await readFile(join(fixturesDir, "screen-b.png"));
    let nextScreenshot = screenA;

    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      autoScreenshot: false,
      simulator: {
        runCommand: async (command: string, args: string[] = []) => ({ command, args, stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        doctor: async () => ({ ok: true, checks: [] }),
        build: async () => ({ command: "xcodebuild", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        boot: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        install: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        launch: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        screenshot: async ({ outputPath }: { outputPath: string }) => {
          await writeFile(outputPath, nextScreenshot);
          return { command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 };
        },
        recordVideo: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        startRecordVideo: () => {
          throw new Error("not used");
        },
        version: async () => ({
          xcodebuild: { command: "xcodebuild", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 },
          simctl: { command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }
        })
      } as never
    });

    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl: daemon.url }));
      process.chdir(tempDir);

      const createResponse = await fetch(`${daemon.url}/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ simulator: { name: "iPhone 16" } })
      });
      const created = (await createResponse.json() as { data: { id: string } }).data;
      const takeScreenshot = () =>
        fetch(`${daemon.url}/v1/sessions/${created.id}/screenshot`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: "baseline" })
        });

      await takeScreenshot();
      await expect(main(["baseline", "save", "--session", created.id, "--name", "home"])).resolves.toBe(0);
      const saved = JSON.parse(logged.at(-1) ?? "{}");
      expect(saved).toMatchObject({ ok: true, name: "home", width: 60, height: 120, sourceSessionId: created.id });

      // Identical screenshot passes.
      await takeScreenshot();
      await expect(main(["baseline", "compare", "--session", created.id, "--name", "home"])).resolves.toBe(0);
      expect(JSON.parse(logged.at(-1) ?? "{}")).toMatchObject({ pass: true, changedCount: 0 });

      // A different screen fails and writes the mask.
      nextScreenshot = screenB;
      await takeScreenshot();
      const maskPath = join(tempDir, "diff", "home-mask.png");
      await expect(
        main(["baseline", "compare", "--session", created.id, "--name", "home", "--out", maskPath])
      ).resolves.toBe(1);
      const failed = JSON.parse(logged.at(-1) ?? "{}");
      expect(failed.pass).toBe(false);
      expect(failed.changedRatio).toBeGreaterThan(0.3);
      expect(failed.maskPath).toBe(maskPath);
      expect((await readFile(maskPath)).subarray(1, 4).toString("latin1")).toBe("PNG");

      // A tightened ratio ceiling would also fail the identical-variant case; list shows the baseline.
      await expect(main(["baseline", "list"])).resolves.toBe(0);
      expect(JSON.parse(logged.at(-1) ?? "{}")).toMatchObject({ count: 1, baselines: [expect.objectContaining({ name: "home" })] });

      await expect(main(["baseline", "compare", "--session", created.id, "--name", "missing"])).rejects.toThrow(/no baseline named missing/);
      await expect(main(["baseline", "save", "--session", created.id, "--name", "bad name!"])).rejects.toThrow(/--name must be/);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await daemon.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes a self-contained HTML evidence report from live daemon evidence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-html-"));
    const artifactRoot = join(tempDir, "artifacts", "sessions");
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];

    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      autoScreenshot: false,
      simulator: {
        runCommand: async (command: string, args: string[] = []) => ({ command, args, stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        doctor: async () => ({ ok: true, checks: [] }),
        build: async () => ({ command: "xcodebuild", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        boot: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        install: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        launch: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        screenshot: async ({ outputPath }: { outputPath: string }) => {
          await writeFile(outputPath, Buffer.from("fake html report png"));
          return { command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 };
        },
        recordVideo: async () => ({ command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }),
        startRecordVideo: ({ outputPath }: { outputPath: string }) => {
          let resolveDone: (value: unknown) => void = () => undefined;
          const done = new Promise((resolveInner) => {
            resolveDone = resolveInner;
          });
          return {
            pid: 999,
            startedAt: new Date().toISOString(),
            done,
            stop: async () => {
              await writeFile(outputPath, Buffer.from("fake mp4"));
              const result = { command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 };
              resolveDone(result);
              return result;
            }
          };
        },
        version: async () => ({
          xcodebuild: { command: "xcodebuild", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 },
          simctl: { command: "xcrun", args: [], stdout: "", stderr: "", exitCode: 0, durationMs: 1 }
        })
      } as never
    });

    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl: daemon.url }));
      process.chdir(tempDir);

      const createResponse = await fetch(`${daemon.url}/v1/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ simulator: { name: "iPhone 16" }, record: true })
      });
      const created = (await createResponse.json() as { data: { id: string } }).data;
      await fetch(`${daemon.url}/v1/sessions/${created.id}/screenshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "html-report" })
      });
      await fetch(`${daemon.url}/v1/sessions/${created.id}/end`, { method: "POST" });

      const reportPath = join(tempDir, "reports", "evidence.html");
      await expect(main(["evidence", "report", "--session", created.id, "--format", "html", "--out", reportPath])).resolves.toBe(0);

      const html = await readFile(reportPath, "utf8");
      expect(html.startsWith("<!doctype html>")).toBe(true);
      expect(html).toContain("data:image/png;base64,");
      expect(html).toContain(created.id);
      expect(html).not.toMatch(/src="https?:\/\//);
      expect(html).toContain('src="../artifacts/sessions/');

      const summary = JSON.parse(logged.at(-1) ?? "{}");
      expect(summary).toMatchObject({ ok: true, format: "html", screenshotCount: 1 });

      await expect(main(["evidence", "report", "--session", created.id, "--format", "bogus"])).rejects.toThrow(/--format must be markdown or html/);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await daemon.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prints session history and alias results through the configured daemon URL", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-history-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const historyForPath = (requestPath: string) => ({
      schemaVersion: "atlas-loop.session-history.v1",
      generatedAt: "2026-07-05T10:00:00.000Z",
      total: 1,
      count: 1,
      limit: requestPath.endsWith("limit=2") ? 2 : 1,
      sessions: [
        {
          session: {
            id: "sess_history",
            schemaVersion: "atlas-loop.session.v1",
            platform: "ios-simulator",
            status: "ended",
            createdAt: "2026-07-04T09:00:00.000Z",
            updatedAt: "2026-07-04T09:00:01.000Z",
            simulator: {},
            artifactDir: "/tmp/atlas-loop/sess_history"
          },
          sessionId: "sess_history",
          status: "ended",
          createdAt: "2026-07-04T09:00:00.000Z",
          updatedAt: "2026-07-04T09:00:01.000Z",
          artifactDir: "/tmp/atlas-loop/sess_history",
          storage: { source: "disk", artifactBacked: true, warningCount: 0 },
          artifacts: { total: 0, byType: {} },
          events: { total: 0 },
          canMutate: false,
          hasScreenshot: false,
          ready: false
        }
      ]
    });
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      if (/^\/sessions\/history\?limit=\d+$/.test(requestPath)) {
        return { ok: true, data: historyForPath(requestPath) };
      }
      return {
        ok: false,
        status: 404,
        error: { code: "NOT_FOUND", message: `unexpected route ${requestPath}` }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["session", "history", "--limit", "2"])).resolves.toBe(0);
      await expect(main(["session", "hist", "--limit", "1"])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([
      "/sessions/history?limit=2",
      "/sessions/history?limit=1"
    ]);
    expect(JSON.parse(logged[0])).toMatchObject({
      schemaVersion: "atlas-loop.session-history.v1",
      limit: 2,
      sessions: [expect.objectContaining({ sessionId: "sess_history" })]
    });
    expect(JSON.parse(logged[1])).toMatchObject({
      schemaVersion: "atlas-loop.session-history.v1",
      limit: 1,
      sessions: [expect.objectContaining({ sessionId: "sess_history" })]
    });
  });

  it("prints filtered daemon events with configured URL and stable JSON metadata", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-events-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const events = traceEvents("sess_events");
    const server = await startEventsDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return events;
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main([
        "events",
        "list",
        "--session",
        "latest",
        "--type",
        "action.completed",
        "--limit",
        "1"
      ])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual(["/sessions/latest/events"]);
    expect(JSON.parse(logged[0])).toEqual({
      requestedSessionId: "latest",
      filters: {
        type: "action.completed",
        limit: 1
      },
      total: 4,
      matched: 2,
      count: 1,
      events: [events[2]]
    });
  });

  it("exports filtered daemon events to a local JSON file", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-events-export-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const events = traceEvents("sess_events_export");
    const outPath = join(tempDir, "exports", "events", "latest.json");
    let payload: any;
    const server = await startEventsDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return events;
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main([
        "events",
        "export",
        "--session",
        "latest",
        "--type",
        "action.completed",
        "--limit",
        "1",
        "--out",
        outPath
      ])).resolves.toBe(0);
      payload = JSON.parse(await readFile(outPath, "utf8"));
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual(["/sessions/latest/events"]);
    expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false);
    expect(payload).toMatchObject({
      schemaVersion: "atlas-loop.events-export.v1",
      requestedSessionId: "latest",
      outPath,
      localOnly: true,
      uploaded: false,
      filters: {
        type: "action.completed",
        limit: 1
      },
      total: 4,
      matched: 2,
      count: 1,
      events: [events[2]]
    });
    expect(JSON.parse(logged[0])).toEqual(payload);
  });

  it("requires an event export output path before daemon I/O", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-events-export-missing-out-"));
    const originalCwd = process.cwd();
    const requestedPaths: string[] = [];
    const server = await startEventsDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return traceEvents("sess_events_export");
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));

    try {
      process.chdir(tempDir);
      await expect(main([
        "events",
        "export",
        "--session",
        "latest"
      ])).rejects.toThrow("Missing required --out");
    } finally {
      process.chdir(originalCwd);
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([]);
  });

  it("rejects invalid event export arguments before daemon I/O", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-events-export-invalid-"));
    const originalCwd = process.cwd();
    const requestedPaths: string[] = [];
    const server = await startEventsDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return traceEvents("sess_events_export");
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));

    try {
      process.chdir(tempDir);
      await expect(main([
        "events",
        "export",
        "--session",
        "latest",
        "--limit",
        "-1",
        "--out",
        join(tempDir, "events.json")
      ])).rejects.toThrow("--limit must be a non-negative integer");
      await expect(main([
        "events",
        "export",
        "--session",
        "latest",
        "--out",
        "https://example.com/events.json"
      ])).rejects.toThrow("event export out path must be a local filesystem path");
    } finally {
      process.chdir(originalCwd);
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([]);
  });

  it("rejects invalid event limits before daemon I/O", async () => {
    await expect(main([
      "session",
      "history",
      "--limit",
      "-1"
    ])).rejects.toThrow("--limit must be a non-negative integer");

    await expect(main([
      "events",
      "list",
      "--session",
      "latest",
      "--limit",
      "-1"
    ])).rejects.toThrow("--limit must be a non-negative integer");

    await expect(main([
      "events",
      "list",
      "--session",
      "latest",
      "--limit",
      "1.5"
    ])).rejects.toThrow("--limit must be a non-negative integer");
  });

  it("prints session handoff JSON and keeps health failures as blockers", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-handoff-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const handoffJsonPath = join(tempDir, "handoffs", "handoff.json");
    let writtenJson = "";
    const latestScreenshot: ArtifactRef = {
      id: "artifact_handoff",
      sessionId: "sess_handoff_cli",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess-handoff-cli/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:00.000Z"
    };
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      if (requestPath === "/sessions/latest/summary") {
        return {
          ok: true,
          data: sessionSummary("sess_handoff_cli", {
            artifactDir: "/tmp/atlas-loop/sess-handoff-cli",
            latestScreenshot,
            storage: { source: "disk", artifactBacked: true, warnings: [] }
          })
        };
      }
      return {
        ok: false,
        status: 404,
        error: { code: "NOT_FOUND", message: "artifact health missing" }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["session", "handoff", "--session", "latest", "--viewer-base-url", "http://127.0.0.1:5176/"])).resolves.toBe(0);
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--out",
        handoffJsonPath,
        "--viewer-base-url",
        "http://127.0.0.1:5176/"
      ])).resolves.toBe(0);
      writtenJson = await readFile(handoffJsonPath, "utf8");
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([
      "/sessions/latest/summary",
      "/sessions/sess_handoff_cli/artifacts/health",
      "/sessions/latest/summary",
      "/sessions/sess_handoff_cli/artifacts/health"
    ]);
    expect(JSON.parse(logged[0])).toMatchObject({
      sessionId: "sess_handoff_cli",
      requestedSessionId: "latest",
      status: "running",
      daemonUrl,
      viewerBaseUrl: "http://127.0.0.1:5176",
      viewerUrl: `http://127.0.0.1:5176?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=sess_handoff_cli`,
      artifactDir: "/tmp/atlas-loop/sess-handoff-cli",
      latestScreenshotPath: latestScreenshot.path,
      artifactHealth: null,
      canMutate: false,
      hasScreenshot: true,
      ready: false,
      blockingReasons: ["artifact health unavailable: artifact health missing"],
      nextCommands: expect.arrayContaining([
        `atlas-loop artifacts health --session sess_handoff_cli --daemon-url ${daemonUrl}`,
        `atlas-loop session handoff --session sess_handoff_cli --bundle ./atlas-loop-handoffs/sess_handoff_cli --viewer-base-url http://127.0.0.1:5176 --daemon-url ${daemonUrl}`,
        `atlas-loop events export --session sess_handoff_cli --out ./atlas-loop-events/sess_handoff_cli.json --daemon-url ${daemonUrl}`,
        `atlas-loop viewer url --session sess_handoff_cli --viewer-base-url http://127.0.0.1:5176 --daemon-url ${daemonUrl}`
      ])
    });
    expect(JSON.parse(logged[0]).nextCommands).not.toContain(`atlas-loop screenshot --session sess_handoff_cli --reason handoff --daemon-url ${daemonUrl}`);
    expect(JSON.parse(logged[1])).toMatchObject({
      ok: true,
      format: "json",
      handoffPath: handoffJsonPath,
      sessionId: "sess_handoff_cli",
      requestedSessionId: "latest",
      ready: false,
      localOnly: true,
      uploaded: false
    });
    expect(JSON.parse(writtenJson)).toMatchObject({
      sessionId: "sess_handoff_cli",
      requestedSessionId: "latest",
      nextCommands: expect.arrayContaining([
        `atlas-loop session handoff --session sess_handoff_cli --bundle ./atlas-loop-handoffs/sess_handoff_cli --viewer-base-url http://127.0.0.1:5176 --daemon-url ${daemonUrl}`,
        `atlas-loop events export --session sess_handoff_cli --out ./atlas-loop-events/sess_handoff_cli.json --daemon-url ${daemonUrl}`
      ])
    });
  });

  it("prints Markdown session handoffs and writes selected output locally", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-handoff-md-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const handoffPath = join(tempDir, "handoffs", "handoff.md");
    const latestError = { code: "HID_FAILED" as const, message: "tap failed" };
    const latestScreenshot: ArtifactRef = {
      id: "artifact_handoff_md",
      sessionId: "sess_handoff_md",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess-handoff-md/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:00.000Z"
    };
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      if (requestPath === "/sessions/latest/summary") {
        return {
          ok: true,
          data: sessionSummary("sess_handoff_md", {
            artifactDir: "/tmp/atlas-loop/sess-handoff-md",
            latestScreenshot,
            storage: {
              source: "memory",
              artifactBacked: false,
              warnings: [{ path: "/tmp/atlas-loop/sess-handoff-md/trace.jsonl", message: "trace warning" }]
            },
            latestAction: {
              actionId: "act_handoff_md",
              ok: false,
              startedAt: "2026-07-04T12:00:01.000Z",
              endedAt: "2026-07-04T12:00:01.100Z",
              artifactCount: 1,
              error: latestError
            },
            latestError
          })
        };
      }
      if (requestPath === "/sessions/sess_handoff_md/artifacts/health") {
        return {
          ok: true,
          data: artifactHealth("sess_handoff_md", "sess_handoff_md", false, {
            errorCount: 1,
            warningCount: 2,
            issueCount: 3
          })
        };
      }
      return {
        ok: false,
        status: 404,
        error: { code: "NOT_FOUND", message: `unexpected route ${requestPath}` }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;
    let writtenNote = "";

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--format",
        "markdown",
        "--viewer-base-url",
        "http://127.0.0.1:5177/"
      ])).resolves.toBe(0);
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--format",
        "markdown",
        "--out",
        handoffPath,
        "--viewer-base-url",
        "http://127.0.0.1:5177/"
      ])).resolves.toBe(0);
      writtenNote = await readFile(handoffPath, "utf8");
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(logged[0]).toContain("# Atlas Loop Session Handoff");
    expect(logged[0]).toContain("- Resolved session: `sess_handoff_md`");
    expect(logged[0]).toContain("- Requested session: `latest`");
    expect(logged[0]).toContain("- Status: `running`");
    expect(logged[0]).toContain("- Ready: no");
    expect(logged[0]).toContain(`- Daemon URL: ${daemonUrl}`);
    expect(logged[0]).toContain(`- Viewer URL: http://127.0.0.1:5177?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=sess_handoff_md`);
    expect(logged[0]).toContain("- Artifact directory: `/tmp/atlas-loop/sess-handoff-md`");
    expect(logged[0]).toContain("- Storage: `memory` (artifact-backed: no, warnings: 1)");
    expect(logged[0]).toContain("- Latest screenshot: `/tmp/atlas-loop/sess-handoff-md/screenshots/latest.png`");
    expect(logged[0]).toContain("- Artifact health: failed (daemon, sessions: 1, errors: 1, warnings: 2, issues: 3)");
    expect(logged[0]).toContain("- Latest action: `act_handoff_md` (failed)");
    expect(logged[0]).toContain("- Action error: HID\\_FAILED: tap failed");
    expect(logged[0]).toContain("- Latest error: HID\\_FAILED: tap failed");
    expect(logged[0]).toContain("- artifact health failed: 1 errors, 2 warnings");
    expect(logged[0]).toContain(`atlas-loop session handoff --session sess_handoff_md --bundle ./atlas-loop-handoffs/sess_handoff_md --viewer-base-url http://127.0.0.1:5177 --daemon-url ${daemonUrl}`);
    expect(logged[0]).toContain(`atlas-loop events export --session sess_handoff_md --out ./atlas-loop-events/sess_handoff_md.json --daemon-url ${daemonUrl}`);
    expect(logged[0]).toContain(`atlas-loop screenshot --session sess_handoff_md --reason handoff --daemon-url ${daemonUrl}`);

    expect(JSON.parse(logged[1])).toMatchObject({
      ok: true,
      format: "markdown",
      handoffPath,
      sessionId: "sess_handoff_md",
      requestedSessionId: "latest",
      ready: false,
      localOnly: true,
      uploaded: false
    });
    expect(writtenNote).toBe(`${logged[0]}\n`);
    expect(requestedPaths).toEqual([
      "/sessions/latest/summary",
      "/sessions/sess_handoff_md/artifacts/health",
      "/sessions/latest/summary",
      "/sessions/sess_handoff_md/artifacts/health"
    ]);
  });

  it("rejects malformed handoff format flags before reading the daemon", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-handoff-format-"));
    const originalCwd = process.cwd();
    const requestedPaths: string[] = [];
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return {
        ok: false,
        status: 500,
        error: { code: "UNEXPECTED_DAEMON_READ", message: requestPath }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));

    try {
      process.chdir(tempDir);
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--format",
        "--out",
        "handoff.md"
      ])).rejects.toThrow("--format must be json or markdown");
    } finally {
      process.chdir(originalCwd);
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([]);
  });

  it("writes local session handoff bundles with resolved session evidence", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-handoff-bundle-"));
    const bundleDir = join(tempDir, "handoff-bundle");
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const artifactDir = "/tmp/atlas-loop/sess-bundle";
    const latestScreenshot: ArtifactRef = {
      id: "artifact_bundle",
      sessionId: "sess_bundle",
      type: "screenshot",
      path: `${artifactDir}/screenshots/latest.png`,
      createdAt: "2026-07-04T12:00:00.000Z",
      metadata: { actionId: "act_screenshot", operation: "screenshot", sizeBytes: 2048 }
    };
    const logArtifact: ArtifactRef = {
      id: "log_bundle",
      sessionId: "sess_bundle",
      type: "log",
      path: `${artifactDir}/logs/install.log`,
      createdAt: "2026-07-04T12:00:03.000Z",
      metadata: { actionId: "act_install", operation: "install", sizeBytes: 481 }
    };
    const events = traceEvents("sess_bundle");
    const summary = sessionSummary("sess_bundle", {
      artifactDir,
      latestScreenshot,
      storage: { source: "memory", artifactBacked: true, warnings: [] }
    });
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      if (requestPath === "/sessions/latest/summary" || requestPath === "/sessions/sess_bundle/summary") {
        return { ok: true, data: summary };
      }
      if (requestPath === "/sessions/sess_bundle/artifacts/health") {
        return {
          ok: true,
          data: artifactHealth("sess_bundle", "sess_bundle", true)
        };
      }
      if (requestPath === "/sessions/sess_bundle/events") {
        return { ok: true, data: events };
      }
      if (requestPath === "/sessions/sess_bundle/artifacts") {
        return { ok: true, data: [logArtifact, latestScreenshot] };
      }
      return {
        ok: false,
        status: 404,
        error: { code: "NOT_FOUND", message: `unexpected route ${requestPath}` }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;
    let manifest: any;
    let output: any;
    let handoffJson: any;
    let eventsJson: any;
    let handoffMarkdown = "";
    let readme = "";
    let evidenceReport = "";
    let expectedIntegrity: any;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--bundle",
        bundleDir,
        "--viewer-base-url",
        "http://127.0.0.1:5176/"
      ])).resolves.toBe(0);
      output = JSON.parse(logged[0]);
      manifest = JSON.parse(await readFile(join(bundleDir, "manifest.json"), "utf8"));
      handoffJson = JSON.parse(await readFile(join(bundleDir, "handoff.json"), "utf8"));
      eventsJson = JSON.parse(await readFile(join(bundleDir, "events.json"), "utf8"));
      handoffMarkdown = await readFile(join(bundleDir, "handoff.md"), "utf8");
      readme = await readFile(join(bundleDir, "README.md"), "utf8");
      evidenceReport = await readFile(join(bundleDir, "evidence-report.md"), "utf8");
      expectedIntegrity = {
        handoffJson: await fileIntegrity(join(bundleDir, "handoff.json")),
        handoffMarkdown: await fileIntegrity(join(bundleDir, "handoff.md")),
        readme: await fileIntegrity(join(bundleDir, "README.md")),
        eventsJson: await fileIntegrity(join(bundleDir, "events.json")),
        evidenceReport: await fileIntegrity(join(bundleDir, "evidence-report.md"))
      };
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([
      "/sessions/latest/summary",
      "/sessions/sess_bundle/artifacts/health",
      "/sessions/sess_bundle/events",
      "/sessions/sess_bundle/summary",
      "/sessions/sess_bundle/artifacts"
    ]);
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(manifest.exportedAt))).toBe(false);
    expect(output).toMatchObject({
      ok: true,
      schemaVersion: "atlas-loop.handoff-bundle.v1",
      bundleDir,
      manifestPath: join(bundleDir, "manifest.json"),
      sessionId: "sess_bundle",
      requestedSessionId: "latest",
      ready: true,
      localOnly: true,
      uploaded: false,
      warnings: []
    });
    expect(output.files).toEqual(manifest.files);
    expect(output.integrity).toEqual(manifest.integrity);
    expect(manifest).toMatchObject({
      schemaVersion: "atlas-loop.handoff-bundle.v1",
      sessionId: "sess_bundle",
      requestedSessionId: "latest",
      ready: true,
      localOnly: true,
      uploaded: false,
      viewerUrl: `http://127.0.0.1:5176?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=sess_bundle`,
      artifactDir,
      bundleDir,
      files: {
        manifest: join(bundleDir, "manifest.json"),
        handoffJson: join(bundleDir, "handoff.json"),
        handoffMarkdown: join(bundleDir, "handoff.md"),
        readme: join(bundleDir, "README.md"),
        eventsJson: join(bundleDir, "events.json"),
        evidenceReport: join(bundleDir, "evidence-report.md")
      },
      warnings: []
    });
    expect(manifest.integrity).toEqual(expectedIntegrity);
    expect(manifest.integrity).not.toHaveProperty("manifest");
    expect(handoffJson).toMatchObject({
      sessionId: "sess_bundle",
      requestedSessionId: "latest",
      ready: true
    });
    expect(handoffJson).not.toHaveProperty("localOnly");
    expect(handoffMarkdown).toContain("# Atlas Loop Session Handoff");
    expect(handoffMarkdown).toContain("- Resolved session: `sess_bundle`");
    expect(readme).toContain("# Atlas Loop Handoff Bundle");
    expect(readme).toContain("Nothing in this directory is uploaded.");
    expect(readme).toContain("- Resolved session: `sess_bundle`");
    expect(readme).toContain("- Requested session: `latest`");
    expect(readme).toContain(`- Viewer URL: http://127.0.0.1:5176?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=sess_bundle`);
    expect(readme).toContain(`- Artifact directory: \`${artifactDir}\``);
    expect(readme).toContain("- `manifest.json`: bundle metadata and integrity");
    expect(readme).toContain("- `handoff.json`: structured handoff JSON");
    expect(readme).toContain("- `handoff.md`: Markdown handoff note");
    expect(readme).toContain("- `README.md`: local bundle instructions");
    expect(readme).toContain("- `events.json`: exported daemon events");
    expect(readme).toContain("- `evidence-report.md`: Markdown evidence report");
    expect(readme).not.toContain("## Warnings");
    expect(eventsJson).toMatchObject({
      schemaVersion: "atlas-loop.events-export.v1",
      requestedSessionId: "sess_bundle",
      outPath: join(bundleDir, "events.json"),
      localOnly: true,
      uploaded: false,
      total: events.length,
      matched: events.length,
      count: events.length,
      events
    });
    expect(evidenceReport).toContain("# Atlas Loop Evidence Report");
    expect(evidenceReport).toContain("sess_bundle");
    expect(evidenceReport).toContain("log_bundle");
  });

  it("keeps handoff bundles usable when optional event and report exports fail", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-handoff-bundle-partial-"));
    const bundleDir = join(tempDir, "handoff-bundle");
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const summary = sessionSummary("sess_bundle_partial", {
      artifactDir: "/tmp/atlas-loop/sess-bundle-partial",
      storage: { source: "disk", artifactBacked: true, warnings: [] }
    });
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      if (requestPath === "/sessions/latest/summary") {
        return { ok: true, data: summary };
      }
      if (requestPath === "/sessions/sess_bundle_partial/artifacts/health") {
        return {
          ok: true,
          data: artifactHealth("sess_bundle_partial", "sess_bundle_partial", true)
        };
      }
      if (requestPath === "/sessions/sess_bundle_partial/events") {
        return {
          ok: false,
          status: 404,
          error: { code: "NOT_FOUND", message: "events route unavailable" }
        };
      }
      if (requestPath === "/sessions/sess_bundle_partial/summary") {
        return {
          ok: false,
          status: 500,
          error: { code: "INTERNAL", message: "resolved summary unavailable" }
        };
      }
      return {
        ok: false,
        status: 404,
        error: { code: "NOT_FOUND", message: `unexpected route ${requestPath}` }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;
    let output: any;
    let manifest: any;
    let handoffJson: any;
    let readme = "";
    let expectedIntegrity: any;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "events.json"), "{\"stale\":true}\n", "utf8");
    await writeFile(join(bundleDir, "evidence-report.md"), "# stale report\n", "utf8");
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--bundle",
        bundleDir
      ])).resolves.toBe(0);
      output = JSON.parse(logged[0]);
      manifest = JSON.parse(await readFile(join(bundleDir, "manifest.json"), "utf8"));
      handoffJson = JSON.parse(await readFile(join(bundleDir, "handoff.json"), "utf8"));
      readme = await readFile(join(bundleDir, "README.md"), "utf8");
      expectedIntegrity = {
        handoffJson: await fileIntegrity(join(bundleDir, "handoff.json")),
        handoffMarkdown: await fileIntegrity(join(bundleDir, "handoff.md")),
        readme: await fileIntegrity(join(bundleDir, "README.md"))
      };
      await expect(readFile(join(bundleDir, "events.json"), "utf8")).rejects.toThrow();
      await expect(readFile(join(bundleDir, "evidence-report.md"), "utf8")).rejects.toThrow();
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([
      "/sessions/latest/summary",
      "/sessions/sess_bundle_partial/artifacts/health",
      "/sessions/sess_bundle_partial/events",
      "/sessions/sess_bundle_partial/summary"
    ]);
    expect(handoffJson).toMatchObject({
      sessionId: "sess_bundle_partial",
      requestedSessionId: "latest"
    });
    expect(manifest.files).toMatchObject({
      manifest: join(bundleDir, "manifest.json"),
      handoffJson: join(bundleDir, "handoff.json"),
      handoffMarkdown: join(bundleDir, "handoff.md"),
      readme: join(bundleDir, "README.md"),
      eventsJson: null,
      evidenceReport: null
    });
    expect(manifest.integrity).toEqual(expectedIntegrity);
    expect(manifest.integrity).not.toHaveProperty("manifest");
    expect(manifest.integrity).not.toHaveProperty("eventsJson");
    expect(manifest.integrity).not.toHaveProperty("evidenceReport");
    expect(manifest.warnings).toHaveLength(2);
    expect(manifest.warnings[0]).toContain("events.json");
    expect(manifest.warnings[1]).toContain("evidence-report.md");
    expect(readme).toContain("- Resolved session: `sess_bundle_partial`");
    expect(readme).toContain("- Requested session: `latest`");
    expect(readme).toContain("Nothing in this directory is uploaded.");
    expect(readme).toContain("## Warnings");
    expect(readme).toContain("events.json unavailable");
    expect(readme).toContain("evidence-report.md unavailable");
    expect(readme).not.toContain("- `events.json`: exported daemon events");
    expect(readme).not.toContain("- `evidence-report.md`: Markdown evidence report");
    expect(output.files).toEqual(manifest.files);
    expect(output.integrity).toEqual(manifest.integrity);
    expect(output.warnings).toEqual(manifest.warnings);
  });

  it("rejects ambiguous or non-local handoff bundle output before reading the daemon", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-handoff-bundle-invalid-"));
    const originalCwd = process.cwd();
    const requestedPaths: string[] = [];
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return {
        ok: false,
        status: 500,
        error: { code: "UNEXPECTED_DAEMON_READ", message: requestPath }
      };
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));

    try {
      process.chdir(tempDir);
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--bundle",
        join(tempDir, "bundle"),
        "--out",
        join(tempDir, "handoff.json")
      ])).rejects.toThrow("Use either --bundle or --out for session handoff, not both");
      await expect(main([
        "session",
        "handoff",
        "--session",
        "latest",
        "--bundle",
        "https://example.com/handoff"
      ])).rejects.toThrow("handoff bundle path must be a local filesystem path");
    } finally {
      process.chdir(originalCwd);
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([]);
  });

  it("routes handoff bundle verification through the shared artifact verifier", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-handoff-verify-shared-"));
    const bundleDir = join(tempDir, "handoff-bundle");
    const originalLog = console.log;
    const logged: string[] = [];
    const verifierResult: SessionHandoffBundleVerification = {
      ok: false,
      schemaVersion: "atlas-loop.handoff-verify.v1",
      bundleDir,
      manifestPath: join(bundleDir, "manifest.json"),
      sessionId: "sess_shared_verify",
      checkedAt: "2026-07-04T12:00:00.000Z",
      filesChecked: 0,
      summary: {
        errorCount: 1,
        warningCount: 0,
        issueCount: 1
      },
      issues: [{
        severity: "error",
        path: bundleDir,
        message: "mocked shared verifier result"
      }],
      localOnly: true,
      uploaded: false
    };
    const verifyMock = vi.fn(async () => verifierResult);

    try {
      vi.resetModules();
      vi.doMock("@atlas-loop/artifacts", async (importOriginal) => {
        const actual = await importOriginal<typeof import("@atlas-loop/artifacts")>();
        return {
          ...actual,
          verifySessionHandoffBundle: verifyMock
        };
      });
      console.log = (value?: unknown) => {
        logged.push(String(value));
      };

      const { main: mockedMain } = await import("../../apps/cli/src/index.ts");
      await expect(mockedMain(["handoff", "verify", "--bundle", bundleDir])).resolves.toBe(1);
    } finally {
      vi.doUnmock("@atlas-loop/artifacts");
      vi.resetModules();
      console.log = originalLog;
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(verifyMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledWith({ bundleDir });
    expect(JSON.parse(logged[0])).toEqual(verifierResult);
  });

  it("rejects non-local handoff verification bundle paths", async () => {
    await expect(main([
      "handoff",
      "verify",
      "--bundle",
      "https://example.com/handoff"
    ])).rejects.toThrow("handoff bundle path must be a local filesystem path");
  });

  it("prints and writes Markdown evidence reports", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-report-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const latestScreenshot: ArtifactRef = {
      id: "artifact_report",
      sessionId: "sess_report",
      type: "screenshot",
      path: "/tmp/atlas-loop/sess-report/screenshots/latest.png",
      createdAt: "2026-07-04T12:00:04.000Z",
      metadata: { actionId: "act_report", operation: "screenshot", sizeBytes: 1204 }
    };
    const logArtifact: ArtifactRef = {
      id: "log_report",
      sessionId: "sess_report",
      type: "log",
      path: "/tmp/atlas-loop/sess-report/logs/install.log",
      createdAt: "2026-07-04T12:00:03.000Z",
      metadata: { actionId: "act_install", operation: "install", sizeBytes: 481 }
    };
    const server = await startSessionHandoffDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      if (requestPath === "/sessions/latest/summary") {
        return {
          ok: true,
          data: sessionSummary("sess_report", {
            artifactDir: "/tmp/atlas-loop/sess-report",
            latestScreenshot
          })
        };
      }
      if (requestPath === "/sessions/sess_report/artifacts") {
        return { ok: true, data: [logArtifact, latestScreenshot] };
      }
      return {
        ok: false,
        status: 404,
        error: { code: "NOT_FOUND", message: `unexpected route ${requestPath}` }
      };
    });
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
    expect(logged[0]).toContain("Artifact Highlights");
    expect(logged[0]).toContain("act_report");
    const writeResult = JSON.parse(logged[1]);
    expect(writeResult).toMatchObject({ ok: true, reportPath, sessionId: "sess_report" });
    expect(reportText).toContain("Latest screenshot");
    expect(reportText).toContain("log_report");
    expect(requestedPaths).toEqual([
      "/sessions/latest/summary",
      "/sessions/sess_report/artifacts",
      "/sessions/latest/summary",
      "/sessions/sess_report/artifacts"
    ]);
  });

  it("exports local evidence bundles from summary artifact paths without artifact downloads", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-export-"));
    const artifactDir = join(tempDir, "sessions", "sess_export");
    const screenshotsDir = join(artifactDir, "screenshots");
    const exportDir = join(tempDir, "export-bundle");
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const latestScreenshot: ArtifactRef = {
      id: "artifact_export",
      sessionId: "sess_export",
      type: "screenshot",
      path: join(screenshotsDir, "latest.png"),
      createdAt: "2026-07-04T12:00:00.000Z"
    };

    await mkdir(screenshotsDir, { recursive: true });
    await writeFile(join(artifactDir, "session.json"), JSON.stringify(sessionRecord("sess_export", artifactDir), null, 2));
    await writeFile(join(artifactDir, "manifest.json"), JSON.stringify({ artifacts: [latestScreenshot] }, null, 2));
    await writeFile(join(artifactDir, "trace.jsonl"), "");
    await writeFile(latestScreenshot.path, "png-bytes");

    const server = await startFakeDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return sessionSummary("sess_export", { artifactDir, latestScreenshot });
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["evidence", "export", "--session", "latest", "--out", exportDir])).resolves.toBe(0);
      expect(requestedPaths).toEqual(["/sessions/latest/summary"]);
      const output = JSON.parse(logged[0]);
      expect(output).toMatchObject({
        schemaVersion: "atlas-loop.evidence-export.v1",
        sessionId: "sess_export",
        requestedSessionId: "latest",
        bundleDir: exportDir,
        sourceArtifactDir: artifactDir,
        localOnly: true,
        uploaded: false,
        artifactTotal: 1,
        latestScreenshotPath: latestScreenshot.path,
        exportedLatestScreenshotPath: join(exportDir, "screenshots", "latest.png")
      });
      await expect(readFile(join(exportDir, "screenshots", "latest.png"), "utf8")).resolves.toBe("png-bytes");
      await expect(readFile(join(exportDir, "atlas-evidence-export.json"), "utf8")).resolves.toContain("sess_export");
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("verifies an explicit local artifact path with structured JSON output", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-verify-path-"));
    const resolvedTempDir = await realpath(tempDir);
    const artifactDir = join(resolvedTempDir, "sess_verify_path");
    const requestedPath = "sess_verify_path";
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];

    await writeValidArtifactSession(artifactDir, "sess_verify_path");
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["artifacts", "verify", "--path", requestedPath])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(JSON.parse(logged[0])).toEqual({
      ok: true,
      target: artifactDir,
      source: "path",
      requestedPath,
      report: {
        target: artifactDir,
        sessionCount: 1,
        issues: [],
        ok: true
      }
    });
  });

  it("verifies a session artifact directory by resolving the session summary", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-verify-session-"));
    const artifactDir = join(tempDir, "sessions", "sess_verify");
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const server = await startFakeDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return sessionSummary("sess_verify", { artifactDir });
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeValidArtifactSession(artifactDir, "sess_verify");
    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["artifacts", "verify", "--session", "latest"])).resolves.toBe(0);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual(["/sessions/latest/summary"]);
    expect(JSON.parse(logged[0])).toEqual({
      ok: true,
      target: artifactDir,
      source: "session",
      requestedSessionId: "latest",
      sessionId: "sess_verify",
      artifactDir,
      report: {
        target: artifactDir,
        sessionCount: 1,
        issues: [],
        ok: true
      }
    });
  });

  it("prints daemon-backed artifact health and exits nonzero when unhealthy", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-cli-health-"));
    const originalCwd = process.cwd();
    const originalLog = console.log;
    const logged: string[] = [];
    const requestedPaths: string[] = [];
    const server = await startArtifactHealthDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      if (requestPath === "/sessions/sess_unhealthy/artifacts/health") {
        return artifactHealth("sess_unhealthy", "sess_unhealthy", false, {
          errorCount: 1,
          warningCount: 1,
          issueCount: 2
        });
      }
      return artifactHealth("sess_health", "latest", true);
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    await writeFile(join(tempDir, "atlas-loop.config.json"), JSON.stringify({ daemonUrl }, null, 2));
    console.log = (value?: unknown) => {
      logged.push(String(value));
    };

    try {
      process.chdir(tempDir);
      await expect(main(["artifacts", "health", "--session", "latest"])).resolves.toBe(0);
      await expect(main(["artifacts", "health", "--session", "sess_unhealthy"])).resolves.toBe(1);
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([
      "/sessions/latest/artifacts/health",
      "/sessions/sess_unhealthy/artifacts/health"
    ]);
    expect(JSON.parse(logged[0])).toEqual(artifactHealth("sess_health", "latest", true));
    expect(JSON.parse(logged[1])).toMatchObject({
      ok: false,
      sessionId: "sess_unhealthy",
      requestedSessionId: "sess_unhealthy",
      summary: {
        errorCount: 1,
        warningCount: 1,
        issueCount: 2
      }
    });
  });

  it("rejects ambiguous artifact verification inputs before validation", async () => {
    await expect(main([
      "artifacts",
      "verify",
      "--session",
      "latest",
      "--path",
      "/tmp/atlas-loop/sess"
    ])).rejects.toThrow("Provide exactly one of --session or --path");
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

async function startArtifactHealthDaemon(healthForPath: (requestPath: string) => unknown): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || !request.url || !/^\/sessions\/[^/]+\/artifacts\/health$/.test(request.url)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: `unexpected route ${request.method} ${request.url}` }
      }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, data: healthForPath(request.url) }));
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake artifact health daemon did not bind a TCP port");

  return {
    port: address.port,
    close: () => closeServer(server)
  };
}

async function startEventsDaemon(eventsForPath: (requestPath: string) => TraceEvent[]): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.method !== "GET" || !request.url || !/^\/sessions\/[^/]+\/events$/.test(request.url)) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: `unexpected route ${request.method} ${request.url}` }
      }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, data: eventsForPath(request.url) }));
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake events daemon did not bind a TCP port");

  return {
    port: address.port,
    close: () => closeServer(server)
  };
}

async function startSessionHandoffDaemon(responseForPath: (requestPath: string) => {
  ok: true;
  data: unknown;
} | {
  ok: false;
  status: number;
  error: { code: string; message: string };
}): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = createServer((request, response) => {
    const requestPath = request.url ?? "";
    if (request.method !== "GET" || !requestPath) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: `unexpected route ${request.method} ${request.url}` }
      }));
      return;
    }

    const result = responseForPath(requestPath);
    if (result.ok) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, data: result.data }));
      return;
    }

    response.writeHead(result.status, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: result.error }));
  });

  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake handoff daemon did not bind a TCP port");

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

function artifactHealth(
  sessionId: string,
  requestedSessionId: string,
  ok: boolean,
  counts: Partial<{ sessionCount: number; errorCount: number; warningCount: number; issueCount: number }> = {}
): unknown {
  const summary = {
    sessionCount: counts.sessionCount ?? 1,
    errorCount: counts.errorCount ?? 0,
    warningCount: counts.warningCount ?? 0,
    issueCount: counts.issueCount ?? 0
  };
  return {
    ok,
    target: `/tmp/atlas-loop/${sessionId}`,
    source: "daemon",
    artifactDir: `/tmp/atlas-loop/${sessionId}`,
    requestedSessionId,
    sessionId,
    report: { ok, issues: [] },
    summary
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

async function fileIntegrity(filePath: string): Promise<{ sha256: string; sizeBytes: number }> {
  const contents = await readFile(filePath);
  return {
    sha256: createHash("sha256").update(contents).digest("hex"),
    sizeBytes: contents.byteLength
  };
}

function sessionSummary(
  sessionId: string,
  options: {
    artifactDir: string;
    latestScreenshot?: ArtifactRef;
    status?: Session["status"];
    storage?: SessionSummary["storage"];
    latestAction?: SessionSummary["events"]["latestAction"];
    latestError?: SessionSummary["events"]["latestError"];
  }
): SessionSummary {
  return {
    session: { ...sessionRecord(sessionId, options.artifactDir), status: options.status ?? "running" },
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
    events: {
      total: options.latestAction || options.latestError ? 1 : 0,
      latestAction: options.latestAction,
      latestError: options.latestError
    },
    storage: options.storage ?? { source: "disk", artifactBacked: true, warnings: [] }
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

function traceEvents(sessionId: string): TraceEvent[] {
  return [
    {
      type: "session.created",
      at: "2026-07-04T12:00:00.000Z",
      session: sessionRecord(sessionId, `/tmp/atlas-loop/${sessionId}`)
    },
    {
      type: "action.completed",
      at: "2026-07-04T12:00:01.000Z",
      result: {
        actionId: "act_first",
        ok: true,
        startedAt: "2026-07-04T12:00:00.900Z",
        endedAt: "2026-07-04T12:00:01.000Z",
        artifacts: []
      }
    },
    {
      type: "action.completed",
      at: "2026-07-04T12:00:02.000Z",
      result: {
        actionId: "act_second",
        ok: false,
        startedAt: "2026-07-04T12:00:01.900Z",
        endedAt: "2026-07-04T12:00:02.000Z",
        artifacts: [],
        error: { code: "HID_FAILED", message: "tap failed" }
      }
    },
    {
      type: "error",
      at: "2026-07-04T12:00:02.001Z",
      sessionId,
      error: { code: "HID_FAILED", message: "tap failed" }
    }
  ];
}

async function writeValidArtifactSession(artifactDir: string, sessionId: string): Promise<void> {
  await mkdir(join(artifactDir, "screenshots"), { recursive: true });
  await mkdir(join(artifactDir, "logs"), { recursive: true });
  await mkdir(join(artifactDir, "metadata"), { recursive: true });
  await writeFile(join(artifactDir, "session.json"), JSON.stringify(sessionRecord(sessionId, artifactDir), null, 2));
  await writeFile(join(artifactDir, "actions.jsonl"), "");
}
