import { describe, expect, it } from "vitest";
import {
  atlasJourneyHighlight,
  atlasJourneyLabel,
  atlasScreenLabel,
  deriveAtlasJourneys,
  sortAtlasJourneys,
  summariseAtlasJourneys
} from "../../packages/protocol/src/index.js";
import type { ActionKind, AtlasScreen, AtlasTransition } from "../../packages/protocol/src/index.js";

function transition(
  id: string,
  from: string,
  to: string,
  examples: Array<{ sessionId: string; at: string; actionId?: string }>,
  actionKinds: ActionKind[] = ["tap"]
): AtlasTransition {
  return {
    id,
    from,
    to,
    actionSignature: `${id}-sig`,
    actionKinds,
    count: examples.length,
    sessionIds: [...new Set(examples.map((example) => example.sessionId))],
    examples: examples.map((example, index) => ({
      sessionId: example.sessionId,
      actionId: example.actionId ?? `${id}-act-${index}`,
      at: example.at
    }))
  };
}

function screen(id: string, screenId?: string): AtlasScreen {
  const shot = { sessionId: "s", artifactId: "a", path: "p", createdAt: "2026-07-25T10:00:00.000Z" };
  return {
    id,
    ...(screenId ? { screenId } : {}),
    hashes: [id],
    representative: shot,
    variants: [shot],
    screenshotCount: 1,
    sessionIds: ["s"],
    firstSeenAt: shot.createdAt,
    lastSeenAt: shot.createdAt
  };
}

describe("deriving journeys", () => {
  it("reconstructs a run's walk in the order it happened", () => {
    const journeys = deriveAtlasJourneys({
      transitions: [
        // Deliberately out of chronological order in the map.
        transition("t2", "cart", "checkout", [{ sessionId: "sess_1", at: "2026-07-25T10:00:02.000Z" }]),
        transition("t1", "home", "cart", [{ sessionId: "sess_1", at: "2026-07-25T10:00:01.000Z" }])
      ]
    });

    expect(journeys).toHaveLength(1);
    expect(journeys[0]!.screenIds).toEqual(["home", "cart", "checkout"]);
    expect(journeys[0]!.steps.map((step) => step.transitionId)).toEqual(["t1", "t2"]);
    expect(journeys[0]!.startedAt).toBe("2026-07-25T10:00:01.000Z");
    expect(journeys[0]!.endedAt).toBe("2026-07-25T10:00:02.000Z");
  });

  it("keeps each run's walk separate", () => {
    const journeys = deriveAtlasJourneys({
      transitions: [
        transition("t1", "home", "cart", [
          { sessionId: "sess_1", at: "2026-07-25T10:00:01.000Z" },
          { sessionId: "sess_2", at: "2026-07-25T11:00:01.000Z" }
        ])
      ]
    });

    expect(journeys.map((journey) => journey.sessionId)).toEqual(["sess_1", "sess_2"]);
    expect(journeys.every((journey) => journey.steps.length === 1)).toBe(true);
  });

  it("splits a walk where the chain breaks instead of inventing an edge", () => {
    // A relaunch moves the app without a recorded transition; joining these
    // would claim a path nobody walked.
    const journeys = deriveAtlasJourneys({
      transitions: [
        transition("t1", "home", "cart", [{ sessionId: "sess_1", at: "2026-07-25T10:00:01.000Z" }]),
        transition("t2", "home", "settings", [{ sessionId: "sess_1", at: "2026-07-25T10:00:09.000Z" }])
      ]
    });

    expect(journeys).toHaveLength(2);
    expect(journeys[0]!.screenIds).toEqual(["home", "cart"]);
    expect(journeys[1]!.screenIds).toEqual(["home", "settings"]);
  });

  it("continues a walk that revisits a screen", () => {
    const journeys = deriveAtlasJourneys({
      transitions: [
        transition("t1", "home", "cart", [{ sessionId: "sess_1", at: "2026-07-25T10:00:01.000Z" }]),
        transition("t2", "cart", "home", [{ sessionId: "sess_1", at: "2026-07-25T10:00:02.000Z" }]),
        transition("t3", "home", "cart", [{ sessionId: "sess_1", at: "2026-07-25T10:00:03.000Z" }])
      ]
    });

    expect(journeys).toHaveLength(1);
    expect(journeys[0]!.screenIds).toEqual(["home", "cart", "home", "cart"]);
  });

  it("skips examples with an unusable timestamp rather than misordering the walk", () => {
    const journeys = deriveAtlasJourneys({
      transitions: [
        transition("t1", "home", "cart", [{ sessionId: "sess_1", at: "not-a-date" }]),
        transition("t2", "cart", "checkout", [{ sessionId: "sess_1", at: "2026-07-25T10:00:02.000Z" }])
      ]
    });

    expect(journeys).toHaveLength(1);
    expect(journeys[0]!.screenIds).toEqual(["cart", "checkout"]);
  });

  it("returns nothing for a map with no transitions", () => {
    expect(deriveAtlasJourneys({ transitions: [] })).toEqual([]);
  });

  it("survives a transition that arrived without examples", () => {
    // The map comes over the network; a missing field must not take the whole
    // Atlas view down.
    const partial = [
      { id: "t1", from: "a", to: "b", actionSignature: "s", actionKinds: ["tap"], count: 0, sessionIds: [] },
      transition("t2", "b", "c", [{ sessionId: "s", at: "2026-07-25T10:00:01.000Z" }])
    ] as unknown as AtlasTransition[];

    expect(() => deriveAtlasJourneys({ transitions: partial })).not.toThrow();
    expect(deriveAtlasJourneys({ transitions: partial })).toHaveLength(1);
  });

  it("survives a transition that arrived without action kinds", () => {
    const partial = [
      { id: "t1", from: "a", to: "b", actionSignature: "s", count: 1, sessionIds: ["s"], examples: [{ sessionId: "s", actionId: "act", at: "2026-07-25T10:00:01.000Z" }] }
    ] as unknown as AtlasTransition[];

    const journeys = deriveAtlasJourneys({ transitions: partial });
    expect(journeys).toHaveLength(1);
    // With nothing recorded about what the run did, the honest answer is the
    // least specific category, not a guess.
    expect(journeys[0]!.category).toBe("navigate");
  });

  it("always has one more screen than it has steps", () => {
    const journeys = deriveAtlasJourneys({
      transitions: [
        transition("t1", "a", "b", [{ sessionId: "s", at: "2026-07-25T10:00:01.000Z" }]),
        transition("t2", "b", "c", [{ sessionId: "s", at: "2026-07-25T10:00:02.000Z" }])
      ]
    });

    for (const journey of journeys) {
      expect(journey.screenIds).toHaveLength(journey.steps.length + 1);
    }
  });
});

describe("categorising journeys", () => {
  function categoryFor(kinds: ActionKind[]): string {
    return deriveAtlasJourneys({
      transitions: [transition("t1", "a", "b", [{ sessionId: "s", at: "2026-07-25T10:00:01.000Z" }], kinds)]
    })[0]!.category;
  }

  it("derives the category from what the run did, not from screen names", () => {
    expect(categoryFor(["typeText"])).toBe("input");
    expect(categoryFor(["pinch"])).toBe("gesture");
    expect(categoryFor(["swipe"])).toBe("gesture");
    expect(categoryFor(["assertVisible"])).toBe("verified");
    expect(categoryFor(["tap"])).toBe("navigate");
  });

  it("prefers the most specific category when a walk did several things", () => {
    expect(categoryFor(["tap", "assertVisible", "typeText"])).toBe("input");
    expect(categoryFor(["tap", "assertVisible", "rotate"])).toBe("gesture");
  });
});

describe("presentation", () => {
  const screens = [screen("scr_home", "Home"), screen("scr_checkoutlongidentifier")];

  it("uses an explicit screen identifier when the evidence carried one", () => {
    expect(atlasScreenLabel(screens[0], "scr_home")).toBe("Home");
  });

  it("names the synthetic launch node instead of leaking its sentinel", () => {
    // `__launch__` is a graph node, not a captured screen; showing it raw
    // reads as a bug.
    expect(atlasScreenLabel(undefined, "__launch__")).toBe("Launch");
  });

  it("trims an opaque id rather than inventing a name", () => {
    expect(atlasScreenLabel(screens[1], "scr_checkoutlongidentifier")).toBe("scr_checkout…");
    expect(atlasScreenLabel(undefined, "unknown_screen")).toBe("unknown_scre…");
  });

  it("labels a journey by its endpoints", () => {
    const [journey] = deriveAtlasJourneys({
      transitions: [
        transition("t1", "scr_home", "scr_checkoutlongidentifier", [{ sessionId: "s", at: "2026-07-25T10:00:01.000Z" }])
      ]
    });

    expect(atlasJourneyLabel(journey!, screens)).toBe("Home → scr_checkout…");
  });

  it("names a round trip by its single endpoint", () => {
    const [journey] = deriveAtlasJourneys({
      transitions: [
        transition("t1", "scr_home", "b", [{ sessionId: "s", at: "2026-07-25T10:00:01.000Z" }]),
        transition("t2", "b", "scr_home", [{ sessionId: "s", at: "2026-07-25T10:00:02.000Z" }])
      ]
    });

    expect(atlasJourneyLabel(journey!, screens)).toBe("Home");
  });

  it("sorts the longest walk first, then the most recent", () => {
    const journeys = deriveAtlasJourneys({
      transitions: [
        transition("t1", "a", "b", [{ sessionId: "short_old", at: "2026-07-25T09:00:00.000Z" }]),
        transition("t2", "a", "b", [{ sessionId: "short_new", at: "2026-07-25T12:00:00.000Z" }]),
        transition("t3", "a", "b", [{ sessionId: "long", at: "2026-07-25T10:00:00.000Z" }]),
        transition("t4", "b", "c", [{ sessionId: "long", at: "2026-07-25T10:00:01.000Z" }])
      ]
    });

    expect(sortAtlasJourneys(journeys).map((journey) => journey.sessionId)).toEqual(["long", "short_new", "short_old"]);
  });

  it("counts journeys by category and reports the longest", () => {
    const journeys = deriveAtlasJourneys({
      transitions: [
        transition("t1", "a", "b", [{ sessionId: "s1", at: "2026-07-25T10:00:00.000Z" }], ["typeText"]),
        transition("t2", "a", "b", [{ sessionId: "s2", at: "2026-07-25T10:00:00.000Z" }], ["tap"]),
        transition("t3", "b", "c", [{ sessionId: "s2", at: "2026-07-25T10:00:01.000Z" }], ["tap"])
      ]
    });

    expect(summariseAtlasJourneys(journeys)).toEqual({
      journeys: 2,
      byCategory: { input: 1, gesture: 0, verified: 0, navigate: 1 },
      longest: 2
    });
  });

  it("reports the screens and transitions to keep lit, and empties for no selection", () => {
    const [journey] = deriveAtlasJourneys({
      transitions: [transition("t1", "a", "b", [{ sessionId: "s", at: "2026-07-25T10:00:01.000Z" }])]
    });

    expect(atlasJourneyHighlight(journey)).toEqual({
      screenIds: new Set(["a", "b"]),
      transitionIds: new Set(["t1"])
    });
    const empty = atlasJourneyHighlight(undefined);
    expect(empty.screenIds.size).toBe(0);
    expect(empty.transitionIds.size).toBe(0);
  });
});
