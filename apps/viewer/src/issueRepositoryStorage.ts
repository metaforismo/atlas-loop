import { normalizeRepository } from "./issueExport.js";

/**
 * The GitHub repository issues are filed against. A browser-local convenience
 * so the field is not retyped every run; it is validated on read so edited site
 * data cannot put a broken slug into a link.
 */

export const ISSUE_REPOSITORY_STORAGE_KEY = "atlas-loop.issue-repository.v1";

export function loadIssueRepository(storage: Storage = window.localStorage): string {
  try {
    return normalizeRepository(storage.getItem(ISSUE_REPOSITORY_STORAGE_KEY) ?? undefined) ?? "";
  } catch {
    return "";
  }
}

export function saveIssueRepository(value: string, storage: Storage = window.localStorage): string {
  const normalized = normalizeRepository(value);
  try {
    if (normalized) storage.setItem(ISSUE_REPOSITORY_STORAGE_KEY, normalized);
    else storage.removeItem(ISSUE_REPOSITORY_STORAGE_KEY);
  } catch {
    // A blocked store must not stop the operator filing the issue.
  }
  return normalized ?? "";
}
