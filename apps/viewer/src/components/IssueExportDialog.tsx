import { useMemo, useState } from "react";
import { buildIssueDraft, buildIssueTargets, type IssueDraftInput } from "../issueExport.js";
import { useModalDialog } from "../useModalDialog.js";
import { copyToClipboard } from "./common.js";

type CopyState = { status: "idle" } | { status: "copied" } | { status: "failed"; message: string };

/**
 * Composes an issue from the run that is already on screen. The draft is
 * rebuilt as the operator types, so what the deep link carries is exactly what
 * the preview shows.
 */
export function IssueExportDialog({
  input,
  repository,
  onRepositoryChange,
  onClose
}: {
  input: Omit<IssueDraftInput, "notes">;
  repository: string;
  onRepositoryChange: (value: string) => void;
  onClose: () => void;
}) {
  const { dialogRef, initialFocusRef } = useModalDialog(onClose);
  const [notes, setNotes] = useState("");
  const [copyState, setCopyState] = useState<CopyState>({ status: "idle" });

  const draft = useMemo(() => buildIssueDraft({ ...input, notes }), [input, notes]);
  const targets = useMemo(() => buildIssueTargets(draft, repository), [draft, repository]);
  const oversized = targets.some((target) => target.url === undefined);

  const copyMarkdown = (): void => {
    void copyToClipboard(`# ${draft.title}\n\n${draft.body}`)
      .then(() => setCopyState({ status: "copied" }))
      .catch((error: unknown) => {
        setCopyState({ status: "failed", message: error instanceof Error ? error.message : "Copy failed." });
      });
  };

  return (
    <div className="issue-export-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="issue-export-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="issue-export-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <p className="kicker">File with evidence</p>
            <h2 id="issue-export-title">Create an issue from this run</h2>
          </div>
          <button type="button" className="issue-export-close" ref={initialFocusRef} onClick={onClose} aria-label="Close issue export">
            ×
          </button>
        </header>

        <p className="issue-export-lede">
          The failing step, the reason, the device, and a link back to this exact evidence travel with the ticket.
        </p>

        <div className="issue-export-title-preview">
          <small>Title</small>
          <strong>{draft.title}</strong>
        </div>

        {draft.failedStep ? (
          <div className="issue-export-failure tone-bad">
            <small>First failed step</small>
            <strong>Step {draft.failedStep.position} · {draft.failedStep.kind}</strong>
            <p>{draft.failedStep.reason}</p>
          </div>
        ) : (
          <div className="issue-export-failure tone-neutral">
            <small>First failed step</small>
            <strong>No failed action recorded</strong>
            <p>The issue will still carry the run context and a link to its evidence.</p>
          </div>
        )}

        <dl className="issue-export-fields" aria-label="Run context included in the issue">
          {draft.runFields.map((field) => (
            <div key={field.label}>
              <dt>{field.label}</dt>
              <dd title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>

        <label className="issue-export-notes">
          <span>Notes</span>
          <textarea
            value={notes}
            rows={3}
            placeholder="Add additional context here…"
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>

        <label className="issue-export-repository">
          <span>GitHub repository</span>
          <input
            value={repository}
            spellCheck={false}
            placeholder="owner/repo — enables the GitHub link"
            onChange={(event) => onRepositoryChange(event.target.value)}
          />
        </label>

        {oversized ? (
          <p className="issue-export-warning" role="status">
            This draft is too long for a prefilled link. Copy the markdown instead — truncating it would file a ticket
            missing the part that matters.
          </p>
        ) : null}

        <footer>
          <button type="button" className="issue-export-secondary" onClick={copyMarkdown}>
            {copyState.status === "copied" ? "Markdown copied" : "Copy markdown"}
          </button>
          {targets.map((target) => (
            <a
              key={target.id}
              className={`issue-export-primary ${target.url ? "" : "is-disabled"}`}
              href={target.url ?? undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={target.url ? undefined : true}
              onClick={(event) => { if (!target.url) event.preventDefault(); }}
            >
              Open in {target.label} <span aria-hidden="true">↗</span>
            </a>
          ))}
        </footer>

        <p className={`issue-export-status ${copyState.status}`} role="status" aria-live="polite">
          {copyState.status === "failed"
            ? copyState.message
            : copyState.status === "copied"
              ? "Markdown copied to clipboard."
              : "Nothing is sent anywhere until you open a link."}
        </p>
      </div>
    </div>
  );
}
