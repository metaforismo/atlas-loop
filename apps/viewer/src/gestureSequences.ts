import type { ViewerActionDraft } from "./types.js";

export interface GestureSequenceStep {
  label: string;
  action: ViewerActionDraft;
}

export interface GestureSequencePreset {
  id: string;
  label: string;
  detail: string;
  steps: GestureSequenceStep[];
}

export const GESTURE_SEQUENCE_PRESETS: GestureSequencePreset[] = [
  {
    id: "pull-refresh",
    label: "Pull to refresh",
    detail: "Pull down, then allow network and layout work to settle.",
    steps: [
      {
        label: "Pull down",
        action: { kind: "swipe", from: { x: "0.5", y: "0.24" }, to: { x: "0.5", y: "0.78" }, durationMs: "450" }
      },
      { label: "Settle", action: { kind: "wait", durationMs: "800" } }
    ]
  },
  {
    id: "scroll-reveal",
    label: "Scroll and reveal",
    detail: "Exercise two viewport advances with an animation-safe pause.",
    steps: [
      {
        label: "First scroll",
        action: { kind: "swipe", from: { x: "0.5", y: "0.82" }, to: { x: "0.5", y: "0.22" }, durationMs: "320" }
      },
      { label: "Settle", action: { kind: "wait", durationMs: "250" } },
      {
        label: "Second scroll",
        action: { kind: "swipe", from: { x: "0.5", y: "0.82" }, to: { x: "0.5", y: "0.22" }, durationMs: "320" }
      }
    ]
  },
  {
    id: "back-settle",
    label: "Back and settle",
    detail: "Use the iOS leading-edge gesture, then wait for navigation.",
    steps: [
      { label: "Navigate back", action: { kind: "edgeGesture", edge: "left", distance: "0.55", durationMs: "320" } },
      { label: "Settle", action: { kind: "wait", durationMs: "350" } }
    ]
  },
  {
    id: "carousel-scan",
    label: "Carousel scan",
    detail: "Move one page in each direction to catch paging regressions.",
    steps: [
      {
        label: "Advance",
        action: { kind: "swipe", from: { x: "0.82", y: "0.5" }, to: { x: "0.18", y: "0.5" }, durationMs: "300" }
      },
      { label: "Settle", action: { kind: "wait", durationMs: "250" } },
      {
        label: "Return",
        action: { kind: "swipe", from: { x: "0.18", y: "0.5" }, to: { x: "0.82", y: "0.5" }, durationMs: "300" }
      }
    ]
  },
  {
    id: "pinch-zoom-audit",
    label: "Pinch zoom audit",
    detail: "Open and close a two-touch pinch to catch zoom and canvas regressions.",
    steps: [
      { label: "Pinch open", action: { kind: "pinch", scale: "1.8", velocity: "1" } },
      { label: "Settle", action: { kind: "wait", durationMs: "250" } },
      { label: "Pinch close", action: { kind: "pinch", scale: "0.55", velocity: "-1" } },
      { label: "Capture", action: { kind: "screenshot", reason: "pinch zoom audit" } }
    ]
  },
  {
    id: "rotation-audit",
    label: "Rotation audit",
    detail: "Rotate a two-touch target clockwise and back to its original state.",
    steps: [
      { label: "Rotate clockwise", action: { kind: "rotate", rotation: "1.57", velocity: "1" } },
      { label: "Settle", action: { kind: "wait", durationMs: "250" } },
      { label: "Rotate back", action: { kind: "rotate", rotation: "-1.57", velocity: "-1" } },
      { label: "Capture", action: { kind: "screenshot", reason: "rotation audit" } }
    ]
  },
  {
    id: "press-context-audit",
    label: "Press context audit",
    detail: "Hold the center target long enough to reveal menus, previews, or drag states.",
    steps: [
      { label: "Long press", action: { kind: "longPress", x: "0.5", y: "0.5", durationMs: "800" } },
      { label: "Settle", action: { kind: "wait", durationMs: "250" } },
      { label: "Capture", action: { kind: "screenshot", reason: "long press context audit" } }
    ]
  }
];

export const GESTURE_STEP_CATALOG: GestureSequenceStep[] = [
  {
    label: "Swipe up",
    action: { kind: "swipe", from: { x: "0.5", y: "0.82" }, to: { x: "0.5", y: "0.18" }, durationMs: "320" }
  },
  {
    label: "Swipe down",
    action: { kind: "swipe", from: { x: "0.5", y: "0.18" }, to: { x: "0.5", y: "0.82" }, durationMs: "320" }
  },
  {
    label: "Swipe left",
    action: { kind: "swipe", from: { x: "0.82", y: "0.5" }, to: { x: "0.18", y: "0.5" }, durationMs: "300" }
  },
  {
    label: "Swipe right",
    action: { kind: "swipe", from: { x: "0.18", y: "0.5" }, to: { x: "0.82", y: "0.5" }, durationMs: "300" }
  },
  { label: "Navigate back", action: { kind: "edgeGesture", edge: "left", distance: "0.55", durationMs: "320" } },
  { label: "Tap center", action: { kind: "tap", x: "0.5", y: "0.5" } },
  { label: "Long press center", action: { kind: "longPress", x: "0.5", y: "0.5", durationMs: "800" } },
  { label: "Pinch open", action: { kind: "pinch", scale: "1.8", velocity: "1" } },
  { label: "Pinch close", action: { kind: "pinch", scale: "0.55", velocity: "-1" } },
  { label: "Rotate clockwise", action: { kind: "rotate", rotation: "1.57", velocity: "1" } },
  { label: "Rotate counterclockwise", action: { kind: "rotate", rotation: "-1.57", velocity: "-1" } },
  { label: "Two-finger tap", action: { kind: "twoFingerTap" } },
  { label: "Tap accessibility element", action: { kind: "tapElement", identifier: "" } },
  { label: "Type text", action: { kind: "typeText", text: "" } },
  { label: "Verify element is visible", action: { kind: "assertVisible", identifier: "" } },
  { label: "Wait for layout", action: { kind: "wait", durationMs: "500" } },
  { label: "Capture checkpoint", action: { kind: "screenshot", reason: "gesture sequence checkpoint" } }
];

export function cloneGestureSteps(steps: GestureSequenceStep[]): GestureSequenceStep[] {
  return steps.map((step) => ({ ...step, action: structuredClone(step.action) }));
}
