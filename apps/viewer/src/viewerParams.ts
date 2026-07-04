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

export function readViewerParams(search: string): ViewerParams {
  const params = new URLSearchParams(search);
  return {
    daemonUrl: normalizeDaemonUrl(params.get("daemonUrl")),
    sessionId: normalizeSessionId(params.get("sessionId"))
  };
}

export function writeViewerSearch(params: ViewerParams): string {
  const search = new URLSearchParams();
  search.set("daemonUrl", normalizeDaemonUrl(params.daemonUrl));
  search.set("sessionId", normalizeSessionId(params.sessionId));
  return `?${search.toString()}`;
}

export function buildSessionUrl(params: ViewerParams, suffix = ""): string {
  const session = encodeURIComponent(normalizeSessionId(params.sessionId));
  const cleanSuffix = suffix.startsWith("/") || suffix === "" ? suffix : `/${suffix}`;
  return `${normalizeDaemonUrl(params.daemonUrl)}/v1/sessions/${session}${cleanSuffix}`;
}
