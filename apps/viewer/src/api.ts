import type {
  ActionResultLike,
  ApiEnvelope,
  ArtifactRef,
  ScreenshotState,
  Session,
  SessionListItem,
  SessionSummary,
  TraceEvent,
  ViewerActionDraft,
  ViewerActionRequest,
  ViewerNumericInput,
  ViewerParams
} from "./types.js";
import { buildSessionsUrl, buildSessionUrl, normalizeDaemonUrl } from "./viewerParams.js";

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

export async function fetchSessions(daemonUrl: string, signal?: AbortSignal): Promise<SessionListItem[]> {
  const value = await fetchJson<unknown>(buildSessionsUrl(daemonUrl), signal);
  return normalizeSessionList(value);
}

export async function fetchArtifacts(params: ViewerParams, signal?: AbortSignal): Promise<ArtifactRef[]> {
  const value = await fetchJson<unknown>(buildSessionUrl(params, "artifacts"), signal);
  return normalizeArtifactList(value);
}

export async function fetchEvents(params: ViewerParams, signal?: AbortSignal): Promise<TraceEvent[]> {
  const value = await fetchJson<unknown>(buildSessionUrl(params, "events"), signal);
  return normalizeEventList(value);
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

export function normalizeSessionList(value: unknown): SessionListItem[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { sessions?: unknown[] }).sessions)
      ? (value as { sessions: unknown[] }).sessions
      : value && typeof value === "object" && Array.isArray((value as { items?: unknown[] }).items)
        ? (value as { items: unknown[] }).items
        : [];

  return list.map(normalizeSessionListItem).filter((session): session is SessionListItem => Boolean(session));
}

export function normalizeEventList(value: unknown): TraceEvent[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { events?: unknown[] }).events)
      ? (value as { events: unknown[] }).events
      : [];

  return list.filter(isTraceEvent);
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

function normalizeSessionListItem(value: unknown): SessionListItem | undefined {
  if (typeof value === "string" && value.trim()) return { id: value.trim() };
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  const id = firstString(record.id, record.sessionId);
  if (!id) return undefined;

  return {
    id,
    status: firstString(record.status, record.state),
    createdAt: firstString(record.createdAt, record.startedAt),
    updatedAt: firstString(record.updatedAt, record.lastUpdatedAt, record.lastActivityAt, record.lastEventAt),
    simulator: objectOrUndefined(record.simulator),
    app: objectOrUndefined(record.app),
    artifactDir: firstString(record.artifactDir, record.artifactsDir),
    viewerUrl: firstString(record.viewerUrl),
    backend: firstString(record.backend),
    platform: firstString(record.platform),
    error: objectOrUndefined(record.error)
  };
}

function objectOrUndefined<T extends object>(value: unknown): T | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as T) : undefined;
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
