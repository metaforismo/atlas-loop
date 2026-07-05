import type { HealthState, SessionHistoryItem } from "../types.js";
import { formatDateTime, sessionEvidenceChips, sessionSignal, sessionTone, sessionUpdatedAt } from "../viewerPresentation.js";
import { EmptyState } from "./common.js";

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
    <div role="list">
      {sessions.map((listedSession) => (
        <SessionBrowserRow
          key={listedSession.id}
          session={listedSession}
          selected={listedSession.id === selectedSessionId}
          onSelect={() => onSelect(listedSession.id)}
        />
      ))}
    </div>
  );
}

function SessionBrowserRow({ session, selected, onSelect }: { session: SessionHistoryItem; selected: boolean; onSelect: () => void }) {
  const evidenceChips = sessionEvidenceChips(session);

  return (
    <div role="listitem">
      <button
        type="button"
        className={`session-row session-choice ${selected ? "selected" : ""} tone-${sessionTone(session.status)}`}
        aria-current={selected ? "true" : undefined}
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
                  <strong>{chip.value}</strong>
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
