import type { AppRef, SessionHistoryItem, SessionStatus } from "./types.js";
import { sessionUpdatedAt } from "./viewerPresentation.js";

export interface ObservedApp {
  id: string;
  name: string;
  identity: string;
  bundleId?: string;
  scheme?: string;
  appPath?: string;
  sessions: SessionHistoryItem[];
  latestSession: SessionHistoryItem;
  runCount: number;
  artifactCount: number;
  activeRunCount: number;
  attentionRunCount: number;
  simulators: string[];
  pinIds: string[];
  pinned: boolean;
}

const ACTIVE_STATUSES = new Set<SessionStatus>([
  "created",
  "booting",
  "booted",
  "building",
  "installing",
  "installed",
  "launching",
  "running"
]);

export function deriveObservedApps(
  sessions: SessionHistoryItem[],
  pinnedIds: ReadonlySet<string> = new Set()
): ObservedApp[] {
  const groups = new Map<string, { app: AppRef; sessions: SessionHistoryItem[]; identityIds: Set<string> }>();
  const identifiedSessions = sessions
    .map((session) => {
      const app = session.app ?? session.session?.app;
      return { session, app, identity: observedAppIdentity(app) };
    })
    .filter((entry): entry is { session: SessionHistoryItem; app: AppRef; identity: NonNullable<ReturnType<typeof observedAppIdentity>> } =>
      Boolean(entry.app && entry.identity)
    );
  const bundleIdentityByName = uniqueBundleIdentityByName(identifiedSessions);

  for (const { session, app, identity } of identifiedSessions) {
    const bundleAlias = app.bundleId ? undefined : bundleIdentityByName.get(identity.name.toLowerCase());
    const groupId = bundleAlias || identity.id;
    const current = groups.get(groupId);
    if (current) {
      current.sessions.push(session);
      current.identityIds.add(identity.id);
      if (app.bundleId && !current.app.bundleId) current.app = app;
    } else {
      const bundleEntry = bundleAlias
        ? identifiedSessions.find((entry) => entry.identity.id === bundleAlias)
        : undefined;
      groups.set(groupId, { app: bundleEntry?.app ?? app, sessions: [session], identityIds: new Set([identity.id, groupId]) });
    }
  }

  return [...groups.entries()]
    .map(([id, group]) => {
      const sortedSessions = [...group.sessions].sort(compareSessionsByRecency);
      const latestSession = sortedSessions[0]!;
      const identity = observedAppIdentity(group.app)!;
      return {
        id,
        name: identity.name,
        identity: identity.label,
        bundleId: normalizedValue(group.app.bundleId),
        scheme: normalizedValue(group.app.scheme),
        appPath: normalizedValue(group.app.appPath),
        sessions: sortedSessions,
        latestSession,
        runCount: sortedSessions.length,
        artifactCount: sortedSessions.reduce((total, session) => total + Math.max(0, session.artifacts?.total ?? 0), 0),
        activeRunCount: sortedSessions.filter((session) => isActiveObservedSession(session.status ?? session.session?.status)).length,
        attentionRunCount: sortedSessions.filter(observedSessionNeedsAttention).length,
        simulators: [...new Set(sortedSessions
          .map((session) => session.simulator?.name ?? session.session?.simulator?.name)
          .filter((value): value is string => Boolean(value)))],
        pinIds: [...group.identityIds],
        pinned: [...group.identityIds].some((identityId) => pinnedIds.has(identityId))
      };
    })
    .sort((a, b) => compareObservedApps(a, b, "recent"));
}

function uniqueBundleIdentityByName(
  entries: Array<{ app: AppRef; identity: NonNullable<ReturnType<typeof observedAppIdentity>> }>
): Map<string, string | undefined> {
  const result = new Map<string, string | undefined>();
  for (const entry of entries) {
    if (!entry.app.bundleId) continue;
    const name = entry.identity.name.toLowerCase();
    const existing = result.get(name);
    if (existing && existing !== entry.identity.id) result.set(name, undefined);
    else if (!result.has(name)) result.set(name, entry.identity.id);
  }
  return result;
}

export type ObservedAppScope = "all" | "active" | "attention" | "pinned";
export type ObservedAppSort = "recent" | "runs" | "evidence" | "name";

export function filterAndSortObservedApps(
  apps: ObservedApp[],
  query: string,
  scope: ObservedAppScope,
  sort: ObservedAppSort
): ObservedApp[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return apps
    .filter((app) => {
      if (scope === "active" && app.activeRunCount === 0) return false;
      if (scope === "attention" && app.attentionRunCount === 0) return false;
      if (scope === "pinned" && !app.pinned) return false;
      if (terms.length === 0) return true;
      const haystack = [
        app.name,
        app.identity,
        app.bundleId,
        app.scheme,
        app.appPath,
        ...app.simulators,
        ...app.sessions.map((session) => session.id ?? session.sessionId)
      ].filter(Boolean).join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => compareObservedApps(a, b, sort));
}

export function isActiveObservedSession(status: SessionStatus | undefined): boolean {
  return status ? ACTIVE_STATUSES.has(status) : false;
}

export function observedSessionNeedsAttention(session: SessionHistoryItem): boolean {
  const status = session.status ?? session.session?.status;
  return status === "failed"
    || Boolean(session.error ?? session.session?.error)
    || session.events?.latestAction?.ok === false
    || Boolean(session.events?.latestError)
    || Boolean(session.blockingReasons?.length)
    || (session.storage?.warningCount ?? session.storage?.warnings?.length ?? 0) > 0;
}

function observedAppIdentity(app: AppRef | undefined): { id: string; name: string; label: string } | undefined {
  if (!app) return undefined;
  const bundleId = normalizedValue(app.bundleId);
  if (bundleId) return { id: `bundle:${bundleId}`, name: displayName(bundleId), label: bundleId };
  const scheme = normalizedValue(app.scheme);
  if (scheme) return { id: `scheme:${scheme}`, name: displayName(scheme), label: `Scheme · ${scheme}` };
  const appPath = normalizedValue(app.appPath);
  if (appPath) {
    const leaf = appPath.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.app$/i, "") || appPath;
    return { id: `path:${appPath}`, name: displayName(leaf), label: appPath };
  }
  return undefined;
}

function displayName(value: string): string {
  const lastSegment = value.split(".").filter(Boolean).pop() ?? value;
  return lastSegment
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function compareObservedApps(a: ObservedApp, b: ObservedApp, sort: ObservedAppSort): number {
  if (sort === "name") return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  if (sort === "runs") return b.runCount - a.runCount || compareObservedApps(a, b, "recent");
  if (sort === "evidence") return b.artifactCount - a.artifactCount || compareObservedApps(a, b, "recent");
  const byTime = sessionTime(b.latestSession) - sessionTime(a.latestSession);
  return byTime || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function compareSessionsByRecency(a: SessionHistoryItem, b: SessionHistoryItem): number {
  return sessionTime(b) - sessionTime(a) || a.id.localeCompare(b.id);
}

function sessionTime(session: SessionHistoryItem): number {
  const value = sessionUpdatedAt(session) ?? sessionUpdatedAt(session.session);
  const parsed = value ? Date.parse(value) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

function normalizedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
