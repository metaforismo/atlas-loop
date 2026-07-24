import { describe, expect, it } from "vitest";
import {
  ISSUE_URL_LIMIT,
  buildIssueDraft,
  buildIssueTargets,
  findFirstFailedStep,
  normalizeRepository
} from "../../apps/viewer/src/issueExport.js";
import type { Session, TraceEvent } from "../../apps/viewer/src/types.js";

const EVIDENCE_URL = "http://127.0.0.1:5173/?sessionId=sess_1";

const session: Session = {
  id: "sess_1",
  status: "running",
  createdAt: "2026-07-24T09:00:00.000Z",
  platform: "ios-simulator",
  inputBackend: "xcuitest",
  simulator: { name: "iPhone 16 Pro", runtime: "iOS 18.5" },
  app: { bundleId: "app.atlasloop.CommerceDemo" }
};

function started(id: string, kind: string): TraceEvent {
  return { type: "action.started", at: "2026-07-24T09:00:01.000Z", action: { id, kind } };
}

function completed(actionId: string, ok: boolean, message?: string): TraceEvent {
  return {
    type: "action.completed",
    at: "2026-07-24T09:00:02.000Z",
    result: { actionId, ok, endedAt: "2026-07-24T09:00:02.000Z", ...(message ? { error: { code: "ACTION_TIMEOUT", message } } : {}) }
  };
}

function draft(events: TraceEvent[], notes?: string) {
  return buildIssueDraft({ session, artifacts: [], events, evidenceUrl: EVIDENCE_URL, notes });
}

describe("issue export", () => {
  describe("first failed step", () => {
    it("finds the first failure and its recorded reason", () => {
      const step = findFirstFailedStep([
        started("act_1", "tapElement"),
        completed("act_1", true),
        started("act_2", "assertVisible"),
        completed("act_2", false, "confirmation was not visible after 5000ms"),
        started("act_3", "screenshot"),
        completed("act_3", false, "later failure")
      ]);

      expect(step).toMatchObject({
        position: 2,
        actionId: "act_2",
        kind: "assertVisible",
        reason: "confirmation was not visible after 5000ms"
      });
    });

    it("numbers the step by completed actions so it matches the step list", () => {
      // Interleaved non-action events must not shift the number.
      const step = findFirstFailedStep([
        { type: "session.status", at: "t0", from: "created", to: "running" },
        started("act_1", "tap"),
        { type: "artifact.created", at: "t1" },
        completed("act_1", true),
        started("act_2", "tap"),
        completed("act_2", false, "boom")
      ]);

      expect(step?.position).toBe(2);
    });

    it("says so when a failure carries no reason instead of inventing one", () => {
      const step = findFirstFailedStep([started("act_1", "tap"), completed("act_1", false)]);

      expect(step?.reason).toBe("Not recorded");
    });

    it("returns nothing when every action passed", () => {
      expect(findFirstFailedStep([started("act_1", "tap"), completed("act_1", true)])).toBeUndefined();
    });

    it("survives a completion with no matching start", () => {
      const step = findFirstFailedStep([completed("act_orphan", false, "boom")]);

      expect(step).toMatchObject({ position: 1, kind: "unknown", reason: "boom" });
    });
  });

  describe("draft", () => {
    it("titles a failure with the app and the failing action", () => {
      const result = draft([started("act_1", "assertVisible"), completed("act_1", false, "not visible")]);

      expect(result.title).toBe("app.atlasloop.CommerceDemo: assertVisible failed at step 1");
    });

    it("falls back to an investigation title when nothing failed", () => {
      expect(draft([started("act_1", "tap"), completed("act_1", true)]).title).toContain("Investigate Atlas Loop run");
    });

    it("carries the device, backend, and outcome into the body", () => {
      const body = draft([started("act_1", "tap"), completed("act_1", false, "boom")]).body;

      expect(body).toContain("iPhone 16 Pro");
      expect(body).toContain("iOS 18.5");
      expect(body).toContain("xcuitest");
      expect(body).toContain("| Result | failed |");
      expect(body).toContain("0/1 passed");
    });

    it("links back to the exact evidence", () => {
      expect(draft([]).body).toContain(EVIDENCE_URL);
    });

    it("reports missing values rather than guessing", () => {
      const result = buildIssueDraft({ session: undefined, artifacts: [], events: [], evidenceUrl: EVIDENCE_URL });

      expect(result.body).toContain("Not recorded");
      expect(result.body).toContain("No failed action was recorded for this run.");
      expect(result.runFields.find((field) => field.label === "Actions")?.value).toBe("None recorded");
    });

    it("includes operator notes only when they have content", () => {
      expect(draft([], "Repro attached, who can grab this?").body).toContain("Repro attached, who can grab this?");
      expect(draft([], "   ").body).not.toContain("## Notes");
      expect(draft([]).body).not.toContain("## Notes");
    });
  });

  describe("deep links", () => {
    it("always offers Linear, which needs no repository", () => {
      const targets = buildIssueTargets(draft([]));

      expect(targets.map((target) => target.id)).toEqual(["linear"]);
      expect(targets[0]!.url).toContain("https://linear.app/new?title=");
    });

    it("adds GitHub once a repository is known", () => {
      const targets = buildIssueTargets(draft([]), "metaforismo/atlas-loop");

      expect(targets.map((target) => target.id)).toEqual(["linear", "github"]);
      expect(targets[1]!.url).toContain("https://github.com/metaforismo/atlas-loop/issues/new?title=");
    });

    it("encodes the body so markdown survives the query string", () => {
      const url = buildIssueTargets(draft([started("a", "tap"), completed("a", false, "a & b")]))[0]!.url!;

      expect(url).not.toContain("\n");
      expect(url).toContain("%26");
    });

    it("drops the link rather than truncating an oversized draft", () => {
      // A truncated body would file a ticket missing the part that matters.
      const long = buildIssueDraft({
        session,
        artifacts: [],
        events: [],
        evidenceUrl: EVIDENCE_URL,
        notes: "x".repeat(ISSUE_URL_LIMIT)
      });

      expect(buildIssueTargets(long)[0]!.url).toBeUndefined();
      // The markdown is still complete, so copying it still works.
      expect(long.body).toContain("x".repeat(100));
    });
  });

  describe("repository parsing", () => {
    it("accepts owner/repo and a full URL", () => {
      expect(normalizeRepository("metaforismo/atlas-loop")).toBe("metaforismo/atlas-loop");
      expect(normalizeRepository("https://github.com/metaforismo/atlas-loop")).toBe("metaforismo/atlas-loop");
      expect(normalizeRepository("https://github.com/metaforismo/atlas-loop.git")).toBe("metaforismo/atlas-loop");
      expect(normalizeRepository("  metaforismo/atlas-loop  ")).toBe("metaforismo/atlas-loop");
    });

    it("rejects anything that would produce a broken link", () => {
      for (const bad of ["", "   ", "atlas-loop", "https://gitlab.com/a/b", "a/b/c", undefined]) {
        expect(normalizeRepository(bad)).toBeUndefined();
      }
    });
  });
});
