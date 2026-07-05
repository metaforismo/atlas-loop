import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { startDaemonServer, type StartedDaemon, type SimulatorApi } from "./server.ts";

const startedDaemons: StartedDaemon[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(startedDaemons.splice(0).map((daemon) => daemon.close()));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("daemon session summary", () => {
  it("returns a not found error when latest is requested without sessions", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-latest-empty-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const response = await fetch(`${daemon.url}/v1/sessions/latest`);
    const envelope = await response.json() as { ok: boolean; error?: { code?: string; message?: string } };

    expect(response.status).toBe(404);
    expect(envelope).toMatchObject({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "no sessions are available for latest alias"
      }
    });
  });

  it("resolves latest to the only session", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-latest-one-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });

    const latest = await requestJson<{ id: string }>(daemon.url, "/v1/sessions/latest");

    expect(latest.id).toBe(created.id);
  });

  it("resolves latest to the newest active session before ended sessions", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-latest-active-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const first = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const second = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 17" } })
    });
    await requestJson(daemon.url, `/sessions/${second.id}/end`, { method: "POST" });

    const latest = await requestJson<{ id: string }>(daemon.url, "/v1/sessions/latest");
    await requestJson(daemon.url, `/sessions/${first.id}/end`, { method: "POST" });
    const latestAfterAllEnded = await requestJson<{ id: string }>(daemon.url, "/v1/sessions/latest");

    expect(latest.id).toBe(first.id);
    expect(latestAfterAllEnded.id).toBe(first.id);
  });

  it("returns session paths, artifact counts, and latest screenshot metadata", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-summary-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const screenshotResult = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "summary-test" })
    });

    const summary = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/summary`);
    const screenshotArtifact = screenshotResult.artifacts[0];

    expect(screenshotArtifact.metadata).toMatchObject({
      reason: "summary-test",
      sizeBytes: 8,
      mediaType: "image/png",
      actionId: screenshotResult.actionId,
      actionSequence: 1,
      actionKind: "screenshot",
      latest: true,
      latestScreenshot: true
    });
    expect(summary.session).toMatchObject({ id: created.id, simulator: { name: "iPhone 16" } });
    expect(summary.paths.artifactDir).toContain(created.id);
    expect(summary.artifacts).toMatchObject({
      total: 1,
      byType: { screenshot: 1 },
      latestScreenshotId: screenshotArtifact.id,
      latestScreenshotPath: screenshotArtifact.path,
      latestScreenshotCreatedAt: screenshotArtifact.createdAt
    });
    expect(summary.artifacts.latestScreenshot).toMatchObject({
      type: "screenshot",
      sessionId: created.id,
      metadata: {
        reason: "summary-test",
        sizeBytes: 8,
        mediaType: "image/png",
        actionId: screenshotResult.actionId,
        actionSequence: 1,
        latestScreenshot: true
      }
    });
    expect(summary.events.latestAction).toMatchObject({ ok: true, artifactCount: 1 });
    expect(summary.storage).toMatchObject({ source: "memory", artifactBacked: true, warnings: [] });
  });

  it("returns artifact health for a valid session artifact directory", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-health-ok-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string; artifactDir: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    await requestJson(daemon.url, `/sessions/${created.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "health-ok" })
    });

    const health = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/artifacts/health`);

    expect(health).toMatchObject({
      ok: true,
      sessionId: created.id,
      requestedSessionId: created.id,
      source: "memory",
      artifactDir: created.artifactDir,
      summary: {
        sessionCount: 1,
        errorCount: 0,
        warningCount: 0,
        issueCount: 0
      },
      report: {
        ok: true,
        sessionCount: 1,
        issues: []
      }
    });
    expect(health.target).toBe(created.artifactDir);
    expect(health.report.target).toBe(created.artifactDir);
  });

  it("summarizes artifact health warning and error counts", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-health-counts-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string; artifactDir: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const sessionPath = join(created.artifactDir, "session.json");
    const sessionJson = JSON.parse(await readFile(sessionPath, "utf8"));
    await writeFile(sessionPath, JSON.stringify({ ...sessionJson, platform: "android" }, null, 2));

    const health = await requestJson<Record<string, any>>(daemon.url, `/v1/sessions/${created.id}/artifacts/health`);

    expect(health).toMatchObject({
      ok: false,
      sessionId: created.id,
      requestedSessionId: created.id,
      source: "memory",
      summary: {
        sessionCount: 1,
        errorCount: 1,
        warningCount: 1,
        issueCount: 2
      },
      report: { ok: false, sessionCount: 1 }
    });
    expect(health.report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", message: "session platform must be ios-simulator" }),
      expect.objectContaining({ severity: "warning", message: expect.stringContaining("actions.jsonl is missing") })
    ]));
  });

  it("resolves latest when returning artifact health", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-health-latest-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const newest = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 17" } })
    });
    await requestJson(daemon.url, `/sessions/${newest.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "health-latest" })
    });

    const health = await requestJson<Record<string, any>>(daemon.url, "/v1/sessions/latest/artifacts/health");

    expect(health).toMatchObject({
      ok: true,
      sessionId: newest.id,
      requestedSessionId: "latest",
      source: "memory",
      summary: {
        sessionCount: 1,
        errorCount: 0,
        warningCount: 0,
        issueCount: 0
      }
    });
  });

  it("adds file and action metadata to command artifacts", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-command-metadata-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const installResult = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/install`, {
      method: "POST",
      body: JSON.stringify({ appPath: "/tmp/Test.app" })
    });
    const artifacts = await requestJson<Array<Record<string, any>>>(daemon.url, `/sessions/${created.id}/artifacts`);
    const logArtifact = installResult.artifacts.find((artifact: Record<string, any>) => artifact.type === "log");
    const metadataArtifact = installResult.artifacts.find((artifact: Record<string, any>) => artifact.type === "metadata");

    expect(logArtifact.metadata).toMatchObject({
      sizeBytes: expect.any(Number),
      mediaType: "text/plain",
      actionId: installResult.actionId,
      actionSequence: 1,
      actionKind: "install",
      operation: "install",
      command: "xcrun simctl install",
      exitCode: 0,
      durationMs: 1
    });
    expect(metadataArtifact.metadata).toMatchObject({
      sizeBytes: expect.any(Number),
      mediaType: "application/json",
      actionId: installResult.actionId,
      actionSequence: 1,
      actionKind: "install",
      operation: "install"
    });
    expect(artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: logArtifact.id, metadata: expect.objectContaining({ actionId: installResult.actionId }) }),
      expect.objectContaining({ id: metadataArtifact.id, metadata: expect.objectContaining({ actionId: installResult.actionId }) })
    ]));
  });

  it("lists and fetches artifact-backed sessions after daemon restart", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-restart-"));
    tempDirs.push(artifactRoot);
    const firstDaemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(firstDaemon);

    const created = await requestJson<{ id: string }>(firstDaemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    await requestJson(firstDaemon.url, `/sessions/${created.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "restart-test" })
    });
    await firstDaemon.close();
    startedDaemons.splice(startedDaemons.indexOf(firstDaemon), 1);

    const secondDaemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(secondDaemon);

    const sessions = await requestJson<Array<{ id: string }>>(secondDaemon.url, "/v1/sessions");
    const fetched = await requestJson<{ id: string }>(secondDaemon.url, `/v1/sessions/${created.id}`);
    const latest = await requestJson<{ id: string }>(secondDaemon.url, "/v1/sessions/latest");
    const summary = await requestJson<Record<string, any>>(secondDaemon.url, `/v1/sessions/${created.id}/summary`);
    const health = await requestJson<Record<string, any>>(secondDaemon.url, `/sessions/${created.id}/artifacts/health`);

    expect(sessions.filter((session) => session.id === created.id)).toHaveLength(1);
    expect(fetched.id).toBe(created.id);
    expect(latest.id).toBe(created.id);
    expect(summary).toMatchObject({
      session: { id: created.id },
      artifacts: { total: 1, byType: { screenshot: 1 } },
      storage: { source: "disk", artifactBacked: true, warnings: [] }
    });
    expect(summary.artifacts.latestScreenshot).toMatchObject({
      type: "screenshot",
      sessionId: created.id,
      metadata: {
        reason: "restart-test",
        sizeBytes: 8,
        mediaType: "image/png",
        actionSequence: 1,
        actionKind: "screenshot",
        latestScreenshot: true
      }
    });
    expect(health).toMatchObject({
      ok: true,
      sessionId: created.id,
      requestedSessionId: created.id,
      source: "disk",
      summary: {
        sessionCount: 1,
        errorCount: 0,
        warningCount: 0,
        issueCount: 0
      }
    });
  }, 15_000);

  it("resolves disk-only latest by newest evidence rather than stale active status", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-disk-latest-"));
    tempDirs.push(artifactRoot);
    const firstDaemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(firstDaemon);

    const staleCreated = await requestJson<{ id: string }>(firstDaemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const newerEnded = await requestJson<{ id: string }>(firstDaemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 17" } })
    });
    await requestJson(firstDaemon.url, `/sessions/${newerEnded.id}/end`, { method: "POST" });
    await firstDaemon.close();
    startedDaemons.splice(startedDaemons.indexOf(firstDaemon), 1);

    const secondDaemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(secondDaemon);

    const latest = await requestJson<{ id: string }>(secondDaemon.url, "/v1/sessions/latest");

    expect(latest.id).toBe(newerEnded.id);
    expect(latest.id).not.toBe(staleCreated.id);
  }, 15_000);

  it("rejects mutations through latest when no active in-memory session exists", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-latest-ended-mutation-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    await requestJson(daemon.url, `/sessions/${created.id}/end`, { method: "POST" });

    const latestRead = await requestJson<{ id: string }>(daemon.url, "/v1/sessions/latest");
    const latestMutation = await fetch(`${daemon.url}/sessions/latest/screenshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "should-not-write" })
    });
    const explicitMutation = await fetch(`${daemon.url}/sessions/${created.id}/screenshot`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "should-not-write" })
    });
    const latestEnvelope = await latestMutation.json() as { ok: boolean; error?: { code?: string; message?: string } };
    const explicitEnvelope = await explicitMutation.json() as { ok: boolean; error?: { code?: string; message?: string } };

    expect(latestRead.id).toBe(created.id);
    expect(latestMutation.status).toBe(404);
    expect(latestEnvelope).toMatchObject({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "no active sessions are available for latest alias"
      }
    });
    expect(explicitMutation.status).toBe(404);
    expect(explicitEnvelope).toMatchObject({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `active session not found: ${created.id}`
      }
    });
  });

  it("does not duplicate active sessions that are also present on disk", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-no-duplicates-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });

    const sessions = await requestJson<Array<{ id: string }>>(daemon.url, "/v1/sessions");

    expect(sessions.filter((session) => session.id === created.id)).toHaveLength(1);
  });

  it("returns ordered history for active memory and persisted disk sessions with limits", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-history-"));
    tempDirs.push(artifactRoot);
    const firstDaemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(firstDaemon);

    const persisted = await requestJson<{ id: string; artifactDir: string }>(firstDaemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    await requestJson(firstDaemon.url, `/sessions/${persisted.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "history-disk" })
    });
    await firstDaemon.close();
    startedDaemons.splice(startedDaemons.indexOf(firstDaemon), 1);
    await rewriteSessionTimes(persisted.artifactDir, {
      createdAt: "2001-01-01T00:00:00.000Z",
      updatedAt: "2001-01-01T00:00:00.000Z"
    });

    const secondDaemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(secondDaemon);
    const active = await requestJson<{ id: string }>(secondDaemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 17" } })
    });
    await requestJson(secondDaemon.url, `/sessions/${active.id}/launch`, {
      method: "POST",
      body: JSON.stringify({ bundleId: "com.example.History" })
    });
    await requestJson(secondDaemon.url, `/sessions/${active.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "history-memory" })
    });

    const history = await requestJson<Record<string, any>>(secondDaemon.url, "/v1/sessions/history");
    const limited = await requestJson<Record<string, any>>(secondDaemon.url, "/sessions/history?limit=1");
    const emptyLimit = await requestJson<Record<string, any>>(secondDaemon.url, "/sessions/history?limit=0");

    expect(history).toMatchObject({
      schemaVersion: "atlas-loop.session-history.v1",
      total: 2,
      count: 2,
      limit: null
    });
    expect(history.generatedAt).toEqual(expect.any(String));
    expect(history.sessions.map((entry: Record<string, any>) => entry.sessionId)).toEqual([active.id, persisted.id]);
    expect(history.sessions[0]).toMatchObject({
      session: { id: active.id, status: "running" },
      sessionId: active.id,
      status: "running",
      storage: { source: "memory", artifactBacked: true, warningCount: 0 },
      artifacts: { total: 3, byType: { log: 1, metadata: 1, screenshot: 1 } },
      events: { total: expect.any(Number), latestAction: { ok: true, artifactCount: 1 } },
      canMutate: true,
      hasScreenshot: true,
      ready: true
    });
    expect(history.sessions[0].artifacts.latestScreenshotPath).toContain(active.id);
    expect(history.sessions[1]).toMatchObject({
      session: { id: persisted.id, status: "created" },
      sessionId: persisted.id,
      status: "created",
      createdAt: "2001-01-01T00:00:00.000Z",
      updatedAt: "2001-01-01T00:00:00.000Z",
      storage: { source: "disk", artifactBacked: true, warningCount: 0 },
      artifacts: { total: 1, byType: { screenshot: 1 } },
      canMutate: false,
      hasScreenshot: true,
      ready: false
    });
    expect(history.sessions[1].artifacts.latestScreenshotPath).toContain(persisted.id);
    expect(limited).toMatchObject({
      total: 2,
      count: 1,
      limit: 1,
      sessions: [expect.objectContaining({ sessionId: active.id })]
    });
    expect(emptyLimit).toMatchObject({
      total: 2,
      count: 0,
      limit: 0,
      sessions: []
    });
  }, 15_000);

  it("rejects malformed history limits", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-history-invalid-limit-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    for (const limit of ["-1", "abc", "1.5"]) {
      const response = await fetch(`${daemon.url}/v1/sessions/history?limit=${encodeURIComponent(limit)}`);
      const envelope = await response.json() as { ok: boolean; error?: { code?: string; message?: string } };

      expect(response.status).toBe(400);
      expect(envelope).toMatchObject({
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "limit must be a non-negative integer"
        }
      });
    }
  });

  it("handles limit zero and legacy action traces without artifact arrays", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-history-legacy-trace-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string; artifactDir: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    await writeFile(
      join(created.artifactDir, "trace.jsonl"),
      `${JSON.stringify({
        type: "action.completed",
        at: "2026-07-04T09:00:03.000Z",
        result: {
          actionId: "act_legacy",
          ok: true,
          startedAt: "2026-07-04T09:00:02.000Z",
          endedAt: "2026-07-04T09:00:03.000Z"
        }
      })}\n`,
      { flag: "a" }
    );

    const emptyLimit = await requestJson<Record<string, any>>(daemon.url, "/v1/sessions/history?limit=0");
    const history = await requestJson<Record<string, any>>(daemon.url, "/v1/sessions/history?limit=1");

    expect(emptyLimit).toMatchObject({
      total: 1,
      count: 0,
      limit: 0,
      sessions: []
    });
    expect(history).toMatchObject({
      total: 1,
      count: 1,
      sessions: [
        expect.objectContaining({
          sessionId: created.id,
          events: expect.objectContaining({
            latestAction: expect.objectContaining({
              actionId: "act_legacy",
              ok: true,
              artifactCount: 0
            })
          })
        })
      ]
    });
  });

  it("records HID success metadata as durable evidence", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-hid-success-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      hidHelperPath: "/tmp/atlas-loop/helper",
      autoScreenshot: false,
      simulator: fakeSimulator(),
      hidClientFactory: () => fakeHidClient() as never
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16", udid: "SIM-123" } })
    });
    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tap", x: 0.5, y: 0.75 } })
    });
    const summary = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/summary`);
    const metadataArtifact = result.artifacts[0];
    const metadataText = await readFile(metadataArtifact.path, "utf8");

    expect(result).toMatchObject({ ok: true, artifacts: [expect.objectContaining({ type: "metadata" })] });
    expect(metadataArtifact.metadata).toMatchObject({
      actionId: result.actionId,
      actionKind: "tap",
      operation: "input-action",
      inputAction: true,
      inputBackend: "cgevent",
      ok: true
    });
    expect(JSON.parse(metadataText)).toMatchObject({
      schemaVersion: "atlas-loop.input-action.v1",
      inputBackend: "cgevent",
      helperPath: "/tmp/atlas-loop/helper",
      helperTarget: "SIM-123",
      simulator: { udid: "SIM-123", name: "iPhone 16" },
      action: { kind: "tap", x: 0.5, y: 0.75 },
      result: { ok: true }
    });
    expect(summary.events.latestAction).toMatchObject({ ok: true, artifactCount: 1 });
  });

  it("records HID failure metadata on the failed action result", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-hid-failure-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator(),
      hidClientFactory: () => fakeHidClient(new Error("tap target rejected")) as never
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tap", x: 0.1, y: 0.2 } })
    });
    const summary = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/summary`);
    const metadataArtifact = result.artifacts[0];
    const metadata = JSON.parse(await readFile(metadataArtifact.path, "utf8"));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "HID_FAILED", message: "tap target rejected" },
      artifacts: [expect.objectContaining({ type: "metadata" })]
    });
    expect(metadata).toMatchObject({
      schemaVersion: "atlas-loop.input-action.v1",
      inputBackend: "cgevent",
      action: { kind: "tap", x: 0.1, y: 0.2 },
      result: { ok: false, error: { code: "HID_FAILED", message: "tap target rejected" } }
    });
    expect(summary.session).toMatchObject({ status: "failed", error: { code: "HID_FAILED" } });
    expect(summary.events.latestAction).toMatchObject({ ok: false, artifactCount: 1 });
  });
});

describe("daemon artifact content route", () => {
  async function daemonWithScreenshot(): Promise<{ daemon: StartedDaemon; sessionId: string; artifact: Record<string, any> }> {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-content-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const screenshotResult = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "content-test" })
    });

    return { daemon, sessionId: created.id, artifact: screenshotResult.artifacts[0] };
  }

  it("streams full artifact content with media type and range advertisement", async () => {
    const { daemon, sessionId, artifact } = await daemonWithScreenshot();

    const response = await fetch(`${daemon.url}/v1/sessions/${sessionId}/artifacts/${artifact.id}/content`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-length")).toBe("8");
    expect(body).toBe("fake png");
  });

  it("serves a single byte range with 206 and content-range", async () => {
    const { daemon, sessionId, artifact } = await daemonWithScreenshot();

    const response = await fetch(`${daemon.url}/v1/sessions/${sessionId}/artifacts/${artifact.id}/content`, {
      headers: { range: "bytes=0-3" }
    });
    const body = await response.text();

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-3/8");
    expect(response.headers.get("content-length")).toBe("4");
    expect(body).toBe("fake");
  });

  it("serves a suffix byte range from the end of the file", async () => {
    const { daemon, sessionId, artifact } = await daemonWithScreenshot();

    const response = await fetch(`${daemon.url}/v1/sessions/${sessionId}/artifacts/${artifact.id}/content`, {
      headers: { range: "bytes=-3" }
    });
    const body = await response.text();

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 5-7/8");
    expect(body).toBe("png");
  });

  it("rejects unsatisfiable ranges with 416", async () => {
    const { daemon, sessionId, artifact } = await daemonWithScreenshot();

    const response = await fetch(`${daemon.url}/v1/sessions/${sessionId}/artifacts/${artifact.id}/content`, {
      headers: { range: "bytes=100-200" }
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */8");
  });

  it("returns 404 for an unknown artifact id", async () => {
    const { daemon, sessionId } = await daemonWithScreenshot();

    const response = await fetch(`${daemon.url}/v1/sessions/${sessionId}/artifacts/artifact_missing/content`);
    const envelope = await response.json() as { ok: boolean; error?: { code?: string } };

    expect(response.status).toBe(404);
    expect(envelope).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("rejects artifacts whose path escapes the session directory", async () => {
    const { daemon, sessionId, artifact } = await daemonWithScreenshot();

    const outsidePath = join(tmpdir(), "atlas-loop-escape.png");
    await writeFile(outsidePath, Buffer.from("outside"));
    tempDirs.push(outsidePath);
    const sessionDir = artifact.path.slice(0, artifact.path.indexOf(sessionId) + sessionId.length);
    const manifestPath = join(sessionDir, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.artifacts[0].path = outsidePath;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const actionsPath = join(sessionDir, "actions.jsonl");
    const rewrittenActions = (await readFile(actionsPath, "utf8"))
      .split(/\r?\n/)
      .map((line) => (line.trim() ? line.replaceAll(artifact.path, outsidePath) : line))
      .join("\n");
    await writeFile(actionsPath, rewrittenActions);

    const restarted = await startDaemonServer({
      port: 0,
      artifactRoot: sessionDir.slice(0, sessionDir.lastIndexOf("/")),
      simulator: fakeSimulator()
    });
    startedDaemons.push(restarted);

    const response = await fetch(`${restarted.url}/v1/sessions/${sessionId}/artifacts/${manifest.artifacts[0].id}/content`);

    expect(response.status).toBe(404);
  });

  it("populates artifact url on list, latest-screenshot, and summary responses", async () => {
    const { daemon, sessionId, artifact } = await daemonWithScreenshot();

    const listed = await requestJson<Array<Record<string, any>>>(daemon.url, `/v1/sessions/${sessionId}/artifacts`);
    const latest = await requestJson<Record<string, any>>(daemon.url, `/v1/sessions/${sessionId}/artifacts/latest-screenshot`);
    const summary = await requestJson<Record<string, any>>(daemon.url, `/v1/sessions/${sessionId}/summary`);
    const expectedUrl = `${daemon.url}/v1/sessions/${sessionId}/artifacts/${artifact.id}/content`;

    expect(listed[0].url).toBe(expectedUrl);
    expect(latest.url).toBe(expectedUrl);
    expect(summary.artifacts.latestScreenshot.url).toBe(expectedUrl);

    const manifestOnDisk = JSON.parse(await readFile(join(listed[0].path, "..", "..", "manifest.json"), "utf8"));
    expect(manifestOnDisk.artifacts[0].url).toBeUndefined();
  });
});

describe("daemon post-action screenshots", () => {
  async function daemonForScreenshots(options: { autoScreenshot?: boolean; screenshotFails?: boolean } = {}) {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-after-shot-"));
    tempDirs.push(artifactRoot);
    const simulator = fakeSimulator();
    if (options.screenshotFails) {
      simulator.screenshot = async () => {
        throw new Error("screenshot pipeline unavailable");
      };
    }
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      autoScreenshot: options.autoScreenshot,
      simulator,
      hidClientFactory: () => fakeHidClient() as never
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    return { daemon, sessionId: created.id };
  }

  it("captures an after screenshot with action linkage for successful input actions", async () => {
    const { daemon, sessionId } = await daemonForScreenshots();

    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${sessionId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tap", x: 0.25, y: 0.75 } })
    });

    expect(result.ok).toBe(true);
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts[0].type).toBe("metadata");
    expect(result.artifacts[1]).toMatchObject({
      type: "screenshot",
      metadata: {
        role: "after",
        actionId: result.actionId,
        actionKind: "tap",
        tapX: 0.25,
        tapY: 0.75
      }
    });
  });

  it("honors per-request skipScreenshot", async () => {
    const { daemon, sessionId } = await daemonForScreenshots();

    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${sessionId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "swipe", from: { x: 0.5, y: 0.8 }, to: { x: 0.5, y: 0.2 }, durationMs: 300 }, skipScreenshot: true })
    });

    expect(result.ok).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0].type).toBe("metadata");
  });

  it("honors the autoScreenshot config switch", async () => {
    const { daemon, sessionId } = await daemonForScreenshots({ autoScreenshot: false });

    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${sessionId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tap", x: 0.5, y: 0.5 } })
    });

    expect(result.ok).toBe(true);
    expect(result.artifacts).toHaveLength(1);
  });

  it("keeps the action successful and records a trace error when capture fails", async () => {
    const { daemon, sessionId } = await daemonForScreenshots({ screenshotFails: true });

    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${sessionId}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tap", x: 0.5, y: 0.5 } })
    });
    const events = await requestJson<Array<Record<string, any>>>(daemon.url, `/sessions/${sessionId}/events`);

    expect(result.ok).toBe(true);
    expect(result.artifacts).toHaveLength(1);
    expect(events.some((event) => event.type === "error" && String(event.error?.message ?? "").includes("screenshot pipeline unavailable"))).toBe(true);
  });
});

describe("daemon element action groundwork", () => {
  it("rejects tapElement on cgevent sessions with backend remediation", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-element-reject-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tapElement", identifier: "cart.continue" } })
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: expect.stringContaining("cgevent input backend does not support tapElement")
      }
    });
    expect(result.error.message).toContain("--input-backend xcuitest");
  });
});

describe("daemon xcuitest backend wiring", () => {
  interface FakeManagerLog {
    ensured: string[];
    targets: Array<{ udid: string; bundleId: string }>;
    actions: Array<{ udid: string; action: Record<string, any> }>;
    closed: boolean;
  }

  function fakeXcuitestManager(log: FakeManagerLog, options: { actionError?: Record<string, unknown> } = {}) {
    return {
      ensureRunner: async (udid: string) => {
        log.ensured.push(udid);
        return { udid, port: 4711, alive: true, restarts: 0, xctestrunPath: "/dd/AtlasDriverRunner_sim.xctestrun" };
      },
      setTarget: async (udid: string, bundleId: string) => {
        log.targets.push({ udid, bundleId });
        return { bundleId };
      },
      performAction: async (udid: string, action: Record<string, any>) => {
        log.actions.push({ udid, action });
        if (options.actionError) throw options.actionError;
        return { exists: true, isHittable: true };
      },
      close: async () => {
        log.closed = true;
      }
    };
  }

  async function xcuitestDaemon(log: FakeManagerLog, managerOptions: { actionError?: Record<string, unknown> } = {}) {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-xcuitest-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator(),
      xcuitestManagerFactory: () => fakeXcuitestManager(log, managerOptions) as never
    });
    startedDaemons.push(daemon);
    return daemon;
  }

  it("creates xcuitest sessions and drives element actions through the runner manager", async () => {
    const log: FakeManagerLog = { ensured: [], targets: [], actions: [], closed: false };
    const daemon = await xcuitestDaemon(log);

    const created = await requestJson<Record<string, any>>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16", udid: "SIM-XC-1" }, inputBackend: "xcuitest" })
    });
    expect(created.inputBackend).toBe("xcuitest");

    await requestJson(daemon.url, `/sessions/${created.id}/launch`, {
      method: "POST",
      body: JSON.stringify({ bundleId: "app.atlasloop.CommerceDemo" })
    });

    const first = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tapElement", identifier: "cart.continue", timeoutMs: 4000 } })
    });
    const second = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "assertVisible", identifier: "confirmation" } })
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(log.ensured).toEqual(["SIM-XC-1", "SIM-XC-1"]);
    expect(log.targets).toEqual([{ udid: "SIM-XC-1", bundleId: "app.atlasloop.CommerceDemo" }]);
    expect(log.actions.map((entry) => entry.action.kind)).toEqual(["tapElement", "assertVisible"]);
    expect(log.actions[0].action).not.toHaveProperty("id");

    const metadataArtifact = first.artifacts[0];
    expect(metadataArtifact.metadata).toMatchObject({ inputBackend: "xcuitest", operation: "input-action", ok: true });
    const metadataText = JSON.parse(await readFile(metadataArtifact.path, "utf8"));
    expect(metadataText).toMatchObject({
      schemaVersion: "atlas-loop.input-action.v1",
      inputBackend: "xcuitest",
      runnerPort: 4711,
      simulatorUdid: "SIM-XC-1",
      driverData: { exists: true, isHittable: true }
    });
  });

  it("requires a launched app before xcuitest input", async () => {
    const log: FakeManagerLog = { ensured: [], targets: [], actions: [], closed: false };
    const daemon = await xcuitestDaemon(log);

    const created = await requestJson<Record<string, any>>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { udid: "SIM-XC-2" }, inputBackend: "xcuitest" })
    });
    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tap", x: 0.5, y: 0.5 } })
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST", message: expect.stringContaining("launched app") }
    });
    expect(log.ensured).toHaveLength(0);
  });

  it("propagates driver error codes onto the action result", async () => {
    const log: FakeManagerLog = { ensured: [], targets: [], actions: [], closed: false };
    const daemon = await xcuitestDaemon(log, {
      actionError: { code: "ELEMENT_NOT_FOUND", message: "no element with identifier missing.button appeared within 5000ms" }
    });

    const created = await requestJson<Record<string, any>>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { udid: "SIM-XC-3" }, inputBackend: "xcuitest" })
    });
    await requestJson(daemon.url, `/sessions/${created.id}/launch`, {
      method: "POST",
      body: JSON.stringify({ bundleId: "app.atlasloop.CommerceDemo" })
    });
    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tapElement", identifier: "missing.button" } })
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "ELEMENT_NOT_FOUND" },
      artifacts: [expect.objectContaining({ type: "metadata" })]
    });
  });

  it("self-heals once when the driver runner dies mid-session and re-targets the app", async () => {
    const log: FakeManagerLog = { ensured: [], targets: [], actions: [], closed: false };
    let restarts = -1;
    let failedOnce = false;
    const manager = {
      ensureRunner: async (udid: string) => {
        log.ensured.push(udid);
        restarts += 1;
        return { udid, port: 4711, alive: true, restarts, xctestrunPath: "/dd/AtlasDriverRunner_sim.xctestrun" };
      },
      setTarget: async (udid: string, bundleId: string) => {
        log.targets.push({ udid, bundleId });
        return { bundleId };
      },
      performAction: async (udid: string, action: Record<string, any>) => {
        log.actions.push({ udid, action });
        if (!failedOnce) {
          failedOnce = true;
          throw { code: "DRIVER_UNAVAILABLE", message: "driver runner is not reachable", retryable: true };
        }
        return { healed: true };
      },
      close: async () => {
        log.closed = true;
      }
    };

    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-xcuitest-heal-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator(),
      xcuitestManagerFactory: () => manager as never
    });
    startedDaemons.push(daemon);

    const created = await requestJson<Record<string, any>>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { udid: "SIM-HEAL" }, inputBackend: "xcuitest" })
    });
    await requestJson(daemon.url, `/sessions/${created.id}/launch`, {
      method: "POST",
      body: JSON.stringify({ bundleId: "app.atlasloop.CommerceDemo" })
    });
    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tapElement", identifier: "cart.continue" } })
    });

    expect(result.ok).toBe(true);
    expect(log.actions).toHaveLength(2);
    // The target is re-sent because the second ensureRunner reports a new generation.
    expect(log.targets).toEqual([
      { udid: "SIM-HEAL", bundleId: "app.atlasloop.CommerceDemo" },
      { udid: "SIM-HEAL", bundleId: "app.atlasloop.CommerceDemo" }
    ]);
    const metadataText = JSON.parse(await readFile(result.artifacts[0].path, "utf8"));
    expect(metadataText).toMatchObject({ runnerRestarts: 1, driverData: { healed: true } });
  });

  it("resolves a booted simulator udid when the session only has a name", async () => {
    const log: FakeManagerLog = { ensured: [], targets: [], actions: [], closed: false };
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-xcuitest-udid-"));
    tempDirs.push(artifactRoot);
    const simulator = fakeSimulator();
    const originalRunCommand = simulator.runCommand;
    simulator.runCommand = async (command: string, args: string[] = []) => {
      if (command === "xcrun" && args.join(" ").includes("simctl list devices booted")) {
        return {
          command,
          args,
          stdout: JSON.stringify({
            devices: {
              "com.apple.CoreSimulator.SimRuntime.iOS-18-5": [
                { udid: "BOOTED-UDID-9", name: "iPhone 16", state: "Booted" }
              ]
            }
          }),
          stderr: "",
          exitCode: 0,
          durationMs: 1
        };
      }
      return originalRunCommand(command, args);
    };
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator,
      xcuitestManagerFactory: () => fakeXcuitestManager(log) as never
    });
    startedDaemons.push(daemon);

    const created = await requestJson<Record<string, any>>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" }, inputBackend: "xcuitest" })
    });
    await requestJson(daemon.url, `/sessions/${created.id}/launch`, {
      method: "POST",
      body: JSON.stringify({ bundleId: "app.atlasloop.CommerceDemo" })
    });
    const result = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/actions`, {
      method: "POST",
      body: JSON.stringify({ action: { kind: "tap", x: 0.4, y: 0.6 } })
    });
    const session = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}`);

    expect(result.ok).toBe(true);
    expect(log.ensured).toEqual(["BOOTED-UDID-9"]);
    expect(session.simulator.udid).toBe("BOOTED-UDID-9");
  });
});

describe("daemon events stream", () => {
  it("streams existing and newly appended trace events over SSE", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-sse-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });
    await requestJson(daemon.url, `/sessions/${created.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "sse-initial" })
    });

    const controller = new AbortController();
    const response = await fetch(`${daemon.url}/v1/sessions/${created.id}/events`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (predicate: () => boolean, timeoutMs = 5000): Promise<void> => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timed out waiting for SSE data; buffer so far:\n${buffer}`);
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`SSE read timed out; buffer so far:\n${buffer}`)), remaining))
        ]);
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      if (!predicate()) throw new Error(`SSE stream ended before expected data; buffer so far:\n${buffer}`);
    };

    try {
      await readUntil(() =>
        buffer.includes("event: session.created") &&
        buffer.includes("event: action.completed") &&
        buffer.includes("sse-initial")
      );

      await requestJson(daemon.url, `/sessions/${created.id}/screenshot`, {
        method: "POST",
        body: JSON.stringify({ reason: "sse-follow" })
      });
      await readUntil(() => buffer.includes("sse-follow"));

      const framedEvent = buffer.split("\n\n").find((frame) => frame.includes("event: session.created"));
      expect(framedEvent).toBeDefined();
      const dataLine = framedEvent!.split("\n").find((line) => line.startsWith("data: "));
      expect(dataLine).toBeDefined();
      expect(dataLine).toContain(created.id);
      expect(JSON.parse(dataLine!.slice("data: ".length))).toMatchObject({ type: "session.created" });
    } finally {
      controller.abort();
    }
  });

  it("keeps returning a JSON event array without the SSE accept header", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-loop-sse-json-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator()
    });
    startedDaemons.push(daemon);

    const created = await requestJson<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16" } })
    });

    const events = await requestJson<Array<{ type: string }>>(daemon.url, `/v1/sessions/${created.id}/events`);
    expect(Array.isArray(events)).toBe(true);
    expect(events.some((event) => event.type === "session.created")).toBe(true);
  });
});

async function requestJson<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
  expect(response.ok).toBe(true);
  const envelope = await response.json() as { ok: boolean; data?: T; error?: unknown };
  expect(envelope.ok).toBe(true);
  return envelope.data as T;
}

async function rewriteSessionTimes(
  artifactDir: string,
  times: { createdAt: string; updatedAt: string }
): Promise<void> {
  const sessionPath = join(artifactDir, "session.json");
  const session = JSON.parse(await readFile(sessionPath, "utf8"));
  await writeFile(sessionPath, JSON.stringify({ ...session, ...times }, null, 2));
}

function fakeSimulator(): SimulatorApi {
  const result = (command: string, args: string[] = []) => ({
    command,
    args,
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1
  });

  return {
    runCommand: async (command, args) => result(command, args),
    doctor: async () => ({ ok: true, checks: [] }),
    build: async () => result("xcodebuild"),
    boot: async () => result("xcrun", ["simctl", "bootstatus"]),
    install: async () => result("xcrun", ["simctl", "install"]),
    launch: async () => result("xcrun", ["simctl", "launch"]),
    screenshot: async ({ outputPath }) => {
      await writeFile(outputPath, Buffer.from("fake png"));
      return result("xcrun", ["simctl", "io", "screenshot", outputPath]);
    },
    recordVideo: async ({ outputPath }) => result("xcrun", ["simctl", "io", "recordVideo", outputPath]),
    version: async () => {
      return {
        xcodebuild: result("xcodebuild", ["-version"]),
        simctl: result("xcrun", ["simctl", "help"])
      };
    }
  } satisfies SimulatorApi;
}

function fakeHidClient(error?: Error): {
  attach: () => Promise<void>;
  performAction: () => Promise<void>;
  close: () => void;
} {
  return {
    attach: async () => undefined,
    performAction: async () => {
      if (error) throw error;
    },
    close: () => undefined
  };
}
