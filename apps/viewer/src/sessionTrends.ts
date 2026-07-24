import type { SessionHistoryItem } from "./types.js";
import { sessionUpdatedAt } from "./viewerPresentation.js";

/**
 * Week-over-week movement derived from local session evidence.
 *
 * Every number here comes from timestamps the daemon already recorded, so the
 * workspace never claims a trend it cannot show the runs for. Sessions with an
 * unreadable timestamp are reported separately instead of being silently
 * dropped into one of the two windows.
 */

export const TREND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export type TrendDirection = "up" | "down" | "flat";

export interface TrendComparison {
  /** Count inside the most recent window. */
  current: number;
  /** Count inside the window immediately before it. */
  previous: number;
  /**
   * Percentage change, or undefined when the previous window is empty. A jump
   * from zero has no meaningful percentage, so the UI shows the raw count.
   */
  percentChange?: number;
  direction: TrendDirection;
  /** True when neither window contains a dated run. */
  empty: boolean;
}

export interface SessionTrends {
  /** Runs started or updated inside each window. */
  sessions: TrendComparison;
  /** Evidence artifacts recorded by those runs. */
  evidence: TrendComparison;
  /** Runs that failed or reported a blocking reason. */
  failures: TrendComparison;
  /** Runs whose timestamp could not be parsed and so sit in neither window. */
  undatedSessions: number;
}

interface WindowTotals {
  sessions: number;
  evidence: number;
  failures: number;
}

function emptyTotals(): WindowTotals {
  return { sessions: 0, evidence: 0, failures: 0 };
}

function sessionTimestamp(session: SessionHistoryItem): number | undefined {
  const parsed = Date.parse(sessionUpdatedAt(session) ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Mirrors the failure definition used by the overview and session workspaces so
 * a run counted as "needs attention" is the same run counted in this trend.
 */
export function isFailedSession(session: SessionHistoryItem): boolean {
  return session.status === "failed"
    || session.events?.latestAction?.ok === false
    || Boolean(session.events?.latestError)
    || Boolean(session.error)
    || Boolean(session.blockingReasons?.length);
}

function compare(current: number, previous: number): TrendComparison {
  const empty = current === 0 && previous === 0;
  const direction: TrendDirection = current > previous ? "up" : current < previous ? "down" : "flat";
  return {
    current,
    previous,
    percentChange: previous > 0 ? ((current - previous) / previous) * 100 : undefined,
    direction,
    empty
  };
}

/**
 * Splits local sessions into the last seven days and the seven before that.
 *
 * `now` is injected so the calculation stays deterministic in tests and so a
 * caller can reuse one clock reading across several derived values.
 */
export function buildSessionTrends(sessions: SessionHistoryItem[], now: number): SessionTrends {
  const currentStart = now - TREND_WINDOW_MS;
  const previousStart = currentStart - TREND_WINDOW_MS;
  const current = emptyTotals();
  const previous = emptyTotals();
  let undatedSessions = 0;

  for (const session of sessions) {
    const at = sessionTimestamp(session);
    if (at === undefined) {
      undatedSessions += 1;
      continue;
    }

    // `now` is a snapshot: a run updated a moment later must not be dropped.
    const bucket = at >= currentStart ? current : at >= previousStart ? previous : undefined;
    if (!bucket) continue;

    bucket.sessions += 1;
    bucket.evidence += session.artifacts?.total ?? 0;
    if (isFailedSession(session)) bucket.failures += 1;
  }

  return {
    sessions: compare(current.sessions, previous.sessions),
    evidence: compare(current.evidence, previous.evidence),
    failures: compare(current.failures, previous.failures),
    undatedSessions
  };
}

/**
 * Human-readable delta for a metric card. Returns undefined when there is
 * nothing honest to say — no history at all, or a first week with no baseline.
 */
export function formatTrend(trend: TrendComparison): string | undefined {
  if (trend.empty) return undefined;
  if (trend.percentChange === undefined) {
    return trend.current === 0 ? undefined : `+${trend.current} vs last week`;
  }
  if (trend.direction === "flat") return "No change vs last week";
  const rounded = Math.abs(trend.percentChange) >= 10
    ? Math.round(Math.abs(trend.percentChange))
    : Math.round(Math.abs(trend.percentChange) * 10) / 10;
  return `${trend.direction === "up" ? "+" : "−"}${rounded}% vs last week`;
}

/**
 * Whether a movement should read as good or bad. Growth is positive for
 * activity metrics and negative for failures, so the caller states which.
 */
export function trendTone(trend: TrendComparison, risingIsGood: boolean): "good" | "bad" | "neutral" {
  if (trend.empty || trend.direction === "flat") return "neutral";
  const rising = trend.direction === "up";
  return rising === risingIsGood ? "good" : "bad";
}
