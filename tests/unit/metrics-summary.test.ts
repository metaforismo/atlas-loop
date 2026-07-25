import { describe, expect, it } from "vitest";
import { formatBytes, summariseMetrics, type MetricsSample } from "../../packages/protocol/src/index.js";

function sample(overrides: Partial<MetricsSample> = {}): MetricsSample {
  return {
    schemaVersion: "atlas-loop.metrics-sample.v1",
    at: "2026-07-24T09:00:00.000Z",
    pid: 1,
    cpuPercent: 10,
    rssBytes: 100_000_000,
    ...overrides
  };
}

describe("metrics summary", () => {
  it("reports nothing rather than zero when there are no samples", () => {
    const summary = summariseMetrics([]);

    expect(summary.sampleCount).toBe(0);
    expect(summary.cpuPercent).toBeUndefined();
    expect(summary.rssBytes).toBeUndefined();
    expect(summary.durationMs).toBeUndefined();
  });

  it("summarises each series with its peak timestamp", () => {
    const summary = summariseMetrics([
      sample({ at: "2026-07-24T09:00:00.000Z", cpuPercent: 5, rssBytes: 100 }),
      sample({ at: "2026-07-24T09:00:10.000Z", cpuPercent: 89, rssBytes: 300 }),
      sample({ at: "2026-07-24T09:00:20.000Z", cpuPercent: 20, rssBytes: 200 })
    ]);

    expect(summary.cpuPercent).toEqual({ min: 5, max: 89, mean: 38, peakAt: "2026-07-24T09:00:10.000Z" });
    expect(summary.rssBytes).toEqual({ min: 100, max: 300, mean: 200, peakAt: "2026-07-24T09:00:10.000Z" });
  });

  it("takes the window from the extremes, not the first and last entries", () => {
    // A relaunched run writes several files, so file order is not global order.
    const summary = summariseMetrics([
      sample({ at: "2026-07-24T09:00:30.000Z" }),
      sample({ at: "2026-07-24T09:00:00.000Z" }),
      sample({ at: "2026-07-24T09:00:15.000Z" })
    ]);

    expect(summary.startedAt).toBe("2026-07-24T09:00:00.000Z");
    expect(summary.endedAt).toBe("2026-07-24T09:00:30.000Z");
    expect(summary.durationMs).toBe(30_000);
  });

  it("keeps one series when the other is unreadable", () => {
    const summary = summariseMetrics([
      sample({ cpuPercent: Number.NaN, rssBytes: 500 }),
      sample({ cpuPercent: 12, rssBytes: Number.NaN })
    ]);

    expect(summary.cpuPercent).toMatchObject({ min: 12, max: 12 });
    expect(summary.rssBytes).toMatchObject({ min: 500, max: 500 });
    expect(summary.sampleCount).toBe(2);
  });

  it("ignores unparseable timestamps without voiding the series", () => {
    const summary = summariseMetrics([sample({ at: "not-a-date", cpuPercent: 40 })]);

    expect(summary.startedAt).toBeUndefined();
    expect(summary.durationMs).toBeUndefined();
    expect(summary.cpuPercent?.max).toBe(40);
  });

  it("handles a single sample", () => {
    const summary = summariseMetrics([sample({ cpuPercent: 7 })]);

    expect(summary.durationMs).toBe(0);
    expect(summary.cpuPercent).toMatchObject({ min: 7, max: 7, mean: 7 });
  });

  describe("byte formatting", () => {
    it("scales through the units", () => {
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(2048)).toBe("2 KB");
      expect(formatBytes(686 * 1024 * 1024)).toBe("686 MB");
      expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe("3.5 GB");
    });

    it("refuses to invent a value for nonsense input", () => {
      expect(formatBytes(Number.NaN)).toBe("--");
      expect(formatBytes(-1)).toBe("--");
      expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("--");
    });
  });
});
