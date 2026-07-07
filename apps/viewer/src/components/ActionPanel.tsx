import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { performViewerAction } from "../api.js";
import { formatTapCoordinate } from "../screenshotGeometry.js";
import type { ActionResultLike, HealthState, Session, SessionSummary, ViewerActionDraft, ViewerActionKind, ViewerParams } from "../types.js";
import type { UiTone } from "../viewerPresentation.js";

const VIEWER_ACTION_LABELS: Record<ViewerActionKind, string> = {
  screenshot: "Screenshot",
  wait: "Wait",
  tap: "Tap",
  typeText: "Type",
  swipe: "Swipe",
  tapElement: "Tap element",
  assertVisible: "Assert visible"
};

export interface ViewerActionFormState {
  screenshotReason: string;
  waitDurationMs: string;
  tapX: string;
  tapY: string;
  typeText: string;
  elementIdentifier: string;
  elementTimeoutMs: string;
  swipeFromX: string;
  swipeFromY: string;
  swipeToX: string;
  swipeToY: string;
  swipeDurationMs: string;
}

export type ViewerActionFormField = keyof ViewerActionFormState;

type ViewerActionSubmitState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string; message: string }
  | { status: "error"; label: string; message: string };

export interface ActionMutationState {
  canSubmitActions: boolean;
  title: string;
  detail: string;
  tone: UiTone;
}

interface ActionTapPreset {
  label: string;
  x: string;
  y: string;
  ariaLabel: string;
}

interface ActionWaitPreset {
  label: string;
  durationMs: string;
  ariaLabel: string;
}

export const DEFAULT_ACTION_FORM: ViewerActionFormState = {
  screenshotReason: "",
  waitDurationMs: "500",
  tapX: "0.5",
  tapY: "0.5",
  typeText: "",
  elementIdentifier: "",
  elementTimeoutMs: "5000",
  swipeFromX: "0.5",
  swipeFromY: "0.82",
  swipeToX: "0.5",
  swipeToY: "0.18",
  swipeDurationMs: "300"
};

const ACTION_TAP_PRESETS: ActionTapPreset[] = [
  { label: "Back", x: "0.085", y: "0.075", ariaLabel: "Set tap target to top back button: x 0.085, y 0.075" },
  { label: "Center", x: "0.500", y: "0.500", ariaLabel: "Set tap target to center: x 0.500, y 0.500" },
  { label: "Primary", x: "0.500", y: "0.910", ariaLabel: "Set tap target to bottom primary action: x 0.500, y 0.910" }
];

const ACTION_WAIT_PRESETS: ActionWaitPreset[] = [
  { label: "250", durationMs: "250", ariaLabel: "Set wait duration to 250 milliseconds" },
  { label: "500", durationMs: "500", ariaLabel: "Set wait duration to 500 milliseconds" },
  { label: "1000", durationMs: "1000", ariaLabel: "Set wait duration to 1000 milliseconds" }
];

function tapPresetMatches(form: ViewerActionFormState, preset: ActionTapPreset): boolean {
  return normalizedStringMatches(form.tapX, preset.x) && normalizedStringMatches(form.tapY, preset.y);
}

function normalizedStringMatches(value: string, expected: string): boolean {
  const parsed = Number(value);
  const expectedParsed = Number(expected);
  return Number.isFinite(parsed) && Number.isFinite(expectedParsed) && formatTapCoordinate(parsed) === formatTapCoordinate(expectedParsed);
}

export function ActionPanel({
  params,
  selectedSessionId,
  mutationState,
  form,
  onFieldChange
}: {
  params: ViewerParams;
  selectedSessionId: string;
  mutationState: ActionMutationState;
  form: ViewerActionFormState;
  onFieldChange: (field: ViewerActionFormField, value: string) => void;
}) {
  const [submitState, setSubmitState] = useState<ViewerActionSubmitState>({ status: "idle" });
  const actionParams: ViewerParams = { ...params, sessionId: selectedSessionId };
  const isPending = submitState.status === "pending";
  const submitDisabled = isPending || !mutationState.canSubmitActions;
  const statusTone = actionSubmitTone(submitState);

  useEffect(() => {
    setSubmitState({ status: "idle" });
  }, [params.daemonUrl, selectedSessionId]);

  const submitAction = async (draft: ViewerActionDraft, label: string): Promise<void> => {
    setSubmitState({ status: "pending", label });
    try {
      const result = await performViewerAction(actionParams, draft);
      if (!result.ok) {
        setSubmitState({ status: "error", label, message: result.error?.message ?? `${label} failed.` });
        return;
      }
      setSubmitState({ status: "success", label, message: actionResultMessage(result) });
    } catch (error) {
      setSubmitState({ status: "error", label, message: error instanceof Error ? error.message : `${label} failed.` });
    }
  };

  const onSubmit = (draft: ViewerActionDraft, label: string) => (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (submitDisabled) return;
    void submitAction(draft, label);
  };

  return (
    <section className="inspector-section action-panel" aria-label="Actions" aria-busy={isPending}>
      <div className="panel-title-row">
        <h2>Actions</h2>
        <span>{selectedSessionId}</span>
      </div>

      <div className={`action-availability tone-${mutationState.tone}`} role="status" aria-live="polite" aria-atomic="true">
        <strong>{mutationState.title}</strong>
        <span>{mutationState.detail}</span>
      </div>

      <ActionShortcutPanel form={form} onFieldChange={onFieldChange} />

      <div className="action-panel-grid">
        <form className="action-row" onSubmit={onSubmit({ kind: "screenshot", reason: form.screenshotReason }, VIEWER_ACTION_LABELS.screenshot)}>
          <ActionTextInput
            id="action-screenshot-reason"
            label="Reason"
            value={form.screenshotReason}
            placeholder="manual"
            onChange={(value) => onFieldChange("screenshotReason", value)}
          />
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.screenshot} pending={isPending} disabled={submitDisabled} disabledReason={mutationState.title} />
        </form>

        <form className="action-row" onSubmit={onSubmit({ kind: "wait", durationMs: form.waitDurationMs }, VIEWER_ACTION_LABELS.wait)}>
          <ActionNumberInput
            id="action-wait-duration"
            label="Duration ms"
            value={form.waitDurationMs}
            min={0}
            step={100}
            onChange={(value) => onFieldChange("waitDurationMs", value)}
          />
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.wait} pending={isPending} disabled={submitDisabled} disabledReason={mutationState.title} />
        </form>

        <form className="action-row" onSubmit={onSubmit({ kind: "tap", x: form.tapX, y: form.tapY }, VIEWER_ACTION_LABELS.tap)}>
          <div className="action-coordinate-pair">
            <ActionNumberInput
              id="action-tap-x"
              label="X 0-1"
              value={form.tapX}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("tapX", value)}
            />
            <ActionNumberInput
              id="action-tap-y"
              label="Y 0-1"
              value={form.tapY}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("tapY", value)}
            />
          </div>
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.tap} pending={isPending} disabled={submitDisabled} disabledReason={mutationState.title} />
        </form>

        <form
          className="action-row action-row-wide"
          onSubmit={onSubmit(
            { kind: "tapElement", identifier: form.elementIdentifier, timeoutMs: form.elementTimeoutMs },
            VIEWER_ACTION_LABELS.tapElement
          )}
        >
          <div className="action-coordinate-pair">
            <ActionTextInput
              id="action-element-identifier"
              label="Accessibility id"
              value={form.elementIdentifier}
              placeholder="cart.continue"
              onChange={(value) => onFieldChange("elementIdentifier", value)}
            />
            <ActionNumberInput
              id="action-element-timeout"
              label="Timeout ms"
              value={form.elementTimeoutMs}
              min={0}
              step={500}
              onChange={(value) => onFieldChange("elementTimeoutMs", value)}
            />
          </div>
          <div className="action-element-buttons">
            <ActionSubmitButton label={VIEWER_ACTION_LABELS.tapElement} pending={isPending} disabled={submitDisabled} disabledReason={mutationState.title} />
            <button
              type="button"
              disabled={submitDisabled}
              title={submitDisabled && !isPending ? mutationState.title : undefined}
              onClick={() => {
                if (submitDisabled) return;
                void submitAction(
                  { kind: "assertVisible", identifier: form.elementIdentifier, timeoutMs: form.elementTimeoutMs },
                  VIEWER_ACTION_LABELS.assertVisible
                );
              }}
            >
              {isPending ? "Pending" : VIEWER_ACTION_LABELS.assertVisible}
            </button>
          </div>
        </form>

        <form className="action-row" onSubmit={onSubmit({ kind: "typeText", text: form.typeText }, VIEWER_ACTION_LABELS.typeText)}>
          <ActionTextInput
            id="action-type-text"
            label="Text"
            value={form.typeText}
            placeholder="Hello"
            onChange={(value) => onFieldChange("typeText", value)}
          />
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.typeText} pending={isPending} disabled={submitDisabled} disabledReason={mutationState.title} />
        </form>

        <form
          className="action-row action-row-wide"
          onSubmit={onSubmit(
            {
              kind: "swipe",
              from: { x: form.swipeFromX, y: form.swipeFromY },
              to: { x: form.swipeToX, y: form.swipeToY },
              durationMs: form.swipeDurationMs
            },
            VIEWER_ACTION_LABELS.swipe
          )}
        >
          <div className="action-swipe-grid">
            <ActionNumberInput
              id="action-swipe-from-x"
              label="From X 0-1"
              value={form.swipeFromX}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeFromX", value)}
            />
            <ActionNumberInput
              id="action-swipe-from-y"
              label="From Y 0-1"
              value={form.swipeFromY}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeFromY", value)}
            />
            <ActionNumberInput
              id="action-swipe-to-x"
              label="To X 0-1"
              value={form.swipeToX}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeToX", value)}
            />
            <ActionNumberInput
              id="action-swipe-to-y"
              label="To Y 0-1"
              value={form.swipeToY}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeToY", value)}
            />
            <ActionNumberInput
              id="action-swipe-duration"
              label="Duration ms"
              value={form.swipeDurationMs}
              min={0}
              step={50}
              onChange={(value) => onFieldChange("swipeDurationMs", value)}
            />
          </div>
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.swipe} pending={isPending} disabled={submitDisabled} disabledReason={mutationState.title} />
        </form>
      </div>

      <div className={`action-status tone-${statusTone}`} role="status" aria-live="polite" aria-atomic="true">
        <strong>{actionStatusTitle(submitState)}</strong>
        <span>{actionStatusMessage(submitState)}</span>
      </div>
    </section>
  );
}

function ActionShortcutPanel({
  form,
  onFieldChange
}: {
  form: ViewerActionFormState;
  onFieldChange: (field: ViewerActionFormField, value: string) => void;
}) {
  const applyTapPreset = (preset: ActionTapPreset): void => {
    onFieldChange("tapX", preset.x);
    onFieldChange("tapY", preset.y);
  };

  return (
    <div className="action-shortcuts" aria-label="Action presets">
      <div className="action-shortcut-group" role="group" aria-label="Tap target presets">
        <span className="action-shortcut-label">Tap target</span>
        <div className="action-shortcut-buttons">
          {ACTION_TAP_PRESETS.map((preset) => {
            const selected = tapPresetMatches(form, preset);
            return (
              <button
                key={preset.label}
                type="button"
                className={`action-shortcut-button ${selected ? "selected" : ""}`}
                aria-label={preset.ariaLabel}
                aria-pressed={selected}
                onClick={() => applyTapPreset(preset)}
              >
                <strong>{preset.label}</strong>
                <span>
                  {preset.x}/{preset.y}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="action-shortcut-group" role="group" aria-label="Wait duration presets">
        <span className="action-shortcut-label">Wait</span>
        <div className="action-shortcut-buttons">
          {ACTION_WAIT_PRESETS.map((preset) => {
            const selected = form.waitDurationMs === preset.durationMs;
            return (
              <button
                key={preset.durationMs}
                type="button"
                className={`action-shortcut-button ${selected ? "selected" : ""}`}
                aria-label={preset.ariaLabel}
                aria-pressed={selected}
                onClick={() => onFieldChange("waitDurationMs", preset.durationMs)}
              >
                <strong>{preset.label}</strong>
                <span>ms</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActionNumberInput({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  min?: number;
  max?: number;
  step: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="action-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        required
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ActionTextInput({
  id,
  label,
  value,
  placeholder,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="action-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ActionSubmitButton({ label, pending, disabled, disabledReason }: { label: string; pending: boolean; disabled: boolean; disabledReason: string }) {
  return (
    <button type="submit" disabled={disabled} title={disabled && !pending ? disabledReason : undefined}>
      {pending ? "Pending" : label}
    </button>
  );
}

function actionResultMessage(result: ActionResultLike): string {
  const artifactCount = result.artifacts?.length ?? 0;
  const artifactLabel = artifactCount === 1 ? "1 artifact" : `${artifactCount} artifacts`;
  return `${result.actionId} completed, ${artifactLabel}.`;
}

function actionSubmitTone(state: ViewerActionSubmitState): UiTone {
  if (state.status === "success") return "good";
  if (state.status === "error") return "bad";
  if (state.status === "pending") return "warn";
  return "neutral";
}

function actionStatusTitle(state: ViewerActionSubmitState): string {
  if (state.status === "idle") return "Ready";
  if (state.status === "pending") return `${state.label} pending`;
  if (state.status === "success") return `${state.label} complete`;
  return `${state.label} failed`;
}

function actionStatusMessage(state: ViewerActionSubmitState): string {
  if (state.status === "idle") return "No action submitted.";
  if (state.status === "pending") return "Waiting for daemon response.";
  return state.message;
}

export function getActionMutationState(health: HealthState, storageSource: SessionSummary["storage"]["source"] | undefined, status: Session["status"] | undefined): ActionMutationState {
  if (health === "offline") {
    return {
      canSubmitActions: false,
      title: "Daemon offline",
      detail: "Actions need a reachable daemon.",
      tone: "bad"
    };
  }

  if (status === "ended" || status === "failed") {
    return {
      canSubmitActions: false,
      title: "Session ended",
      detail: `${status} sessions are evidence only.`,
      tone: "neutral"
    };
  }

  if (!status || status === "unknown" || !storageSource) {
    return {
      canSubmitActions: false,
      title: "Session state pending",
      detail: "Waiting for storage and status.",
      tone: "warn"
    };
  }

  if (storageSource !== "memory") {
    return {
      canSubmitActions: false,
      title: "Read-only evidence",
      detail: `${storageSource} storage does not accept actions.`,
      tone: "warn"
    };
  }

  return {
    canSubmitActions: true,
    title: "Live memory session",
    detail: "Actions send to daemon.",
    tone: "good"
  };
}
