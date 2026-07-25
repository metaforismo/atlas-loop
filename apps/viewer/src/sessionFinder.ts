// The viewer's own shape: every field past the id is optional, because a
// daemon that only listed a session reports far less than one that read it.
import type { SessionHistoryItem } from "./types.js";

/**
 * Narrowing the session list.
 *
 * The rail renders every saved session as a row. At seventy-odd sessions that
 * is around eight thousand pixels of content inside a three hundred pixel box —
 * twenty-eight screens of scrolling to find one run, with nothing to search by.
 * A list that long is not a list, it is an archive, and an archive needs a way
 * in.
 */

export type SessionFinderScope = "all" | "active" | "problems";

/** Statuses that mean the run is still going. */
const ACTIVE_STATUSES = new Set(["created", "installing", "installed", "launching", "running"]);

export function isActiveSession(item: SessionHistoryItem): boolean {
  return ACTIVE_STATUSES.has(item.status ?? "");
}

/**
 * Whether a run is worth attention: it failed, it recorded an error, or the
 * daemon flagged its stored evidence.
 */
export function hasProblem(item: SessionHistoryItem): boolean {
  if (item.status === "failed") return true;
  if (item.events?.latestError) return true;
  return (item.storage?.warningCount ?? 0) > 0;
}

/** Everything an operator would reasonably type to find a run. */
export function matchesQuery(item: SessionHistoryItem, query: string | undefined): boolean {
  const needle = query?.trim().toLowerCase();
  return !needle || haystack(item).includes(needle);
}

function haystack(item: SessionHistoryItem): string {
  const app = item.session?.app;
  return [
    item.id,
    item.sessionId,
    item.status,
    app?.bundleId,
    app?.scheme,
    item.app?.bundleId,
    item.app?.scheme,
    item.simulator?.name,
    item.session?.simulator?.name,
    item.session?.simulator?.runtime
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export interface SessionFinderResult {
  /** Rows to render now, newest first. */
  visible: SessionHistoryItem[];
  /** How many matched before the visible cap. */
  matched: number;
  /** Total sessions the daemon reported. */
  total: number;
  /** True when the cap is hiding matches. */
  truncated: boolean;
}

/**
 * Filters, sorts, and caps the list.
 *
 * The cap is deliberate: showing a handful and offering the rest is a list an
 * operator can read, where showing all of them is a scrollbar. Expanding is one
 * click, and the count says exactly what expanding would reveal.
 */
export function findSessions(
  sessions: readonly SessionHistoryItem[],
  options: { query?: string; scope?: SessionFinderScope; limit?: number; expanded?: boolean } = {}
): SessionFinderResult {
  const query = options.query?.trim().toLowerCase();
  const scope = options.scope ?? "all";

  const matched = sessions.filter((item) => {
    if (scope === "active" && !isActiveSession(item)) return false;
    if (scope === "problems" && !hasProblem(item)) return false;
    return matchesQuery(item, query);
  });

  // Newest first: the run you just made is the one you are looking for.
  const sorted = [...matched].sort((left, right) => updatedMs(right) - updatedMs(left));
  const limit = options.limit ?? 8;
  const visible = options.expanded ? sorted : sorted.slice(0, limit);

  return {
    visible,
    matched: sorted.length,
    total: sessions.length,
    truncated: !options.expanded && sorted.length > visible.length
  };
}

function updatedMs(item: SessionHistoryItem): number {
  const parsed = Date.parse(item.updatedAt ?? item.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * How many sessions each scope would show, for the filter chips.
 *
 * Counted against the current search, not the whole archive: a chip reading
 * "Problems 17" that lands on an empty list because a query is also active is
 * worse than no count at all.
 */
export function scopeCounts(
  sessions: readonly SessionHistoryItem[],
  query?: string
): Record<SessionFinderScope, number> {
  const searched = sessions.filter((item) => matchesQuery(item, query));
  return {
    all: searched.length,
    active: searched.filter(isActiveSession).length,
    problems: searched.filter(hasProblem).length
  };
}
