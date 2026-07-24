import { describe, expect, it } from "vitest";
import {
  createGestureSequenceId,
  GESTURE_SEQUENCE_STORAGE_KEY,
  loadSavedGestureSequences,
  saveGestureSequence
} from "../../apps/viewer/src/gestureSequenceStorage.js";

describe("gesture sequence storage", () => {
  it("drops malformed actions before they can reach workflow execution", () => {
    const storage = memoryStorage();
    storage.setItem(GESTURE_SEQUENCE_STORAGE_KEY, JSON.stringify([
      { id: "valid", label: "Valid", detail: "Safe", steps: [{ label: "Wait", action: { kind: "wait", durationMs: "250" } }] },
      { id: "bad-duration", label: "Bad duration", detail: "Unsafe", steps: [{ label: "Wait", action: { kind: "wait", durationMs: "soon" } }] },
      { id: "bad-point", label: "Bad point", detail: "Unsafe", steps: [{ label: "Tap", action: { kind: "tap", x: "2", y: "0.5" } }] },
      { id: "bad-identifier", label: "Bad identifier", detail: "Unsafe", steps: [{ label: "Tap element", action: { kind: "tapElement", identifier: "" } }] }
    ]));

    expect(loadSavedGestureSequences(storage)).toEqual([
      { id: "valid", label: "Valid", detail: "Safe", steps: [{ label: "Wait", action: { kind: "wait", durationMs: "250" } }] }
    ]);
  });

  it("creates unique IDs and preserves the newest 24 valid workflows", () => {
    const storage = memoryStorage();
    const ids = new Set<string>();
    for (let index = 0; index < 27; index += 1) {
      const id = createGestureSequenceId(ids);
      expect(ids.has(id)).toBe(false);
      ids.add(id);
      saveGestureSequence({
        id,
        label: `Flow ${index}`,
        detail: "Valid saved flow",
        steps: [{ label: "Wait", action: { kind: "wait", durationMs: "1" } }]
      }, storage);
    }

    const saved = loadSavedGestureSequences(storage);
    expect(saved).toHaveLength(24);
    expect(saved[0]?.label).toBe("Flow 26");
    expect(saved.at(-1)?.label).toBe("Flow 3");
  });

  it("refuses to persist invalid or oversized workflows", () => {
    const storage = memoryStorage();
    expect(() => saveGestureSequence({
      id: "bad",
      label: "Invalid",
      detail: "Missing target",
      steps: [{ label: "Tap", action: { kind: "tapElement", identifier: "" } }]
    }, storage)).toThrow("invalid or unsupported");
    expect(() => saveGestureSequence({
      id: "oversized",
      label: "Too many actions",
      detail: "Bounded for a responsive local UI",
      steps: Array.from({ length: 51 }, (_, index) => ({ label: `Wait ${index}`, action: { kind: "wait" as const, durationMs: "1" } }))
    }, storage)).toThrow("invalid or unsupported");
    expect(storage.getItem(GESTURE_SEQUENCE_STORAGE_KEY)).toBeNull();
  });
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); }
  };
}
