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

  it("validates native long-press and multi-touch gesture parameters", () => {
    expect(() => validateActionInput({ kind: "longPress", x: 0.5, y: 0.6, durationMs: 800 })).not.toThrow();
    expect(() => validateActionInput({ kind: "pinch", scale: 1.8, velocity: 1, identifier: "map.canvas", timeoutMs: 4000 })).not.toThrow();
    expect(() => validateActionInput({ kind: "rotate", rotation: -1.57, velocity: -1 })).not.toThrow();
    expect(() => validateActionInput({ kind: "twoFingerTap" })).not.toThrow();

    expect(() => validateActionInput({ kind: "longPress", x: 1.1, y: 0.5, durationMs: 800 })).toThrow(/normalized coordinates/);
    expect(() => validateActionInput({ kind: "pinch", scale: 0, velocity: 1 })).toThrow(/greater than 0/);
    expect(() => validateActionInput({ kind: "pinch", scale: 1, velocity: 1 })).toThrow(/not equal to 1/);
    expect(() => validateActionInput({ kind: "pinch", scale: 0.5, velocity: 0 })).toThrow(/non-zero/);
    expect(() => validateActionInput({ kind: "pinch", scale: 1.2, velocity: 1, identifier: 42 as never })).toThrow(/identifier must be non-empty/);
    expect(() => validateActionInput({ kind: "rotate", rotation: 0, velocity: 1 })).toThrow(/non-zero radians/);
    expect(() => validateActionInput({ kind: "twoFingerTap", identifier: " " })).toThrow(/identifier must be non-empty/);
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
