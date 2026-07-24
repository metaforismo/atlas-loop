import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  deriveObservedApps,
  filterAndSortObservedApps,
  isActiveObservedSession,
  observedSessionNeedsAttention,
  type ObservedAppScope,
  type ObservedAppSort
} from "../appCatalog.js";
import { loadPinnedObservedAppIds, savePinnedObservedAppIds } from "../appCatalogStorage.js";
import type { SessionHistoryItem } from "../types.js";
import { formatDateTime, sessionUpdatedAt } from "../viewerPresentation.js";

interface ObservedAppsWorkspaceProps {
  sessions: SessionHistoryItem[];
  status: "loading" | "ready" | "error";
  error?: string;
  onOpenSession: (sessionId: string) => void;
  onStartSession: (bundleId?: string) => void;
}

const SCOPES: Array<{ id: ObservedAppScope; label: string }> = [
  { id: "all", label: "All apps" },
  { id: "active", label: "Active" },
  { id: "attention", label: "Needs attention" },
  { id: "pinned", label: "Pinned" }
];

export function ObservedAppsWorkspace({
  sessions,
  status,
  error,
  onOpenSession,
  onStartSession
}: ObservedAppsWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<ObservedAppScope>("all");
  const [sort, setSort] = useState<ObservedAppSort>("recent");
  const [pinnedIds, setPinnedIds] = useState(() => new Set(loadPinnedObservedAppIds()));
  const [selectedId, setSelectedId] = useState<string>();
  const [storageMessage, setStorageMessage] = useState("");
  const deferredQuery = useDeferredValue(query);
  const apps = useMemo(() => deriveObservedApps(sessions, pinnedIds), [sessions, pinnedIds]);
  const visibleApps = useMemo(
    () => filterAndSortObservedApps(apps, deferredQuery, scope, sort),
    [apps, deferredQuery, scope, sort]
  );
  const selectedApp = apps.find((app) => app.id === selectedId)
    ?? visibleApps[0]
    ?? apps[0];
  const activeApps = apps.filter((app) => app.activeRunCount > 0).length;
  const attentionApps = apps.filter((app) => app.attentionRunCount > 0).length;
  const artifactCount = apps.reduce((total, app) => total + app.artifactCount, 0);
  const hasFilters = query.trim().length > 0 || scope !== "all" || sort !== "recent";

  useEffect(() => {
    if (selectedApp && selectedApp.id !== selectedId) setSelectedId(selectedApp.id);
  }, [selectedApp, selectedId]);

  const resetFilters = (): void => {
    setQuery("");
    setScope("all");
    setSort("recent");
  };

  const togglePinned = (appId: string): void => {
    const app = apps.find((candidate) => candidate.id === appId);
    if (!app) return;
    const next = new Set(pinnedIds);
    if (app.pinned) {
      next.delete(app.id);
      for (const identityId of app.pinIds) next.delete(identityId);
    } else {
      next.add(app.id);
    }
    try {
      const stored = savePinnedObservedAppIds(next);
      setPinnedIds(new Set(stored));
      setStorageMessage(app.pinned ? "App removed from browser pins." : "App pinned in this browser.");
    } catch {
      setStorageMessage("This browser blocked local pins. Session history is unchanged.");
    }
  };

  return (
    <section id="observed-apps-workspace" className="observed-apps-workspace" aria-labelledby="observed-apps-title" tabIndex={-1}>
      <header className="apps-workspace-header">
        <div>
          <p className="kicker">Derived from local session evidence</p>
          <h1 id="observed-apps-title">Observed apps</h1>
          <p>Turn the apps already seen by Atlas Loop into a launchpad for the next run—without creating a second source of truth.</p>
        </div>
        <div className="apps-workspace-header-actions">
          {selectedApp ? <button type="button" className="apps-secondary-action" onClick={() => onOpenSession(selectedApp.latestSession.id)}>Open latest evidence</button> : null}
          <button type="button" className="apps-primary-action" onClick={() => onStartSession(selectedApp?.bundleId)}>
            {selectedApp?.bundleId ? `Test ${selectedApp.name}` : "Start session"}
          </button>
        </div>
      </header>

      <div className="apps-metrics" aria-label="Observed app metrics">
        <AppMetric label="Observed apps" value={status === "ready" ? String(apps.length) : "--"} detail="Identified in session history" />
        <AppMetric label="Active now" value={status === "ready" ? String(activeApps) : "--"} detail="Apps with mutable runs" tone={activeApps > 0 ? "good" : undefined} />
        <AppMetric label="Evidence items" value={status === "ready" ? String(artifactCount) : "--"} detail="Across identified apps" />
        <AppMetric label="Needs attention" value={status === "ready" ? String(attentionApps) : "--"} detail="Apps with failed or blocked runs" tone={attentionApps > 0 ? "bad" : "good"} />
      </div>

      <div className="apps-toolbar" aria-label="Filter observed apps">
        <label className="apps-search">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search bundle, scheme, Simulator, or session…" aria-label="Search observed apps" />
        </label>
        <div className="apps-scopes" role="group" aria-label="Observed app scope">
          {SCOPES.map((candidate) => (
            <button key={candidate.id} type="button" aria-pressed={scope === candidate.id} onClick={() => setScope(candidate.id)}>{candidate.label}</button>
          ))}
        </div>
        <label className="apps-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as ObservedAppSort)} aria-label="Sort observed apps">
            <option value="recent">Last observed</option>
            <option value="runs">Most runs</option>
            <option value="evidence">Most evidence</option>
            <option value="name">App name</option>
          </select>
        </label>
      </div>

      <div className="apps-result-bar">
        <span>{status === "ready" ? `${visibleApps.length} of ${apps.length} apps` : status === "loading" ? "Loading app history" : "App history unavailable"}</span>
        {hasFilters && visibleApps.length > 0 ? <button type="button" onClick={resetFilters}>Clear filters</button> : <small>Browser pins stay on this device</small>}
      </div>
      {storageMessage ? <p className="apps-storage-message" role="status">{storageMessage}</p> : null}

      {status === "loading" ? (
        <div className="apps-loading" aria-label="Loading observed apps"><span /><span /><span /></div>
      ) : status === "error" ? (
        <AppEmptyState title="Could not load observed apps" detail={error || "The local session history endpoint did not respond."} action="Retry from runtime settings" onAction={() => window.location.reload()} />
      ) : apps.length === 0 ? (
        <AppEmptyState title="No observed apps yet" detail="Start a session with a bundle ID. Atlas Loop will derive this catalog from the resulting local history." action="Start the first app session" onAction={() => onStartSession()} />
      ) : visibleApps.length === 0 ? (
        <AppEmptyState title="No apps match these filters" detail="The underlying session history is still intact. Clear the current scope or search to see it." action="Clear filters" onAction={resetFilters} />
      ) : (
        <div className="apps-workspace-grid">
          <div className="apps-list" role="list" aria-label="Observed apps">
            {visibleApps.map((app) => (
              <article className={`apps-list-row ${selectedApp?.id === app.id ? "selected" : ""}`} role="listitem" key={app.id}>
                <button type="button" className="apps-list-select" aria-pressed={selectedApp?.id === app.id} onClick={() => setSelectedId(app.id)}>
                  <AppMonogram name={app.name} />
                  <span className="apps-list-copy">
                    <strong>{app.name}</strong>
                    <small>{app.identity}</small>
                  </span>
                  <span className="apps-list-stats">
                    <b>{app.runCount}</b><small>{app.runCount === 1 ? "run" : "runs"}</small>
                  </span>
                  <span className={`apps-list-state ${app.attentionRunCount > 0 ? "bad" : app.activeRunCount > 0 ? "good" : "neutral"}`}>
                    {app.attentionRunCount > 0 ? `${app.attentionRunCount} attention` : app.activeRunCount > 0 ? "active" : "observed"}
                  </span>
                </button>
                <button type="button" className="apps-pin" aria-label={`${app.pinned ? "Unpin" : "Pin"} ${app.name}`} aria-pressed={app.pinned} onClick={() => togglePinned(app.id)}>{app.pinned ? "◆" : "◇"}</button>
              </article>
            ))}
          </div>

          {selectedApp ? (
            <aside className="apps-detail" aria-label={`${selectedApp.name} details`}>
              <header>
                <AppMonogram name={selectedApp.name} />
                <div><p className="kicker">Selected app</p><h2>{selectedApp.name}</h2><span>{selectedApp.identity}</span></div>
                <button type="button" aria-pressed={selectedApp.pinned} onClick={() => togglePinned(selectedApp.id)}>{selectedApp.pinned ? "Pinned" : "Pin app"}</button>
              </header>
              <div className="apps-detail-metrics">
                <span><small>RUNS</small><strong>{selectedApp.runCount}</strong></span>
                <span><small>ARTIFACTS</small><strong>{selectedApp.artifactCount}</strong></span>
                <span><small>LAST SEEN</small><strong>{formatDateTime(sessionUpdatedAt(selectedApp.latestSession))}</strong></span>
              </div>
              <div className="apps-detail-context">
                <p><span>Bundle ID</span><strong>{selectedApp.bundleId ?? "Not captured"}</strong></p>
                <p><span>Scheme</span><strong>{selectedApp.scheme ?? "Not captured"}</strong></p>
                <p><span>Simulators</span><strong>{selectedApp.simulators.join(", ") || "Not captured"}</strong></p>
              </div>
              <div className="apps-detail-actions">
                <button type="button" disabled={!selectedApp.bundleId} title={selectedApp.bundleId ? "Open the local session launcher with this bundle ID" : "A bundle ID is required to prefill the launcher"} onClick={() => onStartSession(selectedApp.bundleId)}>Start new run</button>
                <button type="button" onClick={() => onOpenSession(selectedApp.latestSession.id)}>Open latest evidence</button>
              </div>
              <section className="apps-recent-runs" aria-labelledby="apps-recent-runs-title">
                <div><p className="kicker">History</p><h3 id="apps-recent-runs-title">Recent runs</h3></div>
                {selectedApp.sessions.slice(0, 6).map((session) => {
                  const status = session.status ?? session.session?.status ?? "unknown";
                  const attention = observedSessionNeedsAttention(session);
                  return (
                    <button type="button" key={session.id} onClick={() => onOpenSession(session.id)}>
                      <span><strong>{session.id}</strong><small>{formatDateTime(sessionUpdatedAt(session))}</small></span>
                      <em className={attention ? "bad" : isActiveObservedSession(status) ? "good" : "neutral"}>{attention ? "attention" : status}</em>
                      <b>{session.artifacts?.total ?? 0} artifacts →</b>
                    </button>
                  );
                })}
              </section>
            </aside>
          ) : null}
        </div>
      )}
    </section>
  );
}

function AppMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "bad" }) {
  return <div className={`apps-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function AppMonogram({ name }: { name: string }) {
  const characters = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "AP";
  const hue = [...name].reduce((total, character) => total + character.charCodeAt(0), 0) % 360;
  return <span className="apps-monogram" style={{ "--app-hue": hue } as CSSProperties} aria-hidden="true">{characters}</span>;
}

function AppEmptyState({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) {
  return <div className="apps-empty-state"><span aria-hidden="true">◇</span><strong>{title}</strong><p>{detail}</p><button type="button" onClick={onAction}>{action}</button></div>;
}
