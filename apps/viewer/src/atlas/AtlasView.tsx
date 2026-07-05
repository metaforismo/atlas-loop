import { useEffect, useMemo, useState } from "react";
import type { ViewerParams } from "../types.js";
import { formatDateTime } from "../viewerPresentation.js";
import { fetchAtlasMap, screenDisplayName, screenImageUrl, type AtlasMapViewLike, type AtlasScreenLike } from "./atlasApi.js";
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
  onOpenSession: (sessionId: string) => void;
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
        setState({ status: "error", message: error instanceof Error ? error.message : "Failed to load the atlas map." });
      });

    return () => controller.abort();
  }, [params.daemonUrl, rebuildNonce]);

  const view = state.status === "ready" ? state.view : undefined;
  const selectedScreen: AtlasScreenLike | undefined = useMemo(
    () => view?.map.screens.find((screen) => screen.id === selectedScreenId),
    [view, selectedScreenId]
  );

  return (
    <main className="atlas-shell panel" aria-label="Atlas screen map">
      <header className="atlas-topbar">
        <div>
          <p className="kicker">Atlas Loop</p>
          <h1>Atlas map</h1>
          <span className="atlas-subtitle">
            {view
              ? `${view.map.screens.length} screens · ${view.map.transitions.length} transitions · ${view.map.sessions.length} sessions · generated ${formatDateTime(view.map.generatedAt)} (${view.source})`
              : state.status === "loading"
                ? "Deriving screens from local evidence..."
                : "Atlas map unavailable"}
          </span>
        </div>
        <div className="atlas-topbar-actions">
          <div className="atlas-mode-toggle" role="group" aria-label="Map layout mode">
            <button type="button" className={mode === "grid" ? "selected" : ""} aria-pressed={mode === "grid"} onClick={() => setMode("grid")}>
              Screens
            </button>
            <button type="button" className={mode === "graph" ? "selected" : ""} aria-pressed={mode === "graph"} onClick={() => setMode("graph")}>
              Graph
            </button>
          </div>
          <button type="button" onClick={() => setRebuildNonce((nonce) => nonce + 1)} disabled={state.status === "loading"}>
            Rebuild
          </button>
          <button type="button" onClick={onSwitchToSessions}>
            Sessions view
          </button>
        </div>
      </header>

      {state.status === "error" ? (
        <p className="inline-error" role="alert">
          {state.message}
        </p>
      ) : null}

      {view && view.warnings.length > 0 ? (
        <p className="atlas-warnings" role="status">
          {view.warnings.length} derivation warning{view.warnings.length === 1 ? "" : "s"}; some evidence was skipped.
        </p>
      ) : null}

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
    </main>
  );
}

export { screenDisplayName, screenImageUrl };
