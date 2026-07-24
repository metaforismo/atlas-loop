import { compileLocalTestScript, localTestUsesMultiTouch } from "./localTests.js";
import type { GestureSequenceStep } from "./gestureSequences.js";

export interface LocalTestModule {
  id: string;
  label: string;
  detail: string;
  tags: string[];
  script: string;
  steps: GestureSequenceStep[];
  createdAt?: string;
  updatedAt?: string;
}

export interface LocalTestModuleSeed {
  name: string;
  detail?: string;
  tags?: string[];
  script: string;
}

export const DEFAULT_LOCAL_TEST_MODULE_SCRIPT = `Wait 500ms
Capture "settled state"`;

export const LOCAL_TEST_MODULE_STARTERS: LocalTestModule[] = [
  createStarter(
    "checkout-handoff",
    "Checkout handoff",
    "Move from the cart through shipping and payment, then preserve the confirmed state.",
    ["commerce", "checkout"],
    `Tap "cart.continue"
Tap "shipping.continue"
Tap "payment-review.place-order"
Verify "confirmation" is visible
Capture "checkout confirmed"`
  ),
  createStarter(
    "settle-and-capture",
    "Settle and capture",
    "Give the interface a bounded moment to settle before preserving a visual checkpoint.",
    ["evidence", "checkpoint"],
    DEFAULT_LOCAL_TEST_MODULE_SCRIPT
  ),
  createStarter(
    "native-canvas-stress",
    "Native canvas stress",
    "Exercise native multi-touch input against the instrumented Gesture Lab canvas.",
    ["gesture-lab", "multi-touch"],
    `Pinch open on "gesture-lab.canvas"
Rotate clockwise on "gesture-lab.canvas"
Two-finger tap "gesture-lab.canvas"
Capture "gesture canvas stressed"`
  )
];

export function localTestModuleUsesMultiTouch(module: Pick<LocalTestModule, "steps">): boolean {
  return localTestUsesMultiTouch(module);
}

export function appendLocalTestModuleScript(currentScript: string, module: Pick<LocalTestModule, "label" | "script">): string {
  const current = currentScript.trimEnd();
  const moduleScript = module.script.trim();
  if (!moduleScript) return current;
  const block = `# Module: ${module.label.trim() || "Untitled module"}\n${moduleScript}`;
  return current ? `${current}\n\n${block}` : block;
}

function createStarter(id: string, label: string, detail: string, tags: string[], script: string): LocalTestModule {
  const compiled = compileLocalTestScript(script);
  if (compiled.errors.length > 0) throw new Error(`Invalid built-in module: ${id}`);
  return { id, label, detail, tags, script, steps: compiled.steps };
}
