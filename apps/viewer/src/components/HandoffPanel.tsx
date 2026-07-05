import { useEffect, useId, useState } from "react";
import type {
  AgentHandoffBrief,
  AgentHandoffBundleSummary,
  AgentHandoffCommandPreview,
  AgentHandoffCopyPayload,
  UiTone
} from "../viewerPresentation.js";
import { copyToClipboard } from "./common.js";

type HandoffCopyState =
  | { status: "idle" }
  | { status: "copied"; label: string }
  | { status: "failed"; message: string };

export function AgentHandoffPanel({ brief }: { brief: AgentHandoffBrief }) {
  const busy = brief.readiness === "waiting";
  const [copyState, setCopyState] = useState<HandoffCopyState>({ status: "idle" });
  const copyPayloadKey = brief.copyPayloads.map((payload) => `${payload.id}:${payload.value}`).join("\x1f");

  useEffect(() => {
    setCopyState({ status: "idle" });
  }, [copyPayloadKey]);

  const copyHandoffPayload = (payload: AgentHandoffCopyPayload): void => {
    void copyToClipboard(payload.value)
      .then(() => setCopyState({ status: "copied", label: handoffCopiedLabel(payload) }))
      .catch((error: unknown) => {
        setCopyState({ status: "failed", message: error instanceof Error ? error.message : "Copy failed." });
      });
  };

  const copyStatus =
    copyState.status === "copied"
      ? `${copyState.label} copied.`
      : copyState.status === "failed"
        ? copyState.message
        : "Clipboard ready.";

  return (
    <section className={`agent-handoff tone-${brief.tone}`} aria-label="Agent handoff" aria-busy={busy}>
      <div className="panel-title-row">
        <h2>Agent handoff</h2>
        <span>{brief.statusText}</span>
      </div>

      <div className="handoff-banner" role="status" aria-live="polite" aria-atomic="true">
        <strong>{brief.title}</strong>
        <span>{brief.detail}</span>
      </div>

      <div className="handoff-copy-tools" aria-label="Handoff copy actions">
        {brief.copyPayloads.map((payload) => (
          <button key={payload.id} type="button" className="handoff-copy-action" aria-label={payload.ariaLabel} onClick={() => copyHandoffPayload(payload)}>
            {payload.label}
          </button>
        ))}
      </div>
      <p className={`handoff-copy-status ${copyState.status}`} role="status" aria-live="polite">
        {copyStatus}
      </p>

      {brief.bundleSummary ? <HandoffBundleOutput summary={brief.bundleSummary} /> : null}
      {brief.commandPreview ? <HandoffCommandPreview preview={brief.commandPreview} /> : null}

      <div className="handoff-signal-grid">
        <HandoffSignal
          label="Screenshot"
          value={brief.latestScreenshot.source}
          detail={brief.latestScreenshot.detail}
          meta={brief.latestScreenshot.path}
          tone={brief.latestScreenshot.tone}
        />
        <HandoffSignal
          label="Action"
          value={brief.latestAction.label}
          detail={brief.latestAction.error ?? brief.latestAction.detail}
          tone={brief.latestAction.tone}
        />
      </div>

      <dl className="handoff-identifiers" aria-label="Viewer and session identifiers">
        {brief.identifiers.map((identifier) => (
          <div key={identifier.label}>
            <dt>{identifier.label}</dt>
            <dd className={identifier.mono ? "mono" : ""} title={identifier.value}>{identifier.value}</dd>
          </div>
        ))}
      </dl>

      <div className="handoff-notices">
        <strong>Blockers and warnings</strong>
        {brief.notices.length > 0 ? (
          <ul>
            {brief.notices.map((notice, index) => (
              <li key={`${notice.title}:${notice.detail}:${index}`} className={`tone-${notice.tone}`}>
                <span>{notice.title}</span>
                <p>{notice.detail}</p>
                {notice.path ? <code>{notice.path}</code> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No blockers detected from loaded viewer data.</p>
        )}
      </div>

      <div className="handoff-next">
        <strong>Next steps</strong>
        <ul>
          {brief.nextSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HandoffBundleOutput({ summary }: { summary: AgentHandoffBundleSummary }) {
  const headingId = useId();
  const detailId = useId();

  return (
    <section className="handoff-bundle-output" role="region" aria-labelledby={headingId} aria-describedby={detailId}>
      <div className="handoff-bundle-output-head">
        <strong id={headingId}>{summary.label}</strong>
        <span>local-only</span>
      </div>
      <p id={detailId}>{summary.detail}</p>
      <dl aria-label="Bundle output details">
        <div>
          <dt>Directory</dt>
          <dd>
            <code title={summary.directory}>{summary.directory}</code>
          </dd>
        </div>
        <div>
          <dt>Manifest</dt>
          <dd>
            <code title={summary.manifestPath}>{summary.manifestPath}</code>
          </dd>
        </div>
        <div className="handoff-bundle-output-command">
          <dt>Verify</dt>
          <dd>
            <code title={summary.verifyCommand}>{summary.verifyCommand}</code>
          </dd>
        </div>
        <div className="handoff-bundle-output-command">
          <dt>MCP tool</dt>
          <dd>
            <code title={summary.mcpVerifyToolCall}>{summary.mcpVerifyToolCall}</code>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function HandoffCommandPreview({ preview }: { preview: AgentHandoffCommandPreview }) {
  const [expanded, setExpanded] = useState(false);
  const previewId = useId();
  const headingId = useId();
  const previewKey = [...preview.visibleLines, ...preview.hiddenLines].join("\x1f");
  const shownLines = expanded ? [...preview.visibleLines, ...preview.hiddenLines] : preview.visibleLines;
  const hasOverflow = preview.hiddenLineCount > 0;

  useEffect(() => {
    setExpanded(false);
  }, [previewKey]);

  return (
    <section className="handoff-command-preview" aria-labelledby={headingId}>
      <div className="handoff-command-preview-head">
        <strong id={headingId}>{preview.label}</strong>
        <span>
          {shownLines.length}/{preview.totalLineCount} lines
        </span>
      </div>
      <small>{preview.detail}</small>
      <pre id={previewId} className="handoff-command-lines" role="region" aria-label={expanded ? "Expanded local handoff command lines" : "Visible local handoff command lines"}>
        <code>
          {shownLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </code>
      </pre>
      {hasOverflow ? (
        <button
          type="button"
          className="handoff-command-overflow"
          aria-controls={previewId}
          aria-expanded={expanded}
          aria-label={expanded ? `Hide ${preview.hiddenLineCount} overflow local handoff command lines` : `Show ${preview.hiddenLineCount} overflow local handoff command lines`}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Collapse command preview" : `+${preview.hiddenLineCount} more lines: daemon checks`}
        </button>
      ) : null}
    </section>
  );
}

function handoffCopiedLabel(payload: AgentHandoffCopyPayload): string {
  switch (payload.id) {
    case "note":
      return "Handoff note";
    case "nextSteps":
      return "Next steps";
    case "commands":
      return "Command snippets";
  }
}

function HandoffSignal({ label, value, detail, meta, tone }: { label: string; value: string; detail: string; meta?: string; tone: UiTone }) {
  return (
    <div className={`handoff-signal tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {meta ? <code title={meta}>{meta}</code> : null}
    </div>
  );
}
