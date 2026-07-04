import type { ApiEnvelope, ArtifactRef, ScreenshotState, Session, TraceEvent, ViewerParams } from "./types.js";
import { buildSessionUrl, normalizeDaemonUrl } from "./viewerParams.js";

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

export async function fetchArtifacts(params: ViewerParams, signal?: AbortSignal): Promise<ArtifactRef[]> {
  const value = await fetchJson<unknown>(buildSessionUrl(params, "artifacts"), signal);
  return normalizeArtifactList(value);
}

export async function fetchEvents(params: ViewerParams, signal?: AbortSignal): Promise<TraceEvent[]> {
  const value = await fetchJson<unknown>(buildSessionUrl(params, "events"), signal);
  return normalizeEventList(value);
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

export function normalizeArtifactList(value: unknown): ArtifactRef[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { artifacts?: unknown[] }).artifacts)
      ? (value as { artifacts: unknown[] }).artifacts
      : [];

  return list.filter(isArtifactRef);
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

function isArtifactRef(value: unknown): value is ArtifactRef {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ArtifactRef>;
  return typeof record.id === "string" && typeof record.type === "string" && typeof record.path === "string";
}

function isTraceEvent(value: unknown): value is TraceEvent {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { type?: unknown }).type === "string";
}
