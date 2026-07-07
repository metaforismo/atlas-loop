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
  SessionHistoryResult,
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

export type ArtifactValidationSeverity = "error" | "warning";

export interface ArtifactValidationIssue {
  severity: ArtifactValidationSeverity;
  path: string;
  message: string;
}

export interface ArtifactValidationReport {
  target: string;
  sessionCount: number;
  ok: boolean;
  issues: ArtifactValidationIssue[];
}

export interface SessionArtifactHealthSummary {
  sessionCount: number;
  errorCount: number;
  warningCount: number;
  issueCount: number;
}

export interface SessionArtifactHealth {
  ok: boolean;
  target: string;
  sessionId: string;
  requestedSessionId: string;
  source: "memory" | "disk";
  artifactDir: string;
  report: ArtifactValidationReport;
  summary: SessionArtifactHealthSummary;
}

export interface SessionHandoffArtifactHealth {
  ok: boolean;
  target: string;
  source: string;
  summary: SessionArtifactHealthSummary;
}

export interface SessionHandoff {
  sessionId: string;
  requestedSessionId: string;
  status: string;
  daemonUrl: string;
  viewerBaseUrl: string;
  viewerUrl: string;
  artifactDir: string | null;
  storage: {
    source: string;
    artifactBacked: boolean;
    warningCount: number;
  };
  latestScreenshotPath: string | null;
  latestAction?: SessionSummary["events"]["latestAction"];
  latestError?: AtlasLoopError;
  artifactHealth: SessionHandoffArtifactHealth | null;
  canMutate: boolean;
  hasScreenshot: boolean;
  ready: boolean;
  blockingReasons: string[];
  nextCommands: string[];
}

export interface SessionHandoffClient {
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
  getSessionArtifactHealth?(sessionId: string): Promise<{
    ok: boolean;
    target: string;
    source: string;
    summary: SessionArtifactHealthSummary;
  }>;
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
  artifactHighlights?: ArtifactRef[];
  eventTotal: number;
  latestAction?: SessionSummary["events"]["latestAction"];
  latestError?: AtlasLoopError;
  storage: SessionSummary["storage"];
}

export async function buildSessionHandoff(
  client: SessionHandoffClient,
  params: { sessionId: string; daemonUrl: string; viewerBaseUrl?: string }
): Promise<SessionHandoff> {
  const requestedSessionId = params.sessionId;
  const summary = await client.getSessionSummary(requestedSessionId);
  const sessionId = firstString(summary.session?.id) ?? requestedSessionId;
  const status = firstString(summary.session?.status) ?? "unknown";
  const artifactDir = firstString(summary.paths?.artifactDir) ?? null;
  const storageWarnings = Array.isArray(summary.storage?.warnings) ? summary.storage.warnings : [];
  const storageSource = firstString(summary.storage?.source) ?? "unknown";
  const latestScreenshotPath = firstString(summary.artifacts?.latestScreenshot?.path)
    ?? firstString(summary.artifacts?.latestScreenshotPath)
    ?? null;
  const viewerBaseUrl = trimTrailingSlash(params.viewerBaseUrl ?? "http://127.0.0.1:5173");
  const daemonUrl = trimTrailingSlash(params.daemonUrl);
  const artifactHealthResult = await readSessionArtifactHealth(client, sessionId);
  const canMutate = storageSource === "memory" && isLiveSessionStatus(status);
  const hasScreenshot = latestScreenshotPath !== null;
  const blockingReasons = sessionHandoffBlockingReasons({
    status,
    artifactDir,
    latestAction: summary.events?.latestAction,
    latestError: summary.events?.latestError,
    artifactHealthResult
  });

  return {
    sessionId,
    requestedSessionId,
    status,
    daemonUrl,
    viewerBaseUrl,
    viewerUrl: buildHandoffViewerUrl({ daemonUrl, sessionId, viewerBaseUrl }),
    artifactDir,
    storage: {
      source: storageSource,
      artifactBacked: Boolean(summary.storage?.artifactBacked),
      warningCount: storageWarnings.length
    },
    latestScreenshotPath,
    ...(summary.events?.latestAction ? { latestAction: summary.events.latestAction } : {}),
    ...(summary.events?.latestError ? { latestError: summary.events.latestError } : {}),
    artifactHealth: artifactHealthResult.health,
    canMutate,
    hasScreenshot,
    ready: blockingReasons.length === 0,
    blockingReasons,
    nextCommands: buildSessionHandoffNextCommands({ sessionId, daemonUrl, viewerBaseUrl, canMutate })
  };
}

export function buildSessionHandoffMarkdownNote(handoff: SessionHandoff): string {
  const lines = [
    "# Atlas Loop Session Handoff",
    "",
    "Local-only handoff note. No cloud, auth, or share links are required.",
    "",
    "## Session",
    `- Resolved session: ${code(handoff.sessionId)}`,
    `- Requested session: ${code(handoff.requestedSessionId)}`,
    `- Status: ${code(handoff.status)}`,
    `- Ready: ${yesNo(handoff.ready)}`,
    `- Can mutate live session: ${yesNo(handoff.canMutate)}`,
    "",
    "## Local Access",
    `- Daemon URL: ${handoff.daemonUrl}`,
    `- Viewer URL: ${handoff.viewerUrl}`,
    `- Viewer base URL: ${handoff.viewerBaseUrl}`,
    "",
    "## Artifacts",
    `- Artifact directory: ${handoff.artifactDir ? code(handoff.artifactDir) : "none"}`,
    `- Storage: ${code(handoff.storage.source)} (artifact-backed: ${yesNo(handoff.storage.artifactBacked)}, warnings: ${handoff.storage.warningCount})`,
    `- Latest screenshot: ${handoff.latestScreenshotPath ? code(handoff.latestScreenshotPath) : "none"}`,
    `- Artifact health: ${formatHandoffArtifactHealth(handoff.artifactHealth)}`
  ];

  if (handoff.artifactHealth?.target) {
    lines.push(`- Artifact health target: ${code(handoff.artifactHealth.target)}`);
  }

  lines.push("", "## Latest Runtime");
  if (handoff.latestAction) {
    lines.push(
      `- Latest action: ${code(handoff.latestAction.actionId)} (${handoff.latestAction.ok ? "passed" : "failed"})`,
      `- Action started: ${handoff.latestAction.startedAt}`,
      `- Action ended: ${handoff.latestAction.endedAt}`,
      `- Action artifacts: ${handoff.latestAction.artifactCount}`
    );
    if (handoff.latestAction.error) {
      lines.push(`- Action error: ${formatHandoffError(handoff.latestAction.error)}`);
    }
  } else {
    lines.push("- Latest action: none");
  }

  if (handoff.latestError) {
    lines.push(`- Latest error: ${formatHandoffError(handoff.latestError)}`);
  } else {
    lines.push("- Latest error: none");
  }

  lines.push("", "## Blockers");
  if (handoff.blockingReasons.length > 0) {
    for (const reason of handoff.blockingReasons) lines.push(`- ${markdownText(reason)}`);
  } else {
    lines.push("- none");
  }

  lines.push("", "## Next Commands");
  if (handoff.nextCommands.length > 0) {
    lines.push("```sh", ...handoff.nextCommands, "```");
  } else {
    lines.push("- none");
  }

  return `${lines.join("\n")}\n`;
}

export function evidenceReportDataFromSessionSummary(
  summary: SessionSummary,
  params: {
    requestedSessionId: string;
    daemonUrl: string;
    viewerBaseUrl: string;
    viewerUrl: string;
    latestScreenshot?: ArtifactRef | null;
    artifactHighlights?: ArtifactRef[];
  }
): EvidenceReportData {
  const artifacts = summary.artifacts ?? { total: 0, byType: {} };
  const events = summary.events ?? { total: 0 };
  const storage: SessionSummary["storage"] = summary.storage ?? { source: "memory", artifactBacked: false, warnings: [] };
  const latestScreenshot = params.latestScreenshot ?? artifacts.latestScreenshot ?? null;
  const artifactHighlights = normalizeArtifactHighlights(params.artifactHighlights, latestScreenshot);
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
    ...(artifactHighlights.length > 0 ? { artifactHighlights } : {}),
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

  const artifactHighlights = evidence.artifactHighlights ?? [];
  if (artifactHighlights.length > 0) {
    lines.push("", "## Artifact Highlights");
    for (const artifact of artifactHighlights) {
      lines.push(formatArtifactHighlight(artifact));
    }
  }

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

  listSessionHistory(options: { limit?: number } = {}): Promise<SessionHistoryResult> {
    const path = options.limit === undefined
      ? "/sessions/history"
      : `/sessions/history?${new URLSearchParams({ limit: String(options.limit) }).toString()}`;
    return this.requestData("GET", path, "session history");
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

  getSessionArtifactHealth(sessionId: string): Promise<SessionArtifactHealth> {
    return this.requestData(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/artifacts/health`,
      "session artifact health"
    );
  }

  endSession(sessionId: string): Promise<Session> {
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/end`, "ended session");
  }

  getSessionMetrics(sessionId: string): Promise<{ active: boolean; sampleCount: number; samples: EvidenceHtmlMetricsSample[] }> {
    return this.requestData("GET", `/sessions/${encodeURIComponent(sessionId)}/metrics`, "session metrics");
  }

  getAtlasMap(rebuild = false): Promise<unknown> {
    return rebuild
      ? this.requestData("POST", "/atlas/map/rebuild", "atlas map")
      : this.requestData("GET", "/atlas/map", "atlas map");
  }

  startRecording(sessionId: string): Promise<{ active: boolean; startedAt: string; path: string }> {
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/recording/start`, "recording status");
  }

  stopRecording(sessionId: string): Promise<ArtifactRef> {
    return this.requestData("POST", `/sessions/${encodeURIComponent(sessionId)}/recording/stop`, "video artifact");
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

async function readSessionArtifactHealth(
  client: SessionHandoffClient,
  sessionId: string
): Promise<{ health: SessionHandoffArtifactHealth | null; unavailableReason?: string }> {
  if (typeof client.getSessionArtifactHealth !== "function") {
    return { health: null, unavailableReason: "daemon client does not support artifact health" };
  }

  try {
    const health = await client.getSessionArtifactHealth(sessionId);
    return {
      health: {
        ok: health.ok,
        target: health.target,
        source: health.source,
        summary: health.summary
      }
    };
  } catch (error) {
    return { health: null, unavailableReason: errorMessage(error) };
  }
}

function sessionHandoffBlockingReasons(params: {
  status: string;
  artifactDir: string | null;
  latestAction?: SessionSummary["events"]["latestAction"];
  latestError?: AtlasLoopError;
  artifactHealthResult: { health: SessionHandoffArtifactHealth | null; unavailableReason?: string };
}): string[] {
  const reasons: string[] = [];
  if (params.status === "unknown") reasons.push("session status is unknown");
  if (params.status === "failed") reasons.push("session status is failed");
  if (!params.artifactDir) reasons.push("session summary did not include paths.artifactDir");
  if (!params.artifactHealthResult.health) {
    reasons.push(`artifact health unavailable: ${params.artifactHealthResult.unavailableReason ?? "unknown error"}`);
  } else if (!params.artifactHealthResult.health.ok) {
    const summary = params.artifactHealthResult.health.summary;
    reasons.push(`artifact health failed: ${summary.errorCount} errors, ${summary.warningCount} warnings`);
  }
  if (params.latestAction?.ok === false) {
    reasons.push(`latest action failed: ${params.latestAction.error?.message ?? params.latestAction.actionId}`);
  }
  if (params.latestError) reasons.push(`latest error: ${params.latestError.message}`);
  return reasons;
}

function buildSessionHandoffNextCommands(params: {
  sessionId: string;
  daemonUrl: string;
  viewerBaseUrl: string;
  canMutate: boolean;
}): string[] {
  const session = shellArg(params.sessionId);
  const daemon = `--daemon-url ${shellArg(params.daemonUrl)}`;
  return [
    ...(params.canMutate ? [`atlas-loop screenshot --session ${session} --reason handoff ${daemon}`] : []),
    `atlas-loop artifacts health --session ${session} ${daemon}`,
    `atlas-loop session handoff --session ${session} --bundle ${shellArg(`./atlas-loop-handoffs/${params.sessionId}`)} --viewer-base-url ${shellArg(params.viewerBaseUrl)} ${daemon}`,
    `atlas-loop evidence report --session ${session} ${daemon}`,
    `atlas-loop evidence export --session ${session} --out ${shellArg(`./atlas-loop-evidence/${params.sessionId}`)} ${daemon}`,
    `atlas-loop events export --session ${session} --out ${shellArg(`./atlas-loop-events/${params.sessionId}.json`)} ${daemon}`,
    `atlas-loop viewer url --session ${session} --viewer-base-url ${shellArg(params.viewerBaseUrl)} ${daemon}`
  ];
}

function buildHandoffViewerUrl(params: { daemonUrl: string; sessionId: string; viewerBaseUrl: string }): string {
  return `${params.viewerBaseUrl}?daemonUrl=${encodeURIComponent(params.daemonUrl)}&sessionId=${encodeURIComponent(params.sessionId)}`;
}

function formatHandoffArtifactHealth(health: SessionHandoffArtifactHealth | null): string {
  if (!health) return "unavailable";
  const summary = health.summary;
  return `${health.ok ? "ok" : "failed"} (${health.source}, sessions: ${summary.sessionCount}, errors: ${summary.errorCount}, warnings: ${summary.warningCount}, issues: ${summary.issueCount})`;
}

function formatHandoffError(error: AtlasLoopError): string {
  const codePart = firstString(error.code) ? `${markdownText(error.code)}: ` : "";
  return `${codePart}${markdownText(error.message)}`;
}

function isLiveSessionStatus(status: string): boolean {
  return status !== "ended" && status !== "failed" && status !== "unknown";
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return String(error);
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatArtifactCounts(counts: Partial<Record<ArtifactType, number>>): string {
  const entries = Object.entries(counts)
    .filter(([, count]) => typeof count === "number" && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "";
  return ` (${entries.map(([type, count]) => `${type}: ${count}`).join(", ")})`;
}

const MAX_ARTIFACT_HIGHLIGHTS = 8;

function normalizeArtifactHighlights(artifacts: ArtifactRef[] | undefined, latestScreenshot: ArtifactRef | null): ArtifactRef[] {
  const byId = new Map<string, ArtifactRef>();
  for (const artifact of artifacts ?? []) {
    if (!artifact?.id || !artifact.path) continue;
    byId.set(artifact.id, artifact);
  }
  if (latestScreenshot?.id && !byId.has(latestScreenshot.id)) byId.set(latestScreenshot.id, latestScreenshot);

  return [...byId.values()]
    .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt) || left.id.localeCompare(right.id))
    .slice(0, MAX_ARTIFACT_HIGHLIGHTS);
}

function formatArtifactHighlight(artifact: ArtifactRef): string {
  const metadata = artifact.metadata ?? {};
  const details = [
    firstString(metadata.actionId) ? `action ${code(firstString(metadata.actionId) as string)}` : undefined,
    firstString(metadata.operation) ? `operation ${code(firstString(metadata.operation) as string)}` : undefined,
    typeof metadata.sizeBytes === "number" ? formatByteCount(metadata.sizeBytes) : undefined
  ].filter(Boolean);
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `- ${code(artifact.type)} ${code(artifact.id)}${suffix}: ${code(artifact.path)}`;
}

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`;
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function code(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}

function markdownText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

export interface EvidenceHtmlScreenshot {
  name: string;
  dataUri: string;
  createdAt?: string;
  actionId?: string;
  label?: string;
}

export interface EvidenceHtmlAction {
  actionId: string;
  kind: string;
  ok: boolean;
  startedAt?: string;
  endedAt?: string;
  artifactCount: number;
  detail?: string;
}

export interface EvidenceHtmlMetricsSample {
  at: string;
  cpuPercent: number;
  rssBytes: number;
}

export interface EvidenceHtmlAtlasScreen {
  name: string;
  named: boolean;
  screenshotCount: number;
  sessionCount: number;
  lastSeenAt?: string;
}

export interface EvidenceHtmlAtlasTransition {
  from: string;
  to: string;
  actionSignature: string;
  count: number;
}

export interface EvidenceHtmlAtlas {
  generatedAt?: string;
  screens: EvidenceHtmlAtlasScreen[];
  transitions: EvidenceHtmlAtlasTransition[];
  omittedTransitions: number;
}

export interface EvidenceHtmlAssets {
  screenshots: EvidenceHtmlScreenshot[];
  actions: EvidenceHtmlAction[];
  metrics: EvidenceHtmlMetricsSample[];
  videoRelativePath?: string;
  truncatedScreenshots: number;
  atlas?: EvidenceHtmlAtlas;
}

export interface CollectEvidenceHtmlAssetsOptions {
  artifacts: ArtifactRef[];
  events: TraceEvent[];
  metrics?: EvidenceHtmlMetricsSample[];
  maxScreenshots?: number;
  readFile: (path: string) => Promise<Uint8Array>;
  /** Maps a video artifact path to the reference written into the report (e.g. relative to the report file). */
  videoPathResolver?: (path: string) => string;
}

/**
 * Gathers the local assets an HTML evidence report inlines. Screenshots are
 * base64-inlined newest-first up to the cap; the video is referenced by path
 * only (multi-MB videos never get base64-inlined).
 */
export async function collectEvidenceHtmlAssets(options: CollectEvidenceHtmlAssetsOptions): Promise<EvidenceHtmlAssets> {
  const maxScreenshots = options.maxScreenshots ?? 20;

  const startedByActionId = new Map<string, { kind: string; detail?: string }>();
  for (const event of options.events) {
    if (event.type !== "action.started" || !event.action) continue;
    const action = event.action as unknown as Record<string, unknown> & { id: string; kind: string };
    startedByActionId.set(action.id, { kind: action.kind, detail: actionDetailText(action) });
  }

  const actions: EvidenceHtmlAction[] = [];
  for (const event of options.events) {
    if (event.type !== "action.completed" || !event.result) continue;
    const started = startedByActionId.get(event.result.actionId);
    actions.push({
      actionId: event.result.actionId,
      kind: started?.kind ?? "unknown",
      ok: Boolean(event.result.ok),
      startedAt: event.result.startedAt,
      endedAt: event.result.endedAt,
      artifactCount: event.result.artifacts?.length ?? 0,
      detail: started?.detail ?? (event.result.error ? `${event.result.error.code}: ${event.result.error.message}` : undefined)
    });
  }
  actions.sort((left, right) => (left.startedAt ?? "").localeCompare(right.startedAt ?? ""));

  const screenshotArtifacts = options.artifacts
    .filter((artifact) => artifact.type === "screenshot")
    .sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  const selected = screenshotArtifacts.slice(0, maxScreenshots);
  const truncatedScreenshots = Math.max(0, screenshotArtifacts.length - selected.length);

  const screenshots: EvidenceHtmlScreenshot[] = [];
  for (const artifact of selected) {
    try {
      const data = await options.readFile(artifact.path);
      screenshots.push({
        name: artifact.path.split("/").at(-1) ?? artifact.id,
        dataUri: `data:image/png;base64,${Buffer.from(data).toString("base64")}`,
        createdAt: artifact.createdAt,
        actionId: metadataText(artifact, "actionId"),
        label: metadataText(artifact, "reason") ?? metadataText(artifact, "identifier") ?? metadataText(artifact, "actionKind")
      });
    } catch {
      // Unreadable screenshots are simply omitted from the gallery.
    }
  }

  const videoArtifact = [...options.artifacts]
    .filter((artifact) => artifact.type === "video")
    .sort((left, right) => (left.createdAt ?? "").localeCompare(right.createdAt ?? ""))
    .at(-1);

  return {
    screenshots,
    actions,
    metrics: options.metrics ?? [],
    videoRelativePath: videoArtifact ? (options.videoPathResolver ?? ((path: string) => path))(videoArtifact.path) : undefined,
    truncatedScreenshots
  };
}

/**
 * Extracts the session-relevant slice of an atlas map view (as returned by the
 * daemon's atlas map route) for the HTML report. Returns undefined when the
 * payload is malformed or the session never appears in the map, so callers can
 * skip the section gracefully.
 */
export function evidenceHtmlAtlasFromMapView(view: unknown, sessionId: string, maxTransitions = 10): EvidenceHtmlAtlas | undefined {
  const map = (view as { map?: { generatedAt?: string; screens?: unknown; transitions?: unknown } } | null | undefined)?.map;
  if (!map || !Array.isArray(map.screens) || !Array.isArray(map.transitions)) return undefined;

  const allScreens = map.screens.filter(
    (screen): screen is { id: string; screenId?: string; screenshotCount?: number; sessionIds?: unknown; lastSeenAt?: string } =>
      typeof (screen as { id?: unknown })?.id === "string"
  );
  const nameFor = (nodeId: string): { name: string; named: boolean } => {
    if (nodeId === "__launch__") return { name: "launch", named: true };
    const screen = allScreens.find((candidate) => candidate.id === nodeId);
    if (screen?.screenId) return { name: screen.screenId, named: true };
    return { name: `screen ${nodeId.replace(/^screen_/, "").slice(0, 8)}`, named: false };
  };
  const observedHere = (sessionIds: unknown): boolean => Array.isArray(sessionIds) && sessionIds.includes(sessionId);

  const screens: EvidenceHtmlAtlasScreen[] = allScreens
    .filter((screen) => observedHere(screen.sessionIds))
    .map((screen) => ({
      ...nameFor(screen.id),
      screenshotCount: typeof screen.screenshotCount === "number" ? screen.screenshotCount : 0,
      sessionCount: Array.isArray(screen.sessionIds) ? screen.sessionIds.length : 0,
      ...(typeof screen.lastSeenAt === "string" ? { lastSeenAt: screen.lastSeenAt } : {})
    }));

  const sessionTransitions = map.transitions
    .filter(
      (transition): transition is { from: string; to: string; actionSignature?: string; count?: number; sessionIds?: unknown } =>
        typeof (transition as { from?: unknown })?.from === "string" &&
        typeof (transition as { to?: unknown })?.to === "string" &&
        observedHere((transition as { sessionIds?: unknown }).sessionIds)
    )
    .map((transition) => ({
      from: nameFor(transition.from).name,
      to: nameFor(transition.to).name,
      actionSignature: typeof transition.actionSignature === "string" ? transition.actionSignature : "",
      count: typeof transition.count === "number" ? transition.count : 0
    }))
    .sort((left, right) => right.count - left.count || left.from.localeCompare(right.from) || left.to.localeCompare(right.to));

  if (screens.length === 0 && sessionTransitions.length === 0) return undefined;

  return {
    ...(typeof map.generatedAt === "string" ? { generatedAt: map.generatedAt } : {}),
    screens,
    transitions: sessionTransitions.slice(0, maxTransitions),
    omittedTransitions: Math.max(0, sessionTransitions.length - maxTransitions)
  };
}

function metadataText(artifact: ArtifactRef, key: string): string | undefined {
  const value = artifact.metadata?.[key];
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;
}

function actionDetailText(action: Record<string, unknown> & { kind: string }): string | undefined {
  if (typeof action.identifier === "string") return action.identifier;
  if (typeof action.x === "number" && typeof action.y === "number") return `${action.x}, ${action.y}`;
  if (typeof action.text === "string") return "text input";
  if (typeof action.bundleId === "string") return action.bundleId;
  if (typeof action.reason === "string") return action.reason;
  return undefined;
}

/**
 * Renders one self-contained dark-themed HTML file: no scripts, no external
 * asset references. Screenshots arrive base64-inlined; the video (if any) is
 * referenced by a local path so the file stays small.
 */
export function buildEvidenceHtmlReport(
  evidence: EvidenceReportData,
  assets: EvidenceHtmlAssets,
  options: { generatedAt?: string } = {}
): string {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const failedActions = assets.actions.filter((action) => !action.ok).length;

  const sections: string[] = [];

  sections.push(`<header>
  <p class="kicker">Atlas Loop</p>
  <h1>Evidence report</h1>
  <p class="meta">session <code>${escapeHtml(evidence.sessionId)}</code> · status ${escapeHtml(evidence.sessionStatus ?? "unknown")} · generated ${escapeHtml(generatedAt)}</p>
</header>`);

  sections.push(`<section>
  <h2>Session</h2>
  <dl class="facts">
    <div><dt>Created</dt><dd>${escapeHtml(evidence.createdAt ?? "--")}</dd></div>
    <div><dt>Updated</dt><dd>${escapeHtml(evidence.updatedAt ?? "--")}</dd></div>
    <div><dt>Storage</dt><dd>${escapeHtml(evidence.storage.source)}${evidence.storage.artifactBacked ? " (artifact-backed)" : ""}</dd></div>
    <div><dt>Artifacts</dt><dd>${evidence.artifactTotal}</dd></div>
    <div><dt>Events</dt><dd>${evidence.eventTotal}</dd></div>
    <div><dt>Artifact dir</dt><dd><code>${escapeHtml(evidence.artifactDir)}</code></dd></div>
  </dl>
</section>`);

  if (assets.actions.length > 0) {
    const rows = assets.actions
      .map(
        (action) => `      <tr class="${action.ok ? "ok" : "failed"}">
        <td><code>${escapeHtml(action.actionId)}</code></td>
        <td>${escapeHtml(action.kind)}</td>
        <td>${escapeHtml(action.detail ?? "")}</td>
        <td>${action.ok ? "passed" : "failed"}</td>
        <td>${escapeHtml(action.startedAt ?? "--")}</td>
        <td>${action.artifactCount}</td>
      </tr>`
      )
      .join("\n");
    sections.push(`<section>
  <h2>Actions <small>${assets.actions.length} total${failedActions > 0 ? ` · ${failedActions} failed` : ""}</small></h2>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Action</th><th>Kind</th><th>Detail</th><th>Result</th><th>Started</th><th>Artifacts</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</section>`);
  }

  if (assets.atlas && (assets.atlas.screens.length > 0 || assets.atlas.transitions.length > 0)) {
    const atlas = assets.atlas;
    const namedCount = atlas.screens.filter((screen) => screen.named).length;
    const screenRows = atlas.screens
      .map(
        (screen) => `      <tr>
        <td>${screen.named ? `<code>${escapeHtml(screen.name)}</code>` : escapeHtml(screen.name)}</td>
        <td>${screen.screenshotCount}</td>
        <td>${screen.sessionCount}</td>
        <td>${escapeHtml(screen.lastSeenAt ?? "--")}</td>
      </tr>`
      )
      .join("\n");
    const transitionRows = atlas.transitions
      .map(
        (transition) => `      <tr>
        <td>${escapeHtml(transition.from)}</td>
        <td><code>${escapeHtml(transition.actionSignature)}</code></td>
        <td>${escapeHtml(transition.to)}</td>
        <td>${transition.count}</td>
      </tr>`
      )
      .join("\n");
    sections.push(`<section>
  <h2>Atlas map <small>${atlas.screens.length} screen${atlas.screens.length === 1 ? "" : "s"} observed in this session${namedCount > 0 ? ` · ${namedCount} named` : ""}${atlas.generatedAt ? ` · map generated ${escapeHtml(atlas.generatedAt)}` : ""}</small></h2>
${
  atlas.screens.length > 0
    ? `  <div class="table-wrap">
    <table>
      <thead><tr><th>Screen</th><th>Screenshots</th><th>Sessions</th><th>Last seen</th></tr></thead>
      <tbody>
${screenRows}
      </tbody>
    </table>
  </div>`
    : ""
}
${
  atlas.transitions.length > 0
    ? `  <h3>Top transitions${atlas.omittedTransitions > 0 ? ` <small>${atlas.omittedTransitions} more omitted</small>` : ""}</h3>
  <div class="table-wrap">
    <table>
      <thead><tr><th>From</th><th>Action</th><th>To</th><th>Count</th></tr></thead>
      <tbody>
${transitionRows}
      </tbody>
    </table>
  </div>`
    : ""
}
</section>`);
  }

  if (assets.metrics.length > 1) {
    const cpu = assets.metrics.map((sample) => sample.cpuPercent);
    const rssMb = assets.metrics.map((sample) => sample.rssBytes / (1024 * 1024));
    sections.push(`<section>
  <h2>App metrics <small>${assets.metrics.length} samples</small></h2>
  <div class="spark"><span>CPU · peak ${Math.max(...cpu).toFixed(1)}%</span>${sparklineSvg(cpu)}</div>
  <div class="spark"><span>Memory · peak ${Math.max(...rssMb).toFixed(0)}MB</span>${sparklineSvg(rssMb)}</div>
</section>`);
  }

  if (assets.videoRelativePath) {
    sections.push(`<section>
  <h2>Video</h2>
  <p>The session recording lives next to this report's evidence: <code>${escapeHtml(assets.videoRelativePath)}</code></p>
  <video controls preload="metadata" src="${escapeHtml(assets.videoRelativePath)}"></video>
</section>`);
  }

  if (assets.screenshots.length > 0) {
    const figures = assets.screenshots
      .map(
        (shot) => `    <figure>
      <img src="${shot.dataUri}" alt="${escapeHtml(shot.name)}" loading="lazy" />
      <figcaption><code>${escapeHtml(shot.name)}</code>${shot.label ? ` · ${escapeHtml(shot.label)}` : ""}${shot.createdAt ? `<br /><small>${escapeHtml(shot.createdAt)}</small>` : ""}</figcaption>
    </figure>`
      )
      .join("\n");
    sections.push(`<section>
  <h2>Screenshots <small>${assets.screenshots.length} inlined${assets.truncatedScreenshots > 0 ? ` · ${assets.truncatedScreenshots} older omitted` : ""}</small></h2>
  <div class="gallery">
${figures}
  </div>
</section>`);
  }

  if (evidence.storage.warnings.length > 0) {
    const items = evidence.storage.warnings
      .map((warning) => `    <li><code>${escapeHtml(warning.path)}</code> ${escapeHtml(warning.message)}</li>`)
      .join("\n");
    sections.push(`<section>
  <h2>Warnings</h2>
  <ul>
${items}
  </ul>
</section>`);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Atlas Loop evidence · ${escapeHtml(evidence.sessionId)}</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; padding: 32px; background: #0b0f16; color: #e6e9ef; font: 14px/1.5 -apple-system, "Segoe UI", sans-serif; }
.kicker { letter-spacing: .22em; text-transform: uppercase; font-size: 11px; color: #4ab3d8; margin: 0; }
h1 { margin: 4px 0 6px; }
h2 { margin: 32px 0 12px; font-size: 16px; }
h2 small { font-weight: 400; color: #8b93a3; font-size: 12px; }
h3 { margin: 18px 0 8px; font-size: 13px; }
h3 small { font-weight: 400; color: #8b93a3; font-size: 11px; }
.meta { color: #8b93a3; font-size: 12px; }
code { background: rgba(74,179,216,.12); padding: 1px 5px; border-radius: 5px; font-size: 12px; }
.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 0; }
.facts dt { font-size: 11px; color: #8b93a3; }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid rgba(139,147,163,.18); }
tr.failed td { color: #f07878; }
.spark { display: flex; align-items: center; gap: 12px; margin: 8px 0; font-size: 12px; color: #8b93a3; }
.spark span { min-width: 160px; }
.spark svg { background: rgba(0,0,0,.3); border-radius: 8px; }
video { max-width: 420px; width: 100%; border-radius: 10px; margin-top: 8px; background: #000; }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
figure { margin: 0; }
figure img { width: 100%; border-radius: 10px; border: 1px solid rgba(74,179,216,.25); }
figcaption { font-size: 11px; color: #8b93a3; margin-top: 4px; overflow-wrap: anywhere; }
footer { margin-top: 40px; font-size: 11px; color: #8b93a3; }
</style>
</head>
<body>
${sections.join("\n\n")}

<footer>Self-contained local evidence report generated by Atlas Loop. No data leaves this machine.</footer>
</body>
</html>
`;
}

function sparklineSvg(values: number[]): string {
  const width = 260;
  const height = 40;
  const max = Math.max(...values, 0.000001) * 1.08;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => `${(index * step).toFixed(1)},${(height - (value / max) * height).toFixed(1)}`)
    .join(" ");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><polyline fill="none" stroke="#4ab3d8" stroke-width="1.6" points="${points}" /></svg>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
