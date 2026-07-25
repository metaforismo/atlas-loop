import { Fragment } from "react";
import type { Session, SessionSummary } from "../types.js";
import { formatDateTime } from "../viewerPresentation.js";
import { ErrorNotice } from "./common.js";

/**
 * Fields the daemon did not record are collapsed rather than rendered as rows
 * of "--". A run with no Simulator metadata was showing three empty rows for
 * every populated one, which reads as broken instead of as unrecorded — but
 * they stay reachable, because "not recorded" is itself a useful answer.
 */
export function MetadataGrid({ session }: { session: Session }) {
  const fields = sessionMetadataFields(session);
  const recorded = fields.filter((field) => field.value !== undefined);
  const missing = fields.filter((field) => field.value === undefined);

  return (
    <>
      <dl className="meta-grid">
        {recorded.map((field) => (
          <Fragment key={field.label}>
            <dt>{field.label}</dt>
            <dd title={field.value}>{field.value}</dd>
          </Fragment>
        ))}
      </dl>
      {missing.length > 0 ? (
        <details className="meta-grid-missing">
          <summary>
            {missing.length} field{missing.length === 1 ? "" : "s"} not recorded
          </summary>
          <dl className="meta-grid">
            {missing.map((field) => (
              <Fragment key={field.label}>
                <dt>{field.label}</dt>
                <dd>--</dd>
              </Fragment>
            ))}
          </dl>
        </details>
      ) : null}
    </>
  );
}

export interface SessionMetadataField {
  label: string;
  /** Undefined when the daemon recorded nothing for this field. */
  value?: string;
}

export function sessionMetadataFields(session: Session): SessionMetadataField[] {
  // A malformed timestamp counts as recorded: `formatDateTime` passes the raw
  // value through, which surfaces the data problem instead of hiding it under
  // "not recorded".
  const created = text(session.createdAt) === undefined ? undefined : formatDateTime(session.createdAt);

  return [
    { label: "Simulator", value: text(session.simulator?.name) },
    { label: "Runtime", value: text(session.simulator?.runtime) },
    { label: "Backend", value: text(session.backend) },
    { label: "Bundle", value: text(session.app?.bundleId) },
    { label: "Workspace", value: text(session.app?.workspacePath) ?? text(session.app?.projectPath) },
    { label: "Created", value: created },
    { label: "Artifact dir", value: text(session.artifactDir) }
  ];
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "--" ? trimmed : undefined;
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
