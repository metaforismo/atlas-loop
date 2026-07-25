import { spawn, type ChildProcess } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { parseDeviceLogLine, type DeviceLogEntry } from "@atlas-loop/protocol";

/**
 * Streams the Simulator's OS log into an NDJSON artifact for the life of a run.
 *
 * `simctl spawn <udid> log stream` is an unbounded firehose: left alone it will
 * happily write gigabytes and outlive the session. Everything here exists to
 * bound it — a process predicate, a line cap, and a byte cap — and to report
 * honestly when a cap was hit rather than silently truncating the evidence.
 */

export interface DeviceLogStreamOptions {
  udid: string;
  logPath: string;
  /** Process name to filter on. Without one the whole system is captured. */
  processName?: string;
  maxEntries: number;
  maxBytes: number;
  spawnProcess?: typeof spawn;
  onError?: (error: Error) => void;
}

export interface DeviceLogStreamHandle {
  readonly logPath: string;
  entryCount(): number;
  /** Lines the stream produced that were not usable log events. */
  skippedCount(): number;
  /** True when a cap stopped capture before the session ended. */
  truncated(): boolean;
  stop(): Promise<void>;
}

/**
 * Only the app's own output is worth keeping. Matching on the process name
 * rather than the bundle id is deliberate: `log stream` sees the executable,
 * and a bundle id does not appear in `process`.
 */
export function logStreamArgs(udid: string, processName?: string): string[] {
  const args = ["simctl", "spawn", udid, "log", "stream", "--style", "ndjson", "--level", "default"];
  if (processName) {
    // Quotes belong inside the predicate value, not around the whole argument;
    // this is passed as one argv entry, never through a shell.
    args.push("--predicate", `process == "${processName.replace(/"/g, '\\"')}"`);
  }
  return args;
}

export function startDeviceLogStream(options: DeviceLogStreamOptions): DeviceLogStreamHandle {
  const spawnProcess = options.spawnProcess ?? spawn;
  const args = logStreamArgs(options.udid, options.processName);

  let entries = 0;
  let skipped = 0;
  let bytes = 0;
  let truncated = false;
  let stopped = false;
  let pending: Promise<void> = Promise.resolve();
  let buffer = "";

  // stdin is ignored, so the child type is the stdio-specific one rather
  // than the fully-piped variant.
  const child = spawnProcess("xcrun", args, { stdio: ["ignore", "pipe", "pipe"] }) as ChildProcess & {
    stdout: NonNullable<ChildProcess["stdout"]>;
  };

  const halt = (): void => {
    if (stopped) return;
    stopped = true;
    child.kill("SIGTERM");
  };

  const write = (entry: DeviceLogEntry): void => {
    const line = `${JSON.stringify(entry)}\n`;
    bytes += Buffer.byteLength(line);
    entries += 1;
    pending = pending
      .then(() => appendFile(options.logPath, line, "utf8"))
      .catch((error: unknown) => options.onError?.(error instanceof Error ? error : new Error(String(error))));

    if (entries >= options.maxEntries || bytes >= options.maxBytes) {
      truncated = true;
      halt();
    }
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (stopped) return;
    buffer += chunk;

    // The stream emits one JSON object per line; a chunk can split a line.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim() === "") continue;
      const entry = parseDeviceLogLine(line);
      if (entry) write(entry);
      else skipped += 1;
      if (stopped) return;
    }
  });

  child.on("error", (error) => {
    stopped = true;
    options.onError?.(error);
  });

  return {
    logPath: options.logPath,
    entryCount: () => entries,
    skippedCount: () => skipped,
    truncated: () => truncated,
    async stop() {
      halt();
      // Flush whatever the last chunk left behind before the writes settle.
      const tail = buffer.trim();
      buffer = "";
      if (tail !== "") {
        const entry = parseDeviceLogLine(tail);
        if (entry) write(entry);
        else skipped += 1;
      }
      await pending;
    }
  };
}
