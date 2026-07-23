import { useEffect, useMemo, useState } from "react";
import type { ViewerParams } from "../types.js";
import { formatDateTime } from "../viewerPresentation.js";
import { fetchAtlasMap, screenDisplayName, screenImageUrl, type AtlasMapViewLike, type AtlasScreenLike, type OpenSessionHandler } from "./atlasApi.js";
import { MapGraph } from "./MapGraph.js";
import { ScreenDetail } from "./ScreenDetail.js";
import { ScreensGrid } from "./ScreensGrid.js";

type AtlasLoadState =
  | { status: "loading" }
  | { status: "ready"; view: AtlasMapViewLike }
  | { status: "error"; message: string };

export function AtlasView({
  params,
  onSwitchToSessions,
  onOpenSession
}: {
  params: ViewerParams;
  onSwitchToSessions: () => void;
  onOpenSession: OpenSessionHandler;
}) {
  const [state, setState] = useState<AtlasLoadState>({ status: "loading" });
  const [selectedScreenId, setSelectedScreenId] = useState<string | undefined>();
  const [rebuildNonce, setRebuildNonce] = useState(0);
  const [mode, setMode] = useState<"grid" | "graph">("grid");

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    fetchAtlasMap(params.daemonUrl, { rebuild: rebuildNonce > 0, signal: controller.signal })
      .then((view) => setState({ status: "ready", view }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: atlasLoadErrorMessage(error) });
      });

    return () => controller.abort();
  }, [params.daemonUrl, rebuildNonce]);

  const view = state.status === "ready" ? state.view : undefined;
  const selectedScreen: AtlasScreenLike | undefined = useMemo(
    () => view?.map.screens.find((screen) => screen.id === selectedScreenId),
    [view, selectedScreenId]
  );
  const hasScreens = Boolean(view && view.map.screens.length > 0);

  return (
    <main className="atlas-workspace" aria-label="Atlas screen map">
      <aside className="atlas-sidebar" aria-label="Atlas navigation">
        <a className="viewer-home-link atlas-brand" href="/" aria-label="Back to Atlas Loop home">
          <img className="viewer-brand-mark" src="/atlas-loop-mark.png" alt="" />
          <div className="viewer-brand-copy">
            <p className="kicker">Atlas Loop</p>
            <h1>Runtime evidence</h1>
          </div>
        </a>
        <nav className="viewer-nav" aria-label="Workspace navigation">
          <p>Home</p>
          <button type="button" className="viewer-nav-item" onClick={onSwitchToSessions}>
            <span className="viewer-nav-icon overview" aria-hidden="true" />
            Overview
          </button>
          <p>Workspace</p>
          <button type="button" className="viewer-nav-item" onClick={onSwitchToSessions}>
            <span className="viewer-nav-icon sessions" aria-hidden="true" />
            Sessions
          </button>
          <button type="button" className="viewer-nav-item" onClick={onSwitchToSessions}>
            <span className="viewer-nav-icon evidence" aria-hidden="true" />
            Live evidence
          </button>
          <button type="button" className="viewer-nav-item" onClick={onSwitchToSessions}>
            <span className="viewer-nav-icon actions" aria-hidden="true" />
            Actions
          </button>
          <button type="button" className="viewer-nav-item selected" aria-current="page">
            <span className="viewer-nav-icon atlas" aria-hidden="true" />
            Atlas map
          </button>
          <p>Resources</p>
          <a className="viewer-nav-item" href="https://github.com/metaforismo/atlas-loop#readme" target="_blank" rel="noreferrer">
            <span className="viewer-nav-icon docs" aria-hidden="true" />
            Documentation
          </a>
          <a className="viewer-nav-item" href="https://github.com/metaforismo/atlas-loop" target="_blank" rel="noreferrer">
            <span className="viewer-nav-icon source" aria-hidden="true" />
            Source
          </a>
        </nav>
        <section className="atlas-source-list" aria-labelledby="atlas-sources-title">
          <p className="rail-section-label" id="atlas-sources-title">Learns from</p>
          <span><i aria-hidden="true" />Tests</span>
          <span><i aria-hidden="true" />Agent sessions</span>
          <span><i aria-hidden="true" />Human sessions</span>
          <span><i aria-hidden="true" />Builds</span>
        </section>
        <div className="atlas-sidebar-stats" aria-label="Atlas counts">
          <span><small>Screens</small><strong>{view?.map.screens.length ?? 0}</strong></span>
          <span><small>Flows</small><strong>{view?.map.transitions.length ?? 0}</strong></span>
          <span><small>Sessions</small><strong>{view?.map.sessions.length ?? 0}</strong></span>
        </div>
      </aside>

      <header className="atlas-utilitybar">
        <nav className="viewer-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Home</a><span aria-hidden="true">/</span><strong>Atlas</strong>
        </nav>
        <div className="atlas-topbar-actions">
          <div className="atlas-mode-toggle" role="group" aria-label="Map layout mode">
            <button type="button" className={mode === "grid" ? "selected" : ""} aria-pressed={mode === "grid"} onClick={() => setMode("grid")} disabled={!hasScreens}>
              Screens
            </button>
            <button type="button" className={mode === "graph" ? "selected" : ""} aria-pressed={mode === "graph"} onClick={() => setMode("graph")} disabled={!hasScreens}>
              Graph
            </button>
          </div>
          <button className="atlas-rebuild" type="button" onClick={() => setRebuildNonce((nonce) => nonce + 1)} disabled={state.status === "loading"}>
            {state.status === "loading" ? "Mapping…" : "Rebuild map"}
          </button>
        </div>
      </header>

      <section className="atlas-shell">
        <header className="atlas-page-head">
          <div>
            <p className="kicker">Store of record</p>
            <h2>Atlas map</h2>
            <span className="atlas-subtitle">
              {view
                ? `${view.map.screens.length} screens · ${view.map.transitions.length} transitions · ${view.map.sessions.length} sessions · generated ${formatDateTime(view.map.generatedAt)} (${view.source})`
                : state.status === "loading"
                  ? "Deriving screens from local evidence..."
                  : "Atlas needs a reachable local daemon to rebuild."}
            </span>
          </div>
        </header>

        {state.status === "error" ? (
          <p className="inline-error atlas-inline-error" role="alert">
            {state.message}
          </p>
        ) : null}

        {view && view.warnings.length > 0 ? (
          <p className="atlas-warnings" role="status">
            {view.warnings.length} derivation warning{view.warnings.length === 1 ? "" : "s"}; some evidence was skipped.
          </p>
        ) : null}

        {hasScreens ? (
          <div className="atlas-body">
            {mode === "graph" && view ? (
              <MapGraph
                daemonUrl={params.daemonUrl}
                screens={view.map.screens}
                transitions={view.map.transitions}
                selectedScreenId={selectedScreen?.id}
                onSelectScreen={setSelectedScreenId}
              />
            ) : (
              <ScreensGrid
                daemonUrl={params.daemonUrl}
                screens={view?.map.screens ?? []}
                loading={state.status === "loading"}
                selectedScreenId={selectedScreen?.id}
                onSelect={setSelectedScreenId}
              />
            )}
            {view && selectedScreen ? (
              <ScreenDetail
                daemonUrl={params.daemonUrl}
                screen={selectedScreen}
                transitions={view.map.transitions}
                screens={view.map.screens}
                onSelectScreen={setSelectedScreenId}
                onOpenSession={onOpenSession}
                onClose={() => setSelectedScreenId(undefined)}
              />
            ) : null}
          </div>
        ) : (
          <AtlasEmptyState loading={state.status === "loading"} onRebuild={() => setRebuildNonce((nonce) => nonce + 1)} />
        )}
      </section>
    </main>
  );
}

function atlasLoadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (!message || /failed to fetch|networkerror|network request failed/i.test(message)) {
    return "Local daemon unreachable. Start it, then rebuild Atlas from the evidence already on disk.";
  }
  return message;
}

function AtlasEmptyState({ loading, onRebuild }: { loading: boolean; onRebuild: () => void }) {
  return (
    <div className="atlas-empty-state">
      <section className="atlas-empty-copy">
        <span className="atlas-empty-mark" aria-hidden="true" />
        <p className="kicker">Your product, observed</p>
        <h3>{loading ? "Mapping local evidence…" : "Build a living map of every flow."}</h3>
        <p>
          Atlas learns the screens, transitions, and semantic checkpoints your tests and sessions actually exercise. Every node links back to its source evidence.
        </p>
        <ol>
          <li><span>01</span>Run a session with screenshots.</li>
          <li><span>02</span>Exercise a meaningful user journey.</li>
          <li><span>03</span>Rebuild Atlas to make the flow inspectable.</li>
        </ol>
        <button type="button" onClick={onRebuild} disabled={loading}>{loading ? "Deriving map…" : "Rebuild from evidence"}</button>
      </section>
      <div className="atlas-empty-previews" aria-label="Atlas output preview">
        <section>
          <div><span>Structure</span><small>Screens and transitions</small></div>
          <div className="atlas-structure-preview" aria-hidden="true">
            <i /><i /><i /><b /><b />
          </div>
        </section>
        <section>
          <div><span>Semantic coverage</span><small>Observed checkpoints</small></div>
          <div className="atlas-coverage-preview" aria-hidden="true">
            <span><i style={{ width: "82%" }} />Checkout flow</span>
            <span><i style={{ width: "61%" }} />Account settings</span>
            <span><i style={{ width: "38%" }} />Recovery states</span>
          </div>
        </section>
      </div>
    </div>
  );
}

export { screenDisplayName, screenImageUrl };
