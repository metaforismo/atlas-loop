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

export function normalizeViewerView(value: string | null | undefined): "session" | "atlas" {
  return value === "atlas" ? "atlas" : "session";
}

export function normalizeViewerWorkspace(value: string | null | undefined): "overview" | "sessions" | "apps" | "workflows" | "evidence" {
  if (value === "overview" || value === "sessions" || value === "apps" || value === "workflows") return value;
  return "evidence";
}

export function readViewerParams(search: string, viewerBaseUrl?: string): ViewerParams {
  const params = new URLSearchParams(search);
  const normalizedViewerBaseUrl = normalizeViewerBaseUrl(viewerBaseUrl);
  const result: ViewerParams = {
    daemonUrl: normalizeDaemonUrl(params.get("daemonUrl")),
    sessionId: normalizeSessionId(params.get("sessionId"))
  };
  const view = normalizeViewerView(params.get("view"));
  if (view === "atlas") result.view = view;
  const workspace = normalizeViewerWorkspace(params.get("workspace"));
  if (workspace !== "evidence") result.workspace = workspace;
  if (normalizedViewerBaseUrl) result.viewerBaseUrl = normalizedViewerBaseUrl;
  const actionId = params.get("actionId")?.trim();
  if (actionId) result.actionId = actionId;
  const artifactId = params.get("artifactId")?.trim();
  if (artifactId) result.artifactId = artifactId;
  return result;
}

export function writeViewerSearch(params: ViewerParams): string {
  const search = new URLSearchParams();
  search.set("daemonUrl", normalizeDaemonUrl(params.daemonUrl));
  search.set("sessionId", normalizeSessionId(params.sessionId));
  if (normalizeViewerView(params.view) === "atlas") search.set("view", "atlas");
  const workspace = normalizeViewerWorkspace(params.workspace);
  if (workspace !== "evidence") search.set("workspace", workspace);
  const actionId = params.actionId?.trim();
  if (actionId) search.set("actionId", actionId);
  const artifactId = params.artifactId?.trim();
  if (artifactId) search.set("artifactId", artifactId);
  return `?${search.toString()}`;
}

export function buildSessionsUrl(daemonUrl: string): string {
  return `${normalizeDaemonUrl(daemonUrl)}/v1/sessions`;
}

export function buildSessionHistoryUrl(daemonUrl: string, limit?: number): string {
  const url = new URL(`${normalizeDaemonUrl(daemonUrl)}/v1/sessions/history`);
  if (limit !== undefined) url.searchParams.set("limit", String(Math.max(0, Math.trunc(limit))));
  return url.toString();
}

export function buildSessionUrl(params: ViewerParams, suffix = ""): string {
  const session = encodeURIComponent(normalizeSessionId(params.sessionId));
  const cleanSuffix = suffix.startsWith("/") || suffix === "" ? suffix : `/${suffix}`;
  return `${normalizeDaemonUrl(params.daemonUrl)}/v1/sessions/${session}${cleanSuffix}`;
}
