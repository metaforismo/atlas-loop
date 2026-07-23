import type { FlowRunSummary } from "../viewerPresentation.js";

export function FlowRunPanel({ summary }: { summary: FlowRunSummary }) {
  return (
    <section className={`flow-run-panel tone-${summary.tone}`} aria-label="Flow verdict">
      <div className="flow-run-verdict">
        <span className="flow-run-mark" aria-hidden="true" />
        <div>
          <strong>{summary.title}</strong>
          <span>{summary.detail}</span>
        </div>
      </div>
      <div className="flow-run-progress" aria-label={`${summary.completed} of ${summary.total} actions completed`}>
        <span style={{ transform: `scaleX(${summary.progress})` }} />
      </div>
      <dl className="flow-run-counts">
        <div>
          <dt>Passed</dt>
          <dd>{summary.passed}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{summary.failed}</dd>
        </div>
        <div>
          <dt>Running</dt>
          <dd>{summary.running}</dd>
        </div>
      </dl>
    </section>
  );
}
