import type { TimelineItem } from "./timeline.js";

/**
 * One playhead over a run.
 *
 * The device screenshot, the highlighted step, the metrics cursor, and the
 * timeline each know a different slice of the same run. Without a shared
 * position they drift, and answering "what was on screen when CPU spiked"
 * means reading three panels and doing the arithmetic yourself.
 *
 * Everything here resolves "what was true at this moment" from evidence that
 * already carries timestamps. Nothing is interpolated: a moment reports the
 * newest recorded state at or before it, which is what the device was actually
 * showing.
 */

export interface RunScrubberMark {
  id: string;
  /** Position across the run, 0 to 1. */
  fraction: number;
  tone: TimelineItem["tone"];
  actionId?: string;
  artifactId?: string;
  artifactType?: TimelineItem["artifactType"];
}

export interface RunScrubberModel {
  startedMs: number;
  endedMs: number;
  durationMs: number;
  /** Timeline items with a usable timestamp, oldest first. */
  items: TimelineItem[];
  marks: RunScrubberMark[];
}

export interface RunMoment {
  fraction: number;
  atMs: number;
  at: string;
  elapsedMs: number;
  /** Newest timeline item at or before this moment. */
  item?: TimelineItem;
  /** Step that had most recently started, if any. */
  actionId?: string;
  /** What the device was last showing at this moment. */
  screenshotArtifactId?: string;
}

function timeOf(item: TimelineItem): number {
  const parsed = Date.parse(item.at);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Builds the track from a run's timeline. Returns undefined when there is
 * nothing to scrub — a single instant is not a range, and a scrubber over it
 * would imply a duration the run never had.
 */
export function buildRunScrubberModel(timeline: readonly TimelineItem[]): RunScrubberModel | undefined {
  const items = timeline
    .filter((item) => Number.isFinite(timeOf(item)))
    .slice()
    .sort((left, right) => timeOf(left) - timeOf(right));
  if (items.length < 2) return undefined;

  const startedMs = timeOf(items[0]!);
  const endedMs = timeOf(items[items.length - 1]!);
  const durationMs = endedMs - startedMs;
  if (durationMs <= 0) return undefined;

  return {
    startedMs,
    endedMs,
    durationMs,
    items,
    marks: items.map((item) => ({
      id: item.id,
      fraction: (timeOf(item) - startedMs) / durationMs,
      tone: item.tone,
      actionId: item.actionId,
      artifactId: item.artifactId,
      artifactType: item.artifactType
    }))
  };
}

function isScreenshot(item: TimelineItem): boolean {
  return item.artifactType === "screenshot" && typeof item.artifactId === "string";
}

/**
 * Resolves the run's state at a position on the track.
 *
 * The screenshot and the step are each the newest one recorded at or before
 * the moment, never the nearest: a screenshot taken after this instant shows
 * something the device had not displayed yet.
 */
export function resolveRunMoment(model: RunScrubberModel, fraction: number): RunMoment {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const atMs = model.startedMs + clamped * model.durationMs;

  let item: TimelineItem | undefined;
  let actionId: string | undefined;
  let screenshotArtifactId: string | undefined;

  for (const candidate of model.items) {
    if (timeOf(candidate) > atMs) break;
    item = candidate;
    if (candidate.actionId) actionId = candidate.actionId;
    if (isScreenshot(candidate)) screenshotArtifactId = candidate.artifactId;
  }

  return {
    fraction: clamped,
    atMs,
    at: new Date(atMs).toISOString(),
    elapsedMs: atMs - model.startedMs,
    item,
    actionId,
    screenshotArtifactId
  };
}

/**
 * Position of a timeline item on the track, for jumping the playhead to a
 * step the operator clicked elsewhere.
 */
export function fractionOfItem(model: RunScrubberModel, itemId: string): number | undefined {
  return model.marks.find((mark) => mark.id === itemId)?.fraction;
}

/**
 * The instant a position on the track refers to.
 *
 * A parked playhead is stored as a moment rather than a fraction: a live run
 * keeps growing, and a fraction of a growing run silently slides forward in
 * time. Half of a thirty second run is not half of a sixty second one.
 */
export function timeOfFraction(model: RunScrubberModel, fraction: number): number {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return model.startedMs + clamped * model.durationMs;
}

/** Where a moment sits on the current track, clamped into it. */
export function fractionOfTime(model: RunScrubberModel, atMs: number): number {
  if (!Number.isFinite(atMs)) return 0;
  return Math.min(1, Math.max(0, (atMs - model.startedMs) / model.durationMs));
}

/**
 * The next or previous mark from a position, so arrow keys step between
 * recorded moments rather than sliding through empty time.
 */
export function stepFraction(model: RunScrubberModel, fraction: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction === 1) {
    const next = model.marks.find((mark) => mark.fraction > fraction + epsilon);
    return next?.fraction ?? 1;
  }
  const previous = [...model.marks].reverse().find((mark) => mark.fraction < fraction - epsilon);
  return previous?.fraction ?? 0;
}

/** `1m 12.3s` — elapsed time reads better than a wall clock on a scrubber. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}m ${seconds.toFixed(1).padStart(4, "0")}s`;
}

/**
 * Where playback has reached after some wall-clock time at a speed.
 *
 * Playback advances against the clock rather than by counting ticks: a busy
 * workspace delays timers, and a tick-counting playhead then runs slower than
 * the speed it claims to be running at.
 */
export function advanceFraction(
  model: RunScrubberModel,
  startFraction: number,
  elapsedWallMs: number,
  speed: number
): number {
  const start = Number.isFinite(startFraction) ? startFraction : 0;
  const elapsed = Number.isFinite(elapsedWallMs) ? Math.max(0, elapsedWallMs) : 0;
  return Math.min(1, Math.max(0, start + (elapsed * speed) / model.durationMs));
}
