// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsPanel } from "../../apps/viewer/src/components/MetricsPanel.js";
import type { TraceEvent } from "../../apps/viewer/src/types.js";
import { buildSparklinePoints, metricsMarkerFractions } from "../../apps/viewer/src/viewerPresentation.js";

describe("buildSparklinePoints", () => {
  it("scales values into the frame with headroom", () => {
    const points = buildSparklinePoints([0, 50, 100], 100, 50);
    const pairs = points.split(" ").map((pair) => pair.split(",").map(Number));

    expect(pairs).toHaveLength(3);
    expect(pairs[0][0]).toBe(0);
    expect(pairs[2][0]).toBe(100);
    // Zero sits on the baseline, the peak stays below the top edge.
    expect(pairs[0][1]).toBe(50);
    expect(pairs[2][1]).toBeGreaterThan(0);
    expect(pairs[2][1]).toBeLessThan(pairs[1][1]);
  });

  it("renders a single sample as a horizontal line and drops non-finite values", () => {
    const single = buildSparklinePoints([10], 100, 50);
    const [first, second] = single.split(" ");
    expect(first.split(",")[1]).toBe(second.split(",")[1]);

    expect(buildSparklinePoints([Number.NaN, Number.POSITIVE_INFINITY], 100, 50)).toBe("");
    expect(buildSparklinePoints([], 100, 50)).toBe("");
  });
});

describe("metricsMarkerFractions", () => {
  const samples = [
    { at: "2026-07-05T10:00:00.000Z", cpuPercent: 1, rssBytes: 1 },
    { at: "2026-07-05T10:00:10.000Z", cpuPercent: 2, rssBytes: 2 }
  ];

  it("maps action starts onto the sample time axis", () => {
    const events: TraceEvent[] = [
      { type: "action.started", at: "2026-07-05T10:00:05.000Z", action: { id: "a", kind: "tap" } },
      { type: "action.started", at: "2026-07-05T09:59:00.000Z", action: { id: "b", kind: "tap" } },
      { type: "action.completed", at: "2026-07-05T10:00:06.000Z", result: { actionId: "a", ok: true } }
    ];

    expect(metricsMarkerFractions(samples, events)).toEqual([0.5]);
  });

  it("returns nothing for degenerate series", () => {
    expect(metricsMarkerFractions([], [])).toEqual([]);
    expect(metricsMarkerFractions([samples[0]], [])).toEqual([]);
  });
});

describe("MetricsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              schemaVersion: "atlas-loop.metrics.v1",
              sessionId: "sess_metrics",
              active: true,
              sampleCount: 3,
              samples: [
                { at: "2026-07-05T10:00:00.000Z", cpuPercent: 10, rssBytes: 100 * 1024 * 1024 },
                { at: "2026-07-05T10:00:01.000Z", cpuPercent: 42.5, rssBytes: 120 * 1024 * 1024 },
                { at: "2026-07-05T10:00:02.000Z", cpuPercent: 21, rssBytes: 110 * 1024 * 1024 }
              ]
            }
          }),
          { status: 200 }
        )
      )
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders CPU and memory sparklines with current and peak labels", async () => {
    await act(async () => {
      root.render(
        <MetricsPanel
          params={{ daemonUrl: "http://127.0.0.1:4317", sessionId: "sess_metrics" }}
          sessionStatus="ended"
          events={[{ type: "action.started", at: "2026-07-05T10:00:01.000Z", action: { id: "a", kind: "tap" } }]}
        />
      );
    });

    expect(container.querySelectorAll("polyline.metrics-line")).toHaveLength(2);
    expect(container.querySelectorAll("line.metrics-marker").length).toBeGreaterThan(0);
    expect(container.textContent).toContain("3 samples");
    expect(container.textContent).toContain("peak 42.5%");
    expect(container.textContent).toContain("peak 120MB");
  });
});
