/**
 * Summarises the CPU and memory samples recorded during a run.
 *
 * Raw samples are the evidence, but nobody reads a thousand JSON lines to
 * answer "did this run spike?". The summary answers that in one object, and is
 * shared by the CLI, the MCP server, and the viewer so all three report the
 * same numbers from the same rule.
 */

export interface MetricsSample {
  schemaVersion: "atlas-loop.metrics-sample.v1";
  at: string;
  pid: number;
  cpuPercent: number;
  rssBytes: number;
}

export interface MetricsSeriesSummary {
  min: number;
  max: number;
  mean: number;
  /** Timestamp of the sample that produced `max`. */
  peakAt?: string;
}

export interface MetricsSummary {
  sampleCount: number;
  /** Undefined when no sample carried a usable timestamp. */
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  cpuPercent?: MetricsSeriesSummary;
  rssBytes?: MetricsSeriesSummary;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sampleTime(sample: MetricsSample): number | undefined {
  const parsed = Date.parse(sample.at ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

function summariseSeries(samples: MetricsSample[], read: (sample: MetricsSample) => unknown): MetricsSeriesSummary | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  let count = 0;
  let peakAt: string | undefined;

  for (const sample of samples) {
    const value = read(sample);
    // A sampler that failed to read one metric still records the other, so a
    // missing value skips this series rather than voiding the whole sample.
    if (!isFiniteNumber(value)) continue;
    if (value < min) min = value;
    if (value > max) {
      max = value;
      peakAt = sample.at;
    }
    total += value;
    count += 1;
  }

  if (count === 0) return undefined;
  return { min, max, mean: total / count, peakAt };
}

/**
 * Samples arrive in file order, which is chronological per file but not across
 * the several files a relaunched run produces, so the window is taken from the
 * extremes rather than the first and last entries.
 */
export function summariseMetrics(samples: readonly MetricsSample[]): MetricsSummary {
  const usable = samples.filter((sample): sample is MetricsSample => Boolean(sample) && typeof sample === "object");
  const times = usable.map(sampleTime).filter(isFiniteNumber);
  const startedAtMs = times.length > 0 ? Math.min(...times) : undefined;
  const endedAtMs = times.length > 0 ? Math.max(...times) : undefined;

  return {
    sampleCount: usable.length,
    startedAt: startedAtMs === undefined ? undefined : new Date(startedAtMs).toISOString(),
    endedAt: endedAtMs === undefined ? undefined : new Date(endedAtMs).toISOString(),
    durationMs: startedAtMs === undefined || endedAtMs === undefined ? undefined : endedAtMs - startedAtMs,
    cpuPercent: summariseSeries(usable, (sample) => sample.cpuPercent),
    rssBytes: summariseSeries(usable, (sample) => sample.rssBytes)
  };
}

/** Bytes as a short human string. Used in CLI output and viewer labels. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "--";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}
