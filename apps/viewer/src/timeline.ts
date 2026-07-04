import type { ActionLike, ActionResultLike, ArtifactRef, TraceEvent } from "./types.js";

export type TimelineTone = "neutral" | "good" | "warn" | "bad" | "accent";

export interface TimelineItem {
  id: string;
  at: string;
  sourceType: "event" | "artifact";
  title: string;
  detail: string;
  tone: TimelineTone;
  sortKey: number;
  actionId?: string | undefined;
  artifactId?: string | undefined;
  artifactType?: ArtifactRef["type"] | undefined;
  artifactPath?: string | undefined;
  relatedArtifactIds?: string[] | undefined;
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
      upsertTimelineItem(items, item);
    }
  }

  for (const artifact of artifacts) {
    const item = artifactToItem(artifact);
    upsertTimelineItem(items, item);
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
          tone: "accent",
          actionId: event.action.id
        })
      ];
    case "action.completed":
      if (!event.result) return [genericEventItem(event, at)];
      return [
        makeItem({
          id: `event:action.completed:${event.result.actionId}`,
          at: event.result.endedAt ?? at,
          title: event.result.ok ? "Action completed" : "Action failed",
          detail: actionCompletionDetail(event.result),
          tone: event.result.ok ? "good" : "bad",
          actionId: event.result.actionId,
          relatedArtifactIds: relatedArtifactIds(event.result.artifacts)
        }),
        ...(event.result.artifacts ?? []).map((artifact) => artifactToItem(artifact, undefined, event.result?.actionId))
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

function artifactToItem(artifact: ArtifactRef, fallbackAt?: string, fallbackActionId?: string): TimelineItem {
  const actionId = artifactActionId(artifact) ?? fallbackActionId;

  return makeItem({
    id: `artifact:${artifact.id}`,
    at: artifact.createdAt ?? fallbackAt ?? new Date(0).toISOString(),
    sourceType: "artifact",
    title: `${artifact.type} artifact`,
    detail: artifactDetail(artifact.path, actionId),
    tone: artifact.type === "screenshot" ? "good" : "neutral",
    actionId,
    artifactId: artifact.id,
    artifactType: artifact.type,
    artifactPath: artifact.path,
    relatedArtifactIds: undefined
  });
}

function makeItem(input: Omit<TimelineItem, "sourceType" | "sortKey"> & { sourceType?: "event" | "artifact" }): TimelineItem {
  return {
    sourceType: "event",
    sortKey: toTimestamp(input.at),
    ...input
  };
}

function upsertTimelineItem(items: Map<string, TimelineItem>, item: TimelineItem): void {
  const existing = items.get(item.id);
  items.set(item.id, existing ? mergeTimelineItems(existing, item) : item);
}

function mergeTimelineItems(first: TimelineItem, second: TimelineItem): TimelineItem {
  const display = richerTimelineItem(first, second);
  const actionId = first.actionId ?? second.actionId;
  const artifactPath = first.artifactPath ?? second.artifactPath;
  const relatedArtifactIds = mergeIds(first.relatedArtifactIds, second.relatedArtifactIds);
  const merged: TimelineItem = {
    ...display,
    sortKey: mergedSortKey(first.sortKey, second.sortKey),
    actionId,
    artifactId: first.artifactId ?? second.artifactId,
    artifactType: first.artifactType ?? second.artifactType,
    artifactPath,
    relatedArtifactIds
  };

  if (merged.sourceType === "artifact" && artifactPath) {
    merged.detail = artifactDetail(artifactPath, actionId);
  }

  return merged;
}

function richerTimelineItem(first: TimelineItem, second: TimelineItem): TimelineItem {
  const firstScore = timelineItemRichness(first);
  const secondScore = timelineItemRichness(second);
  if (firstScore !== secondScore) return firstScore > secondScore ? first : second;

  const firstDisplayKey = `${first.title}\u0000${first.detail}`;
  const secondDisplayKey = `${second.title}\u0000${second.detail}`;
  if (firstDisplayKey !== secondDisplayKey) return firstDisplayKey.localeCompare(secondDisplayKey) <= 0 ? first : second;

  return first.sortKey <= second.sortKey ? first : second;
}

function timelineItemRichness(item: TimelineItem): number {
  return [
    item.actionId,
    item.artifactId,
    item.artifactType,
    item.artifactPath,
    ...(item.relatedArtifactIds ?? [])
  ].filter(Boolean).length;
}

function mergedSortKey(first: number, second: number): number {
  if (first === 0) return second;
  if (second === 0) return first;
  return Math.min(first, second);
}

function mergeIds(first: string[] | undefined, second: string[] | undefined): string[] | undefined {
  const ids = new Set([...(first ?? []), ...(second ?? [])].filter((id): id is string => typeof id === "string" && id.length > 0));
  return ids.size === 0 ? undefined : [...ids].sort();
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

function actionCompletionDetail(result: ActionResultLike): string {
  const status = result.ok ? "Passed" : "Failed";
  const duration = formatDuration(result.startedAt, result.endedAt);
  const statusDetail = duration ? `${status} in ${duration}` : status;
  const artifactSummary = formatArtifactSummary(result.artifacts);
  const base = result.error?.message ? `${statusDetail}: ${result.error.message}` : statusDetail;
  return `${base} · ${artifactSummary}`;
}

function formatArtifactSummary(artifacts: ArtifactRef[] | undefined): string {
  if (!artifacts || artifacts.length === 0) return "no artifacts";

  const counts = new Map<string, number>();
  for (const artifact of artifacts) {
    counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
  }

  const parts = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => count === 1 ? type : `${type} x${count}`);
  const noun = artifacts.length === 1 ? "artifact" : "artifacts";
  return `${artifacts.length} ${noun}: ${parts.join(", ")}`;
}

function formatDuration(startedAt: string | undefined, endedAt: string | undefined): string | undefined {
  const started = toTimestamp(startedAt);
  const ended = toTimestamp(endedAt);
  if (started === 0 || ended === 0 || ended < started) return undefined;

  const durationMs = ended - started;
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs % 1000 === 0) return `${durationMs / 1000}s`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function relatedArtifactIds(artifacts: ArtifactRef[] | undefined): string[] | undefined {
  const ids = new Set((artifacts ?? []).map((artifact) => artifact.id).filter((id) => id.length > 0));
  return ids.size === 0 ? undefined : [...ids].sort();
}

function artifactActionId(artifact: ArtifactRef): string | undefined {
  const actionId = artifact.metadata?.actionId;
  return typeof actionId === "string" && actionId.length > 0 ? actionId : undefined;
}

function artifactDetail(path: string, actionId: string | undefined): string {
  return actionId ? `${path} · action ${actionId}` : path;
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
