import { performViewerAction } from "./api.js";
import type { GestureSequencePreset, GestureSequenceStep } from "./gestureSequences.js";
import type { ViewerParams } from "./types.js";

export type GestureSequenceRunResult =
  | { status: "success"; completedSteps: number }
  | { status: "cancelled"; completedSteps: number }
  | { status: "error"; completedSteps: number; failedStep: GestureSequenceStep; message: string };

export async function runGestureSequenceSteps({
  params,
  sequence,
  signal,
  onProgress
}: {
  params: ViewerParams;
  sequence: GestureSequencePreset;
  signal?: AbortSignal;
  onProgress?: (step: GestureSequenceStep, index: number, total: number) => void;
}): Promise<GestureSequenceRunResult> {
  let completedSteps = 0;

  for (let index = 0; index < sequence.steps.length; index += 1) {
    const step = sequence.steps[index];
    if (!step) continue;
    if (signal?.aborted) return { status: "cancelled", completedSteps };
    onProgress?.(step, index, sequence.steps.length);

    try {
      const result = await performViewerAction(params, step.action, signal);
      if (!result.ok) {
        return {
          status: "error",
          completedSteps,
          failedStep: step,
          message: result.error?.message ?? "Daemon rejected the action."
        };
      }
      completedSteps += 1;
    } catch (error) {
      if (signal?.aborted) return { status: "cancelled", completedSteps };
      return {
        status: "error",
        completedSteps,
        failedStep: step,
        message: error instanceof Error ? error.message : "Gesture sequence failed."
      };
    }
  }

  return { status: "success", completedSteps };
}
