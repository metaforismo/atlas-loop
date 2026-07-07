import { normalizeDaemonUrl } from "../viewerParams.js";

export interface AtlasScreenLike {
  id: string;
  screenId?: string;
  screenshotCount: number;
  sessionIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  hashes: string[];
  variants: Array<{ sessionId: string; artifactId: string; createdAt: string }>;
}

export interface AtlasTransitionLike {
  id: string;
  from: string;
  to: string;
  actionSignature: string;
  count: number;
  sessionIds: string[];
  examples?: Array<{ sessionId: string; actionId: string; at: string }>;
}

/** Deep-link target passed alongside a session id when jumping into the sessions view. */
export interface SessionDeepLinkTarget {
  actionId?: string;
  artifactId?: string;
}

export type OpenSessionHandler = (sessionId: string, target?: SessionDeepLinkTarget) => void;

export interface AtlasMapLike {
  generatedAt: string;
  hashThreshold: number;
  sessions: Array<{ sessionId: string; observationCount: number; bundleId?: string }>;
  screens: AtlasScreenLike[];
  transitions: AtlasTransitionLike[];
}

export interface AtlasMapViewLike {
  source: string;
  map: AtlasMapLike;
  warnings: Array<{ sessionId?: string; path?: string; message: string }>;
}

export async function fetchAtlasMap(daemonUrl: string, options: { rebuild?: boolean; signal?: AbortSignal } = {}): Promise<AtlasMapViewLike> {
  const base = normalizeDaemonUrl(daemonUrl);
  const response = options.rebuild
    ? await fetch(`${base}/v1/atlas/map/rebuild`, { method: "POST", signal: options.signal })
    : await fetch(`${base}/v1/atlas/map`, { signal: options.signal });
  const envelope = (await response.json()) as { ok?: boolean; data?: AtlasMapViewLike; error?: { message?: string } };
  if (!response.ok || envelope.ok !== true || !envelope.data?.map) {
    throw new Error(envelope.error?.message ?? `atlas map request failed with status ${response.status}`);
  }
  return normalizeAtlasView(envelope.data);
}

export function normalizeAtlasView(view: AtlasMapViewLike): AtlasMapViewLike {
  return {
    source: view.source ?? "unknown",
    warnings: Array.isArray(view.warnings) ? view.warnings : [],
    map: {
      generatedAt: view.map.generatedAt ?? "",
      hashThreshold: view.map.hashThreshold ?? 0,
      sessions: Array.isArray(view.map.sessions) ? view.map.sessions : [],
      screens: Array.isArray(view.map.screens) ? view.map.screens : [],
      transitions: Array.isArray(view.map.transitions) ? view.map.transitions : []
    }
  };
}

export function screenImageUrl(daemonUrl: string, screenId: string, variant?: number): string {
  const base = `${normalizeDaemonUrl(daemonUrl)}/v1/atlas/screens/${encodeURIComponent(screenId)}/image`;
  return variant === undefined ? base : `${base}?variant=${variant}`;
}

export function screenDisplayName(screen: AtlasScreenLike): string {
  return screen.screenId ?? `screen ${screen.id.replace(/^screen_/, "").slice(0, 8)}`;
}
