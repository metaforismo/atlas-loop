/**
 * Device logs, aligned to the step that was running when they were emitted.
 *
 * A wall of OS log lines beside a failed run is nearly useless; the same lines
 * scoped to "the step that failed" usually contain the answer. Alignment is
 * the point of this module, and it happens here — as pure functions over
 * timestamps — so the daemon, the CLI, the MCP server, and the viewer all
 * attribute a line to the same step.
 */

export type DeviceLogLevel = "default" | "info" | "debug" | "error" | "fault";

export interface DeviceLogEntry {
  schemaVersion: "atlas-loop.device-log.v1";
  /** ISO 8601. Normalised on capture; see `normaliseLogTimestamp`. */
  at: string;
  level: DeviceLogLevel;
  message: string;
  subsystem?: string;
  category?: string;
  process?: string;
  processId?: number;
}

/** One action's execution window, used to attribute entries to a step. */
export interface DeviceLogWindow {
  actionId: string;
  kind?: string;
  sequence?: number;
  startedAt: string;
  /** Absent while the action is still running, which leaves the window open. */
  endedAt?: string;
}

export interface DeviceLogAttribution {
  actionId: string;
  kind?: string;
  sequence?: number;
  entries: DeviceLogEntry[];
}

export interface DeviceLogAlignment {
  /** One bucket per window that captured at least one entry, in window order. */
  steps: DeviceLogAttribution[];
  /** Entries emitted outside every window — before the first action, or between them. */
  unattributed: DeviceLogEntry[];
}

const LEVELS: Record<string, DeviceLogLevel> = {
  default: "default",
  info: "info",
  debug: "debug",
  error: "error",
  fault: "fault"
};

/**
 * `log stream --style ndjson` emits `2026-07-25 12:06:54.348781+0200`, which is
 * not ISO 8601: a space instead of `T` and an offset with no colon. V8 happens
 * to parse it, but that is engine-specific and these timestamps travel to a
 * browser, so they are normalised once, here, at capture time.
 */
export function normaliseLogTimestamp(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;

  const isoish = raw.trim().replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = Date.parse(isoish);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

/**
 * Parses one line of `log stream --style ndjson`.
 *
 * The stream opens with a human-readable banner ("Filtering the log data
 * using ...") before any JSON, and can emit non-event records, so anything
 * that is not a usable log event returns undefined rather than throwing.
 */
export function parseDeviceLogLine(line: string): DeviceLogEntry | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;

  let value: Record<string, unknown>;
  try {
    value = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const at = normaliseLogTimestamp(value.timestamp);
  if (!at) return undefined;

  const message = typeof value.eventMessage === "string" ? value.eventMessage : "";
  if (message === "") return undefined;

  const processPath = typeof value.processImagePath === "string" ? value.processImagePath : undefined;

  return {
    schemaVersion: "atlas-loop.device-log.v1",
    at,
    level: LEVELS[String(value.messageType ?? "").toLowerCase()] ?? "default",
    message,
    subsystem: nonEmpty(value.subsystem),
    category: nonEmpty(value.category),
    process: processPath ? processPath.split("/").pop() : undefined,
    processId: typeof value.processID === "number" ? value.processID : undefined
  };
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function time(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Attributes each entry to the action running when it was emitted.
 *
 * When windows overlap — a nested or retried action — the entry goes to the
 * one that started most recently, so a line is attributed to the innermost
 * step rather than an enclosing one. Entries outside every window are
 * reported separately instead of being forced into the nearest step, because
 * "logged between steps" is a different claim from "logged during step 3".
 */
export function alignDeviceLogs(
  entries: readonly DeviceLogEntry[],
  windows: readonly DeviceLogWindow[]
): DeviceLogAlignment {
  const usable = windows
    .map((window) => ({ window, start: time(window.startedAt), end: time(window.endedAt) }))
    .filter((candidate): candidate is { window: DeviceLogWindow; start: number; end: number | undefined } =>
      candidate.start !== undefined
    );

  const buckets = new Map<string, DeviceLogEntry[]>();
  const unattributed: DeviceLogEntry[] = [];

  for (const entry of entries) {
    const at = time(entry.at);
    if (at === undefined) {
      unattributed.push(entry);
      continue;
    }

    let best: { window: DeviceLogWindow; start: number } | undefined;
    for (const candidate of usable) {
      if (at < candidate.start) continue;
      if (candidate.end !== undefined && at > candidate.end) continue;
      if (best && candidate.start <= best.start) continue;
      best = { window: candidate.window, start: candidate.start };
    }

    if (!best) {
      unattributed.push(entry);
      continue;
    }

    const bucket = buckets.get(best.window.actionId);
    if (bucket) bucket.push(entry);
    else buckets.set(best.window.actionId, [entry]);
  }

  const steps: DeviceLogAttribution[] = [];
  for (const window of windows) {
    const collected = buckets.get(window.actionId);
    if (!collected) continue;
    steps.push({ actionId: window.actionId, kind: window.kind, sequence: window.sequence, entries: collected });
  }

  return { steps, unattributed };
}

export interface DeviceLogSummary {
  total: number;
  byLevel: Record<DeviceLogLevel, number>;
  /** Entries at error or fault level, which are what a failure triage starts from. */
  problems: number;
  firstAt?: string;
  lastAt?: string;
}

export function summariseDeviceLogs(entries: readonly DeviceLogEntry[]): DeviceLogSummary {
  const byLevel: Record<DeviceLogLevel, number> = { default: 0, info: 0, debug: 0, error: 0, fault: 0 };
  let firstAt: string | undefined;
  let lastAt: string | undefined;

  for (const entry of entries) {
    byLevel[entry.level] += 1;
    const at = time(entry.at);
    if (at === undefined) continue;
    if (firstAt === undefined || at < time(firstAt)!) firstAt = entry.at;
    if (lastAt === undefined || at > time(lastAt)!) lastAt = entry.at;
  }

  return { total: entries.length, byLevel, problems: byLevel.error + byLevel.fault, firstAt, lastAt };
}

/** Case-insensitive match over the fields an operator actually searches. */
export function filterDeviceLogs(entries: readonly DeviceLogEntry[], query: string): DeviceLogEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return [...entries];

  return entries.filter((entry) =>
    [entry.message, entry.subsystem, entry.category, entry.process, entry.level]
      .filter((field): field is string => typeof field === "string")
      .some((field) => field.toLocaleLowerCase().includes(needle))
  );
}
