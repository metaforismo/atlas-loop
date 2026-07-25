import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDaemonServer, type SimulatorApi, type StartedDaemon } from "../../apps/daemon/src/server.js";
import type { NetworkExchange } from "../../packages/protocol/src/networkCapture.js";

/**
 * The network route end to end: a real proxy, a real origin, a real daemon, and
 * the HTTP shape the CLI, the MCP server, and the viewer all read.
 */

const tempDirs: string[] = [];
const daemons: StartedDaemon[] = [];
const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  await Promise.all(daemons.splice(0).map((daemon) => daemon.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A simulator whose screenshot blocks until the test lets it finish. */
function fakeSimulator(gate?: { wait: Promise<void> }): SimulatorApi {
  const result = (command: string, args: string[] = []) => ({
    command,
    args,
    stdout: "",
    stderr: "",
    exitCode: 0,
    durationMs: 1
  });
  return {
    runCommand: async (command: string, args: string[]) => result(command, args),
    doctor: async () => ({ ok: true, checks: [] }),
    build: async () => result("xcodebuild"),
    boot: async () => result("xcrun"),
    install: async () => result("xcrun"),
    launch: async () => result("xcrun"),
    setLocation: async () => result("xcrun"),
    clearLocation: async () => result("xcrun"),
    screenshot: async ({ outputPath }: { outputPath: string }) => {
      if (gate) await gate.wait;
      await writeFile(outputPath, Buffer.from("fake png"));
      return result("xcrun");
    },
    recordVideo: async () => result("xcrun"),
    startRecordVideo: () => ({ done: Promise.resolve(result("xcrun")), stop: async () => undefined })
  } as unknown as SimulatorApi;
}

async function request<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
  const envelope = await response.json() as { ok: boolean; data?: T; error?: { message?: string } };
  expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
  return envelope.data as T;
}

async function origin(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<number> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return (server.address() as { port: number }).port;
}

function proxied(port: number, url: string, method = "GET"): Promise<number> {
  return new Promise((resolve, reject) => {
    const call = httpRequest({ host: "127.0.0.1", port, method, path: url }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    call.on("error", reject);
    call.end();
  });
}

async function scenario(gate?: { wait: Promise<void> }) {
  const artifactRoot = await mkdtemp(join(tmpdir(), "atlas-net-root-"));
  const caDir = await mkdtemp(join(tmpdir(), "atlas-net-ca-"));
  tempDirs.push(artifactRoot, caDir);

  const daemon = await startDaemonServer({
    port: 0,
    artifactRoot,
    networkCaDir: caDir,
    simulator: fakeSimulator(gate)
  });
  daemons.push(daemon);

  const session = await request<{ id: string }>(daemon.url, "/sessions", {
    method: "POST",
    body: JSON.stringify({ simulator: { name: "iPhone 16", udid: "UDID-1" } })
  });
  return { daemon, session };
}

describe("controlling the capture", () => {
  it("starts a proxy and reports that nothing has reached it yet", async () => {
    // Routing is a separate step, so a fresh proxy must not look like a quiet app.
    const { daemon, session } = await scenario();
    const started = await request<{ active: boolean; receiving: boolean; proxyUrl: string; caPath: string }>(
      daemon.url,
      `/sessions/${session.id}/network`,
      { method: "POST", body: JSON.stringify({ action: "start" }) }
    );

    expect(started).toMatchObject({ active: true, receiving: false });
    expect(started.proxyUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(started.caPath).toContain("atlas-loop-ca.pem");
  }, 30000);

  it("reports the running proxy rather than starting a second one", async () => {
    const { daemon, session } = await scenario();
    const first = await request<{ port: number }>(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const again = await request<{ port: number; alreadyRunning?: boolean }>(
      daemon.url,
      `/sessions/${session.id}/network`,
      { method: "POST", body: JSON.stringify({}) }
    );

    expect(again.port).toBe(first.port);
    expect(again.alreadyRunning).toBe(true);
  }, 30000);

  it("installs the capture CA into the session's simulator", async () => {
    // The one part of routing that can be automated: it touches the simulator's
    // trust store, never the host's.
    const { daemon, session } = await scenario();
    const started = await request<{ trusted?: boolean }>(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({})
    });

    expect(started.trusted).toBe(true);
  }, 30000);

  it("leaves the simulator's trust store alone when asked to", async () => {
    const { daemon, session } = await scenario();
    const started = await request<{ trusted?: boolean }>(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({ trustSimulator: false })
    });

    expect(started.trusted).toBeUndefined();
  }, 30000);

  it("stopping a capture that never started is not an error", async () => {
    const { daemon, session } = await scenario();
    const stopped = await request<{ active: boolean; stopped: boolean }>(
      daemon.url,
      `/sessions/${session.id}/network`,
      { method: "POST", body: JSON.stringify({ action: "stop" }) }
    );

    expect(stopped).toMatchObject({ active: false, stopped: false });
  }, 30000);
});

describe("reading what the app requested", () => {
  it("records a forwarded request with what came back", async () => {
    const port = await origin((incoming, response) => {
      response.writeHead(incoming.url === "/v1/inventory" ? 503 : 200, { "content-type": "application/json" });
      response.end("{}");
    });
    const { daemon, session } = await scenario();
    const started = await request<{ port: number }>(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({})
    });

    await proxied(started.port, `http://127.0.0.1:${port}/v1/catalog`);
    await proxied(started.port, `http://127.0.0.1:${port}/v1/inventory`);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const view = await request<{ receiving: boolean; exchanges: NetworkExchange[]; summary: { errors: number } }>(
      daemon.url,
      `/sessions/${session.id}/network`
    );

    expect(view.receiving).toBe(true);
    expect(view.exchanges.map((exchange) => [exchange.path, exchange.status])).toEqual([
      ["/v1/catalog", 200],
      ["/v1/inventory", 503]
    ]);
    expect(view.summary.errors).toBe(1);
  }, 30000);

  it("attributes a request to the step that was running when it started", async () => {
    // The step's window and the request have to genuinely overlap, so the
    // screenshot is held open until the request has been made.
    let release = (): void => undefined;
    const gate = { wait: new Promise<void>((resolve) => (release = resolve)) };
    const port = await origin((_incoming, response) => response.end("{}"));
    const { daemon, session } = await scenario(gate);
    const started = await request<{ port: number }>(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({})
    });

    const screenshot = request<{ actionId: string }>(daemon.url, `/sessions/${session.id}/screenshot`, {
      method: "POST",
      body: JSON.stringify({ reason: "during" })
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    await proxied(started.port, `http://127.0.0.1:${port}/v1/orders`, "POST");
    release();
    const action = await screenshot;
    await new Promise((resolve) => setTimeout(resolve, 250));

    const view = await request<{
      exchanges: NetworkExchange[];
      alignment: { steps: Array<{ actionId: string; exchanges: NetworkExchange[] }>; unattributed: NetworkExchange[] };
    }>(daemon.url, `/sessions/${session.id}/network`);

    expect(view.exchanges[0]!.actionId).toBe(action.actionId);
    expect(view.alignment.steps).toEqual([
      { actionId: action.actionId, exchanges: [expect.objectContaining({ path: "/v1/orders" })] }
    ]);
    expect(view.alignment.unattributed).toEqual([]);
  }, 30000);

  it("leaves a request made outside every step unattributed", async () => {
    const port = await origin((_incoming, response) => response.end("{}"));
    const { daemon, session } = await scenario();
    const started = await request<{ port: number }>(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({})
    });

    await proxied(started.port, `http://127.0.0.1:${port}/v1/background`);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const view = await request<{ alignment: { steps: unknown[]; unattributed: NetworkExchange[] } }>(
      daemon.url,
      `/sessions/${session.id}/network`
    );

    expect(view.alignment.steps).toEqual([]);
    expect(view.alignment.unattributed.map((exchange) => exchange.path)).toEqual(["/v1/background"]);
  }, 30000);

  it("keeps the capture readable after it is stopped", async () => {
    // Stopping releases the port; the evidence has to survive as an artifact.
    const port = await origin((_incoming, response) => response.end("{}"));
    const { daemon, session } = await scenario();
    const started = await request<{ port: number }>(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({})
    });

    await proxied(started.port, `http://127.0.0.1:${port}/v1/catalog`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await request(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({ action: "stop" })
    });

    const view = await request<{ active: boolean; exchanges: NetworkExchange[] }>(
      daemon.url,
      `/sessions/${session.id}/network`
    );
    const artifacts = await request<Array<Record<string, any>>>(daemon.url, `/sessions/${session.id}/artifacts`);

    expect(view.active).toBe(false);
    expect(view.exchanges.map((exchange) => exchange.path)).toEqual(["/v1/catalog"]);
    expect(artifacts.find((artifact) => artifact.metadata?.kind === "network-capture")).toMatchObject({
      type: "log",
      metadata: { exchangeCount: 1, truncated: false }
    });
  }, 30000);

  it("does not write an artifact for a capture that recorded nothing", async () => {
    const { daemon, session } = await scenario();
    await request(daemon.url, `/sessions/${session.id}/network`, { method: "POST", body: JSON.stringify({}) });
    await request(daemon.url, `/sessions/${session.id}/network`, {
      method: "POST",
      body: JSON.stringify({ action: "stop" })
    });

    const artifacts = await request<Array<Record<string, any>>>(daemon.url, `/sessions/${session.id}/artifacts`);

    expect(artifacts.filter((artifact) => artifact.metadata?.kind === "network-capture")).toEqual([]);
  }, 30000);

  it("reports an inactive capture for a session that never started one", async () => {
    const { daemon, session } = await scenario();

    expect(await request(daemon.url, `/sessions/${session.id}/network`)).toMatchObject({
      active: false,
      receiving: false,
      exchanges: []
    });
  }, 30000);
});
