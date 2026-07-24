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
  | "failed"
  | string;

export interface AtlasLoopError {
  code?: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

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

export interface SessionListItem {
  id: string;
  status?: SessionStatus;
  createdAt?: string;
  updatedAt?: string;
  simulator?: SimulatorRef;
  app?: AppRef;
  artifactDir?: string;
  viewerUrl?: string;
  backend?: string;
  inputBackend?: InputBackendKind;
  error?: AtlasLoopError;
  platform?: string;
}

export interface SessionHistoryStorageEvidence {
  source?: "memory" | "disk" | string;
  artifactBacked?: boolean;
  warningCount?: number;
  warnings?: Array<{ path?: string; message: string }>;
}

export interface SessionHistoryArtifactEvidence {
  total?: number;
  byType?: Partial<Record<ArtifactType, number>>;
  latestScreenshot?: ArtifactRef;
  latestScreenshotId?: string;
  latestScreenshotPath?: string;
  latestScreenshotCreatedAt?: string;
}

export interface SessionHistoryActionEvidence {
  actionId?: string;
  ok?: boolean;
  startedAt?: string;
  endedAt?: string;
  artifactCount?: number;
  artifacts?: ArtifactRef[];
  error?: AtlasLoopError;
}

export interface SessionHistoryEventEvidence {
  total?: number;
  latestAction?: SessionHistoryActionEvidence;
  latestError?: AtlasLoopError;
}

export interface SessionHistoryItem extends SessionListItem {
  sessionId?: string;
  session?: Session;
  storage?: SessionHistoryStorageEvidence;
  artifacts?: SessionHistoryArtifactEvidence;
  events?: SessionHistoryEventEvidence;
  canMutate?: boolean;
  hasScreenshot?: boolean;
  ready?: boolean;
  blockingReasons?: string[];
}

export interface SessionHistoryResult {
  schemaVersion?: string;
  generatedAt?: string;
  total?: number;
  count?: number;
  limit?: number | null;
  sessions: SessionHistoryItem[];
}

export interface Session extends SessionListItem {
  schemaVersion?: string;
  status: SessionStatus;
}

export type InputBackendKind = "cgevent" | "xcuitest";

export interface CreateSessionInput {
  simulatorName?: string;
  bundleId?: string;
  inputBackend: InputBackendKind;
  record: boolean;
}

export type ArtifactType =
  | "screenshot"
  | "video"
  | "log"
  | "trace"
  | "metadata"
  | "app-bundle"
  | "action"
  | string;

export interface ArtifactRef {
  id: string;
  sessionId?: string;
  type: ArtifactType;
  path: string;
  createdAt?: string;
  sha256?: string;
  metadata?: Record<string, unknown>;
  url?: string;
}

export interface ArtifactHealthIssue {
  severity?: "error" | "warning" | string;
  path?: string;
  message: string;
}

export interface ArtifactHealthReport {
  target?: string;
  sessionCount?: number;
  ok?: boolean;
  issues?: ArtifactHealthIssue[];
  [key: string]: unknown;
}

export interface ArtifactHealthSummary {
  sessionCount: number;
  errorCount: number;
  warningCount: number;
  issueCount: number;
}

export interface ArtifactHealth {
  ok: boolean;
  target?: string;
  sessionId?: string;
  requestedSessionId?: string;
  source?: string;
  artifactDir?: string;
  report?: ArtifactHealthReport;
  summary: ArtifactHealthSummary;
}

export interface ActionLike {
  id: string;
  sessionId?: string;
  kind: string;
  createdAt?: string;
  sequence?: number;
  [key: string]: unknown;
}

export interface ActionResultLike {
  actionId: string;
  ok: boolean;
  startedAt?: string;
  endedAt?: string;
  artifacts?: ArtifactRef[];
  error?: AtlasLoopError;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export type ViewerActionKind =
  | "screenshot"
  | "wait"
  | "tap"
  | "typeText"
  | "swipe"
  | "edgeGesture"
  | "longPress"
  | "pinch"
  | "rotate"
  | "twoFingerTap"
  | "tapElement"
  | "assertVisible";

export type EdgeGestureEdge = "left" | "right" | "top" | "bottom";

export type ViewerActionInput =
  | { kind: "screenshot"; reason?: string }
  | { kind: "wait"; durationMs: number }
  | { kind: "tap"; x: number; y: number }
  | { kind: "typeText"; text: string }
  | { kind: "swipe"; from: NormalizedPoint; to: NormalizedPoint; durationMs: number }
  | { kind: "edgeGesture"; edge: EdgeGestureEdge; distance: number; durationMs: number }
  | { kind: "longPress"; x: number; y: number; durationMs: number }
  | { kind: "pinch"; scale: number; velocity: number; identifier?: string; timeoutMs?: number }
  | { kind: "rotate"; rotation: number; velocity: number; identifier?: string; timeoutMs?: number }
  | { kind: "twoFingerTap"; identifier?: string; timeoutMs?: number }
  | { kind: "tapElement"; identifier: string; timeoutMs?: number }
  | { kind: "assertVisible"; identifier: string; timeoutMs?: number };

export type ViewerNumericInput = number | string;

export type ViewerActionDraft =
  | { kind: "screenshot"; reason?: string }
  | { kind: "wait"; durationMs: ViewerNumericInput }
  | { kind: "tap"; x: ViewerNumericInput; y: ViewerNumericInput }
  | { kind: "typeText"; text: string }
  | {
      kind: "swipe";
      from: { x: ViewerNumericInput; y: ViewerNumericInput };
      to: { x: ViewerNumericInput; y: ViewerNumericInput };
      durationMs: ViewerNumericInput;
    }
  | { kind: "edgeGesture"; edge: EdgeGestureEdge; distance: ViewerNumericInput; durationMs: ViewerNumericInput }
  | { kind: "longPress"; x: ViewerNumericInput; y: ViewerNumericInput; durationMs: ViewerNumericInput }
  | { kind: "pinch"; scale: ViewerNumericInput; velocity: ViewerNumericInput; identifier?: string; timeoutMs?: ViewerNumericInput }
  | { kind: "rotate"; rotation: ViewerNumericInput; velocity: ViewerNumericInput; identifier?: string; timeoutMs?: ViewerNumericInput }
  | { kind: "twoFingerTap"; identifier?: string; timeoutMs?: ViewerNumericInput }
  | { kind: "tapElement"; identifier: string; timeoutMs?: ViewerNumericInput }
  | { kind: "assertVisible"; identifier: string; timeoutMs?: ViewerNumericInput };

export interface ViewerActionRequest {
  endpoint: "actions" | "screenshot";
  body: { action: Exclude<ViewerActionInput, { kind: "screenshot" }> } | { reason?: string };
}

export interface SessionSummary {
  session: Session;
  paths: {
    artifactDir: string;
    manifest: string;
    trace: string;
    screenshots: string;
  };
  artifacts: {
    total: number;
    byType: Partial<Record<ArtifactType, number>>;
    latestScreenshot?: ArtifactRef;
    latestScreenshotId?: string;
    latestScreenshotPath?: string;
    latestScreenshotCreatedAt?: string;
  };
  events: {
    total: number;
    latestAction?: ActionResultLike & { artifactCount: number };
    latestError?: AtlasLoopError;
  };
  storage: {
    source: "memory" | "disk" | string;
    artifactBacked: boolean;
    warnings: Array<{ path: string; message: string }>;
  };
}

export interface TraceEvent {
  type: string;
  at?: string;
  session?: Session;
  sessionId?: string;
  from?: string;
  to?: string;
  action?: ActionLike;
  result?: ActionResultLike;
  artifact?: ArtifactRef;
  error?: AtlasLoopError;
  [key: string]: unknown;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: AtlasLoopError;
}

export type ViewerView = "session" | "atlas";
export type ViewerWorkspace = "overview" | "tests" | "library" | "sessions" | "apps" | "workflows" | "evidence";

export interface ViewerParams {
  daemonUrl: string;
  sessionId: string;
  viewerBaseUrl?: string;
  view?: ViewerView;
  /** Deep link: open the overview, tests, module library, apps, workflows, sessions, or evidence workspace. */
  workspace?: ViewerWorkspace;
  /** Deep link: preselect this action's evidence pair in the session view. */
  actionId?: string;
  /** Deep link: preselect this artifact in the session view. */
  artifactId?: string;
}

export type HealthState = "checking" | "online" | "offline";

export type ScreenshotState =
  | { status: "loading" }
  | { status: "empty"; message: string }
  | { status: "ready"; src: string; source: "blob" | "url" | "data-url"; mediaType?: string; updatedAt: string }
  | { status: "stale"; src: string; source: "blob" | "url" | "data-url"; mediaType?: string; updatedAt: string; message: string; staleAt: string }
  | { status: "error"; message: string };
