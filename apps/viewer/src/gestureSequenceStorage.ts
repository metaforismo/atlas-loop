import type { GestureSequencePreset, GestureSequenceStep } from "./gestureSequences.js";
import { buildViewerActionRequest } from "./api.js";

export const GESTURE_SEQUENCE_STORAGE_KEY = "atlas-loop.gesture-sequences.v1";

export function createGestureSequenceId(existingIds: Iterable<string> = []): string {
  const existing = new Set(existingIds);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 12)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const id = `flow-${suffix}`;
    if (!existing.has(id)) return id;
  }
  return `flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export function loadSavedGestureSequences(storage: Storage = window.localStorage): GestureSequencePreset[] {
  try {
    const raw = storage.getItem(GESTURE_SEQUENCE_STORAGE_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter(isGestureSequencePreset).map(cloneSequence) : [];
  } catch {
    return [];
  }
}

export function saveGestureSequence(
  sequence: GestureSequencePreset,
  storage: Storage = window.localStorage
): GestureSequencePreset[] {
  if (!isGestureSequencePreset(sequence)) throw new Error("Workflow contains invalid or unsupported actions.");
  const saved = loadSavedGestureSequences(storage);
  const next = [cloneSequence(sequence), ...saved.filter((candidate) => candidate.id !== sequence.id)].slice(0, 24);
  storage.setItem(GESTURE_SEQUENCE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function deleteGestureSequence(id: string, storage: Storage = window.localStorage): GestureSequencePreset[] {
  const next = loadSavedGestureSequences(storage).filter((candidate) => candidate.id !== id);
  storage.setItem(GESTURE_SEQUENCE_STORAGE_KEY, JSON.stringify(next));
  return next;
}

function cloneSequence(sequence: GestureSequencePreset): GestureSequencePreset {
  return {
    ...sequence,
    steps: sequence.steps.map((step) => ({ ...step, action: structuredClone(step.action) }))
  };
}

function isGestureSequencePreset(value: unknown): value is GestureSequencePreset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GestureSequencePreset>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.trim().length > 0 &&
    typeof candidate.label === "string" &&
    candidate.label.trim().length > 0 &&
    typeof candidate.detail === "string" &&
    Array.isArray(candidate.steps) &&
    candidate.steps.length > 0 &&
    candidate.steps.length <= 50 &&
    candidate.steps.every(isGestureSequenceStep)
  );
}

function isGestureSequenceStep(value: unknown): value is GestureSequenceStep {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GestureSequenceStep>;
  if (typeof candidate.label !== "string" || !candidate.label.trim() || !candidate.action || typeof candidate.action !== "object") return false;
  const kind = (candidate.action as { kind?: unknown }).kind;
  if (![
    "screenshot",
    "wait",
    "tap",
    "typeText",
    "swipe",
    "edgeGesture",
    "longPress",
    "pinch",
    "rotate",
    "twoFingerTap",
    "tapElement",
    "assertVisible"
  ].includes(String(kind))) return false;
  try {
    buildViewerActionRequest(candidate.action as GestureSequenceStep["action"]);
    return true;
  } catch {
    return false;
  }
}
