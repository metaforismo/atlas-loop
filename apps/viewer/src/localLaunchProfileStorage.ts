import {
  compileLaunchProfileDraft,
  launchProfileHasSensitiveEnvironmentKey,
  launchProfileToDraft,
  type LocalLaunchProfile
} from "./localLaunchProfiles.js";

export const LOCAL_LAUNCH_PROFILE_STORAGE_KEY = "atlas-loop.local-launch-profiles.v1";
export const MAX_SAVED_LAUNCH_PROFILES = 24;

export function loadSavedLaunchProfiles(storage: Storage = window.localStorage): LocalLaunchProfile[] {
  try {
    const value = JSON.parse(storage.getItem(LOCAL_LAUNCH_PROFILE_STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter(isLocalLaunchProfile).map(cloneProfile).slice(0, MAX_SAVED_LAUNCH_PROFILES) : [];
  } catch {
    return [];
  }
}

export function saveLaunchProfile(profile: LocalLaunchProfile, storage: Storage = window.localStorage): LocalLaunchProfile[] {
  if (!isLocalLaunchProfile(profile)) throw new Error("Launch profile must be valid before it can be saved.");
  const saved = loadSavedLaunchProfiles(storage);
  const next = [cloneProfile(profile), ...saved.filter((candidate) => candidate.id !== profile.id)].slice(0, MAX_SAVED_LAUNCH_PROFILES);
  storage.setItem(LOCAL_LAUNCH_PROFILE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteLaunchProfile(id: string, storage: Storage = window.localStorage): LocalLaunchProfile[] {
  const next = loadSavedLaunchProfiles(storage).filter((candidate) => candidate.id !== id);
  storage.setItem(LOCAL_LAUNCH_PROFILE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function isLocalLaunchProfile(value: unknown): value is LocalLaunchProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalLaunchProfile>;
  if (
    typeof candidate.id !== "string" || !candidate.id.trim() || candidate.id.length > 160 ||
    typeof candidate.label !== "string" ||
    typeof candidate.detail !== "string" ||
    typeof candidate.bundleId !== "string" ||
    !Array.isArray(candidate.arguments) || !candidate.arguments.every((argument) => typeof argument === "string") ||
    !candidate.environment || typeof candidate.environment !== "object" || Array.isArray(candidate.environment) ||
    !Object.entries(candidate.environment).every(([key, entry]) => typeof key === "string" && typeof entry === "string") ||
    (candidate.createdAt !== undefined && typeof candidate.createdAt !== "string") ||
    (candidate.updatedAt !== undefined && typeof candidate.updatedAt !== "string")
  ) return false;
  if (launchProfileHasSensitiveEnvironmentKey(candidate as LocalLaunchProfile)) return false;
  return compileLaunchProfileDraft(launchProfileToDraft(candidate as LocalLaunchProfile)).errors.length === 0;
}

function cloneProfile(profile: LocalLaunchProfile): LocalLaunchProfile {
  return { ...profile, arguments: [...profile.arguments], environment: { ...profile.environment } };
}
