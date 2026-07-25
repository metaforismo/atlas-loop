import { describe, expect, it } from "vitest";
import { elapsedLabel, peakReading, readingAtFraction } from "../../apps/viewer/src/metricsInspection.js";
import { sessionMetadataFields } from "../../apps/viewer/src/components/MetadataPanel.js";
import type { MetricsSampleLike } from "../../apps/viewer/src/viewerPresentation.js";
import type { Session } from "../../apps/viewer/src/types.js";

function sample(seconds: number, cpuPercent: number, rssBytes = 100): MetricsSampleLike {
  return { at: new Date(Date.parse("2026-07-24T09:00:00.000Z") + seconds * 1000).toISOString(), cpuPercent, rssBytes };
}

const samples = [sample(0, 5), sample(30, 89), sample(60, 20), sample(90, 12)];

describe("metrics inspection", () => {
  describe("reading at a pointer position", () => {
    it("snaps to the nearest plotted sample", () => {
      expect(readingAtFraction(samples, 0)?.index).toBe(0);
      expect(readingAtFraction(samples, 1)?.index).toBe(3);
      // Samples are plotted evenly, so a third of the way across is index 1.
      expect(readingAtFraction(samples, 0.34)?.index).toBe(1);
    });

    it("clamps a pointer dragged outside the chart", () => {
      expect(readingAtFraction(samples, -2)?.index).toBe(0);
      expect(readingAtFraction(samples, 5)?.index).toBe(3);
    });

    it("returns nothing rather than guessing on empty or unusable input", () => {
      expect(readingAtFraction([], 0.5)).toBeUndefined();
      expect(readingAtFraction(samples, Number.NaN)).toBeUndefined();
    });

    it("handles a single sample without dividing by zero", () => {
      const reading = readingAtFraction([sample(0, 4)], 0.7);

      expect(reading).toMatchObject({ index: 0, fraction: 0 });
    });
  });

  describe("peak", () => {
    it("locates the highest value and its position", () => {
      const peak = peakReading(samples, (entry) => entry.cpuPercent);

      expect(peak?.index).toBe(1);
      expect(peak?.sample.cpuPercent).toBe(89);
      expect(peak?.fraction).toBeCloseTo(1 / 3, 5);
    });

    it("keeps the first of equal maxima so the marker does not jump", () => {
      const peak = peakReading([sample(0, 50), sample(10, 50)], (entry) => entry.cpuPercent);

      expect(peak?.index).toBe(0);
    });

    it("skips unreadable values", () => {
      const peak = peakReading([sample(0, Number.NaN), sample(10, 7)], (entry) => entry.cpuPercent);

      expect(peak?.index).toBe(1);
    });

    it("returns nothing when no value is readable", () => {
      expect(peakReading([sample(0, Number.NaN)], (entry) => entry.cpuPercent)).toBeUndefined();
      expect(peakReading([], (entry) => entry.cpuPercent)).toBeUndefined();
    });
  });

  describe("elapsed label", () => {
    it("reports time into the run, not the wall clock", () => {
      // A spike is lined up against a step by elapsed time, not by clock time.
      expect(elapsedLabel(samples, samples[0]!)).toBe("0s");
      expect(elapsedLabel(samples, samples[1]!)).toBe("30s");
      expect(elapsedLabel(samples, samples[3]!)).toBe("1m 30s");
    });

    it("zero-pads the seconds so labels stay aligned", () => {
      expect(elapsedLabel([sample(0, 1), sample(65, 1)], sample(65, 1))).toBe("1m 05s");
    });

    it("refuses to compute a label from unusable timestamps", () => {
      const broken = { at: "not-a-date", cpuPercent: 1, rssBytes: 1 };

      expect(elapsedLabel(samples, broken)).toBe("--");
      expect(elapsedLabel([broken], broken)).toBe("--");
    });
  });
});

describe("session metadata fields", () => {
  const session = (overrides: Partial<Session>): Session => ({ id: "s", status: "running", ...overrides });

  it("separates recorded fields from unrecorded ones", () => {
    const fields = sessionMetadataFields(session({ simulator: { name: "iPhone 16 Pro" }, backend: "local-daemon" }));
    const recorded = fields.filter((field) => field.value !== undefined).map((field) => field.label);

    expect(recorded).toEqual(["Simulator", "Backend"]);
    expect(fields.find((field) => field.label === "Runtime")?.value).toBeUndefined();
  });

  it("treats blank and placeholder values as unrecorded", () => {
    // A daemon that wrote "--" or "  " has not recorded anything useful.
    const fields = sessionMetadataFields(session({ backend: "   ", artifactDir: "--" }));

    expect(fields.find((field) => field.label === "Backend")?.value).toBeUndefined();
    expect(fields.find((field) => field.label === "Artifact dir")?.value).toBeUndefined();
  });

  it("falls back from workspace to project path", () => {
    const fields = sessionMetadataFields(session({ app: { projectPath: "/tmp/Demo.xcodeproj" } }));

    expect(fields.find((field) => field.label === "Workspace")?.value).toBe("/tmp/Demo.xcodeproj");
  });

  it("shows a malformed timestamp rather than calling it unrecorded", () => {
    // The daemon did write something; surfacing it exposes the data problem,
    // whereas hiding it under "not recorded" would misreport what happened.
    expect(sessionMetadataFields(session({ createdAt: "nope" })).find((field) => field.label === "Created")?.value).toBe("nope");
    expect(sessionMetadataFields(session({})).find((field) => field.label === "Created")?.value).toBeUndefined();
  });

  it("always accounts for every field so none is silently dropped", () => {
    expect(sessionMetadataFields(session({})).map((field) => field.label)).toEqual([
      "Simulator",
      "Runtime",
      "Backend",
      "Bundle",
      "Workspace",
      "Created",
      "Artifact dir"
    ]);
  });
});
