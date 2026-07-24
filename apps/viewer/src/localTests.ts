import type { GestureSequencePreset, GestureSequenceStep } from "./gestureSequences.js";

export type LocalTestPlatform = "ios-simulator";
export type LocalTestRunStatus = "passed" | "failed" | "cancelled";

export interface LocalTestDefinition extends GestureSequencePreset {
  platform: LocalTestPlatform;
  appBundleId?: string;
  tags: string[];
  script: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocalTestRunRecord {
  testKey: string;
  status: LocalTestRunStatus;
  sessionId: string;
  completedSteps: number;
  totalSteps: number;
  message: string;
  ranAt: string;
}

export interface LocalTestCompileError {
  line: number;
  source: string;
  message: string;
}

export interface LocalTestCompileResult {
  steps: GestureSequenceStep[];
  errors: LocalTestCompileError[];
}

export const DEFAULT_LOCAL_TEST_SCRIPT = `Tap "cart.continue"
Verify "confirmation" is visible
Capture "checkout confirmation"`;

export const LOCAL_TEST_STARTERS: LocalTestDefinition[] = [
  {
    id: "checkout-confirmation",
    label: "Checkout confirmation",
    detail: "Continue from the cart, verify the confirmation screen, and preserve a checkpoint.",
    platform: "ios-simulator",
    appBundleId: "app.atlasloop.CommerceDemo",
    tags: ["commerce", "smoke"],
    script: DEFAULT_LOCAL_TEST_SCRIPT,
    steps: compileLocalTestScript(DEFAULT_LOCAL_TEST_SCRIPT).steps
  },
  {
    id: "pull-refresh-smoke",
    label: "Pull-to-refresh smoke",
    detail: "Exercise a refresh gesture, allow the layout to settle, and capture the resulting state.",
    platform: "ios-simulator",
    tags: ["gesture", "smoke"],
    script: `Swipe down
Wait 800ms
Capture "after pull to refresh"`,
    steps: compileLocalTestScript(`Swipe down
Wait 800ms
Capture "after pull to refresh"`).steps
  },
  {
    id: "gesture-lab-multitouch",
    label: "Gesture Lab multi-touch",
    detail: "Verify native pinch, rotation, and two-finger input against the instrumented canvas.",
    platform: "ios-simulator",
    appBundleId: "app.atlasloop.CommerceDemo",
    tags: ["gesture-lab", "multi-touch"],
    script: `Pinch open on "gesture-lab.canvas"
Rotate clockwise on "gesture-lab.canvas"
Two-finger tap "gesture-lab.canvas"
Capture "gesture lab checkpoint"`,
    steps: compileLocalTestScript(`Pinch open on "gesture-lab.canvas"
Rotate clockwise on "gesture-lab.canvas"
Two-finger tap "gesture-lab.canvas"
Capture "gesture lab checkpoint"`).steps
  }
];

export function compileLocalTestScript(script: string): LocalTestCompileResult {
  const steps: GestureSequenceStep[] = [];
  const errors: LocalTestCompileError[] = [];

  script.split(/\r?\n/).forEach((sourceLine, index) => {
    const source = sourceLine.trim();
    if (!source || source.startsWith("#")) return;
    const step = compileLine(source);
    if (typeof step === "string") {
      errors.push({ line: index + 1, source, message: step });
      return;
    }
    steps.push(step);
  });

  if (steps.length === 0 && errors.length === 0) {
    errors.push({ line: 1, source: "", message: "Add at least one supported test command." });
  }

  return { steps, errors };
}

export function localTestUsesMultiTouch(test: Pick<LocalTestDefinition, "steps">): boolean {
  return test.steps.some((step) => step.action.kind === "pinch" || step.action.kind === "rotate" || step.action.kind === "twoFingerTap");
}

function compileLine(source: string): GestureSequenceStep | string {
  const tapElement = source.match(/^tap\s+["'](.+)["']$/i);
  if (tapElement?.[1]) return { label: `Tap ${tapElement[1]}`, action: { kind: "tapElement", identifier: tapElement[1] } };

  const tapCoordinate = source.match(/^tap\s+at\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/i);
  if (tapCoordinate?.[1] && tapCoordinate[2]) {
    const point = normalizedPoint(tapCoordinate[1], tapCoordinate[2]);
    return point
      ? { label: `Tap at ${tapCoordinate[1]}% ${tapCoordinate[2]}%`, action: { kind: "tap", ...point } }
      : "Tap coordinates must stay between 0% and 100%.";
  }

  const typeText = source.match(/^type\s+["']([\s\S]*)["']$/i);
  if (typeText?.[1] !== undefined) return { label: `Type “${typeText[1]}”`, action: { kind: "typeText", text: typeText[1] } };

  const swipe = source.match(/^swipe\s+(up|down|left|right)$/i);
  if (swipe?.[1]) return swipeStep(swipe[1].toLowerCase());

  const wait = source.match(/^wait\s+(\d+(?:\.\d+)?)\s*(ms|s|seconds?)?$/i);
  if (wait?.[1]) {
    const duration = Number(wait[1]) * (wait[2]?.toLowerCase().startsWith("s") ? 1_000 : 1);
    if (!Number.isFinite(duration) || duration < 0 || duration > 120_000) return "Wait duration must be between 0ms and 120s.";
    return { label: `Wait ${formatWait(duration)}`, action: { kind: "wait", durationMs: String(Math.round(duration)) } };
  }

  if (/^(back|navigate back)$/i.test(source)) {
    return { label: "Navigate back", action: { kind: "edgeGesture", edge: "left", distance: "0.55", durationMs: "320" } };
  }

  const longPress = source.match(/^long press(?:\s+at\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%|\s+center)?(?:\s+for\s+(\d+)\s*ms)?$/i);
  if (longPress) {
    const point = longPress[1] && longPress[2] ? normalizedPoint(longPress[1], longPress[2]) : { x: "0.5", y: "0.5" };
    if (!point) return "Long-press coordinates must stay between 0% and 100%.";
    const durationMs = longPress[3] ? Number(longPress[3]) : 800;
    if (durationMs < 100 || durationMs > 10_000) return "Long-press duration must be between 100ms and 10s.";
    return { label: "Long press", action: { kind: "longPress", ...point, durationMs: String(durationMs) } };
  }

  const pinch = source.match(/^pinch\s+(open|close)(?:\s+on\s+["'](.+)["'])?$/i);
  if (pinch?.[1]) {
    const open = pinch[1].toLowerCase() === "open";
    return {
      label: `Pinch ${open ? "open" : "close"}${pinch[2] ? ` on ${pinch[2]}` : ""}`,
      action: { kind: "pinch", scale: open ? "1.8" : "0.55", velocity: open ? "1" : "-1", identifier: pinch[2] }
    };
  }

  const rotate = source.match(/^rotate\s+(clockwise|counterclockwise)(?:\s+on\s+["'](.+)["'])?$/i);
  if (rotate?.[1]) {
    const clockwise = rotate[1].toLowerCase() === "clockwise";
    return {
      label: `Rotate ${clockwise ? "clockwise" : "counterclockwise"}${rotate[2] ? ` on ${rotate[2]}` : ""}`,
      action: { kind: "rotate", rotation: clockwise ? "1.57" : "-1.57", velocity: clockwise ? "1" : "-1", identifier: rotate[2] }
    };
  }

  const twoFingerTap = source.match(/^two-finger tap(?:\s+["'](.+)["'])?$/i);
  if (twoFingerTap) {
    return {
      label: `Two-finger tap${twoFingerTap[1] ? ` ${twoFingerTap[1]}` : ""}`,
      action: { kind: "twoFingerTap", identifier: twoFingerTap[1] }
    };
  }

  const verify = source.match(/^(?:verify|assert)\s+["'](.+)["']\s+(?:is\s+)?visible$/i);
  if (verify?.[1]) return { label: `Verify ${verify[1]} is visible`, action: { kind: "assertVisible", identifier: verify[1] } };

  const capture = source.match(/^(?:capture|screenshot)(?:\s+["'](.+)["'])?$/i);
  if (capture) return { label: capture[1] ? `Capture ${capture[1]}` : "Capture checkpoint", action: { kind: "screenshot", reason: capture[1] ?? "local test checkpoint" } };

  return "Unsupported command. Use Tap, Type, Swipe, Wait, Back, Long press, Pinch, Rotate, Two-finger tap, Verify, or Capture.";
}

function normalizedPoint(xPercent: string, yPercent: string): { x: string; y: string } | undefined {
  const x = Number(xPercent);
  const y = Number(yPercent);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return undefined;
  return { x: String(x / 100), y: String(y / 100) };
}

function swipeStep(direction: string): GestureSequenceStep {
  const coordinates = {
    up: { from: { x: "0.5", y: "0.82" }, to: { x: "0.5", y: "0.18" } },
    down: { from: { x: "0.5", y: "0.18" }, to: { x: "0.5", y: "0.82" } },
    left: { from: { x: "0.82", y: "0.5" }, to: { x: "0.18", y: "0.5" } },
    right: { from: { x: "0.18", y: "0.5" }, to: { x: "0.82", y: "0.5" } }
  }[direction] ?? { from: { x: "0.5", y: "0.82" }, to: { x: "0.5", y: "0.18" } };
  return { label: `Swipe ${direction}`, action: { kind: "swipe", ...coordinates, durationMs: "320" } };
}

function formatWait(durationMs: number): string {
  return durationMs >= 1_000 && durationMs % 1_000 === 0 ? `${durationMs / 1_000}s` : `${Math.round(durationMs)}ms`;
}
