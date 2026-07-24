import { useEffect, useMemo, useState } from "react";
import {
  Activity01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  SmartPhone01Icon,
  WorkflowSquare03Icon
} from "@hugeicons/core-free-icons";
import type { HealthState, Session, SessionHistoryItem } from "../types.js";
import { sessionSignal, sessionTone, sessionUpdatedAt, sortSessionList } from "../viewerPresentation.js";
import { useModalDialog } from "../useModalDialog.js";
import type { WorkflowMonitorActivity } from "./WorkflowWorkspace.js";
import { ProductIcon } from "./ProductIcon.js";

type MonitorTab = "devices" | "workflows";
type SessionListStatus = "loading" | "ready" | "error";

export function LiveMonitor({
  health,
  sessions,
  sessionListStatus,
  sessionListError,
  selectedSessionId,
  selectedSession,
  artifactCount,
  eventCount,
  workflowActivity,
  onOpenSession,
  onOpenEvidence,
  onOpenWorkflows,
  onStartSession,
  onOpenRuntime
}: {
  health: HealthState;
  sessions: SessionHistoryItem[];
  sessionListStatus: SessionListStatus;
  sessionListError?: string;
  selectedSessionId: string;
  selectedSession?: Session;
  artifactCount: number;
  eventCount: number;
  workflowActivity: WorkflowMonitorActivity;
  onOpenSession: (sessionId: string) => void;
  onOpenEvidence: () => void;
  onOpenWorkflows: () => void;
  onStartSession: () => void;
  onOpenRuntime: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MonitorTab>("devices");

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <>
      <button
        type="button"
        className="live-monitor-trigger"
        aria-label="Open live monitor"
        aria-keyshortcuts="Meta+Shift+M Control+Shift+M"
        onClick={() => setOpen(true)}
      >
        <ProductIcon icon={Activity01Icon} size={14} />
        <span>Live monitor</span>
        <i className={`tone-${health}`} aria-hidden="true" />
      </button>
      {open ? (
        <LiveMonitorDialog
          health={health}
          sessions={sessions}
          sessionListStatus={sessionListStatus}
          sessionListError={sessionListError}
          selectedSessionId={selectedSessionId}
          selectedSession={selectedSession}
          artifactCount={artifactCount}
          eventCount={eventCount}
          workflowActivity={workflowActivity}
          tab={tab}
          onTabChange={setTab}
          onClose={() => setOpen(false)}
          onOpenSession={(sessionId) => {
            setOpen(false);
            onOpenSession(sessionId);
          }}
          onOpenEvidence={() => {
            setOpen(false);
            onOpenEvidence();
          }}
          onOpenWorkflows={() => {
            setOpen(false);
            onOpenWorkflows();
          }}
          onStartSession={() => {
            setOpen(false);
            onStartSession();
          }}
          onOpenRuntime={() => {
            setOpen(false);
            onOpenRuntime();
          }}
        />
      ) : null}
    </>
  );
}

function LiveMonitorDialog({
  health,
  sessions,
  sessionListStatus,
  sessionListError,
  selectedSessionId,
  selectedSession,
  artifactCount,
  eventCount,
  workflowActivity,
  tab,
  onTabChange,
  onClose,
  onOpenSession,
  onOpenEvidence,
  onOpenWorkflows,
  onStartSession,
  onOpenRuntime
}: Parameters<typeof LiveMonitor>[0] & {
  tab: MonitorTab;
  onTabChange: (tab: MonitorTab) => void;
  onClose: () => void;
}) {
  const { dialogRef, initialFocusRef } = useModalDialog(onClose);
  const activeSessions = useMemo(
    () => sortSessionList(sessions.filter(isActiveSession)),
    [sessions]
  );
  const selectedHistory = sessions.find((candidate) => candidate.id === selectedSessionId);
  const resolvedSelected = selectedSession?.id === selectedSessionId ? selectedSession : selectedHistory;

  return (
    <div className="live-monitor-backdrop" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="live-monitor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-monitor-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="live-monitor-header">
          <div>
            <span className="live-monitor-eyebrow">Operations</span>
            <h2 id="live-monitor-title">Live Monitor</h2>
          </div>
          <div className="live-monitor-header-actions">
            <span className={`live-monitor-connection tone-${health}`}><i aria-hidden="true" />{health === "online" ? "Connected" : health === "checking" ? "Connecting" : "Offline"}</span>
            <button ref={initialFocusRef} type="button" onClick={onClose} aria-label="Close live monitor"><ProductIcon icon={Cancel01Icon} /></button>
          </div>
        </header>

        <nav className="live-monitor-tabs" role="tablist" aria-label="Live monitor views">
          <button type="button" role="tab" aria-selected={tab === "devices"} aria-controls="live-monitor-devices" onClick={() => onTabChange("devices")}>
            <ProductIcon icon={SmartPhone01Icon} size={15} />Devices <span>{activeSessions.length}</span>
          </button>
          <button type="button" role="tab" aria-selected={tab === "workflows"} aria-controls="live-monitor-workflows" onClick={() => onTabChange("workflows")}>
            <ProductIcon icon={WorkflowSquare03Icon} size={15} />Workflows <span>{workflowActivity.status === "running" ? "1" : "0"}</span>
          </button>
        </nav>

        <div className="live-monitor-summary" aria-label="Selected session live summary">
          <div><small>Active devices</small><strong>{sessionListStatus === "loading" ? "–" : activeSessions.length}</strong></div>
          <div><small>Selected run</small><strong title={selectedSessionId}>{compactSessionId(selectedSessionId)}</strong></div>
          <div><small>Evidence</small><strong>{artifactCount} <span>artifacts</span></strong></div>
          <div><small>Timeline</small><strong>{eventCount} <span>events</span></strong></div>
        </div>

        <div className="live-monitor-body">
          {health === "offline" ? (
            <div className="live-monitor-offline" role="status">
              <span><strong>Daemon offline</strong>Cached session evidence is still visible, but live device updates and actions are paused.</span>
              <button type="button" onClick={onOpenRuntime}>Runtime settings</button>
            </div>
          ) : null}

          {tab === "devices" ? (
            <section id="live-monitor-devices" role="tabpanel" className="live-monitor-panel" aria-label="Live devices">
              <MonitorSectionHeading eyebrow="Device activity" title="Active local runs" detail="Sessions still able to produce runtime evidence." />
              {sessionListStatus === "loading" ? <MonitorSkeleton /> : sessionListStatus === "error" && sessions.length === 0 && health !== "offline" ? (
                <MonitorEmpty
                  icon={Activity01Icon}
                  title="Device activity unavailable"
                  detail={sessionListError ?? "Atlas Loop could not read the local session index."}
                  action="Open runtime settings"
                  onAction={onOpenRuntime}
                />
              ) : activeSessions.length ? (
                <div className="live-monitor-device-list" role="list">
                  {activeSessions.map((candidate) => (
                    <button type="button" role="listitem" key={candidate.id} className={candidate.id === selectedSessionId ? "selected" : ""} onClick={() => onOpenSession(candidate.id)}>
                      <span className={`live-monitor-device-signal tone-${sessionTone(candidate.status)}`} aria-hidden="true" />
                      <span className="live-monitor-device-copy"><strong>{candidate.simulator?.name ?? "iPhone Simulator"}</strong><small>{sessionSignal(candidate)}</small></span>
                      <span className="live-monitor-device-meta"><strong>{candidate.status ?? "unknown"}</strong><small>{monitorInputBackend(candidate)} · {formatMonitorTime(sessionUpdatedAt(candidate))}</small></span>
                      <span className="live-monitor-device-evidence"><strong>{candidate.artifacts?.total ?? 0}</strong><small>artifacts</small></span>
                      <ProductIcon icon={ArrowRight01Icon} size={14} />
                    </button>
                  ))}
                </div>
              ) : (
                <MonitorEmpty
                  icon={SmartPhone01Icon}
                  title={health === "offline" ? "No cached active devices" : "No active devices"}
                  detail={health === "offline" ? "Start the daemon, then create a Simulator session to watch it here." : "Start a Simulator session and it will appear here without leaving your current workspace."}
                  action={health === "online" ? "Start a session" : "Open runtime settings"}
                  onAction={health === "online" ? onStartSession : onOpenRuntime}
                />
              )}

              {resolvedSelected ? (
                <div className="live-monitor-selected-run">
                  <div><small>Selected device</small><strong>{resolvedSelected.simulator?.name ?? "iPhone Simulator"}</strong><span>{resolvedSelected.app?.bundleId ?? resolvedSelected.app?.scheme ?? "No app metadata"}</span></div>
                  <div><small>Input backend</small><strong>{resolvedSelected.inputBackend ?? resolvedSelected.backend ?? "Pending"}</strong><span>Status: {resolvedSelected.status}</span></div>
                  <button type="button" onClick={onOpenEvidence}>Open live evidence <ProductIcon icon={ArrowRight01Icon} size={13} /></button>
                </div>
              ) : null}
            </section>
          ) : (
            <section id="live-monitor-workflows" role="tabpanel" className="live-monitor-panel" aria-label="Live workflows">
              <MonitorSectionHeading eyebrow="Workflow activity" title="Current local execution" detail="Progress from multi-step gesture runs in this browser." />
              <WorkflowActivity activity={workflowActivity} onOpenWorkflows={onOpenWorkflows} />
              <div className="live-monitor-workflow-note">
                <span><ProductIcon icon={SmartPhone01Icon} size={15} /></span>
                <div><small>Execution target</small><strong>{resolvedSelected?.simulator?.name ?? compactSessionId(selectedSessionId)}</strong><p>{health === "online" ? "The local daemon is available for deterministic actions." : "Reconnect the daemon before starting another workflow."}</p></div>
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function MonitorSectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <header className="live-monitor-section-heading"><div><small>{eyebrow}</small><h3>{title}</h3></div><p>{detail}</p></header>;
}

function MonitorSkeleton() {
  return <div className="live-monitor-skeleton" aria-label="Loading live devices" aria-busy="true">{[0, 1, 2].map((item) => <span key={item} />)}</div>;
}

function MonitorEmpty({ icon, title, detail, action, onAction }: { icon: Parameters<typeof ProductIcon>[0]["icon"]; title: string; detail: string; action: string; onAction: () => void }) {
  return <div className="live-monitor-empty"><span><ProductIcon icon={icon} size={20} /></span><strong>{title}</strong><p>{detail}</p><button type="button" onClick={onAction}>{action}</button></div>;
}

function WorkflowActivity({ activity, onOpenWorkflows }: { activity: WorkflowMonitorActivity; onOpenWorkflows: () => void }) {
  if (activity.status === "idle") {
    return <MonitorEmpty icon={WorkflowSquare03Icon} title="No workflow running" detail="Start a saved flow or multi-touch template. Open this monitor without replacing the workspace underneath." action="Open workflow library" onAction={onOpenWorkflows} />;
  }
  if (activity.status === "running") {
    const progress = activity.total > 0 ? activity.step / activity.total : 0;
    return (
      <div className="live-monitor-workflow-card running" role="status" aria-live="polite">
        <span className="live-monitor-workflow-mark"><ProductIcon icon={Activity01Icon} /></span>
        <div className="live-monitor-workflow-copy"><small>Running now</small><strong>{activity.workflowLabel}</strong><p>Step {activity.step} of {activity.total} · {activity.stepLabel}</p></div>
        <span className="live-monitor-workflow-count">{activity.step}/{activity.total}</span>
        <div className="live-monitor-workflow-progress"><span style={{ transform: `scaleX(${progress})` }} /></div>
      </div>
    );
  }
  return (
    <div className={`live-monitor-workflow-card ${activity.status}`} role="status" aria-live="polite">
      <span className="live-monitor-workflow-mark"><ProductIcon icon={WorkflowSquare03Icon} /></span>
      <div className="live-monitor-workflow-copy"><small>Latest workflow · {activity.status}</small><strong>{activity.workflowLabel}</strong><p>{activity.message}</p></div>
      <button type="button" onClick={onOpenWorkflows}>Open</button>
    </div>
  );
}

function isActiveSession(session: SessionHistoryItem): boolean {
  if (session.canMutate === false) return false;
  return session.status !== "ended" && session.status !== "failed" && session.status !== "unknown";
}

function compactSessionId(sessionId: string): string {
  return sessionId.length > 18 ? `${sessionId.slice(0, 8)}…${sessionId.slice(-5)}` : sessionId;
}

function monitorInputBackend(session: SessionHistoryItem): string {
  return session.inputBackend ?? session.session?.inputBackend ?? session.backend ?? session.session?.backend ?? "input pending";
}

function formatMonitorTime(value: string | undefined): string {
  if (!value) return "no timestamp";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "invalid timestamp";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
}
