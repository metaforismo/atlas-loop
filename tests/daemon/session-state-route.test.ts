import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDaemonServer, type SimulatorApi, type StartedDaemon } from "../../apps/daemon/src/server.js";
import type { ContainerStateDiff } from "../../packages/protocol/src/containerState.js";

/**
 * The state route end to end: a real container on disk, a real daemon, and the
 * HTTP shape the CLI, the MCP server, and the viewer all read.
 */

const tempDirs: string[] = [];
const daemons: StartedDaemon[] = [];

afterEach(async () => {
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fakeSimulator(): SimulatorApi {
  const result = (command: string, args: string[] = []) => ({
    command,
    args,
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1
  });
  const simulator: SimulatorApi = {
    runCommand: async (command: string, args: string[]) => result(command, args),
    doctor: async () => ({ ok: true, checks: [] }),
    build: async () => result("xcodebuild"),
    boot: async () => result("xcrun", ["simctl", "bootstatus"]),
    install: async () => result("xcrun", ["simctl", "install"]),
    launch: async () => result("xcrun", ["simctl", "launch"]),
    setLocation: async () => result("xcrun", ["simctl", "location"]),
    clearLocation: async () => result("xcrun", ["simctl", "location"]),
    screenshot: async ({ outputPath }: { outputPath: string }) => {
      await writeFile(outputPath, Buffer.from("fake png"));
      return result("xcrun", ["simctl", "io", "screenshot"]);
    },
    recordVideo: async () => result("xcrun", ["simctl", "io", "recordVideo"]),
    startRecordVideo: () => ({
      done: Promise.resolve(result("xcrun", ["simctl", "io", "recordVideo"])),
      stop: async () => undefined
    })
  } as unknown as SimulatorApi;
  return simulator;
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
  const envelope = await response.json() as { ok: boolean; data?: T; error?: { code?: string; message?: string } };
  expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
  return envelope.data as T;
}

async function requestError(baseUrl: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
  return (await response.json() as { ok: boolean; error?: { code?: string; message?: string } }).error;
}

/** A daemon whose container lookup points at a directory the test controls. */
async function scenario() {
  const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-state-root-"));
  const container = await mkdtemp(join(tmpdir(), "atlas-state-container-"));
  tempDirs.push(artifactRoot, container);

  const daemon = await startDaemonServer({
    port: 0,
    artifactRoot,
    simulator: fakeSimulator(),
    containerRootResolver: async () => container
  });
  daemons.push(daemon);

  const session = await request<{ id: string }>(daemon.url, "/sessions", {
    method: "POST",
    body: JSON.stringify({ simulator: { name: "iPhone 16", udid: "UDID-1" } })
  });
  // The bundle id is only known once the app is launched, which is also when a
  // container exists to snapshot.
  await request(daemon.url, `/sessions/${session.id}/launch`, {
    method: "POST",
    body: JSON.stringify({ bundleId: "app.atlasloop.CommerceDemo" })
  });

  const write = async (path: string, content: string) => {
    const full = join(container, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  };
  const capture = (body: Record<string, unknown> = {}) =>
    request<{ artifactId: string; snapshot: Record<string, unknown>; diff: ContainerStateDiff | null }>(
      daemon.url,
      `/sessions/${session.id}/state`,
      { method: "POST", body: JSON.stringify(body) }
    );

  return { daemon, session, container, write, capture };
}

describe("capturing session state", () => {
  it("reports what an action wrote between two captures", async () => {
    const { write, capture } = await scenario();
    await write("Documents/cart.json", "{\"items\":1}");

    const first = await capture({ label: "before checkout" });
    await write("Documents/orders.json", "{\"id\":\"ord_1\"}");
    const second = await capture({ label: "after checkout" });

    // Nothing to compare the first capture against; null says so rather than
    // an empty diff that would read as "nothing changed".
    expect(first.diff).toBeNull();
    expect(second.diff!.changes.some((change) => change.path === "Documents/orders.json")).toBe(true);
  });

  it("records each capture as a metadata artifact", async () => {
    const { daemon, session, write, capture } = await scenario();
    await write("Documents/cart.json", "{}");
    const captured = await capture({ label: "start" });

    const artifacts = await request<Array<Record<string, any>>>(daemon.url, `/sessions/${session.id}/artifacts`);
    const artifact = artifacts.find((entry) => entry.id === captured.artifactId);

    expect(artifact).toMatchObject({
      type: "metadata",
      metadata: { kind: "container-state", label: "start", entryCount: 1, truncated: false }
    });
  });

  it("does not report a rewrite with identical content as a change", async () => {
    const { write, capture } = await scenario();
    await write("Documents/cart.json", "{\"items\":1}");
    await capture();

    await write("Documents/cart.json", "{\"items\":1}");

    expect((await capture()).diff!.changes).toEqual([]);
  });

  it("skips the volatile areas unless asked, and says it did", async () => {
    const { write, capture } = await scenario();
    await write("Documents/cart.json", "{}");
    await write("tmp/scratch", "noise");
    const skipped = await capture();

    expect(skipped.snapshot).toMatchObject({ entryCount: 1, skippedAreas: ["caches", "temporary"] });

    const full = await capture({ includeVolatile: true });
    expect(full.snapshot).toMatchObject({ entryCount: 2, skippedAreas: [] });
  });

  it("refuses to snapshot a session with no installed app", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-state-noapp-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator(),
      containerRootResolver: async () => artifactRoot
    });
    daemons.push(daemon);

    const session = await request<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16", udid: "UDID-1" } })
    });
    const error = await requestError(daemon.url, `/sessions/${session.id}/state`, {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(error?.code).toBe("INVALID_REQUEST");
    expect(error?.message).toContain("install or launch one");
  });

  it("reports a container it cannot reach rather than an empty snapshot", async () => {
    // An empty snapshot would diff as "everything was deleted"; the failure has
    // to surface as a failure.
    const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-state-missing-"));
    tempDirs.push(artifactRoot);
    const daemon = await startDaemonServer({
      port: 0,
      artifactRoot,
      simulator: fakeSimulator(),
      containerRootResolver: async () => {
        throw new Error("no data container: not installed");
      }
    });
    daemons.push(daemon);

    const session = await request<{ id: string }>(daemon.url, "/sessions", {
      method: "POST",
      body: JSON.stringify({ simulator: { name: "iPhone 16", udid: "UDID-1" } })
    });
    await request(daemon.url, `/sessions/${session.id}/launch`, {
      method: "POST",
      body: JSON.stringify({ bundleId: "app.atlasloop.CommerceDemo" })
    });

    const error = await requestError(daemon.url, `/sessions/${session.id}/state`, {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(error?.code).toBe("COMMAND_FAILED");
    expect(error?.message).toContain("not installed");
  });
});

describe("reading session state", () => {
  it("returns every capture with the diff from the one before", async () => {
    const { daemon, session, write, capture } = await scenario();
    await write("Documents/cart.json", "{}");
    await capture({ label: "one" });
    await write("Documents/orders.json", "{}");
    await capture({ label: "two" });

    const view = await request<{
      bundleId: string;
      captures: Array<{ label?: string; diff: ContainerStateDiff | null }>;
    }>(daemon.url, `/sessions/${session.id}/state`);

    expect(view.bundleId).toBe("app.atlasloop.CommerceDemo");
    expect(view.captures.map((capture) => capture.label)).toEqual(["one", "two"]);
    expect(view.captures[0]!.diff).toBeNull();
    expect(view.captures[1]!.diff!.changes.map((change) => change.path)).toEqual(["Documents/orders.json"]);
  });

  it("returns an empty history before anything is captured", async () => {
    const { daemon, session } = await scenario();

    expect(await request<{ captures: unknown[] }>(daemon.url, `/sessions/${session.id}/state`)).toMatchObject({
      captures: []
    });
  });
});
