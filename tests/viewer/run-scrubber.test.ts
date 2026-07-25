import { describe, expect, it } from "vitest";
import {
  advanceFraction,
  buildRunScrubberModel,
  formatElapsed,
  fractionOfItem,
  fractionOfTime,
  resolveRunMoment,
  stepFraction,
  timeOfFraction
} from "../../apps/viewer/src/runScrubber.js";
import type { TimelineItem } from "../../apps/viewer/src/timeline.js";

const BASE = Date.parse("2026-07-25T10:00:00.000Z");

function item(id: string, offsetSeconds: number, overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id,
    at: new Date(BASE + offsetSeconds * 1000).toISOString(),
    sourceType: "event",
    title: id,
    detail: "",
    tone: "neutral",
    sortKey: offsetSeconds,
    ...overrides
  };
}

/** A ten second run: an action, a screenshot, another action, a later screenshot. */
const timeline: TimelineItem[] = [
  item("start", 0, { actionId: "act_1" }),
  item("shot_1", 2, { artifactId: "art_1", artifactType: "screenshot", sourceType: "artifact" }),
  item("second", 6, { actionId: "act_2" }),
  item("shot_2", 8, { artifactId: "art_2", artifactType: "screenshot", sourceType: "artifact" }),
  item("end", 10, { tone: "good" })
];

describe("building the track", () => {
  it("spans the run and places every item on it", () => {
    const model = buildRunScrubberModel(timeline)!;

    expect(model.durationMs).toBe(10_000);
    expect(model.marks.map((mark) => mark.fraction)).toEqual([0, 0.2, 0.6, 0.8, 1]);
  });

  it("sorts items that arrived out of order", () => {
    const model = buildRunScrubberModel([timeline[3]!, timeline[0]!, timeline[2]!])!;

    expect(model.marks.map((mark) => mark.id)).toEqual(["start", "second", "shot_2"]);
  });

  it("refuses to scrub what has no duration", () => {
    // A single instant is not a range; a track over it would imply a duration
    // the run never had.
    expect(buildRunScrubberModel([])).toBeUndefined();
    expect(buildRunScrubberModel([item("only", 0)])).toBeUndefined();
    expect(buildRunScrubberModel([item("a", 3), item("b", 3)])).toBeUndefined();
  });

  it("ignores items whose timestamp cannot be read", () => {
    const model = buildRunScrubberModel([...timeline, { ...item("broken", 5), at: "not-a-date" }])!;

    expect(model.marks.map((mark) => mark.id)).not.toContain("broken");
    expect(model.marks).toHaveLength(5);
  });
});

describe("resolving a moment", () => {
  const model = buildRunScrubberModel(timeline)!;

  it("reports the newest state at or before the moment", () => {
    const moment = resolveRunMoment(model, 0.7);

    expect(moment.item?.id).toBe("second");
    expect(moment.actionId).toBe("act_2");
    // The screenshot at 8s has not happened yet at 7s.
    expect(moment.screenshotArtifactId).toBe("art_1");
    expect(moment.elapsedMs).toBe(7000);
  });

  it("never shows a screenshot the device had not displayed yet", () => {
    // Nearest-match would pick the 2s screenshot at 1s; at-or-before does not.
    expect(resolveRunMoment(model, 0.1).screenshotArtifactId).toBeUndefined();
    expect(resolveRunMoment(model, 0.2).screenshotArtifactId).toBe("art_1");
  });

  it("includes an item that lands exactly on the moment", () => {
    expect(resolveRunMoment(model, 0.6).item?.id).toBe("second");
  });

  it("carries the last step forward through time with no events", () => {
    // Between steps the run is still inside the step that last started.
    expect(resolveRunMoment(model, 0.4).actionId).toBe("act_1");
  });

  it("clamps a position dragged past either end", () => {
    expect(resolveRunMoment(model, -3).fraction).toBe(0);
    expect(resolveRunMoment(model, 9).fraction).toBe(1);
    expect(resolveRunMoment(model, Number.NaN).fraction).toBe(0);
  });

  it("reports the run's end state at the end of the track", () => {
    const moment = resolveRunMoment(model, 1);

    expect(moment.item?.id).toBe("end");
    expect(moment.screenshotArtifactId).toBe("art_2");
    expect(moment.elapsedMs).toBe(10_000);
  });
});

describe("moving the playhead", () => {
  const model = buildRunScrubberModel(timeline)!;

  it("finds where a timeline item sits on the track", () => {
    expect(fractionOfItem(model, "second")).toBe(0.6);
    expect(fractionOfItem(model, "missing")).toBeUndefined();
  });

  it("steps between recorded moments rather than sliding through empty time", () => {
    expect(stepFraction(model, 0, 1)).toBe(0.2);
    expect(stepFraction(model, 0.3, 1)).toBe(0.6);
    expect(stepFraction(model, 0.6, -1)).toBe(0.2);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(stepFraction(model, 1, 1)).toBe(1);
    expect(stepFraction(model, 0, -1)).toBe(0);
  });

  it("does not stick when the playhead is already on a mark", () => {
    // A mark at the current position must not be returned as "next".
    expect(stepFraction(model, 0.2, 1)).toBe(0.6);
    expect(stepFraction(model, 0.2, -1)).toBe(0);
  });
});

describe("elapsed formatting", () => {
  it("reads as time into the run", () => {
    expect(formatElapsed(0)).toBe("0.0s");
    expect(formatElapsed(7_200)).toBe("7.2s");
    expect(formatElapsed(72_300)).toBe("1m 12.3s");
  });

  it("pads seconds so the label does not jitter while dragging", () => {
    expect(formatElapsed(63_000)).toBe("1m 03.0s");
  });

  it("refuses to render a negative or unusable duration", () => {
    expect(formatElapsed(-1)).toBe("0.0s");
    expect(formatElapsed(Number.NaN)).toBe("0.0s");
  });
});

describe("parking the playhead on a moment", () => {
  const model = buildRunScrubberModel(timeline)!;

  it("converts between a position and the instant it means", () => {
    expect(timeOfFraction(model, 0.6)).toBe(BASE + 6000);
    expect(fractionOfTime(model, BASE + 6000)).toBe(0.6);
  });

  it("keeps a parked moment fixed while a live run keeps growing", () => {
    // Six seconds in stays six seconds in, even though the run doubled in
    // length underneath the track. A stored fraction would have slid to 12s.
    const parked = timeOfFraction(model, 0.6);
    const longer = buildRunScrubberModel([...timeline, item("later", 20)])!;

    expect(resolveRunMoment(longer, fractionOfTime(longer, parked)).elapsedMs).toBe(6000);
    expect(fractionOfTime(longer, parked)).toBe(0.3);
  });

  it("clamps a moment from outside the run onto the track", () => {
    expect(fractionOfTime(model, BASE - 5000)).toBe(0);
    expect(fractionOfTime(model, BASE + 99_000)).toBe(1);
    expect(fractionOfTime(model, Number.NaN)).toBe(0);
    expect(timeOfFraction(model, 4)).toBe(BASE + 10_000);
    expect(timeOfFraction(model, Number.NaN)).toBe(BASE);
  });
});

describe("playback", () => {
  const model = buildRunScrubberModel(timeline)!;

  it("advances by real time, so a speed means what it says", () => {
    // Two wall seconds at 4x is eight seconds of a ten second run.
    expect(advanceFraction(model, 0, 2000, 4)).toBe(0.8);
    expect(advanceFraction(model, 0.5, 2000, 1)).toBe(0.7);
  });

  it("does not lose position when timers fire late", () => {
    // A tick that arrives 300ms late still lands where the clock says, rather
    // than counting one nominal tick and falling behind.
    expect(advanceFraction(model, 0, 400, 1)).toBe(advanceFraction(model, 0, 400, 1));
    expect(advanceFraction(model, 0, 1300, 1)).toBe(0.13);
  });

  it("stops at the end rather than running past it", () => {
    expect(advanceFraction(model, 0.9, 60_000, 8)).toBe(1);
    expect(advanceFraction(model, Number.NaN, -50, 1)).toBe(0);
  });
});
