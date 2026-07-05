import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEvidenceSummary, buildSessionReadiness, buildViewerUrl, main } from "../../apps/cli/src/index.ts";
import type { SessionSummary } from "@atlas-loop/daemon-client";
import type { ArtifactRef, Session, TraceEvent } from "@atlas-loop/protocol";

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
    } finally {
      process.chdir(originalCwd);
      console.log = originalLog;
      await server.close();
      await rm(tempDir, { recursive: true, force: true });
    }

    expect(requestedPaths).toEqual([
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
        `atlas-loop events export --session sess_handoff_cli --out ./atlas-loop-events/sess_handoff_cli.json --daemon-url ${daemonUrl}`,
        `atlas-loop viewer url --session sess_handoff_cli --viewer-base-url http://127.0.0.1:5176 --daemon-url ${daemonUrl}`
      ])
    });
    expect(JSON.parse(logged[0]).nextCommands).not.toContain(`atlas-loop screenshot --session sess_handoff_cli --reason handoff --daemon-url ${daemonUrl}`);
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
