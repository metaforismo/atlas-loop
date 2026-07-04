import type { ActionLike, ArtifactRef, TraceEvent } from "./types.js";

export type TimelineTone = "neutral" | "good" | "warn" | "bad" | "accent";

export interface TimelineItem {
  id: string;
  at: string;
  sourceType: "event" | "artifact";
  title: string;
  detail: string;
  tone: TimelineTone;
  sortKey: number;
}

export function mergeTraceEvents(existing: TraceEvent[], incoming: TraceEvent[]): TraceEvent[] {
  const seen = new Set<string>();
  const merged: TraceEvent[] = [];

  for (const event of [...existing, ...incoming]) {
    const key = eventKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
  }

  return sortEvents(merged);
}

export function buildTimelineItems(events: TraceEvent[], artifacts: ArtifactRef[]): TimelineItem[] {
  const items = new Map<string, TimelineItem>();

  for (const event of events) {
    for (const item of eventToItems(event)) {
      items.set(item.id, item);
    }
  }

  for (const artifact of artifacts) {
    const item = artifactToItem(artifact);
    if (!items.has(item.id)) items.set(item.id, item);
  }

  return [...items.values()].sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));
}

export function sortArtifacts(artifacts: ArtifactRef[]): ArtifactRef[] {
  return [...artifacts].sort((a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt) || a.id.localeCompare(b.id));
}

function eventToItems(event: TraceEvent): TimelineItem[] {
  const at = event.at ?? new Date(0).toISOString();

  switch (event.type) {
    case "session.created":
      if (!event.session) return [genericEventItem(event, at)];
      return [
        makeItem({
          id: `event:session.created:${event.session.id}`,
          at,
          title: "Session created",
          detail: event.session.simulator?.name ?? event.session.id,
          tone: "accent"
        })
      ];
    case "session.statusChanged":
      return [
        makeItem({
          id: `event:session.status:${event.sessionId ?? "session"}:${at}:${event.to ?? "unknown"}`,
          at,
          title: `Status ${event.to ?? "unknown"}`,
          detail: event.from ? `${event.from} -> ${event.to ?? "unknown"}` : event.to ?? "unknown",
          tone: event.to === "failed" ? "bad" : event.to === "running" ? "good" : "neutral"
        })
      ];
    case "action.started":
      if (!event.action) return [genericEventItem(event, at)];
      return [
        makeItem({
          id: `event:action.started:${event.action.id}`,
          at: event.action.createdAt ?? at,
          title: actionTitle(event.action),
          detail: actionDetail(event.action),
          tone: "accent"
        })
      ];
    case "action.completed":
      if (!event.result) return [genericEventItem(event, at)];
      return [
        makeItem({
          id: `event:action.completed:${event.result.actionId}`,
          at: event.result.endedAt ?? at,
          title: event.result.ok ? "Action completed" : "Action failed",
          detail: event.result.error?.message ?? `${event.result.artifacts?.length ?? 0} artifact(s)`,
          tone: event.result.ok ? "good" : "bad"
        }),
        ...(event.result.artifacts ?? []).map((artifact) => artifactToItem(artifact))
      ];
    case "artifact.created":
      if (!event.artifact) return [genericEventItem(event, at)];
      return [artifactToItem(event.artifact, at)];
    case "error":
      if (!event.error) return [genericEventItem(event, at)];
      return [
        makeItem({
          id: `event:error:${event.sessionId ?? "global"}:${at}:${event.error.message}`,
          at,
          title: event.error.code ?? "Error",
          detail: event.error.message,
          tone: "bad"
        })
      ];
    default:
      return [
        makeItem({
          id: `event:${event.type}:${at}`,
          at,
          title: event.type,
          detail: "Trace event",
          tone: "neutral"
        })
      ];
  }
}

function genericEventItem(event: TraceEvent, at: string): TimelineItem {
  return makeItem({
    id: `event:${event.type}:${at}`,
    at,
    title: event.type,
    detail: "Trace event",
    tone: "neutral"
  });
}

function artifactToItem(artifact: ArtifactRef, fallbackAt?: string): TimelineItem {
  return makeItem({
    id: `artifact:${artifact.id}`,
    at: artifact.createdAt ?? fallbackAt ?? new Date(0).toISOString(),
    sourceType: "artifact",
    title: `${artifact.type} artifact`,
    detail: artifact.path,
    tone: artifact.type === "screenshot" ? "good" : "neutral"
  });
}

function makeItem(input: Omit<TimelineItem, "sourceType" | "sortKey"> & { sourceType?: "event" | "artifact" }): TimelineItem {
  return {
    sourceType: "event",
    sortKey: toTimestamp(input.at),
    ...input
  };
}

function sortEvents(events: TraceEvent[]): TraceEvent[] {
  return [...events].sort((a, b) => toTimestamp(a.at) - toTimestamp(b.at) || eventKey(a).localeCompare(eventKey(b)));
}

function eventKey(event: TraceEvent): string {
  switch (event.type) {
    case "session.created":
      return `session.created:${event.session?.id ?? ""}`;
    case "session.statusChanged":
      return `session.status:${event.sessionId ?? ""}:${event.at ?? ""}:${event.to}`;
    case "action.started":
      return `action.started:${event.action?.id ?? ""}`;
    case "action.completed":
      return `action.completed:${event.result?.actionId ?? ""}:${event.result?.endedAt ?? event.at ?? ""}`;
    case "artifact.created":
      return `artifact.created:${event.artifact?.id ?? ""}`;
    case "error":
      return `error:${event.sessionId ?? ""}:${event.at ?? ""}:${event.error?.message ?? ""}`;
    default:
      return `${event.type}:${event.at ?? ""}:${JSON.stringify(event)}`;
  }
}

function actionTitle(action: ActionLike): string {
  switch (action.kind) {
    case "tap":
      return "Tap";
    case "typeText":
      return "Type text";
    case "swipe":
      return "Swipe";
    case "edgeGesture":
      return "Edge gesture";
    case "screenshot":
      return "Screenshot";
    case "install":
      return "Install";
    case "launch":
      return "Launch";
    case "wait":
      return "Wait";
    default:
      return action.kind;
  }
}

function actionDetail(action: ActionLike): string {
  switch (action.kind) {
    case "tap":
      return formatPoint(action.x, action.y);
    case "typeText":
      return typeof action.text === "string" ? JSON.stringify(action.text) : "Text input";
    case "swipe":
      return `${formatPointValue(action.from)} -> ${formatPointValue(action.to)}`;
    case "edgeGesture":
      return `${String(action.edge)} edge`;
    case "screenshot":
      return typeof action.reason === "string" ? action.reason : "Capture requested";
    case "install":
      return typeof action.appPath === "string" ? action.appPath : "App bundle";
    case "launch":
      return typeof action.bundleId === "string" ? action.bundleId : "Bundle launch";
    case "wait":
      return typeof action.durationMs === "number" ? `${action.durationMs}ms` : "Delay";
    default:
      return action.sequence === undefined ? "Action" : `#${action.sequence}`;
  }
}

function formatPoint(x: unknown, y: unknown): string {
  if (typeof x !== "number" || typeof y !== "number") return "Point";
  return `${x.toFixed(3)}, ${y.toFixed(3)}`;
}

function formatPointValue(value: unknown): string {
  if (!value || typeof value !== "object") return "Point";
  const record = value as { x?: unknown; y?: unknown };
  return formatPoint(record.x, record.y);
}

function toTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
