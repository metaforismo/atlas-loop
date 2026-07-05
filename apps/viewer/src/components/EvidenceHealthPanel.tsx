import type { ArtifactHealth } from "../types.js";
import { artifactHealthPresentation, visibleArtifactHealth, type ArtifactHealthStatus, type UiTone } from "../viewerPresentation.js";

export function EvidenceHealthPanel({
  health,
  status,
  error
}: {
  health: ArtifactHealth | undefined;
  status: ArtifactHealthStatus;
  error?: string;
}) {
  const visibleHealth = visibleArtifactHealth(health, status);
  const presentation = artifactHealthPresentation(visibleHealth, status, error);
  const summary = visibleHealth?.summary;
  const isLoading = status === "loading";
  const issueRemainder = summary ? Math.max(0, summary.issueCount - presentation.issuePreview.length) : 0;
  const statusText = summary
    ? `${presentation.title}. OK ${visibleHealth?.ok ? "yes" : "no"}. ${summary.errorCount} errors, ${summary.warningCount} warnings, ${summary.issueCount} issues.`
    : `${presentation.title}. ${presentation.detail}`;

  return (
    <section className={`evidence-health tone-${presentation.tone}`} aria-label="Evidence health" aria-busy={isLoading}>
      <div className="panel-title-row">
        <h2>Evidence health</h2>
        <span>{presentation.statusText}</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {statusText}
      </p>

      <div className="evidence-health-banner">
        <strong>{presentation.title}</strong>
        <span>{presentation.detail}</span>
      </div>

      <div className="evidence-health-counts" aria-label="Artifact health counts">
        <EvidenceHealthCount label="OK" value={summary ? (visibleHealth?.ok ? "yes" : "no") : "--"} tone={summary ? (visibleHealth?.ok ? "good" : "bad") : "neutral"} />
        <EvidenceHealthCount label="Errors" value={summary ? String(summary.errorCount) : "--"} tone={summary?.errorCount ? "bad" : "neutral"} />
        <EvidenceHealthCount label="Warnings" value={summary ? String(summary.warningCount) : "--"} tone={summary?.warningCount ? "warn" : "neutral"} />
        <EvidenceHealthCount label="Issues" value={summary ? String(summary.issueCount) : "--"} tone={summary?.issueCount ? presentation.tone : "neutral"} />
      </div>

      <div className="evidence-health-issues" aria-label="Artifact health issue preview">
        {isLoading ? (
          <div className="health-loading-lines" aria-hidden="true">
            <span />
            <span />
          </div>
        ) : presentation.issuePreview.length > 0 ? (
          <>
            <ul>
              {presentation.issuePreview.map((issue, index) => (
                <li key={`${issue.path ?? "issue"}:${issue.message}:${index}`} className={`tone-${issue.tone}`}>
                  <strong>{issue.severity}</strong>
                  <span>{issue.message}</span>
                  {issue.path ? <code>{issue.path}</code> : null}
                </li>
              ))}
            </ul>
            {issueRemainder > 0 ? <small>+{issueRemainder} more issue{issueRemainder === 1 ? "" : "s"}</small> : null}
          </>
        ) : (
          <p>{status === "ready" && visibleHealth?.ok ? "No artifact health issues reported." : "No issue preview available."}</p>
        )}
      </div>
    </section>
  );
}

function EvidenceHealthCount({ label, value, tone }: { label: string; value: string; tone: UiTone }) {
  return (
    <div className={`evidence-health-count tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
