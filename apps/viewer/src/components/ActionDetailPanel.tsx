import { useState } from "react";
import type { ActionEvidencePair } from "../viewerPresentation.js";
import { formatTime } from "../viewerPresentation.js";
import { ImageLightbox } from "./ImageLightbox.js";

export function ActionDetailPanel({
  pairs,
  selectedActionId,
  onSelect
}: {
  pairs: ActionEvidencePair[];
  selectedActionId?: string;
  onSelect: (actionId: string) => void;
}) {
  if (pairs.length === 0) return null;

  const selectedIndex = Math.max(
    0,
    selectedActionId ? pairs.findIndex((pair) => pair.actionId === selectedActionId) : pairs.length - 1
  );
  const pair = pairs[selectedIndex] ?? pairs[pairs.length - 1];
  const tone = pair.ok === false ? "bad" : pair.ok === true ? "good" : "neutral";

  const selectAt = (index: number): void => {
    const next = pairs[Math.min(pairs.length - 1, Math.max(0, index))];
    if (next) onSelect(next.actionId);
  };

  return (
    <section className="inspector-section action-evidence" aria-label="Action before and after evidence">
      <div className="panel-title-row">
        <h2>Action evidence</h2>
        <span>
          {selectedIndex + 1}/{pairs.length}
        </span>
      </div>

      <div className={`action-evidence-head tone-${tone}`}>
        <div className="action-evidence-nav" role="group" aria-label="Navigate action evidence">
          <button type="button" aria-label="Previous action" disabled={selectedIndex <= 0} onClick={() => selectAt(selectedIndex - 1)}>
            ‹
          </button>
          <button
            type="button"
            aria-label="Next action"
            disabled={selectedIndex >= pairs.length - 1}
            onClick={() => selectAt(selectedIndex + 1)}
          >
            ›
          </button>
        </div>
        <div className="action-evidence-title">
          <strong>{pair.label}</strong>
          <span>
            {pair.ok === undefined ? "no result" : pair.ok ? "passed" : "failed"} · {formatTime(pair.at)}
          </span>
        </div>
      </div>

      <div className="action-evidence-grid">
        <EvidenceShot title="Before" artifact={pair.before} tap={pair.tap} />
        <EvidenceShot title="After" artifact={pair.after} tap={pair.tap} />
      </div>
    </section>
  );
}

function EvidenceShot({
  title,
  artifact,
  tap
}: {
  title: string;
  artifact: ActionEvidencePair["before"];
  tap?: { x: number; y: number };
}) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <figure className="action-evidence-shot">
      <figcaption>{title}</figcaption>
      {artifact?.url ? (
        <button
          type="button"
          className="action-evidence-frame"
          aria-label={`Zoom into the ${title.toLowerCase()} screenshot`}
          onClick={() => setZoomed(true)}
        >
          <img src={artifact.url} alt={`${title} screenshot`} loading="lazy" />
          {tap ? (
            <span
              className="action-evidence-marker"
              style={{ left: `${tap.x * 100}%`, top: `${tap.y * 100}%` }}
              aria-hidden="true"
            />
          ) : null}
        </button>
      ) : (
        <div className="action-evidence-empty">{artifact ? "No daemon URL" : "No screenshot"}</div>
      )}
      {zoomed && artifact?.url ? (
        <ImageLightbox src={artifact.url} alt={`${title} screenshot`} caption={artifact.path} onClose={() => setZoomed(false)} />
      ) : null}
    </figure>
  );
}
