import type { MetricsSampleLike } from "./viewerPresentation.js";

/**
 * Helpers for reading a value off a metrics chart.
 *
 * "CPU peaked at 89%" is only half an answer; the useful half is when, so the
 * peak can be lined up against the step that caused it. These functions map a
 * pointer position to the sample under it and locate the peak's position on
 * the same axis.
 */

export interface MetricsReading {
  index: number;
  sample: MetricsSampleLike;
  /** Horizontal position of the sample, 0-1 across the chart. */
  fraction: number;
}

/**
 * The sample nearest a horizontal position. Samples are evenly spaced on the
 * chart regardless of their real spacing in time, matching how the sparkline
 * plots them, so a reading always names the point actually drawn there.
 */
export function readingAtFraction(samples: readonly MetricsSampleLike[], fraction: number): MetricsReading | undefined {
  if (samples.length === 0) return undefined;
  if (!Number.isFinite(fraction)) return undefined;

  const clamped = Math.min(1, Math.max(0, fraction));
  const index = Math.round(clamped * (samples.length - 1));
  const sample = samples[index];
  if (!sample) return undefined;

  return { index, sample, fraction: samples.length === 1 ? 0 : index / (samples.length - 1) };
}

/** Position of the highest value, for marking the peak on the chart. */
export function peakReading(
  samples: readonly MetricsSampleLike[],
  read: (sample: MetricsSampleLike) => number
): MetricsReading | undefined {
  let best: MetricsReading | undefined;

  samples.forEach((sample, index) => {
    const value = read(sample);
    if (!Number.isFinite(value)) return;
    if (best && read(best.sample) >= value) return;
    best = { index, sample, fraction: samples.length === 1 ? 0 : index / (samples.length - 1) };
  });

  return best;
}

/**
 * Elapsed time from the first sample, as a short label. Absolute clock times
 * are useless for lining a spike up against a step; "1m 12s in" is not.
 */
export function elapsedLabel(samples: readonly MetricsSampleLike[], sample: MetricsSampleLike): string {
  const start = Date.parse(samples[0]?.at ?? "");
  const at = Date.parse(sample.at ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) return "--";

  const totalSeconds = Math.round((at - start) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m ${String(totalSeconds % 60).padStart(2, "0")}s`;
}
