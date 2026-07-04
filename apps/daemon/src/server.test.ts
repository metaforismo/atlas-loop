import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    await requestJson(daemon.url, `/sessions/${created.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "summary-test" })
    });

    const summary = await requestJson<Record<string, any>>(daemon.url, `/sessions/${created.id}/summary`);

    expect(summary.session).toMatchObject({ id: created.id, simulator: { name: "iPhone 16" } });
    expect(summary.paths.artifactDir).toContain(created.id);
    expect(summary.artifacts).toMatchObject({ total: 1, byType: { screenshot: 1 } });
    expect(summary.artifacts.latestScreenshot).toMatchObject({
      type: "screenshot",
      sessionId: created.id,
      metadata: { reason: "summary-test" }
    });
    expect(summary.events.latestAction).toMatchObject({ ok: true, artifactCount: 1 });
    expect(summary.storage).toMatchObject({ source: "memory", artifactBacked: true, warnings: [] });
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
      metadata: { reason: "restart-test" }
    });
  }, 15_000);

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
