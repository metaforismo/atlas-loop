import { observedSessionNeedsAttention } from "./appCatalog.js";
import type { InputBackendKind, SessionHistoryItem, SessionStatus } from "./types.js";
import { sessionUpdatedAt } from "./viewerPresentation.js";

export type SessionWorkspaceScope = "all" | "active" | "attention" | "complete";
export type SessionWorkspaceBackend = "all" | InputBackendKind | "unknown";
export type SessionWorkspaceSort = "recent" | "oldest" | "evidence" | "duration";

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

export function filterAndSortSessionHistory(
  sessions: SessionHistoryItem[],
  query: string,
  scope: SessionWorkspaceScope,
  backend: SessionWorkspaceBackend,
  sort: SessionWorkspaceSort
): SessionHistoryItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return sessions
    .filter((session) => {
      const active = isActiveHistorySession(session);
      const attention = observedSessionNeedsAttention(session);
      if (scope === "active" && !active) return false;
      if (scope === "attention" && !attention) return false;
      if (scope === "complete" && (active || attention)) return false;
      if (backend !== "all" && sessionInputBackend(session) !== backend) return false;
      if (terms.length === 0) return true;
      const haystack = [
        session.id,
        session.sessionId,
        sessionStatus(session),
        sessionInputBackend(session),
        sessionPlatform(session),
        sessionAppIdentity(session),
        sessionSimulatorLabel(session),
        session.error?.message,
        session.session?.error?.message,
        session.events?.latestAction?.error?.message,
        session.events?.latestError?.message,
        ...(session.blockingReasons ?? [])
      ].filter(Boolean).join(" ").toLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => compareSessions(a, b, sort));
}

export function isActiveHistorySession(session: SessionHistoryItem): boolean {
  return ACTIVE_STATUSES.has(sessionStatus(session));
}

export function sessionStatus(session: SessionHistoryItem): SessionStatus {
  return session.status ?? session.session?.status ?? "unknown";
}

export function sessionInputBackend(session: SessionHistoryItem): SessionWorkspaceBackend {
  const backend = session.inputBackend ?? session.session?.inputBackend;
  return backend === "xcuitest" || backend === "cgevent" ? backend : "unknown";
}

export function sessionPlatform(session: SessionHistoryItem): string {
  return session.platform ?? session.session?.platform ?? "unknown";
}

export function sessionAppIdentity(session: SessionHistoryItem): string {
  const app = session.app ?? session.session?.app;
  return app?.bundleId ?? app?.scheme ?? app?.appPath ?? "No app captured";
}

export function sessionBundleId(session: SessionHistoryItem): string | undefined {
  return (session.app ?? session.session?.app)?.bundleId?.trim() || undefined;
}

export function sessionSimulatorLabel(session: SessionHistoryItem): string {
  const simulator = session.simulator ?? session.session?.simulator;
  return simulator?.name ?? simulator?.udid ?? "No Simulator captured";
}

export function sessionDurationMs(session: SessionHistoryItem): number | undefined {
  const createdAt = session.createdAt ?? session.session?.createdAt;
  const updatedAt = sessionUpdatedAt(session) ?? sessionUpdatedAt(session.session);
  if (!createdAt || !updatedAt) return undefined;
  const start = Date.parse(createdAt);
  const end = Date.parse(updatedAt);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return undefined;
  return end - start;
}

export function formatSessionDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "--";
  if (durationMs < 1_000) return `${durationMs} ms`;
  const seconds = Math.round(durationMs / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

export function sessionActivityWindow(sessions: SessionHistoryItem[], now = Date.now()): { today: number; sevenDays: number } {
  const oneDay = 24 * 60 * 60 * 1_000;
  let today = 0;
  let sevenDays = 0;
  for (const session of sessions) {
    const timestamp = sessionTime(session);
    if (!timestamp || timestamp > now) continue;
    if (now - timestamp <= oneDay) today += 1;
    if (now - timestamp <= 7 * oneDay) sevenDays += 1;
  }
  return { today, sevenDays };
}

function compareSessions(a: SessionHistoryItem, b: SessionHistoryItem, sort: SessionWorkspaceSort): number {
  if (sort === "oldest") return sessionTime(a) - sessionTime(b) || a.id.localeCompare(b.id);
  if (sort === "evidence") return (b.artifacts?.total ?? 0) - (a.artifacts?.total ?? 0) || compareSessions(a, b, "recent");
  if (sort === "duration") return (sessionDurationMs(b) ?? -1) - (sessionDurationMs(a) ?? -1) || compareSessions(a, b, "recent");
  return sessionTime(b) - sessionTime(a) || a.id.localeCompare(b.id);
}

function sessionTime(session: SessionHistoryItem): number {
  const value = sessionUpdatedAt(session) ?? sessionUpdatedAt(session.session);
  const parsed = value ? Date.parse(value) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}
