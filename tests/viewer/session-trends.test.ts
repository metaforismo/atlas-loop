import { describe, expect, it } from "vitest";
import {
  TREND_WINDOW_MS,
  buildSessionTrends,
  formatTrend,
  trendTone
} from "../../apps/viewer/src/sessionTrends.js";
import type { SessionHistoryItem } from "../../apps/viewer/src/types.js";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function session(overrides: Partial<SessionHistoryItem> & { id: string }): SessionHistoryItem {
  return { status: "ended", ...overrides };
}

function agedSession(id: string, msAgo: number, overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return session({ id, updatedAt: new Date(NOW - msAgo).toISOString(), ...overrides });
}

const ONE_DAY = 24 * 60 * 60 * 1000;

describe("session trends", () => {
  it("splits runs into the last seven days and the seven before that", () => {
    const trends = buildSessionTrends(
      [
        agedSession("recent-a", ONE_DAY),
        agedSession("recent-b", 6 * ONE_DAY),
        agedSession("prior-a", 8 * ONE_DAY),
        agedSession("prior-b", 13 * ONE_DAY)
      ],
      NOW
    );

    expect(trends.sessions.current).toBe(2);
    expect(trends.sessions.previous).toBe(2);
    expect(trends.sessions.direction).toBe("flat");
  });

  it("ignores runs older than both windows", () => {
    const trends = buildSessionTrends([agedSession("ancient", 40 * ONE_DAY)], NOW);

    expect(trends.sessions.current).toBe(0);
    expect(trends.sessions.previous).toBe(0);
    expect(trends.sessions.empty).toBe(true);
  });

  it("counts a run updated after the snapshot in the current window", () => {
    // `now` is read once per render; a run that ticks a moment later must not
    // silently disappear from the comparison.
    const trends = buildSessionTrends([agedSession("just-after", -5_000)], NOW);

    expect(trends.sessions.current).toBe(1);
  });

  it("reports undated runs separately instead of assigning them to a window", () => {
    const trends = buildSessionTrends(
      [session({ id: "no-timestamp" }), session({ id: "unparseable", updatedAt: "not-a-date" })],
      NOW
    );

    expect(trends.undatedSessions).toBe(2);
    expect(trends.sessions.current).toBe(0);
    expect(trends.sessions.previous).toBe(0);
  });

  it("totals evidence and failures per window", () => {
    const trends = buildSessionTrends(
      [
        agedSession("recent-ok", ONE_DAY, { artifacts: { total: 10 } }),
        agedSession("recent-bad", 2 * ONE_DAY, { status: "failed", artifacts: { total: 4 } }),
        agedSession("prior-ok", 9 * ONE_DAY, { artifacts: { total: 7 } })
      ],
      NOW
    );

    expect(trends.evidence.current).toBe(14);
    expect(trends.evidence.previous).toBe(7);
    expect(trends.evidence.percentChange).toBeCloseTo(100, 5);
    expect(trends.failures.current).toBe(1);
    expect(trends.failures.previous).toBe(0);
  });

  it("treats a blocking reason as a failure the same way the workspaces do", () => {
    const trends = buildSessionTrends(
      [agedSession("blocked", ONE_DAY, { status: "running", blockingReasons: ["No app installed"] })],
      NOW
    );

    expect(trends.failures.current).toBe(1);
  });

  it("uses a window exactly seven days wide", () => {
    const trends = buildSessionTrends(
      [agedSession("edge", TREND_WINDOW_MS - 1), agedSession("just-outside", TREND_WINDOW_MS + 1)],
      NOW
    );

    expect(trends.sessions.current).toBe(1);
    expect(trends.sessions.previous).toBe(1);
  });

  it("says nothing when there is no history to compare", () => {
    expect(formatTrend(buildSessionTrends([], NOW).sessions)).toBeUndefined();
  });

  it("reports a raw count rather than a percentage when the baseline week is empty", () => {
    const trends = buildSessionTrends([agedSession("first", ONE_DAY), agedSession("second", 2 * ONE_DAY)], NOW);

    expect(trends.sessions.percentChange).toBeUndefined();
    expect(formatTrend(trends.sessions)).toBe("+2 vs last week");
  });

  it("formats growth, decline, and stability distinctly", () => {
    const growth = buildSessionTrends(
      [agedSession("a", ONE_DAY), agedSession("b", 2 * ONE_DAY), agedSession("c", 9 * ONE_DAY)],
      NOW
    ).sessions;
    const decline = buildSessionTrends(
      [agedSession("a", ONE_DAY), agedSession("b", 9 * ONE_DAY), agedSession("c", 10 * ONE_DAY)],
      NOW
    ).sessions;
    const flat = buildSessionTrends([agedSession("a", ONE_DAY), agedSession("b", 9 * ONE_DAY)], NOW).sessions;

    expect(formatTrend(growth)).toBe("+100% vs last week");
    expect(formatTrend(decline)).toBe("−50% vs last week");
    expect(formatTrend(flat)).toBe("No change vs last week");
  });

  it("reads rising activity as good and rising failures as bad", () => {
    const rising = buildSessionTrends(
      [agedSession("a", ONE_DAY), agedSession("b", 2 * ONE_DAY), agedSession("c", 9 * ONE_DAY)],
      NOW
    ).sessions;

    expect(trendTone(rising, true)).toBe("good");
    expect(trendTone(rising, false)).toBe("bad");
    expect(trendTone(buildSessionTrends([], NOW).sessions, true)).toBe("neutral");
  });
});
