import { useMemo, useState, type ReactNode } from "react";
import {
  Add01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Search01Icon,
  WorkflowSquare03Icon
} from "@hugeicons/core-free-icons";
import { buildViewerActionRequest } from "../api.js";
import {
  cloneGestureSteps,
  GESTURE_SEQUENCE_PRESETS,
  GESTURE_STEP_CATALOG,
  type GestureSequencePreset,
  type GestureSequenceStep
} from "../gestureSequences.js";
import { createGestureSequenceId } from "../gestureSequenceStorage.js";
import type { ViewerActionDraft, ViewerNumericInput } from "../types.js";
import { useModalDialog } from "../useModalDialog.js";
import { ProductIcon } from "./ProductIcon.js";

const MULTITOUCH_KINDS = new Set(["pinch", "rotate", "twoFingerTap"]);
const MAX_WORKFLOW_STEPS = 50;

type SaveResult = { ok: true } | { ok: false; message: string };

export function WorkflowBuilderDialog({
  existingIds,
  onClose,
  onSave
}: {
  existingIds: string[];
  onClose: () => void;
  onSave: (workflow: GestureSequencePreset) => SaveResult;
}) {
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [steps, setSteps] = useState<GestureSequenceStep[]>([]);
  const [presetId, setPresetId] = useState("");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const { dialogRef } = useModalDialog(requestClose);

  const nameError = !name.trim()
    ? "Give this workflow a name."
    : name.trim().length > 80
      ? "Keep the workflow name under 80 characters."
      : "";
  const detailError = detail.trim().length > 240 ? "Keep the description under 240 characters." : "";
  const stepErrors = useMemo(() => steps.map(validateWorkflowStep), [steps]);
  const invalidStepCount = stepErrors.filter(Boolean).length;
  const validationIssueCount = invalidStepCount + (nameError ? 1 : 0) + (detailError ? 1 : 0) + (steps.length === 0 ? 1 : 0) + (steps.length > MAX_WORKFLOW_STEPS ? 1 : 0);
  const canSave = !nameError && !detailError && steps.length > 0 && steps.length <= MAX_WORKFLOW_STEPS && invalidStepCount === 0;
  const usesMultiTouch = steps.some((step) => MULTITOUCH_KINDS.has(step.action.kind));
  const dirty = Boolean(name || detail || steps.length || presetId);
  const normalizedCatalogQuery = catalogQuery.trim().toLowerCase();
  const visibleCatalog = GESTURE_STEP_CATALOG.map((step, index) => ({ step, index })).filter(({ step }) =>
    !normalizedCatalogQuery || `${step.label} ${step.action.kind}`.toLowerCase().includes(normalizedCatalogQuery)
  );

  function requestClose(): void {
    if (!dirty || confirmDiscard) {
      onClose();
      return;
    }
    setConfirmDiscard(true);
    setMessage("Your unsaved workflow is still here. Discard it or keep editing.");
  }

  const loadPreset = (nextPresetId: string): void => {
    setPresetId(nextPresetId);
    const preset = GESTURE_SEQUENCE_PRESETS.find((candidate) => candidate.id === nextPresetId);
    if (!preset) return;
    setName(preset.label);
    setDetail(preset.detail);
    setSteps(cloneGestureSteps(preset.steps));
    setConfirmDiscard(false);
    setMessage(`${preset.label} loaded as an editable draft.`);
  };

  const addStep = (catalogIndex: number): void => {
    const catalogStep = GESTURE_STEP_CATALOG[catalogIndex];
    if (!catalogStep || steps.length >= MAX_WORKFLOW_STEPS) return;
    setSteps((current) => [...current, ...cloneGestureSteps([catalogStep])]);
    setConfirmDiscard(false);
    setMessage(`${catalogStep.label} added as step ${steps.length + 1}.`);
  };

  const updateStep = (index: number, update: (step: GestureSequenceStep) => GestureSequenceStep): void => {
    setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? update(step) : step));
    setConfirmDiscard(false);
  };

  const moveStep = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((current) => {
      const next = [...current];
      const moving = next[index];
      const displaced = next[target];
      if (!moving || !displaced) return current;
      next[index] = displaced;
      next[target] = moving;
      return next;
    });
    setConfirmDiscard(false);
  };

  const save = (): void => {
    if (!canSave) {
      setMessage("Resolve the required fields and action issues before saving.");
      return;
    }
    const result = onSave({
      id: createGestureSequenceId(existingIds),
      label: name.trim(),
      detail: detail.trim() || `${steps.length} locally composed gesture steps.`,
      steps: cloneGestureSteps(steps)
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    onClose();
  };

  return (
    <div className="workflow-builder-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
      <section ref={dialogRef} className="workflow-builder" role="dialog" aria-modal="true" aria-labelledby="workflow-builder-title" tabIndex={-1}>
        <header className="workflow-builder-header">
          <div>
            <p className="kicker">Browser-local automation</p>
            <h2 id="workflow-builder-title">Create workflow</h2>
            <span>Assemble deterministic actions, then run the saved flow against any compatible Simulator session.</span>
          </div>
          <button type="button" aria-label="Close workflow builder" onClick={requestClose}><ProductIcon icon={Cancel01Icon} /></button>
        </header>

        <div className="workflow-builder-summary" aria-label="Workflow draft summary">
          <div><ProductIcon icon={WorkflowSquare03Icon} /><span><small>Draft</small><strong>{name.trim() || "Untitled workflow"}</strong></span></div>
          <div><small>Steps</small><strong>{steps.length}</strong></div>
          <div><small>Input</small><strong>{usesMultiTouch ? "XCUITest" : "Any backend"}</strong></div>
          <div><small>Validation</small><strong className={canSave ? "good" : "warn"}>{canSave ? "Ready" : `${validationIssueCount} issue${validationIssueCount === 1 ? "" : "s"}`}</strong></div>
        </div>

        <div className="workflow-builder-body">
          <div className="workflow-builder-definition">
            <section className="workflow-builder-basics" aria-labelledby="workflow-builder-basics-title">
              <div className="workflow-builder-section-title"><span>01</span><div><h3 id="workflow-builder-basics-title">Define the flow</h3><p>Name the reusable intent or begin with a proven template.</p></div></div>
              <div className="workflow-builder-fields">
                <label><span>Workflow name</span><input autoFocus value={name} maxLength={100} onChange={(event) => { setName(event.target.value); setConfirmDiscard(false); }} placeholder="Checkout recovery" aria-invalid={Boolean(nameError)} />{nameError ? <small className="workflow-field-error">{nameError}</small> : <small>Shown in the local workflow library.</small>}</label>
                <label><span>Description</span><textarea value={detail} maxLength={260} onChange={(event) => { setDetail(event.target.value); setConfirmDiscard(false); }} placeholder="What this workflow exercises and when to run it." aria-invalid={Boolean(detailError)} />{detailError ? <small className="workflow-field-error">{detailError}</small> : <small>Optional context for future operators.</small>}</label>
                <label><span>Start from template</span><select value={presetId} onChange={(event) => loadPreset(event.target.value)}><option value="">Blank workflow</option>{GESTURE_SEQUENCE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label} · {preset.steps.length} steps</option>)}</select><small>Templates are copied, so every step remains editable.</small></label>
              </div>
            </section>

            <section className="workflow-builder-sequence" aria-labelledby="workflow-builder-sequence-title">
              <div className="workflow-builder-section-title"><span>02</span><div><h3 id="workflow-builder-sequence-title">Order the actions</h3><p>Rename, configure, duplicate, move, or remove every step.</p></div><em>{steps.length}/{MAX_WORKFLOW_STEPS}</em></div>
              {usesMultiTouch ? <div className="workflow-builder-requirement"><strong>Native multi-touch detected</strong><span>Pinch, rotate, and two-finger tap require a session created with the XCUITest input backend.</span></div> : null}
              {steps.length ? (
                <ol className="workflow-builder-step-list">
                  {steps.map((step, index) => (
                    <li key={`${index}-${step.action.kind}`} className={stepErrors[index] ? "invalid" : ""}>
                      <header>
                        <span className="workflow-builder-step-index">{String(index + 1).padStart(2, "0")}</span>
                        <label><span className="sr-only">Step {index + 1} name</span><input value={step.label} maxLength={80} onChange={(event) => updateStep(index, (current) => ({ ...current, label: event.target.value }))} aria-invalid={!step.label.trim()} /></label>
                        <em>{step.action.kind}</em>
                        <div className="workflow-builder-step-actions">
                          <button type="button" disabled={index === 0} aria-label={`Move ${step.label || `step ${index + 1}`} up`} onClick={() => moveStep(index, -1)}>↑</button>
                          <button type="button" disabled={index === steps.length - 1} aria-label={`Move ${step.label || `step ${index + 1}`} down`} onClick={() => moveStep(index, 1)}>↓</button>
                          <button type="button" disabled={steps.length >= MAX_WORKFLOW_STEPS} aria-label={`Duplicate ${step.label || `step ${index + 1}`}`} onClick={() => setSteps((current) => [...current.slice(0, index + 1), ...cloneGestureSteps([step]), ...current.slice(index + 1)])}><ProductIcon icon={Copy01Icon} size={13} /></button>
                          <button type="button" aria-label={`Remove ${step.label || `step ${index + 1}`}`} onClick={() => setSteps((current) => current.filter((_, stepIndex) => stepIndex !== index))}><ProductIcon icon={Delete02Icon} size={13} /></button>
                        </div>
                      </header>
                      <WorkflowActionFields action={step.action} onChange={(action) => updateStep(index, (current) => ({ ...current, action }))} />
                      {stepErrors[index] ? <p className="workflow-step-error" role="alert">{stepErrors[index]}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="workflow-builder-empty"><ProductIcon icon={WorkflowSquare03Icon} size={22} /><strong>No actions yet</strong><p>Load a template or add an action from the gesture library.</p></div>
              )}
            </section>
          </div>

          <aside className="workflow-builder-catalog" aria-labelledby="workflow-builder-catalog-title">
            <div className="workflow-builder-section-title"><span>03</span><div><h3 id="workflow-builder-catalog-title">Action library</h3><p>Add real protocol actions to the end of this flow.</p></div></div>
            <label className="workflow-builder-search"><ProductIcon icon={Search01Icon} size={14} /><input type="search" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Search actions" aria-label="Search workflow actions" /></label>
            <div className="workflow-builder-action-list">
              {visibleCatalog.map(({ step, index }) => (
                <button type="button" key={`${step.label}-${index}`} onClick={() => addStep(index)} disabled={steps.length >= MAX_WORKFLOW_STEPS}>
                  <span><strong>{step.label}</strong><small>{step.action.kind}</small></span><ProductIcon icon={Add01Icon} size={14} />
                </button>
              ))}
              {!visibleCatalog.length ? <div className="workflow-builder-catalog-empty"><strong>No actions match</strong><button type="button" onClick={() => setCatalogQuery("")}>Clear search</button></div> : null}
            </div>
            <div className="workflow-builder-catalog-note"><strong>Evidence stays inspectable</strong><p>Every completed action is still recorded in the selected session timeline. A failure stops the remaining steps.</p></div>
          </aside>
        </div>

        <footer className="workflow-builder-footer">
          <span role="status" aria-live="polite">{message || (canSave ? "Ready to save in this browser." : steps.length ? "Review the highlighted requirements." : "Add at least one valid action.")}</span>
          {confirmDiscard ? <div className="workflow-builder-discard" role="alert"><strong>Discard this draft?</strong><button type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button type="button" onClick={onClose}>Discard</button></div> : <div className="workflow-builder-footer-actions"><button type="button" onClick={requestClose}>Cancel</button><button type="button" className="workflow-builder-save" disabled={!canSave} onClick={save}><ProductIcon icon={Add01Icon} />Save workflow</button></div>}
        </footer>
      </section>
    </div>
  );
}

function validateWorkflowStep(step: GestureSequenceStep): string {
  if (!step.label.trim()) return "Give this step a readable name.";
  try {
    buildViewerActionRequest(step.action);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "This action is not valid.";
  }
}

function WorkflowActionFields({ action, onChange }: { action: ViewerActionDraft; onChange: (action: ViewerActionDraft) => void }) {
  switch (action.kind) {
    case "screenshot":
      return <ActionField label="Evidence reason"><input value={action.reason ?? ""} onChange={(event) => onChange({ ...action, reason: event.target.value })} placeholder="workflow checkpoint" /></ActionField>;
    case "wait":
      return <NumericField label="Duration (ms)" value={action.durationMs} onChange={(durationMs) => onChange({ ...action, durationMs })} />;
    case "tap":
      return <ActionFieldGrid><NumericField label="X (0–1)" value={action.x} onChange={(x) => onChange({ ...action, x })} /><NumericField label="Y (0–1)" value={action.y} onChange={(y) => onChange({ ...action, y })} /></ActionFieldGrid>;
    case "typeText":
      return <ActionField label="Text"><input value={action.text} onChange={(event) => onChange({ ...action, text: event.target.value })} placeholder="Text to type" /></ActionField>;
    case "swipe":
      return <ActionFieldGrid><NumericField label="From X" value={action.from.x} onChange={(x) => onChange({ ...action, from: { ...action.from, x } })} /><NumericField label="From Y" value={action.from.y} onChange={(y) => onChange({ ...action, from: { ...action.from, y } })} /><NumericField label="To X" value={action.to.x} onChange={(x) => onChange({ ...action, to: { ...action.to, x } })} /><NumericField label="To Y" value={action.to.y} onChange={(y) => onChange({ ...action, to: { ...action.to, y } })} /><NumericField label="Duration (ms)" value={action.durationMs} onChange={(durationMs) => onChange({ ...action, durationMs })} /></ActionFieldGrid>;
    case "edgeGesture":
      return <ActionFieldGrid><ActionField label="Edge"><select value={action.edge} onChange={(event) => onChange({ ...action, edge: event.target.value as typeof action.edge })}><option value="left">Left</option><option value="right">Right</option><option value="top">Top</option><option value="bottom">Bottom</option></select></ActionField><NumericField label="Distance (0–1)" value={action.distance} onChange={(distance) => onChange({ ...action, distance })} /><NumericField label="Duration (ms)" value={action.durationMs} onChange={(durationMs) => onChange({ ...action, durationMs })} /></ActionFieldGrid>;
    case "longPress":
      return <ActionFieldGrid><NumericField label="X (0–1)" value={action.x} onChange={(x) => onChange({ ...action, x })} /><NumericField label="Y (0–1)" value={action.y} onChange={(y) => onChange({ ...action, y })} /><NumericField label="Duration (ms)" value={action.durationMs} onChange={(durationMs) => onChange({ ...action, durationMs })} /></ActionFieldGrid>;
    case "pinch":
      return <ActionFieldGrid><NumericField label="Scale" value={action.scale} onChange={(scale) => onChange({ ...action, scale })} /><NumericField label="Velocity" value={action.velocity} onChange={(velocity) => onChange({ ...action, velocity })} /><ActionField label="Target identifier"><input value={action.identifier ?? ""} onChange={(event) => onChange({ ...action, identifier: event.target.value })} placeholder="Optional" /></ActionField><NumericField label="Timeout (ms)" value={action.timeoutMs ?? ""} onChange={(timeoutMs) => onChange({ ...action, timeoutMs })} placeholder="Optional" /></ActionFieldGrid>;
    case "rotate":
      return <ActionFieldGrid><NumericField label="Radians" value={action.rotation} onChange={(rotation) => onChange({ ...action, rotation })} /><NumericField label="Velocity" value={action.velocity} onChange={(velocity) => onChange({ ...action, velocity })} /><ActionField label="Target identifier"><input value={action.identifier ?? ""} onChange={(event) => onChange({ ...action, identifier: event.target.value })} placeholder="Optional" /></ActionField><NumericField label="Timeout (ms)" value={action.timeoutMs ?? ""} onChange={(timeoutMs) => onChange({ ...action, timeoutMs })} placeholder="Optional" /></ActionFieldGrid>;
    case "twoFingerTap":
      return <ActionFieldGrid><ActionField label="Target identifier"><input value={action.identifier ?? ""} onChange={(event) => onChange({ ...action, identifier: event.target.value })} placeholder="Optional" /></ActionField><NumericField label="Timeout (ms)" value={action.timeoutMs ?? ""} onChange={(timeoutMs) => onChange({ ...action, timeoutMs })} placeholder="Optional" /></ActionFieldGrid>;
    case "tapElement":
    case "assertVisible":
      return <ActionFieldGrid><ActionField label="Accessibility identifier"><input value={action.identifier} onChange={(event) => onChange({ ...action, identifier: event.target.value })} placeholder="checkout.continue" /></ActionField><NumericField label="Timeout (ms)" value={action.timeoutMs ?? ""} onChange={(timeoutMs) => onChange({ ...action, timeoutMs })} placeholder="Optional" /></ActionFieldGrid>;
  }
}

function ActionFieldGrid({ children }: { children: ReactNode }) {
  return <div className="workflow-action-fields">{children}</div>;
}

function ActionField({ label, children }: { label: string; children: ReactNode }) {
  return <label className="workflow-action-field"><span>{label}</span>{children}</label>;
}

function NumericField({ label, value, placeholder, onChange }: { label: string; value: ViewerNumericInput; placeholder?: string; onChange: (value: string) => void }) {
  return <ActionField label={label}><input inputMode="decimal" value={String(value)} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></ActionField>;
}
