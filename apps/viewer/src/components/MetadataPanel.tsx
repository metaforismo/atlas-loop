import type { Session, SessionSummary } from "../types.js";
import { formatDateTime } from "../viewerPresentation.js";
import { ErrorNotice } from "./common.js";

export function MetadataGrid({ session }: { session: Session }) {
  return (
    <dl className="meta-grid">
      <dt>Simulator</dt>
      <dd>{session.simulator?.name ?? "--"}</dd>
      <dt>Runtime</dt>
      <dd>{session.simulator?.runtime ?? "--"}</dd>
      <dt>Backend</dt>
      <dd>{session.backend ?? "--"}</dd>
      <dt>Bundle</dt>
      <dd>{session.app?.bundleId ?? "--"}</dd>
      <dt>Workspace</dt>
      <dd>{session.app?.workspacePath ?? session.app?.projectPath ?? "--"}</dd>
      <dt>Created</dt>
      <dd>{formatDateTime(session.createdAt)}</dd>
      <dt>Artifact dir</dt>
      <dd>{session.artifactDir ?? "--"}</dd>
    </dl>
  );
}

export function MetadataSkeleton() {
  return (
    <div className="meta-skeleton" aria-label="Loading metadata">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function SummaryEvidence({ summary }: { summary: SessionSummary }) {
  const latestAction = summary.events.latestAction;
  const latestError = summary.events.latestError;
  const warnings = summary.storage.warnings ?? [];

  return (
    <section className="summary-evidence" aria-label="Evidence storage summary">
      <div className="summary-evidence-grid">
        <div>
          <span>Storage</span>
          <strong>{summary.storage.source}</strong>
          <small>{summary.storage.artifactBacked ? "artifact-backed" : "not artifact-backed"}</small>
        </div>
        <div>
          <span>Events</span>
          <strong>{summary.events.total}</strong>
          <small>{latestAction ? `${latestAction.ok ? "last passed" : "last failed"} at ${formatDateTime(latestAction.endedAt)}` : "no action results"}</small>
        </div>
        <div>
          <span>Artifacts</span>
          <strong>{summary.artifacts.total}</strong>
          <small>{summary.artifacts.latestScreenshotId ? `latest ${summary.artifacts.latestScreenshotId}` : "no screenshots"}</small>
        </div>
      </div>

      {latestError ? <ErrorNotice message={`${latestError.code ?? "ERROR"}: ${latestError.message}`} compact /> : null}

      {warnings.length > 0 ? (
        <div className="warning-list" role="status" aria-live="polite">
          <strong>{warnings.length} evidence warning{warnings.length === 1 ? "" : "s"}</strong>
          <ul>
            {warnings.slice(0, 3).map((warning) => (
              <li key={`${warning.path}:${warning.message}`}>
                <span>{warning.message}</span>
                <code>{warning.path}</code>
              </li>
            ))}
          </ul>
          {warnings.length > 3 ? <small>+{warnings.length - 3} more warning{warnings.length - 3 === 1 ? "" : "s"}</small> : null}
        </div>
      ) : null}
    </section>
  );
}
