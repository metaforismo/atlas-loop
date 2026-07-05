import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildViewerUrl, callToolWithEnvelope, tools } from "../../apps/mcp-server/src/index.ts";
import type { Session, TraceEvent } from "@atlas-loop/protocol";

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
      "atlas.sessionReady",
      "atlas.getSessionHandoff",
      "atlas.listEvents",
      "atlas.exportEvents",
      "atlas.getArtifactPath",
      "atlas.getLatestScreenshotPath",
      "atlas.verifyArtifacts",
      "atlas.getArtifactHealth",
      "atlas.getViewerUrl",
      "atlas.getEvidence",
      "atlas.getEvidenceReport",
      "atlas.exportEvidence"
    ]));
    expect(tools.find((tool) => tool.name === "atlas.listSessions")?.description).toContain("active and persisted");
  });

  it("publishes concrete input schemas for agent-authored runtime calls", () => {
    const createSession = schemaFor("atlas.createSession");
    const build = schemaFor("atlas.build");
    const action = schemaFor("atlas.performAction");
    const ready = schemaFor("atlas.sessionReady");
    const handoff = schemaFor("atlas.getSessionHandoff");
    const listEvents = schemaFor("atlas.listEvents");
    const exportEvents = schemaFor("atlas.exportEvents");
    const verifyArtifacts = schemaFor("atlas.verifyArtifacts");
    const artifactHealth = schemaFor("atlas.getArtifactHealth");

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
    expect(ready).toMatchObject({
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "Session id or latest." },
        daemonUrl: { type: "string" },
        viewerBaseUrl: { type: "string" }
      }
    });
    expect(handoff).toMatchObject({
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "Session id or latest." },
        daemonUrl: { type: "string" },
        viewerBaseUrl: { type: "string" }
      }
    });
    expect(listEvents).toMatchObject({
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "Session id or latest." },
        type: { type: "string", description: "Exact trace event type to include." },
        limit: { type: "integer", minimum: 0 },
        daemonUrl: { type: "string" }
      },
      additionalProperties: false
    });
    expect(exportEvents).toMatchObject({
      required: ["sessionId", "outPath"],
      properties: {
        sessionId: { type: "string", description: "Session id or latest." },
        outPath: { type: "string", description: "Local JSON file path to write." },
        type: { type: "string", description: "Exact trace event type to include." },
        limit: { type: "integer", minimum: 0 },
        daemonUrl: { type: "string" }
      },
      additionalProperties: false
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
    expect(verifyArtifacts).toMatchObject({
      properties: {
        sessionId: { type: "string", description: "Session id or latest." },
        path: { type: "string", description: "Local artifact directory or artifact root to validate." }
      },
      additionalProperties: false
    });
    expect(verifyArtifacts.oneOf).toEqual(expect.arrayContaining([
      { required: ["sessionId"] },
      { required: ["path"] }
    ]));
    expect(artifactHealth).toMatchObject({
      required: ["sessionId"],
      properties: {
        sessionId: { type: "string", description: "Session id or latest." }
      },
      additionalProperties: false
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

  it("returns compact readiness without treating persisted sessions as mutable", async () => {
    const latestError = { code: "HID_FAILED" as const, message: "tap failed" };

    const result = await callToolWithEnvelope("atlas.sessionReady", { sessionId: "latest" }, {
      client: {
        getSessionSummary: async (sessionId: string) => {
          expect(sessionId).toBe("latest");
          return {
            session: {
              id: "sess_ready",
              status: "running",
              error: latestError
            },
            paths: { artifactDir: "/tmp/atlas-loop/sess-ready" },
            artifacts: { latestScreenshotPath: "/tmp/atlas-loop/sess-ready/screenshots/latest.png" },
            events: {
              latestAction: {
                actionId: "act_ready",
                ok: true,
                startedAt: "2026-07-04T12:00:00.000Z",
                endedAt: "2026-07-04T12:00:00.100Z",
                artifactCount: 1
              },
              latestError
            },
            storage: {
              source: "disk",
              artifactBacked: true,
              warnings: [
                { path: "/tmp/atlas-loop/sess-ready/manifest.json", message: "legacy warning" },
                { path: "/tmp/atlas-loop/sess-ready/actions.jsonl", message: "missing actions" }
              ]
            }
          };
        }
      } as never,
      loadConfig: async () => ({ daemonUrl: "http://127.0.0.1:4317" }),
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(result).toEqual({
      ok: true,
      data: {
        sessionId: "sess_ready",
        requestedSessionId: "latest",
        status: "running",
        storage: {
          source: "disk",
          artifactBacked: true,
          warningCount: 2
        },
        artifactDir: "/tmp/atlas-loop/sess-ready",
        latestScreenshotPath: "/tmp/atlas-loop/sess-ready/screenshots/latest.png",
        latestAction: { id: "act_ready", ok: true },
        latestError,
        viewerUrl: "http://127.0.0.1:5173?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=sess_ready",
        daemonUrl: "http://127.0.0.1:4317",
        viewerBaseUrl: "http://127.0.0.1:5173",
        canMutate: false,
        hasScreenshot: true
      }
    });
  });

  it("returns structured session handoff data for agent runtimes", async () => {
    const result = await callToolWithEnvelope("atlas.getSessionHandoff", { sessionId: "latest" }, {
      client: {
        getSessionSummary: async (sessionId: string) => {
          expect(sessionId).toBe("latest");
          return {
            session: { id: "sess_handoff", status: "running" },
            paths: { artifactDir: "/tmp/atlas-loop/sess-handoff" },
            artifacts: {
              latestScreenshotPath: "/tmp/atlas-loop/sess-handoff/screenshots/latest.png"
            },
            events: {
              latestAction: {
                actionId: "act_handoff",
                ok: true,
                startedAt: "2026-07-04T12:00:00.000Z",
                endedAt: "2026-07-04T12:00:00.100Z",
                artifactCount: 1
              }
            },
            storage: {
              source: "disk",
              artifactBacked: true,
              warnings: []
            }
          };
        },
        getArtifactHealth: async (sessionId: string) => {
          expect(sessionId).toBe("sess_handoff");
          return {
            ok: true,
            target: "/tmp/atlas-loop/sess-handoff",
            source: "disk",
            artifactDir: "/tmp/atlas-loop/sess-handoff",
            requestedSessionId: "sess_handoff",
            sessionId: "sess_handoff",
            report: { ok: true, issues: [] },
            summary: {
              sessionCount: 1,
              errorCount: 0,
              warningCount: 0,
              issueCount: 0
            }
          };
        }
      } as never,
      loadConfig: async () => ({ daemonUrl: "http://127.0.0.1:4317" }),
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(result).toEqual({
      ok: true,
      data: {
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
          actionId: "act_handoff",
          ok: true,
          startedAt: "2026-07-04T12:00:00.000Z",
          endedAt: "2026-07-04T12:00:00.100Z",
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
          "atlas-loop evidence report --session sess_handoff --daemon-url http://127.0.0.1:4317",
          "atlas-loop evidence export --session sess_handoff --out ./atlas-loop-evidence/sess_handoff --daemon-url http://127.0.0.1:4317",
          "atlas-loop events export --session sess_handoff --out ./atlas-loop-events/sess_handoff.json --daemon-url http://127.0.0.1:4317",
          "atlas-loop viewer url --session sess_handoff --viewer-base-url http://127.0.0.1:5173 --daemon-url http://127.0.0.1:4317"
        ]
      }
    });
  });

  it("validates MCP action payloads before calling the daemon", async () => {
    let daemonCalled = false;

    const result = await callToolWithEnvelope("atlas.performAction", {
      sessionId: "sess_invalid",
      action: { kind: "tap", x: 1.2, y: 0.5 }
    }, {
      client: {
        performAction: async () => {
          daemonCalled = true;
          return {};
        }
      } as never
    });

    expect(daemonCalled).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: expect.stringContaining("normalized coordinates")
      }
    });
  });

  it("normalizes MCP action payloads before forwarding them", async () => {
    const forwarded: unknown[] = [];

    const result = await callToolWithEnvelope("atlas.performAction", {
      sessionId: "sess_action",
      action: {
        kind: "tap",
        x: 0.2,
        y: 0.8,
        unexpected: "should not be persisted"
      }
    }, {
      client: {
        performAction: async (_sessionId: string, request: unknown) => {
          forwarded.push(request);
          return { actionId: "act_1", ok: true, startedAt: "2026-07-04T12:00:00.000Z", endedAt: "2026-07-04T12:00:00.010Z", artifacts: [] };
        }
      } as never
    });

    expect(result).toMatchObject({ ok: true });
    expect(forwarded).toEqual([{ action: { kind: "tap", x: 0.2, y: 0.8 } }]);
  });

  it("normalizes MCP build and launch requests before forwarding them", async () => {
    const forwarded: Array<{ method: string; sessionId: string; request: unknown }> = [];

    const client = {
      build: async (sessionId: string, request: unknown) => {
        forwarded.push({ method: "build", sessionId, request });
        return { route: "build" };
      },
      launch: async (sessionId: string, request: unknown) => {
        forwarded.push({ method: "launch", sessionId, request });
        return { route: "launch" };
      }
    } as never;

    await expect(callToolWithEnvelope("atlas.build", {
      sessionId: "sess_runtime",
      scheme: "CommerceDemo",
      projectPath: "apps/ios-commerce-demo/CommerceDemo.xcodeproj",
      configuration: "Release",
      derivedDataPath: "artifacts/DerivedData",
      extra: "ignored-by-runtime-normalizer"
    }, { client })).resolves.toMatchObject({ ok: true, data: { route: "build" } });

    await expect(callToolWithEnvelope("atlas.launch", {
      sessionId: "sess_runtime",
      bundleId: "dev.atlas-loop.CommerceDemo",
      arguments: ["-UITest", "checkout"],
      environment: { ATLAS_LOOP_DEMO_MODE: "checkout" },
      extra: "ignored-by-runtime-normalizer"
    }, { client })).resolves.toMatchObject({ ok: true, data: { route: "launch" } });

    expect(forwarded).toEqual([
      {
        method: "build",
        sessionId: "sess_runtime",
        request: {
          projectPath: "apps/ios-commerce-demo/CommerceDemo.xcodeproj",
          scheme: "CommerceDemo",
          configuration: "Release",
          derivedDataPath: "artifacts/DerivedData"
        }
      },
      {
        method: "launch",
        sessionId: "sess_runtime",
        request: {
          bundleId: "dev.atlas-loop.CommerceDemo",
          arguments: ["-UITest", "checkout"],
          environment: { ATLAS_LOOP_DEMO_MODE: "checkout" }
        }
      }
    ]);
  });

  it("rejects malformed MCP launch arrays before daemon I/O", async () => {
    let daemonCalled = false;

    const result = await callToolWithEnvelope("atlas.launch", {
      sessionId: "sess_runtime",
      bundleId: "dev.atlas-loop.CommerceDemo",
      arguments: "-UITest"
    }, {
      client: {
        launch: async () => {
          daemonCalled = true;
          return {};
        }
      } as never
    });

    expect(daemonCalled).toBe(false);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "arguments must be an array of strings"
      }
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

  it("returns daemon-backed artifact health through the structured MCP envelope", async () => {
    const calls: string[] = [];
    const health = artifactHealth("sess_health", "latest", true);

    const result = await callToolWithEnvelope("atlas.getArtifactHealth", { sessionId: "latest" }, {
      client: {
        getSessionArtifactHealth: async (sessionId: string) => {
          calls.push(sessionId);
          return health;
        }
      } as never
    });

    expect(calls).toEqual(["latest"]);
    expect(result).toEqual({
      ok: true,
      data: health
    });
  });

  it("returns filtered daemon events through the structured MCP envelope", async () => {
    const calls: string[] = [];
    const events = traceEvents("sess_events");

    const result = await callToolWithEnvelope("atlas.listEvents", {
      sessionId: "latest",
      type: "action.completed",
      limit: 1
    }, {
      client: {
        events: async (sessionId: string) => {
          calls.push(sessionId);
          return events;
        }
      } as never
    });

    expect(calls).toEqual(["latest"]);
    expect(result).toEqual({
      ok: true,
      data: {
        requestedSessionId: "latest",
        filters: {
          type: "action.completed",
          limit: 1
        },
        total: 4,
        matched: 2,
        count: 1,
        events: [events[2]]
      }
    });
  });

  it("exports filtered daemon events through the structured MCP envelope", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-mcp-events-export-"));
    const calls: string[] = [];
    const events = traceEvents("sess_events_export");
    const outPath = join(tempDir, "exports", "latest-events.json");

    try {
      const result = await callToolWithEnvelope("atlas.exportEvents", {
        sessionId: "latest",
        type: "action.completed",
        limit: 1,
        outPath
      }, {
        client: {
          events: async (sessionId: string) => {
            calls.push(sessionId);
            return events;
          }
        } as never
      });

      expect(calls).toEqual(["latest"]);
      expect(result).toMatchObject({
        ok: true,
        data: {
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
        }
      });
      if (!result.ok) throw new Error(result.error.message);
      const payload = result.data as { exportedAt: string };
      expect(Number.isNaN(Date.parse(payload.exportedAt))).toBe(false);
      expect(JSON.parse(await readFile(outPath, "utf8"))).toEqual(result.data);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("uses configured daemon URL for default MCP event clients", async () => {
    const requestedPaths: string[] = [];
    const events = traceEvents("sess_configured");
    const server = await startFakeMcpEventsDaemon((requestPath) => {
      requestedPaths.push(requestPath);
      return events;
    });
    const daemonUrl = `http://127.0.0.1:${server.port}`;

    try {
      const result = await callToolWithEnvelope("atlas.listEvents", {
        sessionId: "latest",
        limit: 2
      }, {
        loadConfig: async () => ({ daemonUrl })
      });

      expect(requestedPaths).toEqual(["/sessions/latest/events"]);
      expect(result).toMatchObject({
        ok: true,
        data: {
          requestedSessionId: "latest",
          filters: { limit: 2 },
          total: 4,
          matched: 4,
          count: 2,
          events: [events[2], events[3]]
        }
      });
    } finally {
      await server.close();
    }
  });

  it("rejects invalid event limits without calling the daemon client", async () => {
    const calls: string[] = [];

    for (const limit of [-1, 1.5, "2"]) {
      const result = await callToolWithEnvelope("atlas.listEvents", {
        sessionId: "latest",
        limit
      }, {
        client: {
          events: async (sessionId: string) => {
            calls.push(sessionId);
            return [];
          }
        } as never
      });

      expect(result).toEqual({
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "limit must be a non-negative integer"
        }
      });
    }

    expect(calls).toEqual([]);
  });

  it("rejects invalid MCP event export inputs without calling the daemon client", async () => {
    const calls: string[] = [];

    const missingOut = await callToolWithEnvelope("atlas.exportEvents", {
      sessionId: "latest"
    }, {
      client: {
        events: async (sessionId: string) => {
          calls.push(sessionId);
          return [];
        }
      } as never
    });

    const invalidLimit = await callToolWithEnvelope("atlas.exportEvents", {
      sessionId: "latest",
      outPath: "/tmp/atlas-loop-events.json",
      limit: 1.5
    }, {
      client: {
        events: async (sessionId: string) => {
          calls.push(sessionId);
          return [];
        }
      } as never
    });

    expect(missingOut).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "outPath is required"
      }
    });
    expect(invalidLimit).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "limit must be a non-negative integer"
      }
    });
    expect(calls).toEqual([]);
  });

  it("validates an explicit local artifact path without daemon I/O", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-mcp-verify-path-"));
    const resolvedTempDir = await realpath(tempDir);
    const artifactDir = join(resolvedTempDir, "sess_verify_path");
    const requestedPath = "sess_verify_path";
    const originalCwd = process.cwd();
    let daemonCalled = false;

    await writeValidArtifactSession(artifactDir, "sess_verify_path");

    try {
      process.chdir(tempDir);
      const result = await callToolWithEnvelope("atlas.verifyArtifacts", { path: requestedPath }, {
        client: {
          getSessionSummary: async () => {
            daemonCalled = true;
            return {};
          }
        } as never
      });

      expect(daemonCalled).toBe(false);
      expect(result).toEqual({
        ok: true,
        data: {
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
        }
      });
    } finally {
      process.chdir(originalCwd);
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("validates a session artifact directory through the session summary", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-mcp-verify-session-"));
    const artifactDir = join(tempDir, "sessions", "sess_verify");
    const calls: string[] = [];

    await writeValidArtifactSession(artifactDir, "sess_verify");

    try {
      const result = await callToolWithEnvelope("atlas.verifyArtifacts", { sessionId: "latest" }, {
        client: {
          getSessionSummary: async (sessionId: string) => {
            calls.push(sessionId);
            return {
              session: { id: "sess_verify" },
              paths: { artifactDir }
            };
          }
        } as never
      });

      expect(calls).toEqual(["latest"]);
      expect(result).toEqual({
        ok: true,
        data: {
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
        }
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects ambiguous MCP artifact verification inputs before daemon I/O", async () => {
    let daemonCalled = false;

    const both = await callToolWithEnvelope("atlas.verifyArtifacts", {
      sessionId: "latest",
      path: "/tmp/atlas-loop/sess"
    }, {
      client: {
        getSessionSummary: async () => {
          daemonCalled = true;
          return {};
        }
      } as never
    });

    const neither = await callToolWithEnvelope("atlas.verifyArtifacts", {}, {
      client: {
        getSessionSummary: async () => {
          daemonCalled = true;
          return {};
        }
      } as never
    });

    expect(daemonCalled).toBe(false);
    expect(both).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Provide exactly one of sessionId or path"
      }
    });
    expect(neither).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "Provide exactly one of sessionId or path"
      }
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
      createdAt: "2026-07-04T12:00:00.000Z",
      metadata: { actionId: "act_report", operation: "screenshot", sizeBytes: 1024 }
    };
    const logArtifact = {
      id: "log_report",
      sessionId: "sess_report",
      type: "log",
      path: "/tmp/atlas-loop/sess-report/logs/install.log",
      createdAt: "2026-07-04T12:00:01.000Z",
      metadata: { actionId: "act_install", operation: "install", sizeBytes: 384 }
    };
    const calls: string[] = [];

    const result = await callToolWithEnvelope("atlas.getEvidenceReport", { sessionId: "latest" }, {
      client: {
        getSessionSummary: async (sessionId: string) => {
          calls.push(`summary:${sessionId}`);
          return {
            session: {
              id: "sess_report",
              status: "ended",
              createdAt: "2026-07-04T12:00:00.000Z",
              updatedAt: "2026-07-04T12:00:01.000Z"
            },
            paths: { artifactDir: "/tmp/atlas-loop/sess-report" },
            artifacts: { total: 2, byType: { screenshot: 1, log: 1 }, latestScreenshot: artifact },
            events: { total: 3 },
            storage: { source: "disk", artifactBacked: true, warnings: [] }
          };
        },
        listArtifacts: async (sessionId: string) => {
          calls.push(`artifacts:${sessionId}`);
          return [artifact, { id: "", type: "log", path: "" }, logArtifact];
        }
      } as never,
      loadConfig: async () => ({ daemonUrl: "http://127.0.0.1:4317" }),
      viewerBaseUrl: "http://127.0.0.1:5173/"
    });

    expect(calls).toEqual(["summary:latest", "artifacts:sess_report"]);
    expect(result).toMatchObject({
      ok: true,
      data: {
        evidence: {
          sessionId: "sess_report",
          requestedSessionId: "latest",
          artifactTotal: 2,
          artifactCounts: { screenshot: 1, log: 1 },
          artifactHighlights: [
            expect.objectContaining({ id: "log_report" }),
            expect.objectContaining({ id: "artifact_report" })
          ],
          eventTotal: 3
        },
        report: expect.stringContaining("# Atlas Loop Evidence Report")
      }
    });
    if (!result.ok) throw new Error(result.error.message);
    const reportResult = result.data as { report: string };
    expect(reportResult.report).toContain("Artifact Highlights");
    expect(reportResult.report).toContain("log_report");
    expect(reportResult.report).toContain("act_report");
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

  it("exports a local evidence bundle through a structured MCP tool response", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "atlas-loop-mcp-export-"));
    const artifactDir = join(tempDir, "sessions", "sess_export");
    const screenshotsDir = join(artifactDir, "screenshots");
    const exportDir = join(tempDir, "export-bundle");
    const calls: string[] = [];
    const latestScreenshot = {
      id: "artifact_export",
      sessionId: "sess_export",
      type: "screenshot",
      path: join(screenshotsDir, "latest.png"),
      createdAt: "2026-07-04T12:00:00.000Z"
    };

    await mkdir(screenshotsDir, { recursive: true });
    await writeFile(join(artifactDir, "session.json"), JSON.stringify({
      id: "sess_export",
      schemaVersion: "atlas-loop.session.v1",
      platform: "ios-simulator",
      status: "ended",
      createdAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-04T12:00:01.000Z",
      simulator: { name: "iPhone 16" },
      artifactDir
    }, null, 2));
    await writeFile(join(artifactDir, "manifest.json"), JSON.stringify({ artifacts: [latestScreenshot] }, null, 2));
    await writeFile(join(artifactDir, "trace.jsonl"), "");
    await writeFile(latestScreenshot.path, "png-bytes");

    try {
      const result = await callToolWithEnvelope("atlas.exportEvidence", {
        sessionId: "latest",
        outDir: exportDir
      }, {
        client: {
          getSessionSummary: async (sessionId: string) => {
            calls.push(sessionId);
            return {
              session: { id: "sess_export" },
              paths: { artifactDir },
              artifacts: { total: 1, byType: { screenshot: 1 }, latestScreenshot },
              storage: { source: "disk", artifactBacked: true, warnings: [] }
            };
          }
        } as never
      });

      expect(calls).toEqual(["latest"]);
      expect(result).toMatchObject({
        ok: true,
        data: {
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
        }
      });
      await expect(readFile(join(exportDir, "screenshots", "latest.png"), "utf8")).resolves.toBe("png-bytes");
      await expect(readFile(join(exportDir, "atlas-evidence-export.json"), "utf8")).resolves.toContain("sess_export");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects non-local MCP evidence export paths instead of fetching artifacts", async () => {
    const result = await callToolWithEnvelope("atlas.exportEvidence", {
      sessionId: "sess_remote",
      outDir: "/tmp/atlas-loop-remote-export"
    }, {
      client: {
        getSessionSummary: async () => ({
          session: { id: "sess_remote" },
          paths: { artifactDir: "https://example.com/artifacts/sess_remote" },
          artifacts: { total: 0, byType: {} },
          storage: { source: "disk", artifactBacked: true, warnings: [] }
        })
      } as never
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: expect.stringContaining("local filesystem path")
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

async function startFakeMcpEventsDaemon(eventsForPath: (requestPath: string) => TraceEvent[]): Promise<{
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
  if (!address || typeof address === "string") throw new Error("fake MCP events daemon did not bind a TCP port");

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

function artifactHealth(sessionId: string, requestedSessionId: string, ok: boolean): unknown {
  return {
    ok,
    target: `/tmp/atlas-loop/${sessionId}`,
    source: "daemon",
    artifactDir: `/tmp/atlas-loop/${sessionId}`,
    requestedSessionId,
    sessionId,
    report: { ok, issues: [] },
    summary: {
      sessionCount: 1,
      errorCount: 0,
      warningCount: 0,
      issueCount: 0
    }
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
  await writeFile(join(artifactDir, "session.json"), JSON.stringify({
    id: sessionId,
    schemaVersion: "atlas-loop.session.v1",
    platform: "ios-simulator",
    status: "running",
    createdAt: "2026-07-04T12:00:00.000Z",
    updatedAt: "2026-07-04T12:00:01.000Z",
    simulator: { name: "iPhone 16" },
    artifactDir
  }, null, 2));
  await writeFile(join(artifactDir, "actions.jsonl"), "");
}
