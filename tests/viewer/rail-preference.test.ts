// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  RAIL_COLLAPSED_STORAGE_KEY,
  loadRailCollapsed,
  saveRailCollapsed
} from "../../apps/viewer/src/railPreference.js";

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value)
  };
}

function blockedStorage(): Storage {
  return {
    ...memoryStorage(),
    getItem: () => {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("blocked", "QuotaExceededError");
    }
  };
}

describe("rail collapse preference", () => {
  it("defaults to the expanded rail when nothing is stored", () => {
    expect(loadRailCollapsed(memoryStorage())).toBe(false);
  });

  it("round-trips the collapsed state", () => {
    const storage = memoryStorage();

    expect(saveRailCollapsed(true, storage)).toBe(true);
    expect(storage.getItem(RAIL_COLLAPSED_STORAGE_KEY)).toBe("true");
    expect(loadRailCollapsed(storage)).toBe(true);

    saveRailCollapsed(false, storage);
    expect(loadRailCollapsed(storage)).toBe(false);
  });

  it("treats any other stored value as expanded rather than trusting it", () => {
    // Edited site data must not put the rail into an undefined visual state.
    expect(loadRailCollapsed(memoryStorage({ [RAIL_COLLAPSED_STORAGE_KEY]: "yes" }))).toBe(false);
    expect(loadRailCollapsed(memoryStorage({ [RAIL_COLLAPSED_STORAGE_KEY]: "" }))).toBe(false);
  });

  it("keeps navigating when storage is unavailable", () => {
    const storage = blockedStorage();

    expect(loadRailCollapsed(storage)).toBe(false);
    expect(saveRailCollapsed(true, storage)).toBe(true);
  });
});
