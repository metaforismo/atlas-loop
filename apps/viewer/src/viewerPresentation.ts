import type { TimelineItem } from "./timeline.js";
import type { ArtifactRef, HealthState, SessionListItem, SessionStatus } from "./types.js";

export type UiTone = "neutral" | "good" | "warn" | "bad";
export type TimelineFilter = "all" | "actions" | "artifacts" | "sessions" | "errors";

export interface ArtifactSummary {
  type: string;
  count: number;
}

export interface ArtifactFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface ArtifactFilterState {
  type: string;
  query: string;
}

export interface ArtifactDetailRow {
  label: string;
  value: string;
  mono?: boolean;
}

export interface TimelineFilterOption {
  value: TimelineFilter;
  label: string;
  count: number;
}

export interface TimelineFilterState {
  filter: TimelineFilter;
  query: string;
}

export interface LatestSessionEmptyState {
  title: string;
  detail: string;
}

export function formatTime(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function healthTone(health: HealthState): UiTone {
  if (health === "online") return "good";
  if (health === "offline") return "bad";
  return "warn";
}

export function sessionTone(status: SessionStatus | undefined): UiTone {
  switch (status) {
    case "running":
    case "booted":
    case "installed":
      return "good";
    case "failed":
      return "bad";
    case "building":
    case "booting":
    case "installing":
    case "launching":
      return "warn";
    default:
      return "neutral";
  }
}

export function sessionSignal(session: SessionListItem | undefined): string {
  if (!session) return "No simulator or app metadata";

  const simulator = session.simulator?.name ?? session.simulator?.udid;
  const app = session.app?.bundleId ?? session.app?.scheme ?? session.app?.appPath;

  if (simulator && app) return `${simulator} / ${app}`;
  if (simulator) return simulator;
  if (app) return app;
  return "No simulator or app metadata";
}

export function sessionUpdatedAt(session: SessionListItem | undefined): string | undefined {
  return session?.updatedAt ?? session?.createdAt;
}

export function sortSessionList(sessions: SessionListItem[]): SessionListItem[] {
  return [...sessions].sort((a, b) => {
    const byTime = sessionSortTime(b) - sessionSortTime(a);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

export function eventModeTone(mode: "connecting" | "sse" | "polling"): UiTone {
  if (mode === "sse") return "good";
  if (mode === "polling") return "warn";
  return "neutral";
}

export function summarizeArtifacts(artifacts: ArtifactRef[]): ArtifactSummary[] {
  const counts = new Map<string, number>();
  for (const artifact of artifacts) counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);

  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function latestArtifactOfType(artifacts: ArtifactRef[], type: string): ArtifactRef | undefined {
  return artifacts.find((artifact) => artifact.type === type);
}

export function artifactTypeOptions(artifacts: ArtifactRef[]): ArtifactFilterOption[] {
  return [
    { value: "all", label: "All", count: artifacts.length },
    ...summarizeArtifacts(artifacts).map((summary) => ({
      value: summary.type,
      label: summary.type,
      count: summary.count
    }))
  ];
}

export function filterArtifacts(artifacts: ArtifactRef[], filters: ArtifactFilterState): ArtifactRef[] {
  const query = normalizeSearch(filters.query);
  const type = filters.type || "all";

  return artifacts.filter((artifact) => {
    if (type !== "all" && artifact.type !== type) return false;
    if (!query) return true;
    return artifactSearchText(artifact).includes(query);
  });
}

export function artifactDisplayName(artifact: ArtifactRef): string {
  const cleanPath = artifact.path.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSegment = cleanPath.split("/").filter(Boolean).at(-1);
  return lastSegment ?? artifact.id;
}

export function artifactDetailRows(artifact: ArtifactRef): ArtifactDetailRow[] {
  const rows: ArtifactDetailRow[] = [
    { label: "ID", value: artifact.id, mono: true },
    { label: "Type", value: artifact.type },
    { label: "Created", value: formatDateTime(artifact.createdAt) },
    { label: "Path", value: artifact.path, mono: true }
  ];

  if (artifact.sessionId) rows.splice(1, 0, { label: "Session", value: artifact.sessionId, mono: true });
  if (artifact.sha256) rows.push({ label: "SHA-256", value: shortenHash(artifact.sha256), mono: true });

  const metadataKeys = artifact.metadata ? Object.keys(artifact.metadata).sort() : [];
  if (metadataKeys.length > 0) {
    rows.push({
      label: "Metadata",
      value: metadataKeys.slice(0, 5).join(", ") + (metadataKeys.length > 5 ? ` +${metadataKeys.length - 5}` : "")
    });
  }

  return rows;
}

export function latestSessionEmptyState(health: HealthState): LatestSessionEmptyState {
  if (health === "offline") {
    return {
      title: "Daemon offline",
      detail: "Start the daemon or paste a reachable daemon URL. The latest session will attach once health is online."
    };
  }

  if (health === "checking") {
    return {
      title: "Checking latest session",
      detail: "The viewer is checking daemon health. Keep latest selected to attach to the newest local run automatically."
    };
  }

  return {
    title: "Following latest session",
    detail: "Start an atlas-loop run. The newest session, screenshots, actions, and artifacts will populate this viewer."
  };
}

export function timelineFilterOptions(items: TimelineItem[]): TimelineFilterOption[] {
  return [
    { value: "all", label: "All", count: items.length },
    { value: "actions", label: "Actions", count: items.filter((item) => timelineMatchesFilter(item, "actions")).length },
    { value: "artifacts", label: "Artifacts", count: items.filter((item) => timelineMatchesFilter(item, "artifacts")).length },
    { value: "sessions", label: "Sessions", count: items.filter((item) => timelineMatchesFilter(item, "sessions")).length },
    { value: "errors", label: "Errors", count: items.filter((item) => timelineMatchesFilter(item, "errors")).length }
  ];
}

export function filterTimelineItems(items: TimelineItem[], filters: TimelineFilterState): TimelineItem[] {
  const query = normalizeSearch(filters.query);

  return items.filter((item) => {
    if (!timelineMatchesFilter(item, filters.filter)) return false;
    if (!query) return true;
    return [item.id, item.sourceType, item.title, item.detail, item.at].join(" ").toLowerCase().includes(query);
  });
}

function timelineMatchesFilter(item: TimelineItem, filter: TimelineFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "actions":
      return item.id.startsWith("event:action.");
    case "artifacts":
      return item.sourceType === "artifact" || item.id.startsWith("artifact:");
    case "sessions":
      return item.id.startsWith("event:session.");
    case "errors":
      return item.tone === "bad" || item.id.startsWith("event:error:");
  }
}

function artifactSearchText(artifact: ArtifactRef): string {
  return [
    artifact.id,
    artifact.sessionId,
    artifact.type,
    artifact.path,
    artifact.createdAt,
    artifact.sha256,
    artifact.url,
    stringifyMetadata(artifact.metadata)
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function sessionSortTime(session: SessionListItem): number {
  const date = sessionUpdatedAt(session);
  if (!date) return 0;
  const timestamp = new Date(date).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function stringifyMetadata(metadata: ArtifactRef["metadata"]): string | undefined {
  if (!metadata) return undefined;
  try {
    return JSON.stringify(metadata);
  } catch {
    return Object.keys(metadata).join(" ");
  }
}

function shortenHash(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 12)}...${value.slice(-8)}`;
}
