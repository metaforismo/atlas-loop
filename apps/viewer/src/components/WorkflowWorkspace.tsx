import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Search01Icon } from "@hugeicons/core-free-icons";
import {
  cloneGestureSteps,
  GESTURE_SEQUENCE_PRESETS,
  type GestureSequencePreset
} from "../gestureSequences.js";
import {
  deleteGestureSequence,
  loadSavedGestureSequences,
  saveGestureSequence
} from "../gestureSequenceStorage.js";
import { runGestureSequenceSteps } from "../gestureSequenceRunner.js";
import type { Session, ViewerParams } from "../types.js";
import type { ActionMutationState } from "./ActionPanel.js";
import { ProductIcon } from "./ProductIcon.js";

type WorkflowScope = "all" | "saved" | "templates" | "multitouch";
type WorkflowSort = "name" | "steps";
type WorkflowSource = "saved" | "template";

interface WorkflowEntry extends GestureSequencePreset {
  key: string;
  source: WorkflowSource;
  multitouch: boolean;
}

type WorkflowRunState =
  | { status: "idle" }
  | { status: "running"; workflowKey: string; step: number; total: number; label: string }
  | { status: "success"; workflowKey: string; message: string }
  | { status: "cancelled"; workflowKey: string; message: string }
  | { status: "error"; workflowKey: string; message: string };

const MULTITOUCH_KINDS = new Set(["pinch", "rotate", "twoFingerTap"]);
const WORKFLOW_SCOPES: Array<{ id: WorkflowScope; label: string }> = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "templates", label: "Templates" },
  { id: "multitouch", label: "Multi-touch" }
];

export function WorkflowWorkspace({
  params,
  selectedSessionId,
  session,
  mutationState,
  onOpenActions,
  onOpenEvidence
}: {
  params: ViewerParams;
  selectedSessionId: string;
  session?: Session;
  mutationState: ActionMutationState;
  onOpenActions: () => void;
  onOpenEvidence: () => void;
}) {
  const [saved, setSaved] = useState<GestureSequencePreset[]>(() => loadSavedGestureSequences());
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<WorkflowScope>("all");
  const [sort, setSort] = useState<WorkflowSort>("name");
  const [selectedKey, setSelectedKey] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string>();
  const [libraryMessage, setLibraryMessage] = useState("");
  const [runState, setRunState] = useState<WorkflowRunState>({ status: "idle" });
  const abortRef = useRef<AbortController | undefined>(undefined);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setRunState({ status: "idle" });
    return () => abortRef.current?.abort();
  }, [params.daemonUrl, selectedSessionId]);

  const entries = useMemo(() => buildWorkflowEntries(saved), [saved]);
  const visibleEntries = useMemo(
    () => filterWorkflowEntries(entries, deferredQuery, scope, sort),
    [entries, deferredQuery, scope, sort]
  );
  const selected = visibleEntries.find((entry) => entry.key === selectedKey) ?? visibleEntries[0];
  const totalSteps = entries.reduce((total, entry) => total + entry.steps.length, 0);
  const multitouchCount = entries.filter((entry) => entry.multitouch).length;
  const isRunning = runState.status === "running";
  const hasFilters = query.trim().length > 0 || scope !== "all";

  useEffect(() => {
    if (!selected) {
      setSelectedKey("");
      return;
    }
    if (selected.key !== selectedKey) setSelectedKey(selected.key);
  }, [selected, selectedKey]);

  const resetFilters = (): void => {
    setQuery("");
    setScope("all");
    setSort("name");
  };

  const duplicateWorkflow = (workflow: WorkflowEntry): void => {
    const copy: GestureSequencePreset = {
      id: `flow-${Date.now().toString(36)}-${workflow.id}`,
      label: `${workflow.label} copy`,
      detail: `Saved locally from ${workflow.source === "template" ? "an Atlas Loop template" : "another saved workflow"}.`,
      steps: cloneGestureSteps(workflow.steps)
    };
    try {
      const next = saveGestureSequence(copy);
      setSaved(next);
      setSelectedKey(`saved:${copy.id}`);
      setScope("saved");
      setLibraryMessage(`${copy.label} saved in this browser.`);
    } catch {
      setLibraryMessage("This browser blocked local workflow storage. Check its site-data permissions.");
    }
  };

  const removeWorkflow = (workflow: WorkflowEntry): void => {
    if (workflow.source !== "saved") return;
    try {
      setSaved(deleteGestureSequence(workflow.id));
      setPendingDeleteId(undefined);
      setSelectedKey("");
      setLibraryMessage(`${workflow.label} removed from this browser.`);
    } catch {
      setLibraryMessage("This browser could not remove the saved workflow.");
    }
  };

  const runWorkflow = async (workflow: WorkflowEntry): Promise<void> => {
    if (isRunning || !mutationState.canSubmitActions || workflow.steps.length === 0) return;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const actionParams: ViewerParams = { ...params, sessionId: selectedSessionId };

    const result = await runGestureSequenceSteps({
      params: actionParams,
      sequence: workflow,
      signal: controller.signal,
      onProgress: (step, index, total) => {
        setRunState({ status: "running", workflowKey: workflow.key, step: index + 1, total, label: step.label });
      }
    });

    if (abortRef.current !== controller) return;
    abortRef.current = undefined;
    if (result.status === "success") {
      setRunState({ status: "success", workflowKey: workflow.key, message: `${result.completedSteps} steps completed and written to the evidence timeline.` });
    } else if (result.status === "cancelled") {
      setRunState({ status: "cancelled", workflowKey: workflow.key, message: `Stopped after ${result.completedSteps} completed steps. No further actions were sent.` });
    } else {
      setRunState({ status: "error", workflowKey: workflow.key, message: `${result.failedStep.label} failed: ${result.message}` });
    }
  };

  const cancelRun = (): void => {
    const workflowKey = runState.status === "running" ? runState.workflowKey : selected?.key ?? "";
    abortRef.current?.abort();
    abortRef.current = undefined;
    setRunState({ status: "cancelled", workflowKey, message: "Stopped. No further actions were sent to the daemon." });
  };

  return (
    <section id="workflow-workspace" className="workflow-workspace" aria-labelledby="workflow-workspace-title" tabIndex={-1}>
      <header className="workflow-workspace-header">
        <div>
          <p className="kicker">Local flow library</p>
          <h1 id="workflow-workspace-title">Reusable workflows</h1>
          <p>Run ordered gestures against the selected Simulator session. Templates are built in; saved workflows stay in this browser.</p>
        </div>
        <div className="workflow-workspace-header-actions">
          <button type="button" className="overview-secondary-action" onClick={onOpenActions}>Compose a workflow</button>
          <button type="button" className="overview-primary-action" onClick={onOpenEvidence}>Open live evidence</button>
        </div>
      </header>

      <div className="workflow-metrics" aria-label="Workflow library metrics">
        <WorkflowMetric label="Available" value={String(entries.length)} detail={`${GESTURE_SEQUENCE_PRESETS.length} built-in templates`} />
        <WorkflowMetric label="Saved locally" value={String(saved.length)} detail={saved.length === 1 ? "1 browser workflow" : `${saved.length} browser workflows`} tone={saved.length ? "good" : "neutral"} />
        <WorkflowMetric label="Multi-touch" value={String(multitouchCount)} detail="Pinch, rotate, two-finger tap" />
        <WorkflowMetric label="Ordered steps" value={String(totalSteps)} detail="Across the visible library" />
      </div>

      <div className="workflow-readiness" role="status" aria-live="polite">
        <div className={`workflow-readiness-signal tone-${mutationState.tone}`}><span aria-hidden="true" /><div><small>Selected run</small><strong>{selectedSessionId}</strong></div></div>
        <div><small>App</small><strong>{session?.app?.bundleId ?? session?.app?.scheme ?? "No app metadata"}</strong></div>
        <div><small>Run readiness</small><strong>{mutationState.title}</strong><span>{mutationState.detail}</span></div>
        <button type="button" onClick={onOpenActions}>Open action lab →</button>
      </div>

      <div className="workflow-library-grid">
        <section className="workflow-catalog" aria-labelledby="workflow-catalog-title">
          <div className="workflow-section-heading">
            <div><p className="kicker">Library</p><h2 id="workflow-catalog-title">Choose a flow</h2></div>
            <span>{visibleEntries.length} of {entries.length}</span>
          </div>
          <div className="workflow-controls" role="search" aria-label="Filter workflows">
            <label className="workflow-search"><ProductIcon icon={Search01Icon} size={14} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, step, or action" aria-label="Search workflows" /></label>
            <div className="workflow-scopes" aria-label="Workflow source filter">
              {WORKFLOW_SCOPES.map((option) => <button type="button" key={option.id} aria-pressed={scope === option.id} onClick={() => setScope(option.id)}>{option.label}</button>)}
            </div>
            <label className="workflow-sort"><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as WorkflowSort)} aria-label="Sort workflows"><option value="name">Name</option><option value="steps">Most steps</option></select></label>
          </div>
          <div className="workflow-result-bar" role="status">
            <span>{visibleEntries.length} of {entries.length} workflows</span>
            {hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : null}
          </div>
          {visibleEntries.length ? (
            <div className="workflow-table" role="listbox" aria-label="Available workflows">
              {visibleEntries.map((entry) => (
                <button type="button" role="option" aria-selected={entry.key === selected?.key} className={entry.key === selected?.key ? "selected" : ""} key={entry.key} onClick={() => { setSelectedKey(entry.key); setPendingDeleteId(undefined); }}>
                  <span className={`workflow-source-mark ${entry.source}`} aria-hidden="true" />
                  <span><strong>{entry.label}</strong><small>{entry.detail}</small></span>
                  <span className="workflow-row-tags">{entry.multitouch ? <em>multi-touch</em> : null}<em>{entry.source}</em></span>
                  <b>{entry.steps.length}<small>steps</small></b>
                </button>
              ))}
            </div>
          ) : (
            <div className="workflow-empty"><strong>No workflows match</strong><p>Try a broader search or return to the complete local library.</p>{hasFilters ? <button type="button" onClick={resetFilters}>Clear filters</button> : null}</div>
          )}
        </section>

        <aside className="workflow-detail" aria-labelledby="workflow-detail-title">
          {selected ? (
            <>
              <header>
                <div><p className="kicker">{selected.source === "saved" ? "Saved in this browser" : "Atlas Loop template"}</p><h2 id="workflow-detail-title">{selected.label}</h2></div>
                <span>{selected.steps.length} steps</span>
              </header>
              <p className="workflow-detail-copy">{selected.detail}</p>
              {selected.multitouch ? <div className="workflow-backend-note"><strong>XCUITest required</strong><span>This workflow contains native multi-touch actions. Start the session with the XCUITest input backend.</span></div> : null}
              <ol className="workflow-step-preview">
                {selected.steps.map((step, index) => <li key={`${step.label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><small>{step.action.kind}</small></div><i className={runStepState(runState, selected.key, index)} aria-hidden="true" /></li>)}
              </ol>
              <div className={`workflow-run-status status-${runState.status}`} aria-live="polite">
                {runState.status === "idle" ? <span>Ready to run against {selectedSessionId}.</span> : runState.workflowKey === selected.key ? <span>{workflowRunMessage(runState)}</span> : <span>Another workflow: {workflowRunMessage(runState)}</span>}
              </div>
              <div className="workflow-detail-actions">
                {isRunning ? <button type="button" className="workflow-cancel" onClick={cancelRun}>Stop active run</button> : <button type="button" className="workflow-run" disabled={!mutationState.canSubmitActions} title={!mutationState.canSubmitActions ? mutationState.title : undefined} onClick={() => void runWorkflow(selected)}>{`Run ${selected.steps.length} steps`}</button>}
                <button type="button" onClick={() => duplicateWorkflow(selected)} disabled={isRunning}>{selected.source === "template" ? "Save a copy" : "Duplicate"}</button>
                {selected.source === "saved" ? <button type="button" className="workflow-delete" onClick={() => setPendingDeleteId(selected.id)} disabled={isRunning}>Delete</button> : null}
              </div>
              {pendingDeleteId === selected.id ? <div className="workflow-delete-confirm" role="alert"><span>Remove “{selected.label}” from this browser?</span><button type="button" onClick={() => removeWorkflow(selected)}>Remove</button><button type="button" onClick={() => setPendingDeleteId(undefined)}>Keep</button></div> : null}
              <p className="workflow-library-message" role="status" aria-live="polite">{libraryMessage}</p>
            </>
          ) : <div className="workflow-empty"><strong>No workflow selected</strong><p>Clear the current filters to select a flow.</p></div>}
        </aside>
      </div>
    </section>
  );
}

function buildWorkflowEntries(saved: GestureSequencePreset[]): WorkflowEntry[] {
  return [
    ...saved.map((workflow) => toWorkflowEntry(workflow, "saved")),
    ...GESTURE_SEQUENCE_PRESETS.map((workflow) => toWorkflowEntry(workflow, "template"))
  ];
}

function toWorkflowEntry(workflow: GestureSequencePreset, source: WorkflowSource): WorkflowEntry {
  return {
    ...workflow,
    key: `${source}:${workflow.id}`,
    source,
    multitouch: workflow.steps.some((step) => MULTITOUCH_KINDS.has(step.action.kind))
  };
}

function filterWorkflowEntries(entries: WorkflowEntry[], query: string, scope: WorkflowScope, sort: WorkflowSort): WorkflowEntry[] {
  const normalized = query.trim().toLowerCase();
  return entries
    .filter((entry) => {
      if (scope === "saved" && entry.source !== "saved") return false;
      if (scope === "templates" && entry.source !== "template") return false;
      if (scope === "multitouch" && !entry.multitouch) return false;
      if (!normalized) return true;
      const haystack = `${entry.label} ${entry.detail} ${entry.steps.map((step) => `${step.label} ${step.action.kind}`).join(" ")}`.toLowerCase();
      return normalized.split(/\s+/).every((term) => haystack.includes(term));
    })
    .sort((left, right) => sort === "steps" ? right.steps.length - left.steps.length || left.label.localeCompare(right.label) : left.label.localeCompare(right.label));
}

function WorkflowMetric({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" }) {
  return <div className={`workflow-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function workflowRunMessage(state: Exclude<WorkflowRunState, { status: "idle" }>): string {
  if (state.status === "running") return `Step ${state.step} of ${state.total}: ${state.label}`;
  return state.message;
}

function runStepState(state: WorkflowRunState, workflowKey: string, index: number): string {
  if (state.status !== "running" || state.workflowKey !== workflowKey) return "";
  if (index + 1 < state.step) return "complete";
  if (index + 1 === state.step) return "active";
  return "";
}
