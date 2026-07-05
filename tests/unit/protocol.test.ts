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

  it("validates element actions: identifier required, timeout non-negative", () => {
    expect(() => validateActionInput({ kind: "tapElement", identifier: "cart.continue" })).not.toThrow();
    expect(() => validateActionInput({ kind: "assertVisible", identifier: "confirmation", timeoutMs: 5000 })).not.toThrow();
    expect(() => validateActionInput({ kind: "tapElement", identifier: "" })).toThrow(/non-empty accessibility identifier/);
    expect(() => validateActionInput({ kind: "tapElement", identifier: "   " })).toThrow(/non-empty accessibility identifier/);
    expect(() => validateActionInput({ kind: "assertVisible", identifier: "confirmation", timeoutMs: -1 })).toThrow(/timeout must be non-negative/);
    expect(() => validateActionInput({ kind: "assertVisible", identifier: "confirmation", timeoutMs: Number.NaN })).toThrow(/timeout must be non-negative/);
  });

  it("materializes element actions with session metadata", () => {
    const action = materializeAction("session_123", 3, { kind: "tapElement", identifier: "product-detail.add-to-cart", timeoutMs: 4000 });

    expect(action).toMatchObject({
      kind: "tapElement",
      sessionId: "session_123",
      sequence: 3,
      identifier: "product-detail.add-to-cart",
      timeoutMs: 4000
    });
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
