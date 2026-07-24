import { spawn } from "node:child_process";
import type {
  AtlasLoopError,
  AtlasLoopErrorCode,
  BuildRequest,
  LaunchRequest,
  SimulatorRef
} from "@atlas-loop/protocol";

export interface SimulatorCommandResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  signal?: NodeJS.Signals | null;
}

export interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type RunCommand = (
  command: string,
  args: string[],
  options?: RunCommandOptions
) => Promise<SimulatorCommandResult>;

export interface SimulatorOptions {
  runCommand?: RunCommand;
  defaultTimeoutMs?: number;
}

export interface BuildOptions extends BuildRequest {
  destination?: string;
  timeoutMs?: number;
}

export interface SimulatorTargetOptions {
  simulator?: SimulatorRef;
  timeoutMs?: number;
}

export interface InstallOptions extends SimulatorTargetOptions {
  appPath: string;
}

export interface LaunchOptions extends SimulatorTargetOptions, LaunchRequest {}

export interface ScreenshotOptions extends SimulatorTargetOptions {
  outputPath: string;
}

export interface RecordVideoOptions extends SimulatorTargetOptions {
  outputPath: string;
  durationMs?: number;
}

export interface StartRecordVideoOptions extends SimulatorTargetOptions {
  outputPath: string;
}

export interface RecordingHandle {
  pid?: number;
  startedAt: string;
  /** Resolves when the recorder process exits; rejects if it exits with an error. */
  done: Promise<SimulatorCommandResult>;
  /** Sends SIGINT (which finalizes the video file) and resolves with the exit result. */
  stop(): Promise<SimulatorCommandResult>;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  message: string;
  result?: SimulatorCommandResult;
  error?: AtlasLoopError;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export class SimulatorCommandError extends Error implements AtlasLoopError {
  code: AtlasLoopErrorCode;
  retryable?: boolean;
  details?: Record<string, unknown>;
  result?: SimulatorCommandResult;

  constructor(error: AtlasLoopError, result?: SimulatorCommandResult) {
    super(error.message);
    this.name = "SimulatorCommandError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
    this.result = result;
  }
}

export function createSimulator(options: SimulatorOptions = {}) {
  const runCommand = options.runCommand ?? runProcessCommand;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000;

  async function checked(
    code: AtlasLoopErrorCode,
    command: string,
    args: string[],
    commandOptions: RunCommandOptions = {}
  ): Promise<SimulatorCommandResult> {
    const result = await runCommand(command, args, {
      timeoutMs: defaultTimeoutMs,
      ...commandOptions
    });
    if (result.exitCode !== 0) {
      throw new SimulatorCommandError(simulatorErrorFromCommand(code, result), result);
    }
    return result;
  }

  return {
    runCommand,

    async build(request: BuildOptions): Promise<SimulatorCommandResult> {
      const args = buildXcodebuildArgs(request);
      return checked("BUILD_FAILED", "xcodebuild", args, { timeoutMs: request.timeoutMs });
    },

    async boot(options: SimulatorTargetOptions = {}): Promise<SimulatorCommandResult> {
      const target = requiredSimulatorTarget(options.simulator);
      const result = await runCommand("xcrun", ["simctl", "boot", target], {
        timeoutMs: options.timeoutMs ?? defaultTimeoutMs
      });
      if (result.exitCode !== 0 && !/already booted|current state: booted/i.test(result.stderr)) {
        throw new SimulatorCommandError(simulatorErrorFromCommand("DEVICE_NOT_BOOTED", result), result);
      }

      const bootStatus = await runCommand("xcrun", ["simctl", "bootstatus", target, "-b"], {
        timeoutMs: options.timeoutMs ?? defaultTimeoutMs
      });
      if (bootStatus.exitCode !== 0) {
        throw new SimulatorCommandError(simulatorErrorFromCommand("DEVICE_NOT_BOOTED", bootStatus), bootStatus);
      }
      return bootStatus;
    },

    async install(options: InstallOptions): Promise<SimulatorCommandResult> {
      return checked("INSTALL_FAILED", "xcrun", [
        "simctl",
        "install",
        simulatorTarget(options.simulator),
        options.appPath
      ], { timeoutMs: options.timeoutMs });
    },

    async launch(options: LaunchOptions): Promise<SimulatorCommandResult> {
      const env = childEnvironment(options.environment);
      const target = simulatorTarget(options.simulator);
      // `simctl launch` activates an existing process without reapplying new
      // arguments or environment. A test launch must be a deterministic
      // relaunch, so terminate first; "not running" and other terminate
      // failures are benign because the authoritative launch still follows.
      await runCommand("xcrun", ["simctl", "terminate", target, options.bundleId], {
        timeoutMs: options.timeoutMs ?? defaultTimeoutMs
      });
      return checked("LAUNCH_FAILED", "xcrun", [
        "simctl",
        "launch",
        target,
        options.bundleId,
        ...(options.arguments ?? [])
      ], { env, timeoutMs: options.timeoutMs });
    },

    async screenshot(options: ScreenshotOptions): Promise<SimulatorCommandResult> {
      return checked("COMMAND_FAILED", "xcrun", [
        "simctl",
        "io",
        simulatorTarget(options.simulator),
        "screenshot",
        options.outputPath
      ], { timeoutMs: options.timeoutMs });
    },

    async recordVideo(options: RecordVideoOptions): Promise<SimulatorCommandResult> {
      return recordVideo({
        ...options,
        commandTimeoutMs: defaultTimeoutMs,
        runCommand
      });
    },

    startRecordVideo(options: StartRecordVideoOptions): RecordingHandle {
      return startRecordVideo(options);
    },

    async version(): Promise<{ xcodebuild: SimulatorCommandResult; simctl: SimulatorCommandResult }> {
      const [xcodebuild, simctl] = await Promise.all([
        checked("COMMAND_FAILED", "xcodebuild", ["-version"], { timeoutMs: 15_000 }),
        checked("COMMAND_FAILED", "xcrun", ["simctl", "help"], { timeoutMs: 15_000 })
      ]);
      return { xcodebuild, simctl };
    },

    async doctor(): Promise<DoctorResult> {
      const checks: DoctorCheck[] = [];
      checks.push(await doctorCheck("xcodebuild", "xcodebuild", ["-version"], runCommand));
      checks.push(await doctorCheck("simctl", "xcrun", ["simctl", "list", "devices", "-j"], runCommand));
      return { ok: checks.every((check) => check.ok), checks };
    }
  };
}

export function buildXcodebuildArgs(request: BuildOptions): string[] {
  const args: string[] = [];
  if (request.workspacePath) args.push("-workspace", request.workspacePath);
  if (request.projectPath) args.push("-project", request.projectPath);
  args.push("-scheme", request.scheme);
  if (request.configuration) args.push("-configuration", request.configuration);
  args.push("-destination", request.destination ?? "generic/platform=iOS Simulator");
  if (request.derivedDataPath) args.push("-derivedDataPath", request.derivedDataPath);
  args.push("build");
  return args;
}

export function simulatorErrorFromCommand(
  code: AtlasLoopErrorCode,
  result: SimulatorCommandResult,
  retryable = false
): AtlasLoopError {
  const commandLine = [result.command, ...result.args].join(" ");
  const exit = result.signal ? `signal ${result.signal}` : `exit code ${result.exitCode}`;
  return {
    code,
    message: `${commandLine} failed with ${exit}`,
    retryable,
    details: {
      command: result.command,
      args: result.args,
      exitCode: result.exitCode,
      signal: result.signal ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs
    }
  };
}

export async function runProcessCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<SimulatorCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env }
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, options.timeoutMs);
    }

    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command,
        args,
        exitCode: 127,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: `${Buffer.concat(stderr).toString("utf8")}${error.message}`,
        durationMs: Date.now() - startedAt
      });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({
        command,
        args,
        exitCode: exitCode ?? (signal ? 128 : 1),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - startedAt,
        signal
      });
    });
  });
}

function simulatorTarget(simulator?: SimulatorRef): string {
  return simulator?.udid ?? simulator?.name ?? "booted";
}

function requiredSimulatorTarget(simulator?: SimulatorRef): string {
  const target = simulator?.udid ?? simulator?.name;
  if (!target) {
    throw new SimulatorCommandError({
      code: "SIMULATOR_NOT_FOUND",
      message: "boot requires a simulator udid or name",
      retryable: false
    });
  }
  return target;
}

function childEnvironment(environment?: Record<string, string>): NodeJS.ProcessEnv | undefined {
  if (!environment) return undefined;
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [`SIMCTL_CHILD_${key}`, value])
  );
}

async function recordVideo(options: RecordVideoOptions & {
  commandTimeoutMs: number;
  runCommand: RunCommand;
}): Promise<SimulatorCommandResult> {
  const durationMs = options.durationMs ?? 10_000;
  const command = "xcrun";
  const args = ["simctl", "io", simulatorTarget(options.simulator), "recordVideo", options.outputPath];
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const stop = setTimeout(() => child.kill("SIGINT"), durationMs);
    const hardStop = setTimeout(() => child.kill("SIGTERM"), Math.max(durationMs + 5_000, options.commandTimeoutMs));

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(stop);
      clearTimeout(hardStop);
      reject(new SimulatorCommandError({
        code: "COMMAND_FAILED",
        message: `${command} ${args.join(" ")} failed to start`,
        details: { stderr: error.message }
      }));
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(stop);
      clearTimeout(hardStop);
      const result: SimulatorCommandResult = {
        command,
        args,
        exitCode: exitCode ?? 0,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - startedAt
      };
      if (result.exitCode !== 0 && signal !== "SIGINT") {
        reject(new SimulatorCommandError(simulatorErrorFromCommand("COMMAND_FAILED", result), result));
        return;
      }
      resolve({ ...result, exitCode: 0 });
    });
  });
}

function startRecordVideo(options: StartRecordVideoOptions): RecordingHandle {
  const command = "xcrun";
  const args = ["simctl", "io", simulatorTarget(options.simulator), "recordVideo", "--force", options.outputPath];
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let settled = false;
  let hardStop: NodeJS.Timeout | undefined;

  const done = new Promise<SimulatorCommandResult>((resolve, reject) => {
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (hardStop) clearTimeout(hardStop);
      reject(new SimulatorCommandError({
        code: "COMMAND_FAILED",
        message: `${command} ${args.join(" ")} failed to start`,
        details: { stderr: error.message }
      }));
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (hardStop) clearTimeout(hardStop);
      const result: SimulatorCommandResult = {
        command,
        args,
        exitCode: exitCode ?? 0,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        durationMs: Date.now() - startedAtMs
      };
      // SIGINT is how recordings are finalized; treat it as success.
      if (result.exitCode !== 0 && signal !== "SIGINT") {
        reject(new SimulatorCommandError(simulatorErrorFromCommand("COMMAND_FAILED", result), result));
        return;
      }
      resolve({ ...result, exitCode: 0 });
    });
  });
  // A recording may outlive callers that never await done; avoid unhandled rejections.
  done.catch(() => undefined);

  return {
    pid: child.pid,
    startedAt,
    done,
    stop() {
      if (!settled) {
        child.kill("SIGINT");
        hardStop = setTimeout(() => {
          if (!settled) child.kill("SIGTERM");
        }, 10_000);
        hardStop.unref?.();
      }
      return done;
    }
  };
}

async function doctorCheck(
  name: string,
  command: string,
  args: string[],
  runCommand: RunCommand
): Promise<DoctorCheck> {
  const result = await runCommand(command, args, { timeoutMs: 15_000 });
  if (result.exitCode === 0) {
    return { name, ok: true, message: "ok", result };
  }
  return {
    name,
    ok: false,
    message: result.stderr || `${command} ${args.join(" ")} failed`,
    result,
    error: simulatorErrorFromCommand("COMMAND_FAILED", result)
  };
}
