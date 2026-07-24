import { describe, expect, it } from "vitest";
import {
  LOCAL_TEST_MODULE_STARTERS,
  appendLocalTestModuleScript,
  localTestModuleUsesMultiTouch,
  type LocalTestModule
} from "../../apps/viewer/src/localTestModules.js";
import {
  LOCAL_TEST_MODULE_STORAGE_KEY,
  deleteLocalTestModule,
  loadSavedLocalTestModules,
  saveLocalTestModule
} from "../../apps/viewer/src/localTestModuleStorage.js";
import { compileLocalTestScript } from "../../apps/viewer/src/localTests.js";

describe("local test modules", () => {
  it("ships valid readable starters including a native multi-touch block", () => {
    expect(LOCAL_TEST_MODULE_STARTERS).toHaveLength(3);
    for (const module of LOCAL_TEST_MODULE_STARTERS) {
      expect(compileLocalTestScript(module.script).errors).toEqual([]);
      expect(module.steps.length).toBeGreaterThan(0);
    }
    expect(localTestModuleUsesMultiTouch(LOCAL_TEST_MODULE_STARTERS[2]!)).toBe(true);
  });

  it("inserts visible source instead of an opaque module reference", () => {
    const script = appendLocalTestModuleScript("Tap \"cart\"", LOCAL_TEST_MODULE_STARTERS[1]!);

    expect(script).toContain("# Module: Settle and capture");
    expect(script).toContain("Wait 500ms");
    expect(script).not.toContain("moduleRef");
    expect(compileLocalTestScript(script).errors).toEqual([]);
  });

  it("recompiles readable source at every storage boundary", () => {
    const storage = memoryStorage();
    const safe = moduleDefinition("safe", "Tap \"safe-target\"");
    safe.steps = [{ label: "Injected", action: { kind: "tapElement", identifier: "unsafe-target" } }];

    saveLocalTestModule(safe, storage);
    expect(loadSavedLocalTestModules(storage)[0]?.steps[0]?.action).toEqual({ kind: "tapElement", identifier: "safe-target" });

    saveLocalTestModule({ ...moduleDefinition("safe", "Capture \"updated\""), label: "Updated" }, storage);
    saveLocalTestModule(moduleDefinition("second", "Swipe up"), storage);
    expect(loadSavedLocalTestModules(storage).map((module) => module.id)).toEqual(["second", "safe"]);
    expect(loadSavedLocalTestModules(storage).find((module) => module.id === "safe")?.label).toBe("Updated");
    expect(deleteLocalTestModule("safe", storage).map((module) => module.id)).toEqual(["second"]);
  });

  it("rejects corrupt JSON and invalid hidden-action records", () => {
    const storage = memoryStorage();
    storage.setItem(LOCAL_TEST_MODULE_STORAGE_KEY, "{not json");
    expect(loadSavedLocalTestModules(storage)).toEqual([]);

    storage.setItem(LOCAL_TEST_MODULE_STORAGE_KEY, JSON.stringify([{
      ...moduleDefinition("bad", "Teleport home"),
      steps: [{ label: "Hidden", action: { kind: "tap", x: "0.5", y: "0.5" } }]
    }]));
    expect(loadSavedLocalTestModules(storage)).toEqual([]);
  });
});

function moduleDefinition(id: string, script: string): LocalTestModule {
  return {
    id,
    label: `Module ${id}`,
    detail: "Reusable local step block",
    tags: ["smoke"],
    script,
    steps: compileLocalTestScript(script).steps
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
