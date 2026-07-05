import type { Action, ActionKind, InputBackendKind, Session } from "@atlas-loop/protocol";

export type InputActionKind = Extract<ActionKind, "tap" | "typeText" | "swipe" | "edgeGesture" | "tapElement" | "assertVisible">;

export type InputAction = Extract<Action, { kind: InputActionKind }>;

export interface InputBackend {
  readonly name: InputBackendKind;
  supports(kind: InputActionKind): boolean;
  /** Static backend facts recorded in evidence for both successful and failed actions. */
  describe(session: Session): Record<string, unknown>;
  /** Performs the action; the optional return value is merged into the evidence detail blob. */
  performAction(session: Session, action: InputAction): Promise<Record<string, unknown> | undefined>;
  close(): Promise<void>;
}
