import { useState } from "react";
import {
  cloneGestureSteps,
  GESTURE_SEQUENCE_PRESETS,
  GESTURE_STEP_CATALOG,
  type GestureSequencePreset,
  type GestureSequenceStep
} from "../gestureSequences.js";
import { deleteGestureSequence, loadSavedGestureSequences, saveGestureSequence } from "../gestureSequenceStorage.js";

export function GestureSequenceComposer({
  disabled,
  disabledReason,
  running,
  onRun
}: {
  disabled: boolean;
  disabledReason: string;
  running: boolean;
  onRun: (sequence: GestureSequencePreset) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Scroll coverage check");
  const [steps, setSteps] = useState<GestureSequenceStep[]>(() => cloneGestureSteps(GESTURE_SEQUENCE_PRESETS[1]?.steps ?? []));
  const [catalogIndex, setCatalogIndex] = useState("0");
  const [savedFlows, setSavedFlows] = useState<GestureSequencePreset[]>(() => loadSavedGestureSequences());
  const [savedFlowId, setSavedFlowId] = useState("");
  const [libraryMessage, setLibraryMessage] = useState("");

  const loadPreset = (presetId: string): void => {
    const preset = GESTURE_SEQUENCE_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) return;
    setName(preset.label);
    setSteps(cloneGestureSteps(preset.steps));
    setSavedFlowId("");
    setLibraryMessage(`Loaded ${preset.label}.`);
  };

  const loadSavedFlow = (flowId: string): void => {
    const flow = savedFlows.find((candidate) => candidate.id === flowId);
    if (!flow) return;
    setSavedFlowId(flow.id);
    setName(flow.label);
    setSteps(cloneGestureSteps(flow.steps));
    setLibraryMessage(`Loaded ${flow.label} from this browser.`);
  };

  const saveFlow = (): void => {
    if (steps.length === 0) {
      setLibraryMessage("Add at least one step before saving.");
      return;
    }
    const label = name.trim() || "Custom gesture flow";
    const id = savedFlowId || `flow-${Date.now().toString(36)}`;
    const sequence: GestureSequencePreset = {
      id,
      label,
      detail: "Saved locally from the Atlas Loop gesture composer.",
      steps: cloneGestureSteps(steps)
    };
    try {
      setSavedFlows(saveGestureSequence(sequence));
      setSavedFlowId(id);
      setLibraryMessage(`${label} saved to this browser.`);
    } catch {
      setLibraryMessage("This browser could not save the flow. Check local storage permissions.");
    }
  };

  const deleteSavedFlow = (): void => {
    if (!savedFlowId) return;
    try {
      const deleted = savedFlows.find((candidate) => candidate.id === savedFlowId);
      setSavedFlows(deleteGestureSequence(savedFlowId));
      setSavedFlowId("");
      setLibraryMessage(`${deleted?.label ?? "Saved flow"} removed from this browser.`);
    } catch {
      setLibraryMessage("This browser could not remove the saved flow.");
    }
  };

  const moveStep = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    setSteps((current) => {
      const next = [...current];
      const moving = next[index];
      const replaced = next[target];
      if (!moving || !replaced) return current;
      next[index] = replaced;
      next[target] = moving;
      return next;
    });
  };

  const addStep = (): void => {
    const catalogStep = GESTURE_STEP_CATALOG[Number(catalogIndex)];
    if (!catalogStep) return;
    setSteps((current) => [...current, ...cloneGestureSteps([catalogStep])]);
  };

  const run = (): void => {
    if (disabled || steps.length === 0) return;
    const label = name.trim() || "Custom gesture flow";
    onRun({
      id: "custom-gesture-flow",
      label,
      detail: "Custom sequence composed in the local viewer.",
      steps: cloneGestureSteps(steps)
    });
  };

  return (
    <section className={`sequence-composer ${open ? "open" : ""}`} aria-labelledby="sequence-composer-title">
      <button
        type="button"
        className="sequence-composer-toggle"
        aria-expanded={open}
        aria-controls="sequence-composer-body"
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <small>Reusable flow</small>
          <strong id="sequence-composer-title">Compose a gesture sequence</strong>
        </span>
        <span aria-hidden="true">{open ? "Close" : "Customize"}</span>
      </button>

      {open ? (
        <div id="sequence-composer-body" className="sequence-composer-body">
          <div className="sequence-composer-fields">
            <label>
              <span>Flow name</span>
              <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              <span>Load template</span>
              <select defaultValue="" onChange={(event) => loadPreset(event.target.value)}>
                <option value="" disabled>Select a preset</option>
                {GESTURE_SEQUENCE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
            </label>
            <label>
              <span>Saved flows</span>
              <select value={savedFlowId} onChange={(event) => loadSavedFlow(event.target.value)}>
                <option value="">{savedFlows.length ? "Select from library" : "No saved flows yet"}</option>
                {savedFlows.map((flow) => <option key={flow.id} value={flow.id}>{flow.label}</option>)}
              </select>
            </label>
          </div>

          <div className="sequence-library-actions">
            <button type="button" onClick={saveFlow} disabled={running || steps.length === 0}>{savedFlowId ? "Update saved flow" : "Save to flow library"}</button>
            <button type="button" onClick={deleteSavedFlow} disabled={running || !savedFlowId}>Delete saved flow</button>
            <span role="status" aria-live="polite">{libraryMessage}</span>
          </div>

          <ol className="sequence-step-list" aria-label="Custom gesture sequence steps">
            {steps.length === 0 ? (
              <li className="sequence-step-empty">No steps yet. Add a gesture or checkpoint below.</li>
            ) : steps.map((step, index) => (
              <li key={`${step.label}-${index}`}>
                <span className="sequence-step-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="sequence-step-copy"><strong>{step.label}</strong><small>{step.action.kind}</small></span>
                <span className="sequence-step-actions">
                  <button type="button" aria-label={`Move ${step.label} up`} disabled={index === 0 || running} onClick={() => moveStep(index, -1)}>Up</button>
                  <button type="button" aria-label={`Move ${step.label} down`} disabled={index === steps.length - 1 || running} onClick={() => moveStep(index, 1)}>Down</button>
                  <button type="button" aria-label={`Remove ${step.label}`} disabled={running} onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
                </span>
              </li>
            ))}
          </ol>

          <div className="sequence-composer-footer">
            <label>
              <span className="sr-only">Step to add</span>
              <select value={catalogIndex} onChange={(event) => setCatalogIndex(event.target.value)}>
                {GESTURE_STEP_CATALOG.map((step, index) => <option key={step.label} value={index}>{step.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={addStep} disabled={running}>Add step</button>
            <button
              type="button"
              className="sequence-run-custom"
              disabled={disabled || steps.length === 0}
              title={disabled && !running ? disabledReason : undefined}
              onClick={run}
            >
              {running ? "Sequence running" : `Run ${steps.length} steps`}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
