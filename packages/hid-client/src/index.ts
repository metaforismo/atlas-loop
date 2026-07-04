import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import type { ActionInput, AtlasLoopError } from "@atlas-loop/protocol";

export interface HidClientOptions {
  helperPath: string;
  args?: string[];
  defaultTimeoutMs?: number;
  stderrLimitBytes?: number;
  spawnHelper?: (helperPath: string, args: string[]) => HidHelperProcess;
}

export interface HidRequestOptions {
  timeoutMs?: number;
}

export interface HidAttachOptions {
  appName?: string;
  windowTitleContains?: string;
}

export interface HidHelperProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
}

interface PendingRequest {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: HidClientError) => void;
  timeout: NodeJS.Timeout;
}

interface HelperResponseError {
  code?: string;
  message?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export class HidClientError extends Error implements AtlasLoopError {
  code: AtlasLoopError["code"];
  retryable?: boolean;
  details?: Record<string, unknown>;

  constructor(error: AtlasLoopError) {
    super(error.message);
    this.name = "HidClientError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

export class HidClient {
  private child?: HidHelperProcess;
  private readonly helperPath: string;
  private readonly args: string[];
  private readonly defaultTimeoutMs: number;
  private readonly stderrLimitBytes: number;
  private readonly spawnHelper: (helperPath: string, args: string[]) => HidHelperProcess;
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly pending = new Map<string, PendingRequest>();

  constructor(options: HidClientOptions) {
    this.helperPath = options.helperPath;
    this.args = options.args ?? [];
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    this.stderrLimitBytes = options.stderrLimitBytes ?? 8_192;
    this.spawnHelper = options.spawnHelper ?? defaultSpawnHelper;
  }

  start(): void {
    if (this.child) return;
    try {
      this.child = this.spawnHelper(this.helperPath, this.args);
    } catch (error) {
      throw this.error("HID_FAILED", "failed to spawn HID helper", {
        helperPath: this.helperPath,
        stderr: this.stderrBuffer,
        cause: error instanceof Error ? error.message : String(error)
      });
    }

    this.child.stdout.on("data", (chunk) => this.handleStdout(String(chunk)));
    this.child.stderr.on("data", (chunk) => this.captureStderr(String(chunk)));
    this.child.on("error", (error) => this.rejectAll("HID_FAILED", "HID helper failed", {
      stderr: this.stderrBuffer,
      cause: error.message
    }));
    this.child.on("exit", (code, signal) => this.rejectAll("HID_FAILED", "HID helper exited", {
      stderr: this.stderrBuffer,
      exitCode: code,
      signal
    }));
  }

  request<T = unknown>(method: string, params: Record<string, unknown>, options: HidRequestOptions = {}): Promise<T> {
    this.start();
    const child = this.child;
    if (!child) {
      return Promise.reject(this.error("HID_FAILED", "HID helper is unavailable", { stderr: this.stderrBuffer }));
    }

    const id = `hid_${this.nextId++}`;
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const payload = { id, type: method, data: params };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(this.error("ACTION_TIMEOUT", `${method} timed out after ${timeoutMs}ms`, {
          method,
          helperPath: this.helperPath,
          stderr: this.stderrBuffer
        }));
      }, timeoutMs);

      this.pending.set(id, {
        method,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      });

      child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(this.error("HID_FAILED", `failed to write ${method} request`, {
          method,
          helperPath: this.helperPath,
          stderr: this.stderrBuffer,
          cause: error.message
        }));
      });
    });
  }

  tap(params: { udid: string; x: number; y: number }, options?: HidRequestOptions): Promise<unknown> {
    return this.request("tap", params, options);
  }

  attach(params: HidAttachOptions = {}, options?: HidRequestOptions): Promise<unknown> {
    return this.request("attach", { appName: "Simulator", ...params }, options);
  }

  hello(options?: HidRequestOptions): Promise<unknown> {
    return this.request("hello", {}, options);
  }

  metrics(options?: HidRequestOptions): Promise<unknown> {
    return this.request("metrics", {}, options);
  }

  diagnostics(options?: HidRequestOptions): Promise<unknown> {
    return this.metrics(options);
  }

  typeText(params: { udid: string; text: string }, options?: HidRequestOptions): Promise<unknown> {
    return this.request("typeText", params, options);
  }

  swipe(params: {
    udid: string;
    from: { x: number; y: number };
    to: { x: number; y: number };
    durationMs: number;
  }, options?: HidRequestOptions): Promise<unknown> {
    return this.request("swipe", {
      udid: params.udid,
      startX: params.from.x,
      startY: params.from.y,
      endX: params.to.x,
      endY: params.to.y,
      durationMs: params.durationMs
    }, options);
  }

  edgeGesture(params: {
    udid: string;
    edge: string;
    distance: number;
    durationMs: number;
  }, options?: HidRequestOptions): Promise<unknown> {
    return this.request("edgeGesture", params, options);
  }

  performAction(udid: string, action: ActionInput, options?: HidRequestOptions): Promise<unknown> {
    switch (action.kind) {
      case "tap":
        return this.tap({ udid, x: action.x, y: action.y }, options);
      case "typeText":
        return this.typeText({ udid, text: action.text }, options);
      case "swipe":
        return this.swipe({
          udid,
          from: action.from,
          to: action.to,
          durationMs: action.durationMs
        }, options);
      case "edgeGesture":
        return this.edgeGesture({
          udid,
          edge: action.edge,
          distance: action.distance,
          durationMs: action.durationMs
        }, options);
      default:
        return Promise.reject(this.error("INVALID_REQUEST", `${action.kind} is not a HID action`, {
          kind: action.kind,
          stderr: this.stderrBuffer
        }));
    }
  }

  close(): void {
    if (!this.child) return;
    this.child.kill("SIGTERM");
    this.child = undefined;
  }

  stderr(): string {
    return this.stderrBuffer;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    for (;;) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let response: {
      id?: string;
      ok?: boolean;
      data?: unknown;
      result?: unknown;
      error?: HelperResponseError;
    };
    try {
      response = JSON.parse(line) as typeof response;
    } catch (error) {
      this.rejectAll("HID_FAILED", "HID helper emitted invalid JSON", {
        line,
        stderr: this.stderrBuffer,
        cause: error instanceof Error ? error.message : String(error)
      });
      return;
    }

    if (!response.id) return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);

    if (response.ok === false) {
      pending.reject(this.helperFailure(pending.method, response.error));
      return;
    }
    pending.resolve(response.data ?? response.result);
  }

  private captureStderr(chunk: string): void {
    this.stderrBuffer = `${this.stderrBuffer}${chunk}`;
    if (Buffer.byteLength(this.stderrBuffer) > this.stderrLimitBytes) {
      this.stderrBuffer = this.stderrBuffer.slice(-this.stderrLimitBytes);
    }
  }

  private rejectAll(code: AtlasLoopError["code"], message: string, details: Record<string, unknown>): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(this.error(code, message, details));
      this.pending.delete(id);
    }
  }

  private helperFailure(method: string, helperError?: HelperResponseError): HidClientError {
    const helperCode = typeof helperError?.code === "string" ? helperError.code : undefined;
    const helperMessage = typeof helperError?.message === "string" ? helperError.message : `${method} failed`;
    const helperDetails = isRecord(helperError?.details) ? helperError.details : undefined;
    const retryable = typeof helperError?.retryable === "boolean" ? helperError.retryable : undefined;
    const code: AtlasLoopError["code"] = isRequestError(helperCode) ? "INVALID_REQUEST" : "HID_FAILED";

    return this.error(code, helperMessage, {
      method,
      helperPath: this.helperPath,
      stderr: this.stderrBuffer,
      helperCode,
      helperError: {
        code: helperCode,
        message: helperMessage,
        retryable,
        details: helperDetails
      }
    }, retryable);
  }

  private error(
    code: AtlasLoopError["code"],
    message: string,
    details?: Record<string, unknown>,
    retryable = code === "ACTION_TIMEOUT"
  ): HidClientError {
    return new HidClientError({ code, message, details, retryable });
  }
}

function defaultSpawnHelper(helperPath: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(helperPath, args, { stdio: ["pipe", "pipe", "pipe"] });
}

function isRequestError(helperCode: string | undefined): boolean {
  return helperCode === "invalidRequest" || helperCode === "invalidCoordinates" || helperCode === "unknownCommand";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
