import type {
  ArtifactHealth,
  ArtifactRef,
  HealthState,
  Session,
  SessionHistoryItem
} from "../types.js";
import { formatDateTime, sessionSignal, sessionTone, sessionUpdatedAt, type UiTone } from "../viewerPresentation.js";

export type OverviewDestination = "evidence" | "actions" | "atlas" | "runtime" | "start";

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
  const activeSessions = sessions.filter((candidate) => isActiveSession(candidate.status)).length;
  const failedSessions = sessions.filter((candidate) => hasFailed(candidate)).length;
  const sessionArtifactCount = sessions.reduce((total, candidate) => total + (candidate.artifacts?.total ?? 0), 0);
  const evidenceCount = Math.max(artifacts.length, sessionArtifactCount);
  const healthySessions = sessions.filter((candidate) => candidate.ready || (candidate.hasScreenshot && (candidate.artifacts?.total ?? 0) > 0)).length;
  const readiness = buildReadiness({ health, session, screenshotStatus, artifactHealth, artifactHealthStatus });
  const readyChecks = readiness.filter((item) => item.tone === "good").length;
  const nextStep = deriveNextStep({ health, session, artifacts, artifactHealth, artifactHealthStatus });
  const recentSessions = sessions.slice(0, 5);

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
          <button type="button" onClick={() => onOpen("atlas")}><span>02</span><div><strong>Open Atlas map</strong><small>Inspect observed screens and transitions</small></div></button>
          <button type="button" onClick={() => onOpen("runtime")}><span>03</span><div><strong>Runtime settings</strong><small>Change daemon or follow another session</small></div></button>
        </aside>

        <section className="overview-recent-sessions" aria-labelledby="overview-recent-title">
          <div className="overview-section-heading">
            <div><p className="kicker">Store of record</p><h2 id="overview-recent-title">Recent sessions</h2></div>
            <span>{healthySessions}/{sessions.length || 0} evidence-ready</span>
          </div>
          {sessionListStatus === "loading" ? (
            <OverviewRowsSkeleton />
          ) : sessionListStatus === "error" ? (
            <OverviewInlineState title="Session history unavailable" detail="The daemon did not return a readable session list. Check the runtime connection and retry." />
          ) : recentSessions.length === 0 ? (
            <OverviewInlineState title="No sessions yet" detail="Start a local Simulator session. New runs will appear here with status, app, and evidence counts." action="Start first session" onAction={onStartSession} />
          ) : (
            <div className="overview-session-table" role="table" aria-label="Recent local sessions">
              <div className="overview-session-table-head" role="row">
                <span role="columnheader">Session</span><span role="columnheader">App</span><span role="columnheader">Evidence</span><span role="columnheader">Updated</span><span role="columnheader" />
              </div>
              {recentSessions.map((candidate) => (
                <div className="overview-session-table-row" role="row" key={candidate.id}>
                  <span role="cell"><i className={`tone-${sessionTone(candidate.status)}`} aria-hidden="true" /><span><strong>{candidate.id}</strong><small>{sessionSignal(candidate)}</small></span></span>
                  <span role="cell">{candidate.app?.bundleId ?? candidate.app?.scheme ?? "Unidentified app"}</span>
                  <span role="cell">{candidate.artifacts?.total ?? 0}</span>
                  <time role="cell">{formatDateTime(sessionUpdatedAt(candidate))}</time>
                  <button type="button" onClick={() => onSelectSession(candidate.id)}>Inspect</button>
                </div>
              ))}
            </div>
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
  return session.status === "failed" || session.events?.latestAction?.ok === false || Boolean(session.events?.latestError);
}
