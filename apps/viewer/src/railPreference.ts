/**
 * Whether the workspace rail is collapsed to an icon strip.
 *
 * The preference is a browser convenience, not evidence, so an unreadable or
 * blocked store simply falls back to the expanded rail instead of failing.
 */

export const RAIL_COLLAPSED_STORAGE_KEY = "atlas-loop.rail-collapsed.v1";

export function loadRailCollapsed(storage: Storage = window.localStorage): boolean {
  try {
    return storage.getItem(RAIL_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveRailCollapsed(collapsed: boolean, storage: Storage = window.localStorage): boolean {
  try {
    storage.setItem(RAIL_COLLAPSED_STORAGE_KEY, collapsed ? "true" : "false");
  } catch {
    // A full or blocked store must not break navigation.
  }
  return collapsed;
}
