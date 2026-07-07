export type Platform = "ios-simulator";

export type SessionStatus =
  | "created"
  | "booting"
  | "booted"
  | "building"
  | "installing"
  | "installed"
  | "launching"
  | "running"
  | "ended"
  | "failed";

export interface SimulatorRef {
  udid?: string;
  name?: string;
  runtime?: string;
  booted?: boolean;
}

export interface AppRef {
  bundleId?: string;
  scheme?: string;
  workspacePath?: string;
  projectPath?: string;
  appPath?: string;
}

export type InputBackendKind = "cgevent" | "xcuitest";

export interface Session {
  id: string;
  schemaVersion: "atlas-loop.session.v1";
  platform: Platform;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  simulator: SimulatorRef;
  app?: AppRef;
  artifactDir: string;
  viewerUrl?: string;
  backend?: string;
  inputBackend?: InputBackendKind;
  error?: AtlasLoopError;
}

export interface Point {
  x: number;
  y: number;
}

export type Edge = "left" | "right" | "top" | "bottom";

export type ActionKind =
  | "tap"
  | "typeText"
  | "swipe"
  | "edgeGesture"
  | "tapElement"
  | "assertVisible"
  | "screenshot"
  | "install"
  | "launch"
  | "wait";

export interface BaseAction {
  id: string;
  sessionId: string;
  kind: ActionKind;
  createdAt: string;
  sequence?: number;
}

export interface TapAction extends BaseAction {
  kind: "tap";
  x: number;
  y: number;
}

export interface TypeTextAction extends BaseAction {
  kind: "typeText";
  text: string;
}

export interface SwipeAction extends BaseAction {
  kind: "swipe";
  from: Point;
  to: Point;
  durationMs: number;
}

export interface EdgeGestureAction extends BaseAction {
  kind: "edgeGesture";
  edge: Edge;
  distance: number;
  durationMs: number;
}

export interface TapElementAction extends BaseAction {
  kind: "tapElement";
  identifier: string;
  timeoutMs?: number;
}

export interface AssertVisibleAction extends BaseAction {
  kind: "assertVisible";
  identifier: string;
  timeoutMs?: number;
  /** Marks the asserted element as a screen-level container for Atlas map naming. */
  markScreen?: boolean;
}

export interface ScreenshotAction extends BaseAction {
  kind: "screenshot";
  reason?: string;
}

export interface InstallAction extends BaseAction {
  kind: "install";
  appPath: string;
}

export interface LaunchAction extends BaseAction {
  kind: "launch";
  bundleId: string;
  arguments?: string[];
  environment?: Record<string, string>;
}

export interface WaitAction extends BaseAction {
  kind: "wait";
  durationMs: number;
}

export type Action =
  | TapAction
  | TypeTextAction
  | SwipeAction
  | EdgeGestureAction
  | TapElementAction
  | AssertVisibleAction
  | ScreenshotAction
  | InstallAction
  | LaunchAction
  | WaitAction;

export type ArtifactType =
  | "screenshot"
  | "video"
  | "log"
  | "trace"
  | "metadata"
  | "app-bundle"
  | "action";

export interface ArtifactRef {
  id: string;
  sessionId: string;
  type: ArtifactType;
  path: string;
  createdAt: string;
  sha256?: string;
  metadata?: Record<string, unknown>;
  /** Daemon content URL, populated at response-serialization time only; never persisted to disk. */
  url?: string;
}

export interface ActionResult {
  actionId: string;
  ok: boolean;
  startedAt: string;
  endedAt: string;
  artifacts: ArtifactRef[];
  error?: AtlasLoopError;
}

export type AtlasLoopErrorCode =
  | "SIMULATOR_NOT_FOUND"
  | "DEVICE_NOT_BOOTED"
  | "BUILD_FAILED"
  | "INSTALL_FAILED"
  | "LAUNCH_FAILED"
  | "HID_FAILED"
  | "ELEMENT_NOT_FOUND"
  | "DRIVER_UNAVAILABLE"
  | "ACTION_TIMEOUT"
  | "ARTIFACT_WRITE_FAILED"
  | "INVALID_REQUEST"
  | "COMMAND_FAILED"
  | "NOT_FOUND";

export interface AtlasLoopError {
  code: AtlasLoopErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export type SessionHistoryStorageSource = "memory" | "disk";

export type SessionHistoryLatestAction = Pick<ActionResult, "actionId" | "ok" | "startedAt" | "endedAt" | "error"> & {
  artifactCount: number;
};

export interface SessionHistoryItem {
  session: Session;
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  artifactDir: string;
  storage: {
    source: SessionHistoryStorageSource;
    artifactBacked: boolean;
    warningCount: number;
  };
  artifacts: {
    total: number;
    byType: Partial<Record<ArtifactType, number>>;
    latestScreenshotPath?: string;
    latestScreenshotCreatedAt?: string;
  };
  events: {
    total: number;
    latestAction?: SessionHistoryLatestAction;
    latestError?: AtlasLoopError;
  };
  canMutate: boolean;
  hasScreenshot: boolean;
  ready: boolean;
}

export interface SessionHistoryResult {
  schemaVersion: "atlas-loop.session-history.v1";
  generatedAt: string;
  total: number;
  count: number;
  limit: number | null;
  sessions: SessionHistoryItem[];
}

export type TraceEvent =
  | { type: "session.created"; at: string; session: Session }
  | { type: "session.statusChanged"; at: string; sessionId: string; from: SessionStatus; to: SessionStatus }
  | { type: "action.started"; at: string; action: Action }
  | { type: "action.completed"; at: string; result: ActionResult }
  | { type: "artifact.created"; at: string; artifact: ArtifactRef }
  | { type: "video.started"; at: string; sessionId: string; path: string }
  | { type: "video.stopped"; at: string; sessionId: string; artifactId?: string; error?: AtlasLoopError }
  | { type: "error"; at: string; sessionId?: string; error: AtlasLoopError };

export interface CreateSessionRequest {
  simulator?: SimulatorRef;
  artifactRoot?: string;
  viewer?: boolean;
  inputBackend?: InputBackendKind;
  /** Start a session-long video recording immediately (explicit opt-in). */
  record?: boolean;
}

export interface BuildRequest {
  workspacePath?: string;
  projectPath?: string;
  scheme: string;
  configuration?: "Debug" | "Release";
  derivedDataPath?: string;
}

export interface InstallRequest {
  appPath: string;
}

export interface LaunchRequest {
  bundleId: string;
  arguments?: string[];
  environment?: Record<string, string>;
}

export interface PerformActionRequest {
  action: ActionInput;
  /** Skip the automatic post-action screenshot for this action only. */
  skipScreenshot?: boolean;
}

export type ActionInput =
  | Omit<TapAction, "id" | "sessionId" | "createdAt" | "sequence">
  | Omit<TypeTextAction, "id" | "sessionId" | "createdAt" | "sequence">
  | Omit<SwipeAction, "id" | "sessionId" | "createdAt" | "sequence">
  | Omit<EdgeGestureAction, "id" | "sessionId" | "createdAt" | "sequence">
  | Omit<TapElementAction, "id" | "sessionId" | "createdAt" | "sequence">
  | Omit<AssertVisibleAction, "id" | "sessionId" | "createdAt" | "sequence">
  | Omit<ScreenshotAction, "id" | "sessionId" | "createdAt" | "sequence">
  | Omit<WaitAction, "id" | "sessionId" | "createdAt" | "sequence">;

export const ATLAS_LAUNCH_NODE_ID = "__launch__";

export interface AtlasMapSessionRef {
  sessionId: string;
  bundleId?: string;
  createdAt: string;
  observationCount: number;
}

export interface AtlasScreenShot {
  sessionId: string;
  artifactId: string;
  path: string;
  sha256?: string;
  createdAt: string;
}

export interface AtlasScreen {
  id: string;
  /** Explicit screen identifier when the evidence carried one (e.g. accessibility id). */
  screenId?: string;
  hashes: string[];
  representative: AtlasScreenShot;
  variants: AtlasScreenShot[];
  screenshotCount: number;
  sessionIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface AtlasTransition {
  id: string;
  from: string;
  to: string;
  actionSignature: string;
  actionKinds: ActionKind[];
  count: number;
  sessionIds: string[];
  examples: Array<{ sessionId: string; actionId: string; at: string }>;
}

export interface AtlasMap {
  schemaVersion: "atlas-loop.atlas-map.v1";
  generatedAt: string;
  artifactRoot: string;
  hashThreshold: number;
  sessions: AtlasMapSessionRef[];
  screens: AtlasScreen[];
  transitions: AtlasTransition[];
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: AtlasLoopError;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function atlasError(
  code: AtlasLoopErrorCode,
  message: string,
  details?: Record<string, unknown>,
  retryable = false
): AtlasLoopError {
  return { code, message, details, retryable };
}

export function assertNormalizedPoint(point: Point, label = "point"): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) {
    throw new Error(`${label} must use normalized coordinates between 0 and 1`);
  }
}

export function validateActionInput(action: ActionInput): void {
  switch (action.kind) {
    case "tap":
      assertNormalizedPoint({ x: action.x, y: action.y }, "tap");
      return;
    case "typeText":
      if (!action.text) throw new Error("typeText requires non-empty text");
      return;
    case "swipe":
      assertNormalizedPoint(action.from, "swipe.from");
      assertNormalizedPoint(action.to, "swipe.to");
      if (!Number.isFinite(action.durationMs) || action.durationMs < 0) throw new Error("swipe duration must be non-negative");
      return;
    case "edgeGesture":
      if (!["left", "right", "top", "bottom"].includes(action.edge)) throw new Error("edgeGesture edge is invalid");
      if (!Number.isFinite(action.distance) || action.distance < 0 || action.distance > 1) throw new Error("edgeGesture distance must be 0..1");
      if (!Number.isFinite(action.durationMs) || action.durationMs < 0) throw new Error("edgeGesture duration must be non-negative");
      return;
    case "tapElement":
    case "assertVisible":
      if (typeof action.identifier !== "string" || !action.identifier.trim()) {
        throw new Error(`${action.kind} requires a non-empty accessibility identifier`);
      }
      if (action.timeoutMs !== undefined && (!Number.isFinite(action.timeoutMs) || action.timeoutMs < 0)) {
        throw new Error(`${action.kind} timeout must be non-negative`);
      }
      return;
    case "screenshot":
      return;
    case "wait":
      if (!Number.isFinite(action.durationMs) || action.durationMs < 0) throw new Error("wait duration must be non-negative");
      return;
    default: {
      const neverAction: never = action;
      throw new Error(`unknown action ${(neverAction as { kind?: string }).kind}`);
    }
  }
}

export function materializeAction(sessionId: string, sequence: number, input: ActionInput): Action {
  validateActionInput(input);
  return {
    ...input,
    id: makeId("act"),
    sessionId,
    sequence,
    createdAt: nowIso()
  } as Action;
}
