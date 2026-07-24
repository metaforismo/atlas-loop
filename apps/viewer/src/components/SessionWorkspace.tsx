import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { observedSessionNeedsAttention } from "../appCatalog.js";
import {
  filterAndSortSessionHistory,
  formatSessionDuration,
  isActiveHistorySession,
  sessionActivityWindow,
  sessionAppIdentity,
  sessionBundleId,
  sessionDurationMs,
  sessionInputBackend,
  sessionPlatform,
  sessionSimulatorLabel,
  sessionStatus,
  type SessionWorkspaceBackend,
  type SessionWorkspaceScope,
  type SessionWorkspaceSort
} from "../sessionCatalog.js";
import type { HealthState, SessionHistoryItem } from "../types.js";
import { formatDateTime, sessionUpdatedAt } from "../viewerPresentation.js";

interface SessionWorkspaceProps {
  sessions: SessionHistoryItem[];
  status: "loading" | "ready" | "error";
  error?: string;
  health: HealthState;
  onOpenSession: (sessionId: string) => void;
  onStartSession: (bundleId?: string) => void;
  onOpenAtlas: () => void;
  onOpenRuntimeSettings: () => void;
}

const PAGE_SIZE = 12;
const SCOPES: Array<{ id: SessionWorkspaceScope; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Live" },
  { id: "attention", label: "Needs attention" },
  { id: "complete", label: "Complete" }
];
const BACKENDS: Array<{ id: SessionWorkspaceBackend; label: string }> = [
  { id: "all", label: "All input" },
  { id: "xcuitest", label: "XCUITest" },
  { id: "cgevent", label: "Core Graphics" },
  { id: "unknown", label: "Unrecorded" }
];

export function SessionWorkspace({
  sessions,
  status,
  error,
  health,
  onOpenSession,
  onStartSession,
  onOpenAtlas,
  onOpenRuntimeSettings
}: SessionWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SessionWorkspaceScope>("all");
  const [backend, setBackend] = useState<SessionWorkspaceBackend>("all");
  const [sort, setSort] = useState<SessionWorkspaceSort>("recent");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string>();
  const deferredQuery = useDeferredValue(query);
  const filteredSessions = useMemo(
    () => filterAndSortSessionHistory(sessions, deferredQuery, scope, backend, sort),
    [sessions, deferredQuery, scope, backend, sort]
  );
  const visibleSessions = filteredSessions.slice(0, visibleCount);
  const liveSessions = useMemo(() => sessions.filter(isActiveHistorySession), [sessions]);
  const attentionSessions = useMemo(() => sessions.filter(observedSessionNeedsAttention), [sessions]);
  const evidenceCount = sessions.reduce((total, session) => total + (session.artifacts?.total ?? 0), 0);
  const totalDuration = sessions.reduce((total, session) => total + (sessionDurationMs(session) ?? 0), 0);
  const selectedSession = filteredSessions.find((session) => session.id === selectedId)
    ?? filteredSessions[0]
    ?? sessions[0];
  const activity = sessionActivityWindow(sessions);
  const hasFilters = query.trim().length > 0 || scope !== "all" || backend !== "all" || sort !== "recent";

  useEffect(() => {
    if (selectedSession && selectedSession.id !== selectedId) setSelectedId(selectedSession.id);
  }, [selectedId, selectedSession]);

  const resetFilters = (): void => {
    setQuery("");
    setScope("all");
    setBackend("all");
    setSort("recent");
    setVisibleCount(PAGE_SIZE);
  };

  return (
    <section id="session-workspace" className="session-workspace" aria-labelledby="session-workspace-title" tabIndex={-1}>
      <header className="session-workspace-header">
        <div>
          <p className="kicker">Local device activity</p>
          <h1 id="session-workspace-title">Sessions</h1>
          <p>See every local run, its input path, evidence health, and next action without losing the live Simulator context.</p>
        </div>
        <div className="session-workspace-header-actions">
          <button type="button" className="session-secondary-action" onClick={onOpenAtlas}>Explore Atlas</button>
          <button type="button" className="session-primary-action" onClick={() => onStartSession()}>Start session</button>
        </div>
      </header>

      <div className="session-workspace-metrics" aria-label="Session metrics">
        <SessionMetric label="Local sessions" value={status === "ready" ? String(sessions.length) : "--"} detail={`${activity.sevenDays} observed in the last 7 days`} />
        <SessionMetric label="Live now" value={status === "ready" ? String(liveSessions.length) : "--"} detail={health === "online" ? "Daemon connected" : "Daemon unavailable"} tone={liveSessions.length > 0 ? "good" : undefined} />
        <SessionMetric label="Evidence items" value={status === "ready" ? String(evidenceCount) : "--"} detail={`${formatSessionDuration(totalDuration)} recorded runtime`} />
        <SessionMetric label="Needs attention" value={status === "ready" ? String(attentionSessions.length) : "--"} detail={attentionSessions.length ? "Failed, blocked, or warning runs" : "No flagged runs"} tone={attentionSessions.length ? "bad" : "good"} />
      </div>

      {status === "ready" ? (
        <section className="session-live-strip" aria-labelledby="session-live-title">
          <div className="session-section-heading">
            <div><p className="kicker">Live</p><h2 id="session-live-title">Active local runs</h2></div>
            <span>{liveSessions.length} active · {activity.today} updated today</span>
          </div>
          {liveSessions.length ? (
            <div className="session-live-list">
              {liveSessions.slice(0, 3).map((session) => (
                <button type="button" key={session.id} onClick={() => onOpenSession(session.id)}>
                  <span className="session-live-pulse" aria-hidden="true" />
                  <span><strong>{sessionAppIdentity(session)}</strong><small>{session.id}</small></span>
                  <em>{sessionStatus(session)}</em>
                  <b>{session.artifacts?.total ?? 0} evidence →</b>
                </button>
              ))}
            </div>
          ) : (
            <div className="session-live-empty"><span>No active sessions right now.</span><button type="button" onClick={() => onStartSession()}>Start a local run</button></div>
          )}
        </section>
      ) : null}

      <div className="session-workspace-controls" aria-label="Filter session history">
        <label className="session-workspace-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(PAGE_SIZE); }} placeholder="Search session, app, Simulator, or failure…" aria-label="Search all sessions" />
        </label>
        <div className="session-workspace-scopes" role="group" aria-label="Session status scope">
          {SCOPES.map((candidate) => <button key={candidate.id} type="button" aria-pressed={scope === candidate.id} onClick={() => { setScope(candidate.id); setVisibleCount(PAGE_SIZE); }}>{candidate.label}</button>)}
        </div>
        <label className="session-workspace-backend">
          <span>Input</span>
          <select value={backend} onChange={(event) => { setBackend(event.target.value as SessionWorkspaceBackend); setVisibleCount(PAGE_SIZE); }} aria-label="Filter sessions by input backend">
            {BACKENDS.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
          </select>
        </label>
        <label className="session-workspace-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SessionWorkspaceSort)} aria-label="Sort sessions">
            <option value="recent">Most recent</option>
            <option value="oldest">Oldest first</option>
            <option value="evidence">Most evidence</option>
            <option value="duration">Longest runtime</option>
          </select>
        </label>
      </div>

      <div className="session-workspace-result-bar">
        <span>{status === "ready" ? `${filteredSessions.length} of ${sessions.length} sessions` : status === "loading" ? "Loading session history" : "Session history unavailable"}</span>
        {hasFilters && filteredSessions.length ? <button type="button" onClick={resetFilters}>Clear filters</button> : <small>All data stays on this machine</small>}
      </div>

      {status === "loading" ? (
        <div className="session-workspace-loading" aria-label="Loading session history"><span /><span /><span /><span /></div>
      ) : status === "error" ? (
        <SessionEmptyState title="Could not load session history" detail={error || "The local history endpoint did not respond."} action="Open runtime settings" onAction={onOpenRuntimeSettings} />
      ) : sessions.length === 0 ? (
        <SessionEmptyState title="No sessions yet" detail="Create the first local run to populate live activity, evidence totals, and runtime history." action="Start first session" onAction={() => onStartSession()} />
      ) : filteredSessions.length === 0 ? (
        <SessionEmptyState title="No sessions match these filters" detail="The underlying local history is unchanged. Clear the current query, status, or input filter." action="Clear filters" onAction={resetFilters} />
      ) : (
        <div className="session-workspace-grid">
          <section className="session-history-table" aria-labelledby="session-history-title">
            <div className="session-history-table-header" role="row">
              <span role="columnheader">Session</span><span role="columnheader">Status</span><span role="columnheader">Input</span><span role="columnheader">Evidence</span><span role="columnheader">Updated</span><span role="columnheader" />
            </div>
            <div role="rowgroup">
              {visibleSessions.map((session) => {
                const attention = observedSessionNeedsAttention(session);
                return (
                  <button type="button" role="row" key={session.id} className={selectedSession?.id === session.id ? "selected" : ""} aria-selected={selectedSession?.id === session.id} onClick={() => setSelectedId(session.id)}>
                    <span role="cell" className="session-history-identity"><strong>{sessionAppIdentity(session)}</strong><small>{session.id}</small></span>
                    <span role="cell"><em className={attention ? "bad" : isActiveHistorySession(session) ? "good" : "neutral"}>{attention ? "attention" : sessionStatus(session)}</em></span>
                    <span role="cell" className="session-history-backend">{sessionInputBackend(session)}</span>
                    <span role="cell" className="session-history-evidence"><b>{session.artifacts?.total ?? 0}</b><small>{session.hasScreenshot ? "screenshot" : "no screenshot"}</small></span>
                    <time role="cell">{formatDateTime(sessionUpdatedAt(session) ?? sessionUpdatedAt(session.session))}</time>
                    <span role="cell" aria-hidden="true">→</span>
                  </button>
                );
              })}
            </div>
            {visibleCount < filteredSessions.length ? <button type="button" className="session-history-more" onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, filteredSessions.length - visibleCount)} more</button> : null}
          </section>

          {selectedSession ? (
            <aside className="session-workspace-detail" aria-label={`${selectedSession.id} details`}>
              <header>
                <div><p className="kicker">Selected run</p><h2>{sessionAppIdentity(selectedSession)}</h2><span>{selectedSession.id}</span></div>
                <em className={observedSessionNeedsAttention(selectedSession) ? "bad" : isActiveHistorySession(selectedSession) ? "good" : "neutral"}>{sessionStatus(selectedSession)}</em>
              </header>
              <div className="session-detail-metrics">
                <span><small>DURATION</small><strong>{formatSessionDuration(sessionDurationMs(selectedSession))}</strong></span>
                <span><small>ARTIFACTS</small><strong>{selectedSession.artifacts?.total ?? 0}</strong></span>
                <span><small>EVENTS</small><strong>{selectedSession.events?.total ?? 0}</strong></span>
              </div>
              <div className="session-detail-context">
                <p><span>Input backend</span><strong>{sessionInputBackend(selectedSession)}</strong></p>
                <p><span>Platform</span><strong>{sessionPlatform(selectedSession)}</strong></p>
                <p><span>Simulator</span><strong>{sessionSimulatorLabel(selectedSession)}</strong></p>
                <p><span>Evidence source</span><strong>{selectedSession.storage?.source ?? "unknown"}</strong></p>
                <p><span>Updated</span><strong>{formatDateTime(sessionUpdatedAt(selectedSession) ?? sessionUpdatedAt(selectedSession.session))}</strong></p>
              </div>
              {observedSessionNeedsAttention(selectedSession) ? (
                <div className="session-detail-alert"><small>Needs attention</small><strong>{sessionFailureDetail(selectedSession)}</strong></div>
              ) : null}
              <div className="session-detail-actions">
                <button type="button" onClick={() => onOpenSession(selectedSession.id)}>Open evidence</button>
                <button type="button" disabled={!sessionBundleId(selectedSession)} title={sessionBundleId(selectedSession) ? "Prefill a new session with this app" : "No bundle ID was captured for this run"} onClick={() => onStartSession(sessionBundleId(selectedSession))}>Repeat with app</button>
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}

function SessionMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "bad" }) {
  return <div className={`session-workspace-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function SessionEmptyState({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <div className="session-workspace-empty"><span aria-hidden="true">▯</span><strong>{title}</strong><p>{detail}</p><button type="button" onClick={onAction}>{action}</button></div>;
}

function sessionFailureDetail(session: SessionHistoryItem): string {
  return session.events?.latestAction?.error?.message
    ?? session.events?.latestError?.message
    ?? session.error?.message
    ?? session.session?.error?.message
    ?? session.blockingReasons?.[0]
    ?? `${session.storage?.warningCount ?? session.storage?.warnings?.length ?? 0} evidence warning(s)`;
}
