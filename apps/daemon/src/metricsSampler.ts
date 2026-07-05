import { appendFile } from "node:fs/promises";

export interface MetricsSample {
  schemaVersion: "atlas-loop.metrics-sample.v1";
  at: string;
  pid: number;
  cpuPercent: number;
  rssBytes: number;
}

export interface MetricsRunCommandResult {
  exitCode: number;
  stdout: string;
}

export interface MetricsSamplerOptions {
  pid: number;
  metricsPath: string;
  intervalMs: number;
  runCommand: (command: string, args: string[]) => Promise<MetricsRunCommandResult>;
  now?: () => string;
  /** Called once when the sampler stops itself because the process is gone. */
  onProcessExit?: () => void;
}

export interface MetricsSamplerHandle {
  readonly pid: number;
  readonly metricsPath: string;
  sampleCount(): number;
  stop(): Promise<void>;
}

/**
 * Samples CPU%/RSS of one process on a fixed interval into an NDJSON file.
 * Simulator app processes are host processes, so plain `ps` sees them.
 */
export function startMetricsSampler(options: MetricsSamplerOptions): MetricsSamplerHandle {
  const now = options.now ?? (() => new Date().toISOString());
  let stopped = false;
  let samples = 0;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    if (stopped) return;
    let result: MetricsRunCommandResult;
    try {
      result = await options.runCommand("ps", ["-o", "%cpu=,rss=", "-p", String(options.pid)]);
    } catch {
      result = { exitCode: 1, stdout: "" };
    }

    if (stopped) return;
    if (result.exitCode !== 0) {
      stopped = true;
      if (timer) clearTimeout(timer);
      options.onProcessExit?.();
      return;
    }

    const parsed = parsePsSample(result.stdout);
    if (parsed) {
      const sample: MetricsSample = {
        schemaVersion: "atlas-loop.metrics-sample.v1",
        at: now(),
        pid: options.pid,
        cpuPercent: parsed.cpuPercent,
        rssBytes: parsed.rssKilobytes * 1024
      };
      try {
        await appendFile(options.metricsPath, `${JSON.stringify(sample)}\n`, "utf8");
        samples += 1;
      } catch {
        // A failed write drops one sample; the next tick tries again.
      }
    }

    if (!stopped) {
      timer = setTimeout(() => {
        inFlight = tick();
      }, options.intervalMs);
      timer.unref?.();
    }
  };

  inFlight = tick();

  return {
    pid: options.pid,
    metricsPath: options.metricsPath,
    sampleCount: () => samples,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight.catch(() => undefined);
    }
  };
}

export function parsePsSample(stdout: string): { cpuPercent: number; rssKilobytes: number } | undefined {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim());
  if (!line) return undefined;
  const parts = line.trim().split(/\s+/);
  const cpuPercent = Number(parts[0]);
  const rssKilobytes = Number(parts[1]);
  if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKilobytes)) return undefined;
  return { cpuPercent, rssKilobytes };
}

export function parseLaunchPid(stdout: string): number | undefined {
  const match = /:\s*(\d+)\s*$/m.exec(stdout.trim());
  if (!match) return undefined;
  const pid = Number(match[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}
