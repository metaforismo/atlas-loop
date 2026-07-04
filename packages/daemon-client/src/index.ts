import type {
  ActionInput,
  ActionResult,
  ApiEnvelope,
  ArtifactType,
  ArtifactRef,
  AtlasLoopError,
  BuildRequest,
  CreateSessionRequest,
  InstallRequest,
  LaunchRequest,
  PerformActionRequest,
  Session,
  TraceEvent
} from "@atlas-loop/protocol";

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
    latestAction?: Pick<ActionResult, "actionId" | "ok" | "startedAt" | "endedAt" | "error"> & {
      artifactCount: number;
    };
    latestError?: AtlasLoopError;
  };
  storage: {
    source: "memory" | "disk";
    artifactBacked: boolean;
    warnings: Array<{ path: string; message: string }>;
  };
}

export interface CompactEvidenceSummary {
  sessionId: string;
  requestedSessionId: string;
  artifactDir: string;
  latestScreenshotPath: string | null;
  latestScreenshot: ArtifactRef | null;
  viewerUrl: string;
  daemonUrl: string;
  viewerBaseUrl: string;
}

export interface EvidenceReportData extends CompactEvidenceSummary {
  sessionStatus?: Session["status"];
  createdAt?: string;
  updatedAt?: string;
  artifactTotal: number;
  artifactCounts: Partial<Record<ArtifactType, number>>;
  eventTotal: number;
  latestAction?: SessionSummary["events"]["latestAction"];
  latestError?: AtlasLoopError;
  storage: SessionSummary["storage"];
}

export function evidenceReportDataFromSessionSummary(
  summary: SessionSummary,
  params: {
    requestedSessionId: string;
    daemonUrl: string;
    viewerBaseUrl: string;
    viewerUrl: string;
    latestScreenshot?: ArtifactRef | null;
  }
): EvidenceReportData {
  const artifacts = summary.artifacts ?? { total: 0, byType: {} };
  const events = summary.events ?? { total: 0 };
  const storage: SessionSummary["storage"] = summary.storage ?? { source: "memory", artifactBacked: false, warnings: [] };
  const latestScreenshot = params.latestScreenshot ?? artifacts.latestScreenshot ?? null;
  return {
    sessionId: summary.session.id,
    requestedSessionId: params.requestedSessionId,
    artifactDir: summary.paths.artifactDir,
    latestScreenshotPath: latestScreenshot?.path ?? null,
    latestScreenshot,
    viewerUrl: params.viewerUrl,
    daemonUrl: params.daemonUrl,
    viewerBaseUrl: params.viewerBaseUrl,
    sessionStatus: summary.session.status,
    createdAt: summary.session.createdAt,
    updatedAt: summary.session.updatedAt,
    artifactTotal: artifacts.total ?? 0,
    artifactCounts: artifacts.byType ?? {},
    eventTotal: events.total ?? 0,
    latestAction: events.latestAction,
    latestError: events.latestError,
    storage
  };
}

export function buildEvidenceMarkdownReport(evidence: EvidenceReportData): string {
  const lines = [
    "# Atlas Loop Evidence Report",
    "",
    "## Session",
    `- Session: ${code(evidence.sessionId)}`,
    `- Requested: ${code(evidence.requestedSessionId)}`,
    `- Status: ${code(evidence.sessionStatus ?? "unknown")}`,
    `- Created: ${evidence.createdAt ?? "--"}`,
    `- Updated: ${evidence.updatedAt ?? "--"}`,
    `- Storage: ${code(evidence.storage.source)}${evidence.storage.artifactBacked ? " artifact-backed" : ""}`,
    "",
    "## Evidence",
    `- Artifact directory: ${code(evidence.artifactDir)}`,
    `- Latest screenshot: ${evidence.latestScreenshotPath ? code(evidence.latestScreenshotPath) : "none"}`,
    `- Viewer URL: ${evidence.viewerUrl}`,
    `- Daemon URL: ${evidence.daemonUrl}`,
    "",
    "## Counts",
    `- Artifacts: ${evidence.artifactTotal}${formatArtifactCounts(evidence.artifactCounts)}`,
    `- Events: ${evidence.eventTotal}`
  ];

  if (evidence.latestAction) {
    lines.push(
      "",
      "## Latest Action",
      `- Action: ${code(evidence.latestAction.actionId)}`,
      `- Result: ${evidence.latestAction.ok ? "passed" : "failed"}`,
      `- Started: ${evidence.latestAction.startedAt}`,
      `- Ended: ${evidence.latestAction.endedAt}`,
      `- Artifacts: ${evidence.latestAction.artifactCount}`
    );
    if (evidence.latestAction.error) {
      lines.push(`- Error: ${evidence.latestAction.error.code}: ${evidence.latestAction.error.message}`);
    }
  }

  if (evidence.latestError) {
    lines.push("", "## Latest Error", `- ${evidence.latestError.code}: ${evidence.latestError.message}`);
  }

  if (evidence.storage.warnings.length > 0) {
    lines.push("", "## Warnings");
    for (const warning of evidence.storage.warnings) {
      lines.push(`- ${code(warning.path)}: ${warning.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export interface DaemonClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  apiPrefix?: string;
}

export class DaemonClientError extends Error implements AtlasLoopError {
  code: AtlasLoopError["code"];
  retryable?: boolean;
  details?: Record<string, unknown>;

  constructor(error: AtlasLoopError) {
    super(error.message);
    this.name = "DaemonClientError";
    this.code = error.code;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

export class DaemonClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly apiPrefix: string;

  constructor(options: DaemonClientOptions = {}) {
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? process.env.ATLAS_LOOP_DAEMON_URL ?? "http://127.0.0.1:4317");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiPrefix = options.apiPrefix ?? "";
  }

  health(): Promise<{ status: string; sessions: number; uptimeSeconds: number }> {
    return this.requestData("GET", "/health", "health");
  }

  listSessions(): Promise<Session[]> {
    return this.requestData("GET", "/sessions", "session list");
  }

  createSession(request: CreateSessionRequest = {}): Promise<Session> {
    return this.requestData("POST", "/sessions", "created session", request);
  }

  getSession(sessionId: string): Promise<Session> {
    return this.requestData("GET", `/sessions/${encodeURIComponent(sessionId)}`, "session");
  }

  getSessionSummary(sessionId: string): Promise<SessionSummary> {
    return this.requestData("GET", `/sessions/${encodeURIComponent(sessionId)}/summary`, "session summary");
  }

  endSession(sessionId: string): Promise<Session> {
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/end`, "ended session");
  }

  build(sessionId: string, request: BuildRequest): Promise<unknown> {
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/build`, "build result", request);
  }

  install(sessionId: string, request: InstallRequest): Promise<unknown> {
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/install`, "install result", request);
  }

  launch(sessionId: string, request: LaunchRequest): Promise<unknown> {
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/launch`, "launch result", request);
  }

  performAction(sessionId: string, request: PerformActionRequest | ActionInput): Promise<ActionResult> {
    const body = "action" in request ? request : { action: request };
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/actions`, "action result", body);
  }

  screenshot(sessionId: string, reason?: string): Promise<ActionResult> {
    return this.requestData(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/screenshot`,
      "screenshot action result",
      reason ? { reason } : {}
    );
  }

  latestScreenshot(sessionId: string): Promise<ArtifactRef> {
    return this.requestData(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/artifacts/latest-screenshot`,
      "latest screenshot artifact"
    );
  }

  listArtifacts(sessionId: string): Promise<ArtifactRef[]> {
    return this.requestData("GET", `/sessions/${encodeURIComponent(sessionId)}/artifacts`, "artifact list");
  }

  events(sessionId: string): Promise<TraceEvent[]> {
    return this.requestData("GET", `/sessions/${encodeURIComponent(sessionId)}/events`, "trace events");
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return this.requestEnvelope(method, path, body, { requireData: false });
  }

  private requestData<T>(method: string, path: string, dataLabel: string, body?: unknown): Promise<T> {
    return this.requestEnvelope(method, path, body, { requireData: true, dataLabel });
  }

  private async requestEnvelope<T>(
    method: string,
    path: string,
    body: unknown,
    options: { requireData: boolean; dataLabel?: string }
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${this.apiPrefix}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const envelope = parseEnvelope<T>(text);
    if (!isApiEnvelope(envelope)) {
      throw new DaemonClientError({
        code: "COMMAND_FAILED",
        message: "daemon returned a malformed response",
        details: { status: response.status, body: text }
      });
    }
    if (!response.ok || envelope.ok === false) {
      throw new DaemonClientError(envelope.error ?? {
        code: response.status === 404 ? "NOT_FOUND" : "COMMAND_FAILED",
        message: response.statusText || `HTTP ${response.status}`,
        details: { status: response.status, body: text }
      });
    }
    if (options.requireData && !hasUsableEnvelopeData(envelope)) {
      throw new DaemonClientError({
        code: "COMMAND_FAILED",
        message: `daemon returned ok:true without required data for ${options.dataLabel ?? `${method} ${path}`}`,
        details: { status: response.status, method, path, body: text }
      });
    }
    return envelope.data as T;
  }
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  return Boolean(value && typeof value === "object" && typeof (value as ApiEnvelope<T>).ok === "boolean");
}

function hasUsableEnvelopeData<T>(envelope: ApiEnvelope<T>): boolean {
  return Object.prototype.hasOwnProperty.call(envelope, "data") && envelope.data !== null && envelope.data !== undefined;
}

function parseEnvelope<T>(text: string): ApiEnvelope<T> {
  if (!text) return { ok: true } as ApiEnvelope<T>;
  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    return {
      ok: false,
      error: {
        code: "COMMAND_FAILED",
        message: "daemon returned non-JSON response",
        details: { body: text }
      }
    };
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function formatArtifactCounts(counts: Partial<Record<ArtifactType, number>>): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "";
  return ` (${entries.map(([type, count]) => `${type}: ${count}`).join(", ")})`;
}

function code(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}
