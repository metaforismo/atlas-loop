import type {
  ActionResultLike,
  ApiEnvelope,
  AtlasLoopError,
  ArtifactHealth,
  ArtifactHealthIssue,
  ArtifactHealthReport,
  ArtifactRef,
  ArtifactType,
  ScreenshotState,
  Session,
  SessionHistoryActionEvidence,
  SessionHistoryArtifactEvidence,
  SessionHistoryEventEvidence,
  SessionHistoryItem,
  SessionHistoryStorageEvidence,
  SessionListItem,
  SessionSummary,
  TraceEvent,
  ViewerActionDraft,
  ViewerActionRequest,
  ViewerNumericInput,
  ViewerParams
} from "./types.js";
import { buildSessionHistoryUrl, buildSessionsUrl, buildSessionUrl, normalizeDaemonUrl } from "./viewerParams.js";

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function unwrapEnvelope<T>(value: unknown): T {
  if (value && typeof value === "object" && "ok" in value) {
    const envelope = value as ApiEnvelope<T>;
    if (!envelope.ok) {
      throw new ApiError(envelope.error?.message ?? "Daemon returned an error");
    }
    return envelope.data as T;
  }

  return value as T;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<{ response: Response; text: string }> {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new ApiError(`${response.status} ${response.statusText}`.trim(), response.status);
  }

  return { response, text: await response.text() };
}

export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const { text } = await fetchText(url, signal);
  if (!text.trim()) return undefined as T;

  try {
    return unwrapEnvelope<T>(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Daemon returned invalid JSON");
  }
}

export async function fetchHealth(daemonUrl: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await fetchText(`${normalizeDaemonUrl(daemonUrl)}/healthz`, signal);
    return true;
  } catch {
    return false;
  }
}

export async function fetchSession(params: ViewerParams, signal?: AbortSignal): Promise<Session | undefined> {
  return fetchJson<Session>(buildSessionUrl(params), signal);
}

export async function fetchSessionSummary(params: ViewerParams, signal?: AbortSignal): Promise<SessionSummary | undefined> {
  return fetchJson<SessionSummary>(buildSessionUrl(params, "summary"), signal);
}

export async function fetchSessionHistory(daemonUrl: string, limit?: number, signal?: AbortSignal): Promise<SessionHistoryItem[]> {
  const value = await fetchJson<unknown>(buildSessionHistoryUrl(daemonUrl, limit), signal);
  return normalizeSessionHistory(value);
}

export async function fetchSessions(daemonUrl: string, signal?: AbortSignal): Promise<SessionHistoryItem[]> {
  try {
    return await fetchSessionHistory(daemonUrl, undefined, signal);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  const value = await fetchJson<unknown>(buildSessionsUrl(daemonUrl), signal);
  return normalizeSessionList(value);
}

export async function fetchArtifacts(params: ViewerParams, signal?: AbortSignal): Promise<ArtifactRef[]> {
  const value = await fetchJson<unknown>(buildSessionUrl(params, "artifacts"), signal);
  return normalizeArtifactList(value);
}

export async function fetchArtifactHealth(params: ViewerParams, signal?: AbortSignal): Promise<ArtifactHealth> {
  const value = await fetchJson<unknown>(buildSessionUrl(params, "artifacts/health"), signal);
  const health = normalizeArtifactHealth(value);
  if (!health) throw new ApiError("Daemon returned invalid artifact health.");
  return health;
}

export async function fetchEvents(params: ViewerParams, signal?: AbortSignal): Promise<TraceEvent[]> {
  const value = await fetchJson<unknown>(buildSessionUrl(params, "events"), signal);
  return normalizeEventList(value);
}

export interface SessionMetricsLike {
  active: boolean;
  sampleCount: number;
  samples: Array<{ at: string; cpuPercent: number; rssBytes: number }>;
}

export async function fetchSessionMetrics(params: ViewerParams, signal?: AbortSignal): Promise<SessionMetricsLike> {
  const value = await fetchJson<{ active?: unknown; sampleCount?: unknown; samples?: unknown }>(
    buildSessionUrl(params, "metrics"),
    signal
  );
  const samples = Array.isArray(value?.samples)
    ? value.samples.filter(
        (sample): sample is { at: string; cpuPercent: number; rssBytes: number } =>
          Boolean(sample) &&
          typeof (sample as { at?: unknown }).at === "string" &&
          typeof (sample as { cpuPercent?: unknown }).cpuPercent === "number" &&
          typeof (sample as { rssBytes?: unknown }).rssBytes === "number"
      )
    : [];
  return {
    active: value?.active === true,
    sampleCount: typeof value?.sampleCount === "number" ? value.sampleCount : samples.length,
    samples
  };
}

export async function performViewerAction(params: ViewerParams, draft: ViewerActionDraft, signal?: AbortSignal): Promise<ActionResultLike> {
  const request = buildViewerActionRequest(draft);
  const response = await fetch(buildSessionUrl(params, request.endpoint), {
    method: "POST",
    signal,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(request.body)
  });
  const text = await response.text();
  const payload = parseActionResponseBody(text, response.status);

  if (!response.ok) {
    throw apiErrorFromPayload(payload, response);
  }

  try {
    const result = unwrapEnvelope<ActionResultLike>(payload);
    if (!isActionResultLike(result)) throw new ApiError("Daemon returned an invalid action result", response.status);
    return result;
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError(error.message, response.status);
    throw error;
  }
}

export function buildViewerActionRequest(draft: ViewerActionDraft): ViewerActionRequest {
  switch (draft.kind) {
    case "screenshot": {
      const reason = cleanOptionalText(draft.reason);
      return {
        endpoint: "screenshot",
        body: reason ? { reason } : {}
      };
    }
    case "wait":
      return {
        endpoint: "actions",
        body: { action: { kind: "wait", durationMs: parseNonNegativeDuration(draft.durationMs, "wait duration") } }
      };
    case "tap":
      return {
        endpoint: "actions",
        body: {
          action: {
            kind: "tap",
            x: parseNormalizedNumber(draft.x, "tap x"),
            y: parseNormalizedNumber(draft.y, "tap y")
          }
        }
      };
    case "typeText": {
      if (draft.text.length === 0) throw new ApiError("type text must not be empty");
      return {
        endpoint: "actions",
        body: { action: { kind: "typeText", text: draft.text } }
      };
    }
    case "swipe":
      return {
        endpoint: "actions",
        body: {
          action: {
            kind: "swipe",
            from: {
              x: parseNormalizedNumber(draft.from.x, "swipe from x"),
              y: parseNormalizedNumber(draft.from.y, "swipe from y")
            },
            to: {
              x: parseNormalizedNumber(draft.to.x, "swipe to x"),
              y: parseNormalizedNumber(draft.to.y, "swipe to y")
            },
            durationMs: parseNonNegativeDuration(draft.durationMs, "swipe duration")
          }
        }
      };
  }
}

export async function fetchLatestScreenshot(params: ViewerParams, signal?: AbortSignal): Promise<ScreenshotState> {
  const url = buildSessionUrl(params, "latest-screenshot");
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    headers: {
      Accept: "image/*, application/json"
    }
  });

  if (response.status === 204 || response.status === 404) {
    return { status: "empty", message: "No screenshot captured yet." };
  }

  if (!response.ok) {
    throw new ApiError(`${response.status} ${response.statusText}`.trim(), response.status);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.startsWith("image/")) {
    const blob = await response.blob();
    if (blob.size === 0) return { status: "empty", message: "No screenshot captured yet." };

    return {
      status: "ready",
      src: URL.createObjectURL(blob),
      source: "blob",
      mediaType: contentType,
      updatedAt: new Date().toISOString()
    };
  }

  if (contentType.includes("application/json") || contentType.includes("+json")) {
    const payload = unwrapEnvelope<unknown>(await response.json());
    return normalizeScreenshotPayload(payload, params.daemonUrl);
  }

  return { status: "empty", message: "Latest screenshot endpoint returned no image." };
}

export function screenshotArtifactIdentity(summary: SessionSummary | undefined, artifacts: ArtifactRef[]): string | undefined {
  const summaryParts = [
    summary?.artifacts.latestScreenshotId,
    summary?.artifacts.latestScreenshotPath,
    summary?.artifacts.latestScreenshotCreatedAt
  ].filter(isNonEmptyString);

  if (summaryParts.length > 0) return `summary:${summaryParts.join("|")}`;

  const artifact = artifacts.find((candidate) => candidate.type === "screenshot");
  if (!artifact) return undefined;

  return [
    "artifact",
    artifact.id,
    artifact.path,
    artifact.createdAt,
    artifact.sha256,
    artifact.url
  ]
    .filter(isNonEmptyString)
    .join("|");
}

export function screenshotObjectUrl(state: ScreenshotState): string | undefined {
  return isDisplayableScreenshot(state) && state.source === "blob" ? state.src : undefined;
}

export function isDisplayableScreenshot(
  state: ScreenshotState
): state is Extract<ScreenshotState, { status: "ready" | "stale" }> {
  return state.status === "ready" || state.status === "stale";
}

export function markScreenshotFetchFailed(previous: ScreenshotState, message: string, staleAt = new Date().toISOString()): ScreenshotState {
  if (!isDisplayableScreenshot(previous)) return { status: "error", message };

  return {
    status: "stale",
    src: previous.src,
    source: previous.source,
    mediaType: previous.mediaType,
    updatedAt: previous.updatedAt,
    message,
    staleAt
  };
}

export function mergeScreenshotFetchResult(
  previous: ScreenshotState,
  next: ScreenshotState,
  options: { hasStableArtifactKey: boolean; staleAt?: string }
): ScreenshotState {
  if (options.hasStableArtifactKey && next.status === "empty" && isDisplayableScreenshot(previous)) {
    return markScreenshotFetchFailed(previous, next.message, options.staleAt);
  }
  return next;
}

export function normalizeArtifactList(value: unknown): ArtifactRef[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { artifacts?: unknown[] }).artifacts)
      ? (value as { artifacts: unknown[] }).artifacts
      : [];

  return list.filter(isArtifactRef);
}

export function normalizeSessionHistory(value: unknown): SessionHistoryItem[] {
  return sessionListValues(value)
    .map(normalizeSessionListItem)
    .filter((session): session is SessionHistoryItem => Boolean(session));
}

export function normalizeSessionList(value: unknown): SessionListItem[] {
  return normalizeSessionHistory(value);
}

function sessionListValues(value: unknown): unknown[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { sessions?: unknown[] }).sessions)
      ? (value as { sessions: unknown[] }).sessions
      : value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)
        ? (value as { items: unknown[] }).items
        : value && typeof value === "object" && !Array.isArray(value)
          ? [value]
        : [];

  return list;
}

export function normalizeEventList(value: unknown): TraceEvent[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { events?: unknown[] }).events)
      ? (value as { events: unknown[] }).events
      : [];

  return list.filter(isTraceEvent);
}

export function normalizeArtifactHealth(value: unknown): ArtifactHealth | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  const rawReport = objectOrUndefined<Record<string, unknown>>(record.report);
  const summaryRecord = objectOrUndefined<Record<string, unknown>>(record.summary);
  const hasExplicitOk = typeof record.ok === "boolean";
  const reportIssues = normalizeArtifactHealthIssues(rawReport?.issues);
  const topLevelIssues = reportIssues.length > 0 ? reportIssues : normalizeArtifactHealthIssues(record.issues);
  const reportSessionCount = nonNegativeInteger(rawReport?.sessionCount);
  const hasCompleteSummary = Boolean(
    summaryRecord &&
    nonNegativeInteger(summaryRecord.sessionCount) !== undefined &&
    nonNegativeInteger(summaryRecord.errorCount) !== undefined &&
    nonNegativeInteger(summaryRecord.warningCount) !== undefined &&
    nonNegativeInteger(summaryRecord.issueCount) !== undefined
  );
  const hasReadableReport = Boolean(
    rawReport &&
    typeof rawReport.ok === "boolean" &&
    reportSessionCount !== undefined &&
    Array.isArray(rawReport.issues)
  );
  if (!hasExplicitOk || (!hasCompleteSummary && !hasReadableReport)) return undefined;

  const inferredErrorCount = topLevelIssues.filter((issue) => issue.severity === "error").length;
  const inferredWarningCount = topLevelIssues.filter((issue) => issue.severity === "warning").length;
  const errorCount = nonNegativeInteger(summaryRecord?.errorCount) ?? inferredErrorCount;
  const warningCount = nonNegativeInteger(summaryRecord?.warningCount) ?? inferredWarningCount;
  const issueCount = nonNegativeInteger(summaryRecord?.issueCount) ?? topLevelIssues.length;
  const sessionCount = nonNegativeInteger(summaryRecord?.sessionCount) ?? reportSessionCount ?? 0;
  const reportOk = typeof rawReport?.ok === "boolean" ? rawReport.ok : undefined;
  const ok = typeof record.ok === "boolean" ? record.ok : (reportOk ?? errorCount === 0);
  const report = rawReport
    ? ({
        ...rawReport,
        target: firstString(rawReport.target) ?? undefined,
        sessionCount: nonNegativeInteger(rawReport.sessionCount),
        ok: reportOk,
        issues: topLevelIssues
      } satisfies ArtifactHealthReport)
    : topLevelIssues.length > 0
      ? ({ issues: topLevelIssues, ok, sessionCount } satisfies ArtifactHealthReport)
      : undefined;

  return {
    ok,
    target: firstString(record.target, rawReport?.target),
    sessionId: firstString(record.sessionId),
    requestedSessionId: firstString(record.requestedSessionId),
    source: firstString(record.source),
    artifactDir: firstString(record.artifactDir),
    report,
    summary: {
      sessionCount,
      errorCount,
      warningCount,
      issueCount
    }
  };
}

export function normalizeScreenshotPayload(value: unknown, daemonUrl: string): ScreenshotState {
  if (!value) return { status: "empty", message: "No screenshot captured yet." };

  if (typeof value === "string") {
    return {
      status: "ready",
      src: toResourceUrl(value, daemonUrl),
      source: value.startsWith("data:") ? "data-url" : "url",
      updatedAt: new Date().toISOString()
    };
  }

  if (typeof value !== "object") {
    return { status: "empty", message: "Latest screenshot payload is not displayable." };
  }

  const record = value as Record<string, unknown>;
  const dataUrl = firstString(record.dataUrl, record.dataURI);
  if (dataUrl) {
    return { status: "ready", src: dataUrl, source: "data-url", updatedAt: firstString(record.updatedAt, record.createdAt) ?? new Date().toISOString() };
  }

  const base64 = firstString(record.base64, record.data);
  if (base64) {
    const mediaType = firstString(record.mediaType, record.mimeType, record.contentType) ?? "image/png";
    return {
      status: "ready",
      src: `data:${mediaType};base64,${base64}`,
      source: "data-url",
      mediaType,
      updatedAt: firstString(record.updatedAt, record.createdAt) ?? new Date().toISOString()
    };
  }

  const url = firstString(record.url, record.href, record.src, record.path);
  if (url) {
    return {
      status: "ready",
      src: toResourceUrl(url, daemonUrl),
      source: "url",
      mediaType: firstString(record.mediaType, record.mimeType, record.contentType),
      updatedAt: firstString(record.updatedAt, record.createdAt) ?? new Date().toISOString()
    };
  }

  return { status: "empty", message: "Latest screenshot payload did not include a display URL." };
}

export function toResourceUrl(value: string, daemonUrl: string): string {
  if (value.startsWith("data:")) return value;

  try {
    return new URL(value).toString();
  } catch {
    if (value.startsWith("/")) return `${normalizeDaemonUrl(daemonUrl)}${value}`;
    return `${normalizeDaemonUrl(daemonUrl)}/${value}`;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
  if (number === undefined || !Number.isFinite(number) || number < 0) return undefined;
  return Math.trunc(number);
}

function firstNonNegativeInteger(...values: unknown[]): number | undefined {
  for (const value of values) {
    const normalized = nonNegativeInteger(value);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

function normalizeArtifactHealthIssues(value: unknown): ArtifactHealthIssue[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((issue) => {
      if (typeof issue === "string" && issue.trim()) return { message: issue.trim() };
      if (!issue || typeof issue !== "object" || Array.isArray(issue)) return undefined;

      const record = issue as Record<string, unknown>;
      const message = firstString(record.message, record.detail, record.error);
      const path = firstString(record.path, record.file, record.target);
      if (!message && !path) return undefined;

      const severity = firstString(record.severity, record.level, record.type);
      return {
        severity: normalizeArtifactIssueSeverity(severity),
        path,
        message: message ?? path!
      };
    })
    .filter((issue): issue is ArtifactHealthIssue => Boolean(issue));
}

function normalizeArtifactIssueSeverity(value: string | undefined): ArtifactHealthIssue["severity"] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "error" || normalized === "warning") return normalized;
  return normalized;
}

function parseActionResponseBody(text: string, status: number): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError("Daemon returned invalid JSON", status);
  }
}

function apiErrorFromPayload(payload: unknown, response: Response): ApiError {
  const statusMessage = `${response.status} ${response.statusText}`.trim();
  if (payload && typeof payload === "object") {
    const envelope = payload as ApiEnvelope<unknown>;
    if (envelope.ok === false && envelope.error?.message) {
      return new ApiError(envelope.error.message, response.status);
    }
  }
  return new ApiError(statusMessage || "Daemon returned an error", response.status);
}

function parseNumberInput(value: ViewerNumericInput, label: string): number {
  if (typeof value === "string" && value.trim().length === 0) {
    throw new ApiError(`${label} is required`);
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new ApiError(`${label} must be a number`);
  return number;
}

function parseNormalizedNumber(value: ViewerNumericInput, label: string): number {
  const number = parseNumberInput(value, label);
  if (number < 0 || number > 1) throw new ApiError(`${label} must be between 0 and 1`);
  return number;
}

function parseNonNegativeDuration(value: ViewerNumericInput, label: string): number {
  const number = parseNumberInput(value, label);
  if (number < 0) throw new ApiError(`${label} must be non-negative`);
  return number;
}

function cleanOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isActionResultLike(value: unknown): value is ActionResultLike {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ActionResultLike>;
  return typeof record.actionId === "string" && typeof record.ok === "boolean";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeSessionListItem(value: unknown): SessionHistoryItem | undefined {
  if (typeof value === "string" && value.trim()) return { id: value.trim() };
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const embeddedSession = objectOrUndefined<Session>(record.session);
  const id = firstString(record.id, record.sessionId, embeddedSession?.id);
  if (!id) return undefined;

  const artifacts = normalizeSessionHistoryArtifacts(record);
  const events = normalizeSessionHistoryEvents(record);
  const hasScreenshot = booleanOrUndefined(record.hasScreenshot)
    ?? (artifacts?.latestScreenshot || artifacts?.latestScreenshotId || artifacts?.latestScreenshotPath ? true : undefined);
  const session: SessionHistoryItem = {
    id,
    status: firstString(record.status, record.state, embeddedSession?.status),
    createdAt: firstString(record.createdAt, record.startedAt, embeddedSession?.createdAt),
    updatedAt: firstString(
      record.updatedAt,
      record.lastUpdatedAt,
      record.lastActivityAt,
      record.lastEventAt,
      embeddedSession?.updatedAt,
      embeddedSession?.createdAt
    ),
    simulator: objectOrUndefined(record.simulator) ?? embeddedSession?.simulator,
    app: objectOrUndefined(record.app) ?? embeddedSession?.app,
    artifactDir: firstString(record.artifactDir, record.artifactsDir, embeddedSession?.artifactDir),
    viewerUrl: firstString(record.viewerUrl, embeddedSession?.viewerUrl),
    backend: firstString(record.backend, embeddedSession?.backend),
    platform: firstString(record.platform, embeddedSession?.platform),
    error: objectOrUndefined(record.error) ?? embeddedSession?.error
  };

  const sessionId = firstString(record.sessionId);
  if (sessionId) session.sessionId = sessionId;
  if (embeddedSession) session.session = embeddedSession;

  const storage = normalizeSessionHistoryStorage(record);
  if (storage) session.storage = storage;
  if (artifacts) session.artifacts = artifacts;
  if (events) session.events = events;
  if (hasScreenshot !== undefined) session.hasScreenshot = hasScreenshot;
  const canMutate = booleanOrUndefined(record.canMutate);
  if (canMutate !== undefined) session.canMutate = canMutate;
  const ready = booleanOrUndefined(record.ready);
  if (ready !== undefined) session.ready = ready;
  const blockingReasons = normalizeStringList(record.blockingReasons);
  if (blockingReasons.length > 0) session.blockingReasons = blockingReasons;

  return session;
}

function objectOrUndefined<T extends object>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function normalizeSessionHistoryStorage(record: Record<string, unknown>): SessionHistoryStorageEvidence | undefined {
  const storageRecord = objectOrUndefined<Record<string, unknown>>(record.storage);
  const warnings = normalizeStorageWarnings(storageRecord?.warnings ?? record.warnings);
  const source = firstString(storageRecord?.source, record.storageSource, record.source);
  const artifactBacked = booleanOrUndefined(storageRecord?.artifactBacked ?? record.artifactBacked);
  const warningCount = firstNonNegativeInteger(storageRecord?.warningCount, record.warningCount, warnings.length > 0 ? warnings.length : undefined);

  if (!source && artifactBacked === undefined && warningCount === undefined && warnings.length === 0) return undefined;

  return {
    source,
    artifactBacked,
    warningCount,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

function normalizeStorageWarnings(value: unknown): Array<{ path?: string; message: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((warning) => {
      if (typeof warning === "string" && warning.trim()) return { message: warning.trim() };
      if (!warning || typeof warning !== "object" || Array.isArray(warning)) return undefined;
      const record = warning as Record<string, unknown>;
      const message = firstString(record.message, record.detail, record.error);
      const path = firstString(record.path, record.file, record.target);
      if (!message && !path) return undefined;
      return { path, message: message ?? path! };
    })
    .filter((warning): warning is { path?: string; message: string } => Boolean(warning));
}

function normalizeSessionHistoryArtifacts(record: Record<string, unknown>): SessionHistoryArtifactEvidence | undefined {
  const artifactsValue = record.artifacts;
  const artifactArray = Array.isArray(artifactsValue) ? artifactsValue.filter(isArtifactRef) : undefined;
  const artifactsRecord = objectOrUndefined<Record<string, unknown>>(artifactsValue);
  const latestScreenshotFromRecord = artifactsRecord ? artifactsRecord.latestScreenshot : undefined;
  const latestScreenshot = isArtifactRef(latestScreenshotFromRecord)
    ? latestScreenshotFromRecord
    : artifactArray?.find((artifact) => artifact.type === "screenshot");
  const byType = objectOrUndefined<Partial<Record<ArtifactType, number>>>(artifactsRecord?.byType);
  const total = firstNonNegativeInteger(artifactsRecord?.total, record.artifactCount, record.artifactsCount, artifactArray?.length);
  const latestScreenshotId = firstString(artifactsRecord?.latestScreenshotId, record.latestScreenshotId, latestScreenshot?.id);
  const latestScreenshotPath = firstString(artifactsRecord?.latestScreenshotPath, record.latestScreenshotPath, latestScreenshot?.path);
  const latestScreenshotCreatedAt = firstString(
    artifactsRecord?.latestScreenshotCreatedAt,
    record.latestScreenshotCreatedAt,
    latestScreenshot?.createdAt
  );

  if (
    total === undefined &&
    !byType &&
    !latestScreenshot &&
    !latestScreenshotId &&
    !latestScreenshotPath &&
    !latestScreenshotCreatedAt
  ) {
    return undefined;
  }

  return {
    total,
    byType,
    latestScreenshot,
    latestScreenshotId,
    latestScreenshotPath,
    latestScreenshotCreatedAt
  };
}

function normalizeSessionHistoryEvents(record: Record<string, unknown>): SessionHistoryEventEvidence | undefined {
  const eventsValue = record.events;
  const eventArray = Array.isArray(eventsValue) ? eventsValue.filter(isTraceEvent) : undefined;
  const eventsRecord = objectOrUndefined<Record<string, unknown>>(eventsValue);
  const latestAction = normalizeSessionHistoryLatestAction(eventsRecord?.latestAction ?? record.latestAction);
  const latestError = objectOrUndefined<AtlasLoopError>(eventsRecord?.latestError ?? record.latestError);
  const total = firstNonNegativeInteger(eventsRecord?.total, record.eventCount, record.eventsCount, eventArray?.length);

  if (total === undefined && !latestAction && !latestError) return undefined;

  return {
    total,
    latestAction,
    latestError
  };
}

function normalizeSessionHistoryLatestAction(value: unknown): SessionHistoryActionEvidence | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const artifacts = normalizeArtifactList(record.artifacts);
  const actionId = firstString(record.actionId, record.id);
  const ok = booleanOrUndefined(record.ok);
  const artifactCount = firstNonNegativeInteger(record.artifactCount, artifacts.length > 0 ? artifacts.length : undefined);
  const error = objectOrUndefined<AtlasLoopError>(record.error);

  if (!actionId && ok === undefined && !record.startedAt && !record.endedAt && artifactCount === undefined && !error) return undefined;

  return {
    actionId,
    ok,
    startedAt: firstString(record.startedAt),
    endedAt: firstString(record.endedAt),
    artifactCount,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
    error
  };
}

function isArtifactRef(value: unknown): value is ArtifactRef {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ArtifactRef>;
  return typeof record.id === "string" && typeof record.type === "string" && typeof record.path === "string";
}

function isTraceEvent(value: unknown): value is TraceEvent {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { type?: unknown }).type === "string";
}
