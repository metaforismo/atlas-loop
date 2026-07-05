import { describe, expect, it } from "vitest";
import { mapDriverError, XcuitestClientError, XcuitestRunnerManager, type RunnerProcess, type SpawnRunnerOptions } from "./index.ts";

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

class FakeRunnerProcess implements RunnerProcess {
  killed = false;
  private exitListeners: ExitListener[] = [];

  kill(): boolean {
    this.killed = true;
    return true;
  }

  on(event: "exit" | "error", listener: ExitListener | ((error: Error) => void)): this {
    if (event === "exit") this.exitListeners.push(listener as ExitListener);
    return this;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null = null): void {
    for (const listener of this.exitListeners) listener(code, signal);
  }
}

interface FakeWorld {
  manager: XcuitestRunnerManager;
  spawned: Array<{ options: SpawnRunnerOptions; process: FakeRunnerProcess }>;
  builds: number;
  healthyPorts: Set<number>;
  responses: Map<string, unknown>;
  requests: Array<{ url: string; body?: unknown }>;
}

function makeWorld(overrides: {
  xctestrunFiles?: string[];
  freePorts?: (port: number) => boolean;
  healthTimeoutMs?: number;
  failSpawn?: boolean;
} = {}): FakeWorld {
  const world: FakeWorld = {
    manager: undefined as unknown as XcuitestRunnerManager,
    spawned: [],
    builds: 0,
    healthyPorts: new Set<number>(),
    responses: new Map<string, unknown>(),
    requests: []
  };

  let xctestrunFiles = overrides.xctestrunFiles ?? [];

  world.manager = new XcuitestRunnerManager({
    projectPath: "/repo/native/ios-driver-runner/AtlasDriverRunner.xcodeproj",
    derivedDataPath: "/repo/artifacts/build/driver-runner/DerivedData",
    healthTimeoutMs: overrides.healthTimeoutMs ?? 250,
    healthPollIntervalMs: 5,
    portRange: { start: 4700, end: 4703 },
    sleep: async () => undefined,
    buildRunner: async () => {
      world.builds += 1;
      xctestrunFiles = ["/repo/artifacts/build/driver-runner/DerivedData/Build/Products/AtlasDriverRunner_sim.xctestrun"];
    },
    listXctestrunFiles: async () => xctestrunFiles,
    isPortFree: async (port) => (overrides.freePorts ? overrides.freePorts(port) : true),
    spawnRunner: (options) => {
      if (overrides.failSpawn) throw new Error("spawn blew up");
      const child = new FakeRunnerProcess();
      world.spawned.push({ options, process: child });
      // The fake runner is immediately healthy once spawned.
      world.healthyPorts.add(options.port);
      return child;
    },
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const { port, path } = parseUrl(url);
      world.requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });

      if (path === "/health") {
        if (!world.healthyPorts.has(port)) throw new Error("connection refused");
        return jsonResponse({ ok: true, runnerVersion: "0.1.0", uptimeMs: 10, screen: {} });
      }
      if (!world.healthyPorts.has(port)) throw new Error("connection refused");
      const canned = world.responses.get(path) ?? { ok: true, data: { echoed: true } };
      return jsonResponse(canned);
    }) as typeof fetch
  });

  return world;
}

function parseUrl(url: string): { port: number; path: string } {
  const parsed = new URL(url);
  return { port: Number(parsed.port), path: parsed.pathname };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

describe("xcuitest runner manager", () => {
  it("builds once when no xctestrun exists, then reuses the runner per udid", async () => {
    const world = makeWorld();

    const first = await world.manager.ensureRunner("SIM-A");
    const second = await world.manager.ensureRunner("SIM-A");

    expect(world.builds).toBe(1);
    expect(world.spawned).toHaveLength(1);
    expect(first.port).toBe(4700);
    expect(second.port).toBe(4700);
    expect(first.xctestrunPath).toContain("AtlasDriverRunner_sim.xctestrun");
  });

  it("skips the build when an xctestrun is already cached", async () => {
    const world = makeWorld({ xctestrunFiles: ["/cached/AtlasDriverRunner_sim.xctestrun"] });

    await world.manager.ensureRunner("SIM-A");

    expect(world.builds).toBe(0);
    expect(world.spawned[0].options.xctestrunPath).toBe("/cached/AtlasDriverRunner_sim.xctestrun");
  });

  it("probes the port range and skips busy ports", async () => {
    const world = makeWorld({ freePorts: (port) => port !== 4700 && port !== 4701 });

    const status = await world.manager.ensureRunner("SIM-A");

    expect(status.port).toBe(4702);
  });

  it("fails with DRIVER_UNAVAILABLE when the port range is exhausted", async () => {
    const world = makeWorld({ freePorts: () => false });

    await expect(world.manager.ensureRunner("SIM-A")).rejects.toMatchObject({
      code: "DRIVER_UNAVAILABLE",
      retryable: true,
      message: expect.stringContaining("no free driver port")
    });
  });

  it("allocates distinct ports for parallel simulators", async () => {
    const world = makeWorld();

    const first = await world.manager.ensureRunner("SIM-A");
    const second = await world.manager.ensureRunner("SIM-B");

    expect(first.port).not.toBe(second.port);
    expect(world.spawned).toHaveLength(2);
  });

  it("times out startup with DRIVER_UNAVAILABLE when health never comes up", async () => {
    const world = makeWorld({ healthTimeoutMs: 30 });
    // Never mark the port healthy.
    world.manager = new XcuitestRunnerManager({
      projectPath: "/p",
      derivedDataPath: "/d",
      healthTimeoutMs: 30,
      healthPollIntervalMs: 5,
      sleep: async () => undefined,
      listXctestrunFiles: async () => ["/cached/AtlasDriverRunner_sim.xctestrun"],
      isPortFree: async () => true,
      spawnRunner: () => new FakeRunnerProcess(),
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as typeof fetch
    });

    await expect(world.manager.ensureRunner("SIM-A")).rejects.toMatchObject({
      code: "DRIVER_UNAVAILABLE",
      retryable: true,
      message: expect.stringContaining("did not become healthy")
    });
  });

  it("maps spawn failures to DRIVER_UNAVAILABLE", async () => {
    const world = makeWorld({ failSpawn: true });

    await expect(world.manager.ensureRunner("SIM-A")).rejects.toMatchObject({
      code: "DRIVER_UNAVAILABLE",
      message: expect.stringContaining("failed to spawn"),
      details: expect.objectContaining({ cause: "spawn blew up" })
    });
  });

  it("restarts a dead runner once, then refuses with the stderr tail", async () => {
    const world = makeWorld();

    await world.manager.ensureRunner("SIM-A");
    world.spawned[0].options.onStderr("Testing crashed hard");
    world.spawned[0].process.emitExit(70);

    const restarted = await world.manager.ensureRunner("SIM-A");
    expect(restarted.restarts).toBe(1);
    expect(world.spawned).toHaveLength(2);

    world.spawned[1].process.emitExit(70);
    await expect(world.manager.ensureRunner("SIM-A")).rejects.toMatchObject({
      code: "DRIVER_UNAVAILABLE",
      message: expect.stringContaining("already restarted once")
    });
  });

  it("performs actions through /command and returns envelope data", async () => {
    const world = makeWorld();
    world.responses.set("/command", { ok: true, data: { identifier: "cart.continue", frame: { x: 1 } } });

    const data = await world.manager.performAction("SIM-A", { kind: "tapElement", identifier: "cart.continue" });

    expect(data).toMatchObject({ identifier: "cart.continue" });
    const commandRequest = world.requests.find((request) => request.url.endsWith("/command"));
    expect(commandRequest?.body).toMatchObject({ kind: "tapElement", identifier: "cart.continue" });
  });

  it("maps runner error envelopes to Atlas Loop error codes", async () => {
    const world = makeWorld();
    world.responses.set("/command", {
      ok: false,
      error: { code: "elementNotFound", message: "nope", retryable: false, details: { identifier: "x" } }
    });

    await expect(world.manager.performAction("SIM-A", { kind: "tapElement", identifier: "x" })).rejects.toMatchObject({
      code: "ELEMENT_NOT_FOUND",
      message: "nope",
      details: { identifier: "x" }
    });
  });

  it("marks the runner dead and raises retryable DRIVER_UNAVAILABLE on network failure", async () => {
    const world = makeWorld();

    await world.manager.ensureRunner("SIM-A");
    world.healthyPorts.clear();

    await expect(world.manager.performAction("SIM-A", { kind: "tap", x: 0.5, y: 0.5 })).rejects.toMatchObject({
      code: "DRIVER_UNAVAILABLE",
      retryable: true
    });
    expect(world.manager.runnerStatus("SIM-A")?.alive).toBe(false);
  });

  it("forwards the target bundle id through /target", async () => {
    const world = makeWorld();
    world.responses.set("/target", { ok: true, data: { bundleId: "app.demo", state: "4" } });

    const data = await world.manager.setTarget("SIM-A", "app.demo");

    expect(data).toMatchObject({ bundleId: "app.demo" });
    const targetRequest = world.requests.find((request) => request.url.endsWith("/target"));
    expect(targetRequest?.body).toMatchObject({ bundleId: "app.demo" });
  });
});

describe("driver error mapping", () => {
  it("maps element errors, request errors, keyboard, and unknown codes", () => {
    expect(mapDriverError({ code: "elementNotFound", message: "m" }).code).toBe("ELEMENT_NOT_FOUND");
    expect(mapDriverError({ code: "elementNotHittable", message: "m" }).code).toBe("ELEMENT_NOT_FOUND");
    expect(mapDriverError({ code: "invalidRequest", message: "m" }).code).toBe("INVALID_REQUEST");
    expect(mapDriverError({ code: "unknownCommand", message: "m" }).code).toBe("INVALID_REQUEST");
    expect(mapDriverError({ code: "invalidCoordinates", message: "m" }).code).toBe("INVALID_REQUEST");
    expect(mapDriverError({ code: "noTargetApp", message: "m" }).code).toBe("INVALID_REQUEST");
    const keyboard = mapDriverError({ code: "keyboardNotVisible", message: "m" });
    expect(keyboard.code).toBe("HID_FAILED");
    expect(keyboard.retryable).toBe(true);
    expect(mapDriverError({ code: "internalError", message: "m" }).code).toBe("HID_FAILED");
    expect(mapDriverError(undefined).code).toBe("HID_FAILED");
  });

  it("wraps mapped errors in XcuitestClientError instances", () => {
    const error = new XcuitestClientError(mapDriverError({ code: "elementNotFound", message: "missing" }));
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ELEMENT_NOT_FOUND");
    expect(error.message).toBe("missing");
  });
});
