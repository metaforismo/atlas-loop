import { useDeferredValue, useMemo, useState } from "react";
import type {
  ArtifactHealth,
  ArtifactRef,
  HealthState,
  Session,
  SessionHistoryItem
} from "../types.js";
import { formatDateTime, sessionSignal, sessionTone, sessionUpdatedAt, type UiTone } from "../viewerPresentation.js";

export type OverviewDestination = "evidence" | "apps" | "workflows" | "actions" | "atlas" | "runtime" | "start";

interface WorkspaceOverviewProps {
  health: HealthState;
  session?: Session;
  sessions: SessionHistoryItem[];
  sessionListStatus: "loading" | "ready" | "error";
  artifacts: ArtifactRef[];
  eventCount: number;
  screenshotStatus: "idle" | "empty" | "loading" | "ready" | "stale" | "error";
  artifactHealth?: ArtifactHealth;
  artifactHealthStatus: "idle" | "offline" | "loading" | "ready" | "error";
  onStartSession: () => void;
  onOpen: (destination: OverviewDestination) => void;
  onSelectSession: (sessionId: string) => void;
}

interface ReadinessItem {
  label: string;
  detail: string;
  tone: UiTone;
}

type SessionScope = "all" | "active" | "attention" | "complete";
type SessionSort = "recent" | "evidence" | "status";

const SESSION_PAGE_SIZE = 8;
const SESSION_SCOPES: Array<{ id: SessionScope; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "attention", label: "Needs attention" },
  { id: "complete", label: "Complete" }
];

export function WorkspaceOverview({
  health,
  session,
  sessions,
  sessionListStatus,
  artifacts,
  eventCount,
  screenshotStatus,
  artifactHealth,
  artifactHealthStatus,
  onStartSession,
  onOpen,
  onSelectSession
}: WorkspaceOverviewProps) {
  const [sessionQuery, setSessionQuery] = useState("");
  const [sessionScope, setSessionScope] = useState<SessionScope>("all");
  const [sessionSort, setSessionSort] = useState<SessionSort>("recent");
  const [visibleSessionCount, setVisibleSessionCount] = useState(SESSION_PAGE_SIZE);
  const deferredSessionQuery = useDeferredValue(sessionQuery);
  const activeSessions = sessions.filter((candidate) => isActiveSession(candidate.status)).length;
  const attentionSessions = useMemo(() => sessions.filter((candidate) => hasFailed(candidate)), [sessions]);
  const failedSessions = attentionSessions.length;
  const sessionArtifactCount = sessions.reduce((total, candidate) => total + (candidate.artifacts?.total ?? 0), 0);
  const evidenceCount = Math.max(artifacts.length, sessionArtifactCount);
  const healthySessions = sessions.filter((candidate) => candidate.ready || (candidate.hasScreenshot && (candidate.artifacts?.total ?? 0) > 0)).length;
  const readiness = buildReadiness({ health, session, screenshotStatus, artifactHealth, artifactHealthStatus });
  const readyChecks = readiness.filter((item) => item.tone === "good").length;
  const nextStep = deriveNextStep({ health, session, artifacts, artifactHealth, artifactHealthStatus });
  const filteredSessions = useMemo(
    () => filterAndSortSessions(sessions, deferredSessionQuery, sessionScope, sessionSort),
    [sessions, deferredSessionQuery, sessionScope, sessionSort]
  );
  const visibleSessions = filteredSessions.slice(0, visibleSessionCount);
  const hasActiveSessionFilters = sessionQuery.trim().length > 0 || sessionScope !== "all";

  const resetSessionFilters = (): void => {
    setSessionQuery("");
    setSessionScope("all");
    setSessionSort("recent");
    setVisibleSessionCount(SESSION_PAGE_SIZE);
  };

  const focusAttentionSessions = (): void => {
    setSessionScope("attention");
    setVisibleSessionCount(SESSION_PAGE_SIZE);
    window.requestAnimationFrame(() => document.getElementById("overview-session-search")?.focus());
  };

  return (
    <section id="workspace-overview" className="workspace-overview" aria-labelledby="workspace-overview-title" tabIndex={-1}>
      <header className="workspace-overview-header">
        <div>
          <p className="kicker">Local runtime control plane</p>
          <h1 id="workspace-overview-title">Workspace overview</h1>
          <p>Start with the runtime signal, then move directly into the evidence that needs attention.</p>
        </div>
        <div className="workspace-overview-header-actions">
          <button type="button" className="overview-secondary-action" onClick={() => onOpen("evidence")}>Open live evidence</button>
          <button type="button" className="overview-primary-action" onClick={onStartSession}>Start session</button>
        </div>
      </header>

      <div className="workspace-overview-metrics" aria-label="Workspace metrics">
        <OverviewMetric label="Local sessions" value={sessionListStatus === "ready" ? String(sessions.length) : "--"} detail={sessionListStatus === "loading" ? "Loading history" : "Stored by the daemon"} />
        <OverviewMetric label="Active now" value={sessionListStatus === "ready" ? String(activeSessions) : "--"} detail={activeSessions === 1 ? "1 mutable session" : `${activeSessions} mutable sessions`} tone={activeSessions > 0 ? "good" : "neutral"} />
        <OverviewMetric label="Evidence items" value={sessionListStatus === "ready" ? String(evidenceCount) : "--"} detail={`${eventCount} events in selected run`} />
        <OverviewMetric label="Needs attention" value={sessionListStatus === "ready" ? String(failedSessions) : "--"} detail={failedSessions > 0 ? "Failed or blocked runs" : "No failed runs found"} tone={failedSessions > 0 ? "bad" : "good"} />
      </div>

      <div className="workspace-overview-grid">
        <section className="overview-runtime-block" aria-labelledby="overview-runtime-title">
          <div className="overview-section-heading">
            <div><p className="kicker">Current run</p><h2 id="overview-runtime-title">Runtime readiness</h2></div>
            <span className={`overview-readiness-score tone-${readinessTone(readyChecks, readiness.length)}`}>{readyChecks}/{readiness.length} ready</span>
          </div>
          <div className="overview-readiness-list">
            {readiness.map((item) => (
              <div className={`overview-readiness-row tone-${item.tone}`} key={item.label}>
                <span aria-hidden="true" />
                <div><strong>{item.label}</strong><small>{item.detail}</small></div>
              </div>
            ))}
          </div>
          <div className="overview-next-step">
            <div><small>Next best action</small><strong>{nextStep.title}</strong><p>{nextStep.detail}</p></div>
            <button type="button" onClick={() => onOpen(nextStep.destination)}>{nextStep.action}</button>
          </div>
        </section>

        <aside className="overview-quick-paths" aria-labelledby="overview-quick-paths-title">
          <div className="overview-section-heading"><div><p className="kicker">Operate</p><h2 id="overview-quick-paths-title">Quick paths</h2></div></div>
          <button type="button" onClick={() => onOpen("actions")}><span>01</span><div><strong>Run an action</strong><small>Tap, type, swipe, or use native gestures</small></div></button>
          <button type="button" onClick={() => onOpen("workflows")}><span>02</span><div><strong>Run a workflow</strong><small>Reuse ordered gestures against this session</small></div></button>
          <button type="button" onClick={() => onOpen("apps")}><span>03</span><div><strong>Browse observed apps</strong><small>Relaunch from the local run history</small></div></button>
          <button type="button" onClick={() => onOpen("atlas")}><span>04</span><div><strong>Open Atlas map</strong><small>Inspect observed screens and transitions</small></div></button>
          <button type="button" onClick={() => onOpen("runtime")}><span>05</span><div><strong>Runtime settings</strong><small>Change daemon or follow another session</small></div></button>
        </aside>

        {sessionListStatus === "ready" && attentionSessions.length > 0 ? (
          <section className="overview-attention-queue" aria-labelledby="overview-attention-title">
            <div className="overview-section-heading">
              <div><p className="kicker">Triage queue</p><h2 id="overview-attention-title">Runs that need a closer look</h2></div>
              <button type="button" onClick={focusAttentionSessions}>Review all {attentionSessions.length}</button>
            </div>
            <div className="overview-attention-list">
              {attentionSessions.slice(0, 3).map((candidate) => (
                <article key={candidate.id}>
                  <header><span>Needs attention</span><time>{formatDateTime(sessionUpdatedAt(candidate))}</time></header>
                  <strong>{candidate.app?.bundleId ?? candidate.app?.scheme ?? candidate.id}</strong>
                  <p>{attentionReason(candidate)}</p>
                  <footer><span>{candidate.artifacts?.total ?? 0} evidence items</span><button type="button" onClick={() => onSelectSession(candidate.id)}>Inspect run</button></footer>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="overview-recent-sessions" aria-labelledby="overview-recent-title">
          <div className="overview-section-heading">
            <div><p className="kicker">Store of record</p><h2 id="overview-recent-title">Session history</h2></div>
            <span>{healthySessions}/{sessions.length || 0} evidence-ready</span>
          </div>
          {sessionListStatus === "loading" ? (
            <OverviewRowsSkeleton />
          ) : sessionListStatus === "error" ? (
            <OverviewInlineState title="Session history unavailable" detail="The daemon did not return a readable session list. Check the runtime connection and retry." />
          ) : sessions.length === 0 ? (
            <OverviewInlineState title="No sessions yet" detail="Start a local Simulator session. New runs will appear here with status, app, and evidence counts." action="Start first session" onAction={onStartSession} />
          ) : (
            <>
              <div className="overview-session-controls" role="search" aria-label="Filter local sessions">
                <label className="overview-session-search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    id="overview-session-search"
                    type="search"
                    value={sessionQuery}
                    onChange={(event) => { setSessionQuery(event.target.value); setVisibleSessionCount(SESSION_PAGE_SIZE); }}
                    placeholder="Search session, app, simulator, or error"
                    aria-label="Search session history"
                  />
                </label>
                <div className="overview-session-scopes" aria-label="Session status filter">
                  {SESSION_SCOPES.map((scope) => (
                    <button
                      type="button"
                      key={scope.id}
                      aria-pressed={sessionScope === scope.id}
                      onClick={() => { setSessionScope(scope.id); setVisibleSessionCount(SESSION_PAGE_SIZE); }}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
                <label className="overview-session-sort">
                  <span>Sort</span>
                  <select value={sessionSort} onChange={(event) => { setSessionSort(event.target.value as SessionSort); setVisibleSessionCount(SESSION_PAGE_SIZE); }} aria-label="Sort session history">
                    <option value="recent">Most recent</option>
                    <option value="evidence">Most evidence</option>
                    <option value="status">Status priority</option>
                  </select>
                </label>
              </div>

              <div className="overview-session-result-bar" role="status">
                <span>{filteredSessions.length} of {sessions.length} sessions</span>
                {hasActiveSessionFilters ? <button type="button" onClick={resetSessionFilters}>Clear filters</button> : null}
              </div>

              {visibleSessions.length === 0 ? (
                <OverviewInlineState title="No sessions match" detail="Try a broader search or clear the status filter to return to the complete local history." action="Clear filters" onAction={resetSessionFilters} />
              ) : (
                <div className="overview-session-table" role="table" aria-label="Local session history">
                  <div className="overview-session-table-head" role="row">
                    <span role="columnheader">Session</span><span role="columnheader">Status</span><span role="columnheader">App</span><span role="columnheader">Evidence</span><span role="columnheader">Updated</span><span role="columnheader" />
                  </div>
                  {visibleSessions.map((candidate) => (
                    <div className="overview-session-table-row" role="row" key={candidate.id}>
                      <span role="cell"><i className={`tone-${sessionTone(candidate.status)}`} aria-hidden="true" /><span><strong>{candidate.id}</strong><small>{sessionSignal(candidate)}</small></span></span>
                      <span role="cell"><b className={`overview-status-badge tone-${sessionTone(candidate.status)}`}>{sessionStatusLabel(candidate)}</b></span>
                      <span role="cell">{candidate.app?.bundleId ?? candidate.app?.scheme ?? candidate.simulator?.name ?? "Unidentified run"}</span>
                      <span role="cell">{candidate.artifacts?.total ?? 0}</span>
                      <time role="cell">{formatDateTime(sessionUpdatedAt(candidate))}</time>
                      <button type="button" onClick={() => onSelectSession(candidate.id)}>Inspect</button>
                    </div>
                  ))}
                </div>
              )}

              {visibleSessions.length < filteredSessions.length ? (
                <button type="button" className="overview-session-more" onClick={() => setVisibleSessionCount((count) => count + SESSION_PAGE_SIZE)}>
                  Show {Math.min(SESSION_PAGE_SIZE, filteredSessions.length - visibleSessions.length)} more
                </button>
              ) : null}
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function OverviewMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: UiTone }) {
  return <div className={`overview-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function OverviewRowsSkeleton() {
  return <div className="overview-rows-skeleton" role="status" aria-label="Loading recent sessions">{[0, 1, 2].map((row) => <span key={row} />)}</div>;
}

function OverviewInlineState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="overview-inline-state"><strong>{title}</strong><p>{detail}</p>{action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}</div>;
}

function buildReadiness({
  health,
  session,
  screenshotStatus,
  artifactHealth,
  artifactHealthStatus
}: Pick<WorkspaceOverviewProps, "health" | "session" | "screenshotStatus" | "artifactHealth" | "artifactHealthStatus">): ReadinessItem[] {
  return [
    {
      label: "Local daemon",
      detail: health === "online" ? "Reachable and ready for requests" : health === "checking" ? "Checking the configured endpoint" : "No reachable runtime at the configured URL",
      tone: health === "online" ? "good" : health === "checking" ? "warn" : "bad"
    },
    {
      label: "Simulator session",
      detail: session ? `${session.id} is ${session.status}` : "No concrete session is selected",
      tone: session ? (session.status === "failed" ? "bad" : isActiveSession(session.status) ? "good" : "warn") : "warn"
    },
    {
      label: "Visual evidence",
      detail: screenshotStatus === "ready" ? "Latest screenshot is available" : screenshotStatus === "stale" ? "A previous screenshot is available" : screenshotStatus === "error" ? "Screenshot could not be loaded" : "Waiting for a screenshot artifact",
      tone: screenshotStatus === "ready" ? "good" : screenshotStatus === "error" ? "bad" : "warn"
    },
    {
      label: "Artifact integrity",
      detail: artifactHealthStatus === "loading" ? "Checking manifests, traces, and paths" : artifactHealthStatus === "offline" ? "Verification waits for the local daemon" : artifactHealthStatus === "error" ? "Health verification could not complete" : artifactHealth?.ok ? "Evidence health is clean" : artifactHealth ? `${artifactHealth.summary.issueCount} issue${artifactHealth.summary.issueCount === 1 ? "" : "s"} reported` : "Waiting for an integrity report",
      tone: artifactHealthStatus === "error" || artifactHealthStatus === "offline" ? "bad" : artifactHealth?.ok ? "good" : artifactHealth ? "bad" : "warn"
    }
  ];
}

function deriveNextStep({
  health,
  session,
  artifacts,
  artifactHealth,
  artifactHealthStatus
}: Pick<WorkspaceOverviewProps, "health" | "session" | "artifacts" | "artifactHealth" | "artifactHealthStatus">): { title: string; detail: string; action: string; destination: OverviewDestination } {
  if (health !== "online") return { title: "Reconnect the local runtime", detail: "The workspace needs a reachable daemon before it can create sessions or mutate the Simulator.", action: "Runtime settings", destination: "runtime" };
  if (!session) return { title: "Create the first observable run", detail: "Start a session, launch an installed app, and capture one meaningful checkpoint.", action: "Start session", destination: "start" };
  if (artifacts.length === 0) return { title: "Capture the first evidence", detail: "Run a screenshot or gesture so the session has a durable artifact-backed state.", action: "Open actions", destination: "actions" };
  if (artifactHealthStatus === "error" || (artifactHealth && !artifactHealth.ok)) return { title: "Resolve evidence integrity", detail: "Inspect the health report before handing this session to another agent.", action: "Inspect evidence", destination: "evidence" };
  return { title: "Review the observed flow", detail: "The run has evidence. Confirm the sequence or open Atlas to inspect the paths it discovered.", action: "Open live evidence", destination: "evidence" };
}

function readinessTone(ready: number, total: number): UiTone {
  if (ready === total) return "good";
  if (ready === 0) return "bad";
  return "warn";
}

function isActiveSession(status?: string): boolean {
  return Boolean(status && !["ended", "failed"].includes(status));
}

function hasFailed(session: SessionHistoryItem): boolean {
  return session.status === "failed"
    || session.events?.latestAction?.ok === false
    || Boolean(session.events?.latestError)
    || Boolean(session.error)
    || Boolean(session.blockingReasons?.length);
}

function sessionStatusLabel(session: SessionHistoryItem): string {
  if (hasFailed(session)) return "Attention";
  if (isActiveSession(session.status)) return "Active";
  return session.status === "ended" ? "Complete" : session.status ?? "Unknown";
}

function attentionReason(session: SessionHistoryItem): string {
  return session.events?.latestError?.message
    ?? session.events?.latestAction?.error?.message
    ?? session.error?.message
    ?? session.blockingReasons?.[0]
    ?? "The latest recorded action did not complete successfully.";
}

function filterAndSortSessions(
  sessions: SessionHistoryItem[],
  query: string,
  scope: SessionScope,
  sort: SessionSort
): SessionHistoryItem[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = sessions.filter((candidate) => {
    if (scope === "active" && !isActiveSession(candidate.status)) return false;
    if (scope === "attention" && !hasFailed(candidate)) return false;
    if (scope === "complete" && (isActiveSession(candidate.status) || hasFailed(candidate))) return false;
    if (!normalizedQuery) return true;
    return sessionSearchText(candidate).includes(normalizedQuery);
  });

  return [...filtered].sort((left, right) => {
    if (sort === "evidence") {
      const evidenceDifference = (right.artifacts?.total ?? 0) - (left.artifacts?.total ?? 0);
      if (evidenceDifference !== 0) return evidenceDifference;
    }
    if (sort === "status") {
      const statusDifference = sessionStatusRank(left) - sessionStatusRank(right);
      if (statusDifference !== 0) return statusDifference;
    }
    return sessionTimestamp(right) - sessionTimestamp(left);
  });
}

function sessionSearchText(session: SessionHistoryItem): string {
  return [
    session.id,
    session.status,
    session.app?.bundleId,
    session.app?.scheme,
    session.app?.workspacePath,
    session.app?.projectPath,
    session.simulator?.name,
    session.simulator?.udid,
    session.events?.latestError?.message,
    session.events?.latestAction?.error?.message,
    session.error?.message,
    ...(session.blockingReasons ?? [])
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function sessionTimestamp(session: SessionHistoryItem): number {
  const parsed = Date.parse(sessionUpdatedAt(session) ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sessionStatusRank(session: SessionHistoryItem): number {
  if (hasFailed(session)) return 0;
  if (isActiveSession(session.status)) return 1;
  return 2;
}
