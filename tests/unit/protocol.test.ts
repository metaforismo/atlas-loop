import { describe, expect, it } from "vitest";
import { materializeAction, validateActionInput } from "@atlas-loop/protocol";

describe("protocol action validation", () => {
  it("rejects tap coordinates outside the normalized viewport", () => {
    expect(() => validateActionInput({ kind: "tap", x: 1.01, y: 0.5 })).toThrow(/normalized coordinates/);
    expect(() => validateActionInput({ kind: "tap", x: 0.5, y: -0.01 })).toThrow(/normalized coordinates/);
  });

  it("rejects empty text and negative waits", () => {
    expect(() => validateActionInput({ kind: "typeText", text: "" })).toThrow(/non-empty text/);
    expect(() => validateActionInput({ kind: "wait", durationMs: -1 })).toThrow(/non-negative/);
  });

  it("materializes validated inputs with stable session metadata", () => {
    const action = materializeAction("session_123", 7, { kind: "wait", durationMs: 250 });

    expect(action).toMatchObject({
      kind: "wait",
      sessionId: "session_123",
      sequence: 7,
      durationMs: 250
    });
    expect(action.id).toMatch(/^act_/);
    expect(new Date(action.createdAt).toString()).not.toBe("Invalid Date");
  });
});
