import { useEffect, useState } from "react";
import { ImageLightbox } from "./ImageLightbox.js";
import type { TimelineItem } from "../timeline.js";
import type { ArtifactRef } from "../types.js";
import { artifactDetailRows, artifactDisplayName, formatDateTime } from "../viewerPresentation.js";
import { copyToClipboard, EmptyState } from "./common.js";

export type ArtifactKind = "screenshot" | "video" | "log" | "report" | "trace" | "metadata" | "app" | "action" | "other";

type CopyState =
  | { status: "idle" }
  | { status: "copied"; target: "id" | "path"; label: string }
  | { status: "failed"; target: "id" | "path"; message: string };

export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  screenshot: "Screen",
  video: "Video",
  log: "Log",
  report: "Report",
  trace: "Trace",
  metadata: "Meta",
  app: "Build",
  action: "Action",
  other: "File"
};

export function artifactOptionId(artifactId: string): string {
  return `artifact-option-${artifactId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function ArtifactRow({ id, artifact, selected, onSelect }: { id: string; artifact: ArtifactRef; selected: boolean; onSelect: () => void }) {
  const actionId = artifactActionId(artifact);

  return (
    <button
      id={id}
      type="button"
      role="option"
      className={`artifact-row ${artifactKindClassName(artifact)} ${selected ? "selected" : ""}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
    >
      <span className="artifact-row-top">
        <ArtifactKindBadge artifact={artifact} />
        <small>{formatDateTime(artifact.createdAt)}</small>
      </span>
      <strong title={artifactDisplayName(artifact)}>{artifactDisplayName(artifact)}</strong>
      <span className="artifact-row-path">
        <small title={artifact.path}>{artifact.path}</small>
        {actionId ? <code title={`Linked action ${actionId}`}>{actionId}</code> : null}
      </span>
    </button>
  );
}

export function ArtifactDetails({ artifact }: { artifact: ArtifactRef | undefined }) {
  const [copyState, setCopyState] = useState<CopyState>({ status: "idle" });
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    setCopyState({ status: "idle" });
    setZoomed(false);
  }, [artifact?.id]);

  if (!artifact) {
    return <EmptyState title="No artifact selected" detail="Select an artifact from the list or an artifact card in the timeline to inspect local proof details." />;
  }

  const href = artifact.url;
  const rows = artifactDetailRows(artifact);
  const actionId = artifactActionId(artifact);
  const copyMessage =
    copyState.status === "copied"
      ? `${copyState.label} copied.`
      : copyState.status === "failed"
        ? copyState.message
        : href
          ? "Open the daemon artifact URL or copy stable local identifiers."
          : "No daemon URL for this artifact. Copy the local path from this session.";

  const copyArtifactValue = (target: "id" | "path", value: string): void => {
    void copyToClipboard(value)
      .then(() => setCopyState({ status: "copied", target, label: target === "id" ? "Artifact ID" : "Artifact path" }))
      .catch((error) =>
        setCopyState({
          status: "failed",
          target,
          message: error instanceof Error ? error.message : "Copy failed."
        })
      );
  };

  return (
    <section className={`artifact-detail ${artifactKindClassName(artifact)}`} aria-label="Selected artifact details">
      <div className="artifact-detail-head">
        <div>
          <ArtifactKindBadge artifact={artifact} />
          <strong title={artifactDisplayName(artifact)}>{artifactDisplayName(artifact)}</strong>
        </div>
        <div className="artifact-detail-actions" aria-label="Artifact controls">
          {href ? (
            <a className="artifact-detail-action" href={href} target="_blank" rel="noreferrer">
              Open
            </a>
          ) : (
            <span className="artifact-detail-action disabled">Path only</span>
          )}
          <button type="button" className="artifact-detail-action" onClick={() => copyArtifactValue("path", artifact.path)}>
            Copy path
          </button>
          <button type="button" className="artifact-detail-action" onClick={() => copyArtifactValue("id", artifact.id)}>
            Copy ID
          </button>
        </div>
      </div>

      {href && artifactKind(artifact) === "screenshot" ? (
        <button
          type="button"
          className="artifact-preview-button"
          aria-label={`Zoom into ${artifactDisplayName(artifact)}`}
          onClick={() => setZoomed(true)}
        >
          <img className="artifact-preview-image" src={href} alt={`Preview of ${artifactDisplayName(artifact)}`} loading="lazy" />
        </button>
      ) : null}
      {zoomed && href ? (
        <ImageLightbox src={href} alt={artifactDisplayName(artifact)} caption={artifact.path} onClose={() => setZoomed(false)} />
      ) : null}

      <div className="artifact-detail-summary" aria-label="Artifact quick facts">
        <div>
          <span>Created</span>
          <strong>{formatDateTime(artifact.createdAt)}</strong>
        </div>
        <div>
          <span>Action</span>
          <strong title={actionId ?? "No action metadata"}>{actionId ?? "--"}</strong>
        </div>
        <div>
          <span>Hash</span>
          <strong title={artifact.sha256 ?? "No hash reported"}>{shortHash(artifact.sha256)}</strong>
        </div>
      </div>

      <p className={`artifact-copy-status ${copyState.status}`} role="status" aria-live="polite">
        {copyMessage}
      </p>

      <dl className="artifact-detail-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.mono ? "mono" : ""}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ArtifactKindBadge({ artifact }: { artifact: ArtifactRef }) {
  const kind = artifactKind(artifact);

  return (
    <span className={`artifact-type artifact-kind ${artifactKindClassName(artifact)}`} title={`${artifact.type} artifact`}>
      <span aria-hidden="true" />
      {ARTIFACT_KIND_LABELS[kind]}
    </span>
  );
}

export function artifactKindClassName(artifact: ArtifactRef): string {
  return `kind-${artifactKind(artifact)}`;
}

export function artifactKind(artifact: ArtifactRef): ArtifactKind {
  const type = artifact.type.toLowerCase();
  const path = artifact.path.toLowerCase();

  if (type.includes("screenshot") || /\.(png|jpg|jpeg|heic|webp)$/.test(path)) return "screenshot";
  if (type.includes("video") || /\.(mp4|mov|m4v)$/.test(path)) return "video";
  if (type.includes("report") || path.includes("/reports/") || path.endsWith(".html")) return "report";
  if (type.includes("log") || path.includes("/logs/") || /\.(log|txt)$/.test(path)) return "log";
  if (type.includes("trace") || path.includes("/traces/") || path.endsWith(".jsonl")) return "trace";
  if (type.includes("metadata") || path.includes("/metadata/") || path.endsWith("session.json")) return "metadata";
  if (type.includes("app") || type.includes("bundle") || /\.(app|apk|ipa)$/.test(path)) return "app";
  if (type.includes("action") || path.includes("/actions/")) return "action";
  return "other";
}

function artifactActionId(artifact: ArtifactRef): string | undefined {
  return metadataString(artifact, ["actionId", "action_id", "actionID", "action"]);
}

function metadataString(artifact: ArtifactRef, keys: string[]): string | undefined {
  const metadata = artifact.metadata;
  if (!metadata) return undefined;

  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return undefined;
}

function shortHash(value: string | undefined): string {
  if (!value) return "--";
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function timelineArtifactId(item: TimelineItem, artifacts: ArtifactRef[]): string | undefined {
  const candidateIds = [
    optionalString((item as { artifactId?: unknown }).artifactId),
    optionalString((item as { artifact?: { id?: unknown } }).artifact?.id),
    optionalString((item as { artifactIds?: unknown[] }).artifactIds?.[0]),
    optionalString((item as { relatedArtifactIds?: unknown[] }).relatedArtifactIds?.[0])
  ].filter((value): value is string => Boolean(value));

  if (item.id.startsWith("artifact:")) candidateIds.push(item.id.slice("artifact:".length));

  for (const id of candidateIds) {
    if (artifacts.some((artifact) => artifact.id === id)) return id;
  }

  const exactPathMatch = artifacts.find((artifact) => artifact.path === item.detail);
  if (exactPathMatch) return exactPathMatch.id;

  const containedPathMatch = artifacts.find((artifact) => item.detail.includes(artifact.path));
  return containedPathMatch?.id;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function timelineKindClassName(item: TimelineItem): string {
  const text = `${item.sourceType} ${item.title} ${item.detail}`.toLowerCase();
  if (item.sourceType === "artifact") return "kind-other";
  if (text.includes("error") || item.tone === "bad") return "kind-log";
  if (text.includes("action") || text.includes("tap") || text.includes("swipe") || text.includes("type")) return "kind-action";
  if (text.includes("session") || text.includes("status")) return "kind-metadata";
  return "kind-other";
}

export function timelineSourceLabel(item: TimelineItem): string {
  if (item.sourceType === "artifact") return "Artifact";
  const text = `${item.title} ${item.detail}`.toLowerCase();
  if (text.includes("error") || item.tone === "bad") return "Error";
  if (text.includes("action") || text.includes("tap") || text.includes("swipe") || text.includes("type")) return "Action";
  if (text.includes("session") || text.includes("status")) return "Session";
  return "Event";
}
