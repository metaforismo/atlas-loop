import type { ViewerParams } from "./types.js";

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:4317";
export const DEFAULT_SESSION_ID = "latest";

export function normalizeDaemonUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_DAEMON_URL;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_DAEMON_URL;
  }
}

export function normalizeSessionId(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DEFAULT_SESSION_ID;
}

export function normalizeViewerBaseUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function readViewerParams(search: string, viewerBaseUrl?: string): ViewerParams {
  const params = new URLSearchParams(search);
  const normalizedViewerBaseUrl = normalizeViewerBaseUrl(viewerBaseUrl);
  const result: ViewerParams = {
    daemonUrl: normalizeDaemonUrl(params.get("daemonUrl")),
    sessionId: normalizeSessionId(params.get("sessionId"))
  };
  if (normalizedViewerBaseUrl) result.viewerBaseUrl = normalizedViewerBaseUrl;
  return result;
}

export function writeViewerSearch(params: ViewerParams): string {
  const search = new URLSearchParams();
  search.set("daemonUrl", normalizeDaemonUrl(params.daemonUrl));
  search.set("sessionId", normalizeSessionId(params.sessionId));
  return `?${search.toString()}`;
}

export function buildSessionsUrl(daemonUrl: string): string {
  return `${normalizeDaemonUrl(daemonUrl)}/v1/sessions`;
}

export function buildSessionUrl(params: ViewerParams, suffix = ""): string {
  const session = encodeURIComponent(normalizeSessionId(params.sessionId));
  const cleanSuffix = suffix.startsWith("/") || suffix === "" ? suffix : `/${suffix}`;
  return `${normalizeDaemonUrl(params.daemonUrl)}/v1/sessions/${session}${cleanSuffix}`;
}
