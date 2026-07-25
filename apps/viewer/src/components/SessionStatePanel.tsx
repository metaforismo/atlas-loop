import { useEffect, useMemo, useState } from "react";
import {
  containerAreaLabel,
  filterContainerChanges,
  formatSizeDelta,
  summariseContainerDiff,
  type ContainerArea,
  type ContainerChange
} from "@atlas-loop/protocol";
import { fetchSessionState, type SessionStateCapture } from "../api.js";
import type { Session, ViewerParams } from "../types.js";
import { formatTime } from "../viewerPresentation.js";

const VISIBLE_LIMIT = 120;

/**
 * What the app wrote to disk.
 *
 * A screenshot shows what the app drew. It does not show that the tap actually
 * persisted the order, or that signing out actually cleared the token. Each
 * capture here is a snapshot of the app's data container, and the panel shows
 * the difference from the capture before it.
 */
export function SessionStatePanel({
  params,
  sessionStatus
}: {
  params: ViewerParams;
  sessionStatus: Session["status"] | undefined;
}) {
  const [captures, setCaptures] = useState<SessionStateCapture[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [area, setArea] = useState<ContainerArea | "all">("all");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setCaptures([]);
    setSelectedId(undefined);
  }, [params.daemonUrl, params.sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;

    const load = async (): Promise<void> => {
      try {
        const view = await fetchSessionState(params, controller.signal);
        if (!controller.signal.aborted) setCaptures(view.captures);
      } catch {
        // A daemon without the state route is not an error state for this panel.
      }
    };

    void load();
    if (sessionStatus === "running") timer = window.setInterval(() => void load(), 5000);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [params.daemonUrl, params.sessionId, sessionStatus]);

  // The newest capture is the interesting one, and it changes as a run goes on.
  const selected = useMemo(
    () => captures.find((capture) => capture.artifactId === selectedId) ?? captures[captures.length - 1],
    [captures, selectedId]
  );

  const changes = useMemo<ContainerChange[]>(
    () => (selected?.diff ? filterContainerChanges(selected.diff.changes, { areas: area === "all" ? undefined : [area] }) : []),
    [selected, area]
  );
  const summary = useMemo(
    () => (selected?.diff ? summariseContainerDiff({ ...selected.diff, changes }) : undefined),
    [selected, changes]
  );
  // Only the areas that actually changed become filters; empty tabs are noise.
  const areas = useMemo(
    () => (selected?.diff ? summariseContainerDiff(selected.diff).areas : []),
    [selected]
  );

  if (captures.length === 0) return null;

  return (
    <section className="session-state" aria-labelledby="session-state-title">
      <div className="panel-title-row">
        <h2 id="session-state-title">Stored data</h2>
        <span>
          {captures.length} capture{captures.length === 1 ? "" : "s"}
        </span>
      </div>

      {captures.length > 1 ? (
        <div className="session-state-captures" role="group" aria-label="Container captures">
          {captures.map((capture, index) => (
            <button
              key={capture.artifactId}
              type="button"
              aria-pressed={capture.artifactId === selected?.artifactId}
              className={capture.artifactId === selected?.artifactId ? "selected" : ""}
              onClick={() => setSelectedId(capture.artifactId)}
            >
              {capture.label ?? `Capture ${index + 1}`}
              <small>{formatTime(capture.snapshot.capturedAt)}</small>
            </button>
          ))}
        </div>
      ) : null}

      {selected?.diff && summary ? (
        <>
          <p className="session-state-headline">
            {summary.clean ? (
              <span className="tone-good">Nothing changed on disk</span>
            ) : (
              <>
                <strong>{describeCounts(summary)}</strong> since{" "}
                {formatTime(selected.diff.before.capturedAt)}
                <span className="session-state-delta">{formatSizeDelta(summary.sizeDelta)}</span>
              </>
            )}
          </p>

          {selected.diff.skippedAreas.length > 0 || selected.diff.truncated ? (
            // Absence of change is only evidence when everything was looked at.
            <p className="session-state-caveat">
              {selected.diff.truncated ? "The capture hit its file limit. " : ""}
              {selected.diff.skippedAreas.length > 0
                ? `${selected.diff.skippedAreas.map(containerAreaLabel).join(" and ")} were not walked, so changes there would not show.`
                : ""}
            </p>
          ) : null}

          {areas.length > 1 ? (
            <div className="session-state-areas" role="group" aria-label="Filter by area">
              <button type="button" aria-pressed={area === "all"} className={area === "all" ? "selected" : ""} onClick={() => setArea("all")}>
                All
              </button>
              {areas.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={area === option}
                  className={area === option ? "selected" : ""}
                  onClick={() => setArea(option)}
                >
                  {containerAreaLabel(option)}
                </button>
              ))}
            </div>
          ) : null}

          {changes.length > 0 ? (
            <ul className="session-state-changes">
              {(expanded ? changes : changes.slice(0, VISIBLE_LIMIT)).map((change) => (
                <li key={`${change.kind}-${change.path}`} className={`kind-${change.kind}`}>
                  <span className="session-state-kind">{change.kind}</span>
                  <span className="session-state-path" title={change.path}>
                    {change.path}
                  </span>
                  <span className="session-state-area">{containerAreaLabel(change.area)}</span>
                  <span className="session-state-size">{formatSizeDelta(change.sizeDelta)}</span>
                  {/* Only a modification can be inferred; a path is there or it is not. */}
                  {change.evidence !== undefined && change.evidence !== "hash" ? (
                    <span className="session-state-evidence" title="Inferred from size and modification time, not content">
                      inferred
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {changes.length > VISIBLE_LIMIT ? (
            <button type="button" className="session-state-more" onClick={() => setExpanded((current) => !current)}>
              {expanded ? "Show fewer" : `Show all ${changes.length} changes`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="session-state-headline">
          First capture &mdash; nothing to compare against yet. Capture again after the next action.
        </p>
      )}
    </section>
  );
}

function describeCounts(summary: { added: number; removed: number; modified: number }): string {
  const parts = [
    summary.added > 0 ? `${summary.added} added` : undefined,
    summary.modified > 0 ? `${summary.modified} changed` : undefined,
    summary.removed > 0 ? `${summary.removed} removed` : undefined
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "No matching changes";
}
