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

export interface Session {
  id: string;
  schemaVersion?: string;
  platform?: string;
  status: SessionStatus;
  createdAt?: string;
  updatedAt?: string;
  simulator?: SimulatorRef;
  app?: AppRef;
  artifactDir?: string;
  viewerUrl?: string;
  backend?: string;
  error?: AtlasLoopError;
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

export interface ViewerParams {
  daemonUrl: string;
  sessionId: string;
}

export type HealthState = "checking" | "online" | "offline";

export type ScreenshotState =
  | { status: "loading" }
  | { status: "empty"; message: string }
  | { status: "ready"; src: string; source: "blob" | "url" | "data-url"; mediaType?: string; updatedAt: string }
  | { status: "error"; message: string };
