import { describe, expect, it } from "vitest";
import {
  compileLaunchProfileDraft,
  type LocalLaunchProfile,
  type LocalLaunchProfileDraft
} from "../../apps/viewer/src/localLaunchProfiles.js";
import {
  LOCAL_LAUNCH_PROFILE_STORAGE_KEY,
  deleteLaunchProfile,
  loadSavedLaunchProfiles,
  saveLaunchProfile
} from "../../apps/viewer/src/localLaunchProfileStorage.js";

describe("local launch profiles", () => {
  it("parses ordered arguments and environment values without shell interpretation", () => {
    const compiled = compileLaunchProfileDraft(draft({
      argumentsSource: "# comment\n--uitesting\n--atlas-demo-route=payment-review",
      environmentSource: "ATLAS_LOOP_DEMO_ROUTE=gesture-lab\nEMPTY="
    }));

    expect(compiled.errors).toEqual([]);
    expect(compiled.arguments).toEqual(["--uitesting", "--atlas-demo-route=payment-review"]);
    expect(compiled.environment).toEqual({ ATLAS_LOOP_DEMO_ROUTE: "gesture-lab", EMPTY: "" });
  });

  it("reports every actionable profile error and refuses browser-stored credentials", () => {
    const compiled = compileLaunchProfileDraft(draft({
      label: "",
      bundleId: "not a bundle",
      environmentSource: "BROKEN\nAPI_TOKEN=secret\n__proto__=pollute\nROUTE=one\nROUTE=two"
    }));

    expect(compiled.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      "Give this launch profile a name.",
      "Use a valid bundle ID such as app.example.YourApp.",
      "Use KEY=VALUE format.",
      "API_TOKEN looks sensitive. Pass secrets through your shell instead of browser storage.",
      "__proto__ is reserved and cannot be used as an environment key.",
      "ROUTE is defined more than once."
    ]));
    expect(compileLaunchProfileDraft(draft({ bundleId: "app..broken" })).errors).toContainEqual({
      field: "bundleId",
      message: "Use a valid bundle ID such as app.example.YourApp."
    });
  });

  it("revalidates storage, bounds saved profiles, and deletes only the requested id", () => {
    const storage = memoryStorage();
    storage.setItem(LOCAL_LAUNCH_PROFILE_STORAGE_KEY, JSON.stringify([
      profile("valid"),
      { ...profile("secret"), environment: { PASSWORD: "unsafe" } },
      { id: "broken" }
    ]));

    expect(loadSavedLaunchProfiles(storage).map((profile) => profile.id)).toEqual(["valid"]);
    saveLaunchProfile(profile("second"), storage);
    expect(loadSavedLaunchProfiles(storage).map((profile) => profile.id)).toEqual(["second", "valid"]);
    deleteLaunchProfile("second", storage);
    expect(loadSavedLaunchProfiles(storage).map((profile) => profile.id)).toEqual(["valid"]);

    for (let index = 0; index < 30; index += 1) saveLaunchProfile(profile(`bulk-${index}`), storage);
    const bounded = loadSavedLaunchProfiles(storage);
    expect(bounded).toHaveLength(24);
    expect(bounded[0]?.id).toBe("bulk-29");
    expect(bounded.at(-1)?.id).toBe("bulk-6");
  });
});

function draft(overrides: Partial<LocalLaunchProfileDraft> = {}): LocalLaunchProfileDraft {
  return {
    label: "Gesture Lab",
    detail: "Open the native gesture fixture.",
    bundleId: "app.atlasloop.CommerceDemo",
    argumentsSource: "",
    environmentSource: "",
    ...overrides
  };
}

function profile(id: string): LocalLaunchProfile {
  return {
    id,
    label: `Profile ${id}`,
    detail: "A valid deterministic launch profile.",
    bundleId: "app.atlasloop.CommerceDemo",
    arguments: [],
    environment: { ATLAS_LOOP_DEMO_ROUTE: "gesture-lab" }
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
