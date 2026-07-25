import { useMemo, useState } from "react";
import type { HealthState, SessionHistoryItem } from "../types.js";
import { findSessions, scopeCounts, type SessionFinderScope } from "../sessionFinder.js";
import { formatDateTime, sessionRailSignals, sessionSignal, sessionTone, sessionUpdatedAt } from "../viewerPresentation.js";
import { EmptyState } from "./common.js";

const SCOPES: Array<{ id: SessionFinderScope; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Running" },
  { id: "problems", label: "Problems" }
];

/** How many rows fit the rail before it becomes a scrollbar. */
const VISIBLE_LIMIT = 8;

export function SessionBrowserContent({
  health,
  sessions,
  status,
  error,
  selectedSessionId,
  onSelect
}: {
  health: HealthState;
  sessions: SessionHistoryItem[];
  status: "loading" | "ready" | "error";
  error?: string;
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SessionFinderScope>("all");
  const [expanded, setExpanded] = useState(false);

  const counts = useMemo(() => scopeCounts(sessions, query), [sessions, query]);
  const found = useMemo(
    () => findSessions(sessions, { query, scope, limit: VISIBLE_LIMIT, expanded }),
    [sessions, query, scope, expanded]
  );

  if (health === "offline") {
    return <EmptyState title="Daemon offline" detail="Start the daemon or paste a reachable daemon URL to browse saved sessions." compact />;
  }

  if (status === "loading") {
    return <EmptyState title="Loading sessions" detail="The viewer is asking the daemon for live and saved sessions." compact />;
  }

  if (status === "error") {
    return <EmptyState title="Session list unavailable" detail={error ?? "The daemon did not return a readable session list."} compact />;
  }

  if (sessions.length === 0) {
    return <EmptyState title="No sessions found" detail="Start an atlas-loop run or keep latest selected until the daemon reports one." compact />;
  }

  return (
    <>
      {/* Below this the list is short enough to read; above it, it is an
          archive, and an archive needs a way in. */}
      {sessions.length > VISIBLE_LIMIT ? (
        <div className="session-finder">
          <label className="search-field compact">
            <span className="sr-only">Search sessions</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${sessions.length} sessions`}
            />
          </label>
          <div className="session-finder-scopes" role="group" aria-label="Filter sessions">
            {SCOPES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={scope === option.id}
                className={scope === option.id ? "selected" : ""}
                onClick={() => setScope(option.id)}
              >
                {option.label}
                <span>{counts[option.id]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {found.visible.length === 0 ? (
        <EmptyState
          title="No sessions match"
          detail={
            query.trim()
              ? `None of the ${found.total} saved sessions match "${query.trim()}" in this filter.`
              : `None of the ${found.total} saved sessions are in this filter.`
          }
          compact
        />
      ) : (
        <div role="list">
          {found.visible.map((listedSession) => (
            <SessionBrowserRow
              key={listedSession.id}
              session={listedSession}
              selected={listedSession.id === selectedSessionId}
              onSelect={() => onSelect(listedSession.id)}
            />
          ))}
        </div>
      )}

      {found.truncated || expanded ? (
        <button type="button" className="session-finder-more" onClick={() => setExpanded((current) => !current)}>
          {expanded ? `Show the newest ${VISIBLE_LIMIT}` : `Show all ${found.matched}`}
        </button>
      ) : null}
    </>
  );
}

function SessionBrowserRow({ session, selected, onSelect }: { session: SessionHistoryItem; selected: boolean; onSelect: () => void }) {
  const evidenceChips = sessionRailSignals(session);

  return (
    <div role="listitem">
      <button
        type="button"
        className={`session-row session-choice ${selected ? "selected" : ""} tone-${sessionTone(session.status)}`}
        aria-current={selected ? "true" : undefined}
        aria-label={`Session ${session.id}`}
        onClick={onSelect}
      >
        <div className="session-row-main">
          <strong>{session.id}</strong>
          <span>{sessionSignal(session)}</span>
          {evidenceChips.length > 0 ? (
            <span className="session-evidence-chips" aria-label={`Evidence for ${session.id}`}>
              {evidenceChips.map((chip) => (
                <span
                  key={chip.id}
                  className={`session-evidence-chip tone-${chip.tone}`}
                  title={chip.title}
                  aria-label={chip.ariaLabel}
                >
                  <span>{chip.label}</span>
                  {chip.value ? <strong>{chip.value}</strong> : null}
                </span>
              ))}
            </span>
          ) : null}
        </div>
        <span className="session-row-meta">
          <small>{session.status ?? "unknown"}</small>
          <time>{formatDateTime(sessionUpdatedAt(session))}</time>
        </span>
      </button>
    </div>
  );
}
