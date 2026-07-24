export const PINNED_OBSERVED_APPS_STORAGE_KEY = "atlas-loop.pinned-observed-apps.v1";
const MAX_PINNED_APPS = 50;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function loadPinnedObservedAppIds(storage: StorageLike | undefined = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PINNED_OBSERVED_APPS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()))]
      .slice(0, MAX_PINNED_APPS);
  } catch {
    return [];
  }
}

export function savePinnedObservedAppIds(ids: Iterable<string>, storage: StorageLike | undefined = browserStorage()): string[] {
  if (!storage) throw new Error("Browser storage is unavailable.");
  const normalized = [...new Set([...ids].map((id) => id.trim()).filter(Boolean))].slice(0, MAX_PINNED_APPS);
  storage.setItem(PINNED_OBSERVED_APPS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

function browserStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
