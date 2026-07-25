import { describe, expect, it } from "vitest";
import { findSessions, hasProblem, isActiveSession, scopeCounts } from "../../apps/viewer/src/sessionFinder.js";
import { sessionRailSignals } from "../../apps/viewer/src/viewerPresentation.js";
import type { SessionHistoryItem } from "../../apps/viewer/src/types.js";

const BASE = Date.parse("2026-07-25T10:00:00.000Z");

function item(id: string, overrides: Record<string, unknown> = {}): SessionHistoryItem {
  const { session, events, storage, ...rest } = overrides as Record<string, any>;
  return {
    id,
    sessionId: id,
    status: "ended",
    createdAt: new Date(BASE).toISOString(),
    updatedAt: new Date(BASE).toISOString(),
    artifactDir: `/artifacts/${id}`,
    storage: { source: "disk", artifactBacked: true, warningCount: 0, ...(storage ?? {}) },
    artifacts: { total: 0, byType: {} },
    events: { total: 0, ...(events ?? {}) },
    session: {
      id,
      schemaVersion: "atlas-loop.session.v1",
      platform: "ios-simulator",
      status: "ended",
      createdAt: new Date(BASE).toISOString(),
      updatedAt: new Date(BASE).toISOString(),
      ...(session ?? {})
    },
    ...rest
  } as SessionHistoryItem;
}

describe("what counts as active", () => {
  it("treats a run that has not finished as active", () => {
    for (const status of ["created", "installing", "installed", "launching", "running"]) {
      expect(isActiveSession(item("s", { status }))).toBe(true);
    }
  });

  it("does not treat a finished or failed run as active", () => {
    expect(isActiveSession(item("s", { status: "ended" }))).toBe(false);
    expect(isActiveSession(item("s", { status: "failed" }))).toBe(false);
  });
});

describe("what counts as a problem", () => {
  it("catches a failed run", () => {
    expect(hasProblem(item("s", { status: "failed" }))).toBe(true);
  });

  it("catches a run that finished but recorded an error", () => {
    // A run can end with status "ended" and still have failed at something,
    // which is exactly the run an operator is hunting for.
    expect(hasProblem(item("s", { events: { total: 3, latestError: { code: "COMMAND_FAILED", message: "x" } } }))).toBe(true);
  });

  it("catches a run whose stored evidence was flagged", () => {
    expect(hasProblem(item("s", { storage: { warningCount: 2 } }))).toBe(true);
  });

  it("leaves a clean run alone", () => {
    expect(hasProblem(item("s"))).toBe(false);
  });
});

describe("finding a session", () => {
  const sessions = [
    item("sess_old", { updatedAt: new Date(BASE - 60_000).toISOString() }),
    item("sess_new", {
      updatedAt: new Date(BASE).toISOString(),
      session: { app: { bundleId: "app.atlasloop.CommerceDemo" }, simulator: { name: "iPhone 16 Pro" } }
    }),
    item("sess_broken", { status: "failed", updatedAt: new Date(BASE - 30_000).toISOString() })
  ];

  it("puts the newest run first, because that is the one you just made", () => {
    expect(findSessions(sessions).visible.map((s) => s.sessionId)).toEqual([
      "sess_new",
      "sess_broken",
      "sess_old"
    ]);
  });

  it("matches on the things an operator would actually type", () => {
    expect(findSessions(sessions, { query: "commercedemo" }).visible.map((s) => s.sessionId)).toEqual(["sess_new"]);
    expect(findSessions(sessions, { query: "iPhone 16" }).visible.map((s) => s.sessionId)).toEqual(["sess_new"]);
    expect(findSessions(sessions, { query: "BROKEN" }).visible.map((s) => s.sessionId)).toEqual(["sess_broken"]);
  });

  it("narrows to runs still going, or to runs worth attention", () => {
    const running = [...sessions, item("sess_live", { status: "running", updatedAt: new Date(BASE + 1000).toISOString() })];

    expect(findSessions(running, { scope: "active" }).visible.map((s) => s.sessionId)).toEqual(["sess_live"]);
    expect(findSessions(running, { scope: "problems" }).visible.map((s) => s.sessionId)).toEqual(["sess_broken"]);
  });

  it("caps the list and says how much it is holding back", () => {
    // Seventy rows in a three-hundred-pixel rail is a scrollbar, not a list.
    const many = Array.from({ length: 40 }, (_, index) =>
      item(`sess_${index}`, { updatedAt: new Date(BASE - index * 1000).toISOString() })
    );
    const result = findSessions(many, { limit: 8 });

    expect(result.visible).toHaveLength(8);
    expect(result.matched).toBe(40);
    expect(result.total).toBe(40);
    expect(result.truncated).toBe(true);
    expect(result.visible[0]!.sessionId).toBe("sess_0");
  });

  it("shows everything once expanded", () => {
    const many = Array.from({ length: 40 }, (_, index) => item(`sess_${index}`));
    const result = findSessions(many, { limit: 8, expanded: true });

    expect(result.visible).toHaveLength(40);
    expect(result.truncated).toBe(false);
  });

  it("reports a search that matched nothing without hiding the total", () => {
    const result = findSessions(sessions, { query: "nothing-matches" });

    expect(result.visible).toEqual([]);
    expect(result.matched).toBe(0);
    expect(result.total).toBe(3);
  });

  it("ignores a blank query rather than matching nothing", () => {
    expect(findSessions(sessions, { query: "   " }).matched).toBe(3);
  });

  it("sorts a run with an unreadable timestamp last instead of dropping it", () => {
    const broken = [...sessions, item("sess_undated", { updatedAt: "not-a-date", createdAt: "also-not" })];

    const visible = findSessions(broken).visible.map((s) => s.sessionId);
    expect(visible).toContain("sess_undated");
    expect(visible[visible.length - 1]).toBe("sess_undated");
  });
});

describe("counting each scope", () => {
  it("reports what each filter would show", () => {
    const sessions = [
      item("a", { status: "running" }),
      item("b", { status: "failed" }),
      item("c"),
      item("d", { storage: { warningCount: 1 } })
    ];

    expect(scopeCounts(sessions)).toEqual({ all: 4, active: 1, problems: 2 });
  });

  it("reports zeroes for an empty list rather than failing", () => {
    expect(scopeCounts([])).toEqual({ all: 0, active: 0, problems: 0 });
  });

  it("counts against the current search, so a chip cannot promise an empty list", () => {
    // "Problems 17" that lands on nothing because a query is also active is
    // worse than showing no count at all.
    const sessions = [
      item("keep", { status: "failed", session: { app: { bundleId: "app.atlasloop.CommerceDemo" } } }),
      item("drop", { status: "failed", session: { app: { bundleId: "com.other.App" } } })
    ];

    expect(scopeCounts(sessions).problems).toBe(2);
    expect(scopeCounts(sessions, "commercedemo").problems).toBe(1);
    expect(scopeCounts(sessions, "nothing").problems).toBe(0);
  });
});

describe("what a rail row is worth saying", () => {
  it("says nothing about a clean run", () => {
    // Six truncated chips on every row made them all look identical. A run
    // that ended cleanly already says so through its status.
    expect(sessionRailSignals(item("clean", { artifacts: { total: 4, byType: {} } }))).toEqual([]);
  });

  it("flags a run whose last action failed", () => {
    const signals = sessionRailSignals(
      item("bad", {
        artifacts: { total: 3, byType: {} },
        events: { total: 2, latestAction: { actionId: "a", ok: false, artifactCount: 0 } }
      })
    );

    expect(signals.map((s) => [s.label, s.tone])).toEqual([["failed", "bad"]]);
  });

  it("flags stored-evidence warnings, and counts them in the label", () => {
    const withArtifacts = (count: number) =>
      item("w", { artifacts: { total: 2, byType: {} }, storage: { warningCount: count } });

    expect(sessionRailSignals(withArtifacts(1)).map((s) => s.label)).toEqual(["1 warning"]);
    expect(sessionRailSignals(withArtifacts(3)).map((s) => s.label)).toEqual(["3 warnings"]);
  });

  it("flags a finished run that recorded nothing to review", () => {
    expect(sessionRailSignals(item("empty", { artifacts: { total: 0, byType: {} } })).map((s) => s.label)).toEqual([
      "no evidence"
    ]);
  });

  it("does not flag a run that has not had time to record anything", () => {
    // Installing or launching means the artifacts are still coming; calling
    // that "no evidence" would be wrong rather than merely noisy.
    for (const status of ["created", "installing", "launching", "running"]) {
      expect(sessionRailSignals(item("young", { status, artifacts: { total: 0, byType: {} } }))).toEqual([]);
    }
  });

  it("says nothing when the daemon did not report evidence either way", () => {
    // Absent is not the same as zero; only a reported zero is worth flagging.
    expect(sessionRailSignals(item("unknown", { artifacts: undefined }))).toEqual([]);
    expect(sessionRailSignals(undefined)).toEqual([]);
  });
});
