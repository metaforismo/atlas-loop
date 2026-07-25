/**
 * What the app asked the network for.
 *
 * A screenshot shows a spinner; it does not show which endpoint the app called,
 * what came back, or how long it blocked. Atlas Loop runs a local intercepting
 * proxy and records each exchange against the step that was running.
 *
 * Everything here is pure and browser-safe: the daemon records exchanges, and
 * the viewer, the CLI, and the MCP server all read them through this module.
 */

export const NETWORK_CAPTURE_SCHEMA = "atlas-loop.network-capture.v1";

export interface NetworkExchange {
  id: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  method: string;
  scheme: "http" | "https";
  host: string;
  port: number;
  /** Path and query, as the app requested it. */
  path: string;
  status?: number;
  requestBytes: number;
  responseBytes: number;
  mediaType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  /** Header names whose values were dropped before anything touched disk. */
  redactedHeaders?: string[];
  /** Why the exchange never produced a response. */
  error?: string;
  /** The step that was running when the request started. */
  actionId?: string;
  /**
   * True when only the TLS tunnel was observed. The host and the byte counts
   * are real; the method, path, and status are not known.
   */
  tunnelled?: boolean;
}

/**
 * Headers whose values are credentials.
 *
 * Captures are written to disk as run evidence and get attached to bug reports,
 * so these never leave the proxy. The header *name* is kept: knowing that a
 * request carried an Authorization header is often the answer, and it costs
 * nothing to say so without the token.
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-session-token"
]);

export interface RedactedHeaders {
  headers: Record<string, string>;
  /** Names that were present and had their values removed. */
  redacted: string[];
}

export function redactHeaders(headers: Record<string, string | string[] | undefined>): RedactedHeaders {
  const kept: Record<string, string> = {};
  const redacted: string[] = [];

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const flat = Array.isArray(value) ? value.join(", ") : value;
    if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
      kept[name] = "<redacted>";
      redacted.push(name);
      continue;
    }
    kept[name] = flat;
  }

  return { headers: kept, redacted };
}

/** Whether a header name would have its value dropped. */
export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.trim().toLowerCase());
}

export type NetworkTone = "good" | "warn" | "bad" | "neutral";

/**
 * How an exchange reads at a glance. A request that never got a response is
 * worse than one that got a 500: the app does not even know what happened.
 */
export function networkTone(exchange: NetworkExchange): NetworkTone {
  if (exchange.error) return "bad";
  if (exchange.status === undefined) return "neutral";
  if (exchange.status >= 500) return "bad";
  if (exchange.status >= 400) return "warn";
  if (exchange.status >= 200 && exchange.status < 400) return "good";
  return "neutral";
}

/** `api.example.com/v1/orders` — the part an operator scans for. */
export function exchangeLabel(exchange: NetworkExchange): string {
  return exchange.tunnelled ? `${exchange.host}:${exchange.port}` : `${exchange.host}${exchange.path}`;
}

export interface NetworkSummary {
  total: number;
  failed: number;
  /** 4xx and 5xx responses; a reached server that refused. */
  errors: number;
  tunnelled: number;
  requestBytes: number;
  responseBytes: number;
  /** Longest exchange that completed, in milliseconds. */
  slowestMs?: number;
  slowest?: NetworkExchange;
  hosts: string[];
  firstAt?: string;
  lastAt?: string;
}

export function summariseNetworkExchanges(exchanges: readonly NetworkExchange[]): NetworkSummary {
  const hosts = new Set<string>();
  let failed = 0;
  let errors = 0;
  let tunnelled = 0;
  let requestBytes = 0;
  let responseBytes = 0;
  let slowest: NetworkExchange | undefined;
  let firstAt: string | undefined;
  let lastAt: string | undefined;

  for (const exchange of exchanges) {
    hosts.add(exchange.host);
    if (exchange.error) failed += 1;
    if (exchange.status !== undefined && exchange.status >= 400) errors += 1;
    if (exchange.tunnelled) tunnelled += 1;
    requestBytes += exchange.requestBytes;
    responseBytes += exchange.responseBytes;
    if (exchange.durationMs !== undefined && (slowest?.durationMs ?? -1) < exchange.durationMs) slowest = exchange;

    const at = Date.parse(exchange.startedAt);
    if (!Number.isFinite(at)) continue;
    if (firstAt === undefined || at < Date.parse(firstAt)) firstAt = exchange.startedAt;
    if (lastAt === undefined || at > Date.parse(lastAt)) lastAt = exchange.startedAt;
  }

  return {
    total: exchanges.length,
    failed,
    errors,
    tunnelled,
    requestBytes,
    responseBytes,
    slowestMs: slowest?.durationMs,
    slowest,
    hosts: [...hosts].sort(),
    firstAt,
    lastAt
  };
}

export type NetworkFilterKind = "all" | "problems" | "tunnelled";

/** Narrows a capture to what an operator asked to see. */
export function filterNetworkExchanges(
  exchanges: readonly NetworkExchange[],
  filter: { search?: string; kind?: NetworkFilterKind; host?: string; method?: string } = {}
): NetworkExchange[] {
  const search = filter.search?.trim().toLowerCase();
  const host = filter.host?.trim().toLowerCase();
  const method = filter.method?.trim().toUpperCase();

  return exchanges.filter((exchange) => {
    if (host && exchange.host.toLowerCase() !== host) return false;
    if (method && exchange.method.toUpperCase() !== method) return false;
    if (filter.kind === "problems" && !exchange.error && (exchange.status ?? 0) < 400) return false;
    if (filter.kind === "tunnelled" && !exchange.tunnelled) return false;
    if (search) {
      const haystack = `${exchange.method} ${exchange.host} ${exchange.path} ${exchange.status ?? ""} ${exchange.error ?? ""}`;
      if (!haystack.toLowerCase().includes(search)) return false;
    }
    return true;
  });
}

export interface NetworkWindow {
  actionId: string;
  startedAt: string;
  endedAt?: string;
}

export interface NetworkAlignment {
  steps: Array<{ actionId: string; exchanges: NetworkExchange[] }>;
  /** Exchanges that started outside every step's window. */
  unattributed: NetworkExchange[];
}

function time(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Attributes each exchange to the step that was running when it started.
 *
 * Start time, not end time: a request that outlives its step still belongs to
 * the step that issued it, and attributing by completion would credit a slow
 * call to whatever happened to be running when it finally came back.
 */
export function alignNetworkExchanges(
  exchanges: readonly NetworkExchange[],
  windows: readonly NetworkWindow[]
): NetworkAlignment {
  const usable = windows
    .map((window) => ({ window, start: time(window.startedAt), end: time(window.endedAt) }))
    .filter((candidate): candidate is { window: NetworkWindow; start: number; end: number | undefined } =>
      candidate.start !== undefined
    );

  const buckets = new Map<string, NetworkExchange[]>();
  const unattributed: NetworkExchange[] = [];

  for (const exchange of exchanges) {
    const at = time(exchange.startedAt);
    if (at === undefined) {
      unattributed.push(exchange);
      continue;
    }

    // The innermost matching window wins, so a nested step keeps its own calls.
    let best: { window: NetworkWindow; start: number } | undefined;
    for (const candidate of usable) {
      if (at < candidate.start) continue;
      if (candidate.end !== undefined && at > candidate.end) continue;
      if (best && candidate.start <= best.start) continue;
      best = { window: candidate.window, start: candidate.start };
    }

    if (!best) {
      unattributed.push(exchange);
      continue;
    }

    const bucket = buckets.get(best.window.actionId);
    if (bucket) bucket.push(exchange);
    else buckets.set(best.window.actionId, [exchange]);
  }

  return {
    steps: [...buckets].map(([actionId, list]) => ({ actionId, exchanges: list })),
    unattributed
  };
}

/** `842ms` / `2.4s` — request timings live on both sides of a second. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
