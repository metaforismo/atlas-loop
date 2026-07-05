import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { atlasError, makeId, type ActionInput, type AtlasLoopError } from "@atlas-loop/protocol";

export interface DriverPortRange {
  start: number;
  end: number;
}

export interface RunnerProcess {
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

export interface SpawnRunnerOptions {
  xctestrunPath: string;
  udid: string;
  port: number;
  onStderr: (chunk: string) => void;
}

export interface BuildRunnerOptions {
  projectPath: string;
  derivedDataPath: string;
}

export interface XcuitestClientOptions {
  projectPath: string;
  derivedDataPath: string;
  portRange?: DriverPortRange;
  healthTimeoutMs?: number;
  healthPollIntervalMs?: number;
  requestTimeoutMs?: number;
  stderrLimitBytes?: number;
  buildRunner?: (options: BuildRunnerOptions) => Promise<void>;
  spawnRunner?: (options: SpawnRunnerOptions) => RunnerProcess;
  listXctestrunFiles?: (productsDir: string) => Promise<string[]>;
  isPortFree?: (port: number) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface RunnerHealth {
  ok: boolean;
  runnerVersion?: string;
  uptimeMs?: number;
  screen?: Record<string, unknown>;
}

export interface RunnerStatus {
  udid: string;
  port: number;
  alive: boolean;
  restarts: number;
  xctestrunPath: string;
}

interface DriverEnvelope {
  id?: string;
  type?: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code?: string; message?: string; retryable?: boolean; details?: Record<string, unknown> };
}

interface RunnerHandle {
  udid: string;
  port: number;
  process: RunnerProcess;
  xctestrunPath: string;
  alive: boolean;
  restarts: number;
  stderrTail: string;
  exitReason?: string;
}

export class XcuitestClientError extends Error implements AtlasLoopError {
  code: AtlasLoopError["code"];
  retryable?: boolean;
  details?: Record<string, unknown>;

  constructor(error: AtlasLoopError) {
    super(error.message);
    this.name = "XcuitestClientError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

const DEFAULT_PORT_RANGE: DriverPortRange = { start: 4700, end: 4799 };
const MAX_RESTARTS_PER_RUNNER = 1;

export class XcuitestRunnerManager {
  private readonly options: Required<Pick<XcuitestClientOptions, "projectPath" | "derivedDataPath">> & XcuitestClientOptions;
  private readonly portRange: DriverPortRange;
  private readonly healthTimeoutMs: number;
  private readonly healthPollIntervalMs: number;
  private readonly requestTimeoutMs: number;
  private readonly stderrLimitBytes: number;
  private readonly buildRunner: (options: BuildRunnerOptions) => Promise<void>;
  private readonly spawnRunner: (options: SpawnRunnerOptions) => RunnerProcess;
  private readonly listXctestrunFiles: (productsDir: string) => Promise<string[]>;
  private readonly isPortFree: (port: number) => Promise<boolean>;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly runners = new Map<string, RunnerHandle>();
  private readonly startingRunners = new Map<string, Promise<RunnerHandle>>();
  private buildPromise?: Promise<string>;

  constructor(options: XcuitestClientOptions) {
    this.options = options;
    this.portRange = options.portRange ?? DEFAULT_PORT_RANGE;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 90_000;
    this.healthPollIntervalMs = options.healthPollIntervalMs ?? 1_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.stderrLimitBytes = options.stderrLimitBytes ?? 8_192;
    this.buildRunner = options.buildRunner ?? defaultBuildRunner;
    this.spawnRunner = options.spawnRunner ?? defaultSpawnRunner;
    this.listXctestrunFiles = options.listXctestrunFiles ?? defaultListXctestrunFiles;
    this.isPortFree = options.isPortFree ?? defaultIsPortFree;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  runnerStatus(udid: string): RunnerStatus | undefined {
    const handle = this.runners.get(udid);
    if (!handle) return undefined;
    return {
      udid: handle.udid,
      port: handle.port,
      alive: handle.alive,
      restarts: handle.restarts,
      xctestrunPath: handle.xctestrunPath
    };
  }

  async ensureRunner(udid: string): Promise<RunnerStatus> {
    const handle = await this.ensureHandle(udid);
    return {
      udid: handle.udid,
      port: handle.port,
      alive: handle.alive,
      restarts: handle.restarts,
      xctestrunPath: handle.xctestrunPath
    };
  }

  async health(udid: string): Promise<RunnerHealth> {
    const handle = await this.ensureHandle(udid);
    return await this.fetchHealth(handle.port);
  }

  async setTarget(udid: string, bundleId: string): Promise<Record<string, unknown> | undefined> {
    const envelope = await this.request(udid, "/target", { id: makeId("drv"), bundleId });
    return envelope.data;
  }

  async performAction(udid: string, action: ActionInput): Promise<Record<string, unknown> | undefined> {
    const envelope = await this.request(udid, "/command", { id: makeId("drv"), ...action });
    return envelope.data;
  }

  async stopRunner(udid: string): Promise<void> {
    const handle = this.runners.get(udid);
    if (!handle) return;
    this.runners.delete(udid);
    if (!handle.alive) return;

    try {
      const controller = AbortSignal.timeout(2_000);
      await this.fetchImpl(`http://127.0.0.1:${handle.port}/shutdown`, { method: "POST", signal: controller });
    } catch {
      // The exit watcher and kill below handle a runner that no longer responds.
    }
    handle.process.kill("SIGTERM");
  }

  async close(): Promise<void> {
    await Promise.all([...this.runners.keys()].map((udid) => this.stopRunner(udid)));
  }

  private async ensureHandle(udid: string): Promise<RunnerHandle> {
    const existing = this.runners.get(udid);
    if (existing?.alive) return existing;

    const starting = this.startingRunners.get(udid);
    if (starting) return starting;

    const startPromise = this.startRunner(udid, existing).finally(() => {
      this.startingRunners.delete(udid);
    });
    this.startingRunners.set(udid, startPromise);
    return startPromise;
  }

  private async startRunner(udid: string, previous?: RunnerHandle): Promise<RunnerHandle> {
    if (previous && previous.restarts >= MAX_RESTARTS_PER_RUNNER) {
      throw new XcuitestClientError(
        atlasError(
          "DRIVER_UNAVAILABLE",
          `driver runner for ${udid} died and was already restarted once`,
          { stderrTail: previous.stderrTail, exitReason: previous.exitReason },
          true
        )
      );
    }

    const xctestrunPath = await this.resolveXctestrun();
    const port = await this.allocatePort();

    const handle: RunnerHandle = {
      udid,
      port,
      xctestrunPath,
      alive: true,
      restarts: previous ? previous.restarts + 1 : 0,
      stderrTail: "",
      process: undefined as unknown as RunnerProcess
    };

    let child: RunnerProcess;
    try {
      child = this.spawnRunner({
        xctestrunPath,
        udid,
        port,
        onStderr: (chunk) => {
          handle.stderrTail = (handle.stderrTail + chunk).slice(-this.stderrLimitBytes);
        }
      });
    } catch (error) {
      throw new XcuitestClientError(
        atlasError("DRIVER_UNAVAILABLE", "failed to spawn driver runner", {
          cause: error instanceof Error ? error.message : String(error),
          xctestrunPath
        }, true)
      );
    }

    handle.process = child;
    child.on("exit", (code, signal) => {
      handle.alive = false;
      handle.exitReason = `exit code ${code}, signal ${signal}`;
    });
    child.on("error", (error) => {
      handle.alive = false;
      handle.exitReason = error.message;
    });
    this.runners.set(udid, handle);

    await this.waitForHealth(handle);
    return handle;
  }

  private async waitForHealth(handle: RunnerHandle): Promise<void> {
    const deadline = Date.now() + this.healthTimeoutMs;
    while (Date.now() < deadline) {
      if (!handle.alive) {
        this.runners.delete(handle.udid);
        throw new XcuitestClientError(
          atlasError("DRIVER_UNAVAILABLE", `driver runner exited during startup: ${handle.exitReason ?? "unknown"}`, {
            stderrTail: handle.stderrTail
          }, true)
        );
      }
      try {
        const health = await this.fetchHealth(handle.port);
        if (health.ok) return;
      } catch {
        // Not listening yet; keep polling until the deadline.
      }
      await this.sleep(this.healthPollIntervalMs);
    }

    handle.process.kill("SIGTERM");
    handle.alive = false;
    this.runners.delete(handle.udid);
    throw new XcuitestClientError(
      atlasError("DRIVER_UNAVAILABLE", `driver runner did not become healthy within ${this.healthTimeoutMs}ms`, {
        stderrTail: handle.stderrTail,
        port: handle.port
      }, true)
    );
  }

  private async fetchHealth(port: number): Promise<RunnerHealth> {
    const response = await this.fetchImpl(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(this.healthPollIntervalMs * 2)
    });
    return (await response.json()) as RunnerHealth;
  }

  private async request(udid: string, path: string, body: Record<string, unknown>): Promise<DriverEnvelope> {
    const handle = await this.ensureHandle(udid);

    let response: Response;
    try {
      response = await this.fetchImpl(`http://127.0.0.1:${handle.port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch (error) {
      handle.alive = false;
      throw new XcuitestClientError(
        atlasError("DRIVER_UNAVAILABLE", `driver runner is not reachable: ${error instanceof Error ? error.message : String(error)}`, {
          stderrTail: handle.stderrTail,
          port: handle.port
        }, true)
      );
    }

    const envelope = (await response.json()) as DriverEnvelope;
    if (!envelope.ok) {
      throw new XcuitestClientError(mapDriverError(envelope.error));
    }
    return envelope;
  }

  private async resolveXctestrun(): Promise<string> {
    if (!this.buildPromise) {
      this.buildPromise = this.buildIfNeeded().catch((error) => {
        this.buildPromise = undefined;
        throw error;
      });
    }
    return this.buildPromise;
  }

  private async buildIfNeeded(): Promise<string> {
    const productsDir = join(this.options.derivedDataPath, "Build", "Products");
    const existing = await this.listXctestrunFiles(productsDir);
    if (existing.length > 0) return existing[0];

    await this.buildRunner({
      projectPath: this.options.projectPath,
      derivedDataPath: this.options.derivedDataPath
    });

    const built = await this.listXctestrunFiles(productsDir);
    if (built.length === 0) {
      throw new XcuitestClientError(
        atlasError("DRIVER_UNAVAILABLE", "build-for-testing completed but no xctestrun file was produced", {
          productsDir
        }, true)
      );
    }
    return built[0];
  }

  private async allocatePort(): Promise<number> {
    const usedPorts = new Set([...this.runners.values()].filter((handle) => handle.alive).map((handle) => handle.port));
    for (let port = this.portRange.start; port <= this.portRange.end; port += 1) {
      if (usedPorts.has(port)) continue;
      if (await this.isPortFree(port)) return port;
    }
    throw new XcuitestClientError(
      atlasError("DRIVER_UNAVAILABLE", `no free driver port in range ${this.portRange.start}-${this.portRange.end}`, {}, true)
    );
  }
}

export function mapDriverError(error: DriverEnvelope["error"]): AtlasLoopError {
  const message = error?.message ?? "driver runner reported an unknown error";
  const details = error?.details;
  switch (error?.code) {
    case "elementNotFound":
    case "elementNotHittable":
      return atlasError("ELEMENT_NOT_FOUND", message, details, false);
    case "invalidRequest":
    case "unknownCommand":
    case "invalidCoordinates":
    case "noTargetApp":
      return atlasError("INVALID_REQUEST", message, details, false);
    case "keyboardNotVisible":
      return atlasError("HID_FAILED", message, details, true);
    default:
      return atlasError("HID_FAILED", message, details, error?.retryable ?? false);
  }
}

async function defaultBuildRunner(options: BuildRunnerOptions): Promise<void> {
  await runProcess("xcodebuild", [
    "-project",
    options.projectPath,
    "-scheme",
    "AtlasDriverRunner",
    "-destination",
    "generic/platform=iOS Simulator",
    "-derivedDataPath",
    options.derivedDataPath,
    "build-for-testing",
    "CODE_SIGNING_ALLOWED=NO"
  ]);
}

function defaultSpawnRunner(options: SpawnRunnerOptions): RunnerProcess {
  const child = spawn(
    "xcodebuild",
    ["test-without-building", "-xctestrun", options.xctestrunPath, "-destination", `id=${options.udid}`],
    {
      env: { ...process.env, TEST_RUNNER_ATLAS_DRIVER_PORT: String(options.port) },
      stdio: ["ignore", "ignore", "pipe"]
    }
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => options.onStderr(String(chunk)));
  return child;
}

async function defaultListXctestrunFiles(productsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(productsDir);
    return entries
      .filter((entry) => entry.startsWith("AtlasDriverRunner_") && entry.endsWith(".xctestrun"))
      .sort()
      .map((entry) => join(productsDir, entry));
  } catch {
    return [];
  }
}

function defaultIsPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8_192);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}
