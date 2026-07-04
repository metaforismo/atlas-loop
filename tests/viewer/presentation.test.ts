import { describe, expect, it } from "vitest";
import {
  eventModeTone,
  healthTone,
  latestArtifactOfType,
  sessionTone,
  summarizeArtifacts
} from "../../apps/viewer/src/viewerPresentation.js";
import type { ArtifactRef } from "../../apps/viewer/src/types.js";

describe("viewer presentation helpers", () => {
  it("maps runtime states to UI tones", () => {
    expect(healthTone("online")).toBe("good");
    expect(healthTone("checking")).toBe("warn");
    expect(healthTone("offline")).toBe("bad");

    expect(eventModeTone("sse")).toBe("good");
    expect(eventModeTone("polling")).toBe("warn");
    expect(eventModeTone("connecting")).toBe("neutral");

    expect(sessionTone("running")).toBe("good");
    expect(sessionTone("building")).toBe("warn");
    expect(sessionTone("failed")).toBe("bad");
    expect(sessionTone("ended")).toBe("neutral");
  });

  it("summarizes artifacts by frequency and type", () => {
    const artifacts: ArtifactRef[] = [
      { id: "log-1", type: "log", path: "logs/one.txt" },
      { id: "shot-1", type: "screenshot", path: "screenshots/one.png" },
      { id: "log-2", type: "log", path: "logs/two.txt" },
      { id: "meta-1", type: "metadata", path: "metadata/session.json" }
    ];

    expect(summarizeArtifacts(artifacts)).toEqual([
      { type: "log", count: 2 },
      { type: "metadata", count: 1 },
      { type: "screenshot", count: 1 }
    ]);
  });

  it("finds the newest artifact of a type from the sorted artifact list", () => {
    const artifacts: ArtifactRef[] = [
      { id: "new-shot", type: "screenshot", path: "screenshots/new.png" },
      { id: "log", type: "log", path: "logs/run.txt" },
      { id: "old-shot", type: "screenshot", path: "screenshots/old.png" }
    ];

    expect(latestArtifactOfType(artifacts, "screenshot")?.id).toBe("new-shot");
    expect(latestArtifactOfType(artifacts, "video")).toBeUndefined();
  });
});
