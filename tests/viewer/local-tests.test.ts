import { describe, expect, it } from "vitest";
import {
  MAX_LOCAL_TEST_SCRIPT_LENGTH,
  MAX_LOCAL_TEST_STEPS,
  compileLocalTestScript,
  localTestUsesMultiTouch,
  type LocalTestDefinition,
  type LocalTestRunRecord
} from "../../apps/viewer/src/localTests.js";
import {
  LOCAL_TEST_RUN_STORAGE_KEY,
  LOCAL_TEST_STORAGE_KEY,
  deleteLocalTest,
  loadLocalTestRuns,
  loadSavedLocalTests,
  saveLocalTest,
  saveLocalTestRun
} from "../../apps/viewer/src/localTestStorage.js";

describe("local test compiler", () => {
  it("compiles every supported readable command into exact viewer actions", () => {
    const result = compileLocalTestScript(`# checkout regression
Tap "cart.continue"
Tap at 25% 80%
Type "Avery"
Swipe left
Wait 1.5s
Back
Long press at 40% 60% for 900ms
Pinch close on "canvas"
Rotate counterclockwise on "canvas"
Two-finger tap "canvas"
Assert "confirmation" is visible
Screenshot "complete"`);

    expect(result.errors).toEqual([]);
    expect(result.steps.map((step) => step.action)).toEqual([
      { kind: "tapElement", identifier: "cart.continue" },
      { kind: "tap", x: "0.25", y: "0.8" },
      { kind: "typeText", text: "Avery" },
      { kind: "swipe", from: { x: "0.82", y: "0.5" }, to: { x: "0.18", y: "0.5" }, durationMs: "320" },
      { kind: "wait", durationMs: "1500" },
      { kind: "edgeGesture", edge: "left", distance: "0.55", durationMs: "320" },
      { kind: "longPress", x: "0.4", y: "0.6", durationMs: "900" },
      { kind: "pinch", scale: "0.55", velocity: "-1", identifier: "canvas" },
      { kind: "rotate", rotation: "-1.57", velocity: "-1", identifier: "canvas" },
      { kind: "twoFingerTap", identifier: "canvas" },
      { kind: "assertVisible", identifier: "confirmation" },
      { kind: "screenshot", reason: "complete" }
    ]);
    expect(localTestUsesMultiTouch({ steps: result.steps })).toBe(true);
  });

  it("reports every invalid source line and enforces safe bounds", () => {
    const result = compileLocalTestScript(`Tap at 101% 20%
Wait 121s
Long press center for 20ms
Teleport home`);

    expect(result.steps).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ line: 1, source: "Tap at 101% 20%", message: expect.stringContaining("between 0% and 100%") }),
      expect.objectContaining({ line: 2, message: expect.stringContaining("between 0ms and 120s") }),
      expect.objectContaining({ line: 3, message: expect.stringContaining("between 100ms and 10s") }),
      expect.objectContaining({ line: 4, message: expect.stringContaining("Unsupported command") })
    ]);
    expect(compileLocalTestScript("\n# comment only").errors[0]).toEqual(expect.objectContaining({ line: 1, message: expect.stringContaining("at least one") }));
  });

  it("bounds source size and compiled work before a local run can start", () => {
    const oversized = compileLocalTestScript("Capture\n".repeat(Math.ceil(MAX_LOCAL_TEST_SCRIPT_LENGTH / 8) + 1));
    expect(oversized.steps).toEqual([]);
    expect(oversized.errors[0]).toEqual(expect.objectContaining({ message: expect.stringContaining("20,000 characters") }));

    const tooManySteps = compileLocalTestScript(Array.from({ length: MAX_LOCAL_TEST_STEPS + 2 }, () => "Capture").join("\n"));
    expect(tooManySteps.steps).toHaveLength(MAX_LOCAL_TEST_STEPS);
    expect(tooManySteps.errors).toEqual([
      expect.objectContaining({ line: MAX_LOCAL_TEST_STEPS + 1, message: expect.stringContaining("at most 100") })
    ]);

    const oversizedCommand = compileLocalTestScript(`Tap "${"x".repeat(1_001)}"`);
    expect(oversizedCommand.steps).toEqual([]);
    expect(oversizedCommand.errors[0]).toEqual(expect.objectContaining({ message: expect.stringContaining("1,000 characters") }));
  });
});

describe("local test storage", () => {
  it("recompiles the readable script at the storage boundary", () => {
    const storage = memoryStorage();
    const test = definition("checkout", `Tap "safe-target"`);
    test.steps = [{ label: "Injected", action: { kind: "tapElement", identifier: "unsafe-target" } }];

    const saved = saveLocalTest(test, storage);
    expect(saved[0]?.steps).toEqual([{ label: "Tap safe-target", action: { kind: "tapElement", identifier: "safe-target" } }]);
    expect(loadSavedLocalTests(storage)[0]?.steps[0]?.action).toEqual({ kind: "tapElement", identifier: "safe-target" });
  });

  it("ignores corrupt definitions, replaces duplicate IDs, and deletes narrowly", () => {
    const storage = memoryStorage();
    storage.setItem(LOCAL_TEST_STORAGE_KEY, "{not json");
    expect(loadSavedLocalTests(storage)).toEqual([]);

    saveLocalTest(definition("one", "Swipe up"), storage);
    saveLocalTest({ ...definition("one", "Swipe down"), label: "Updated" }, storage);
    saveLocalTest(definition("two", "Capture"), storage);
    expect(loadSavedLocalTests(storage).map((test) => test.id)).toEqual(["two", "one"]);
    expect(loadSavedLocalTests(storage).find((test) => test.id === "one")?.label).toBe("Updated");
    expect(deleteLocalTest("one", storage).map((test) => test.id)).toEqual(["two"]);

    storage.setItem(LOCAL_TEST_STORAGE_KEY, JSON.stringify([{ ...definition("bad", "Teleport"), steps: [{ label: "Hidden", action: { kind: "tap", x: 0.5, y: 0.5 } }] }]));
    expect(loadSavedLocalTests(storage)).toEqual([]);
  });

  it("keeps only the latest result for each test and rejects corrupt run records", () => {
    const storage = memoryStorage();
    const first = runRecord("saved:one", "failed", "2026-07-24T10:00:00.000Z");
    const latest = runRecord("saved:one", "passed", "2026-07-24T10:01:00.000Z");
    saveLocalTestRun(first, storage);
    saveLocalTestRun(latest, storage);
    saveLocalTestRun(runRecord("saved:two", "cancelled", "2026-07-24T10:02:00.000Z"), storage);

    expect(loadLocalTestRuns(storage)).toHaveLength(2);
    expect(loadLocalTestRuns(storage).find((run) => run.testKey === "saved:one")?.status).toBe("passed");

    storage.setItem(LOCAL_TEST_RUN_STORAGE_KEY, JSON.stringify([{ status: "passed" }]));
    expect(loadLocalTestRuns(storage)).toEqual([]);
  });
});

function definition(id: string, script: string): LocalTestDefinition {
  const compiled = compileLocalTestScript(script);
  return {
    id,
    label: `Test ${id}`,
    detail: "Local test",
    platform: "ios-simulator",
    tags: ["smoke"],
    script,
    steps: compiled.steps
  };
}

function runRecord(testKey: string, status: LocalTestRunRecord["status"], ranAt: string): LocalTestRunRecord {
  return {
    testKey,
    status,
    sessionId: "sess_local",
    completedSteps: status === "passed" ? 1 : 0,
    totalSteps: 1,
    message: status,
    ranAt
  };
}

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
