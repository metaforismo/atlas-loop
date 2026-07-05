import type { TimelineItem } from "./timeline.js";
import type {
  ActionResultLike,
  ArtifactHealth,
  ArtifactHealthIssue,
  ArtifactRef,
  HealthState,
  ScreenshotState,
  Session,
  SessionListItem,
  SessionStatus,
  SessionSummary,
  TraceEvent,
  ViewerParams
} from "./types.js";

export type UiTone = "neutral" | "good" | "warn" | "bad";
export type TimelineFilter = "all" | "actions" | "artifacts" | "sessions" | "errors";
export type ArtifactHealthStatus = "loading" | "ready" | "error" | "offline";
export type AgentHandoffReadiness = "ready" | "waiting" | "needs-attention" | "blocked";

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

export interface ArtifactHealthIssuePreview {
  severity: string;
  tone: UiTone;
  message: string;
  path?: string;
}

export interface ArtifactHealthPresentation {
  title: string;
  detail: string;
  statusText: string;
  tone: UiTone;
  issuePreview: ArtifactHealthIssuePreview[];
}

export interface AgentHandoffNotice {
  title: string;
  detail: string;
  tone: UiTone;
  path?: string;
}

export interface AgentHandoffIdentifier {
  label: string;
  value: string;
  mono?: boolean;
}

export interface AgentHandoffSnapshot {
  path: string;
  source: string;
  detail: string;
  tone: UiTone;
}

export interface AgentHandoffActionSummary {
  label: string;
  detail: string;
  tone: UiTone;
  error?: string;
}

export type AgentHandoffCopyPayloadId = "note" | "nextSteps" | "commands";

export interface AgentHandoffCopyPayload {
  id: AgentHandoffCopyPayloadId;
  label: string;
  ariaLabel: string;
  value: string;
}

export interface AgentHandoffCommandPreview {
  label: string;
  detail: string;
  visibleLines: string[];
  hiddenLines: string[];
  hiddenLineCount: number;
  totalLineCount: number;
}

export interface AgentHandoffBundleSummary {
  label: string;
  directory: string;
  manifestPath: string;
  command: string;
  verifyCommand: string;
  mcpVerifyToolCall: string;
  detail: string;
}

export interface AgentHandoffBrief {
  readiness: AgentHandoffReadiness;
  title: string;
  detail: string;
  statusText: string;
  tone: UiTone;
  identifiers: AgentHandoffIdentifier[];
  latestScreenshot: AgentHandoffSnapshot;
  latestAction: AgentHandoffActionSummary;
  notices: AgentHandoffNotice[];
  nextSteps: string[];
  copyPayloads: AgentHandoffCopyPayload[];
  bundleSummary: AgentHandoffBundleSummary | undefined;
  commandPreview: AgentHandoffCommandPreview | undefined;
}

export interface AgentHandoffInput {
  health: HealthState;
  params: ViewerParams;
  session?: Session;
  sessionSummary?: SessionSummary;
  artifactHealth?: ArtifactHealth;
  artifactHealthStatus: ArtifactHealthStatus;
  artifactHealthError?: string;
  screenshot: ScreenshotState;
  artifacts: ArtifactRef[];
  events: TraceEvent[];
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

export function artifactHealthTone(health: ArtifactHealth | undefined, status: ArtifactHealthStatus): UiTone {
  if (status === "offline" || status === "error") return "bad";
  if (status === "loading") return "neutral";
  if (!health) return "warn";
  if (!health.ok || health.summary.errorCount > 0) return "bad";
  if (health.summary.warningCount > 0 || health.summary.issueCount > 0) return "warn";
  return "good";
}

export function visibleArtifactHealth(health: ArtifactHealth | undefined, status: ArtifactHealthStatus): ArtifactHealth | undefined {
  return status === "ready" ? health : undefined;
}

export function artifactHealthPresentation(
  health: ArtifactHealth | undefined,
  status: ArtifactHealthStatus,
  error?: string
): ArtifactHealthPresentation {
  const tone = artifactHealthTone(health, status);

  if (status === "offline") {
    return {
      title: "Daemon offline",
      detail: "Artifact validation needs a reachable daemon.",
      statusText: "offline",
      tone,
      issuePreview: []
    };
  }

  if (status === "loading") {
    return {
      title: "Checking evidence health",
      detail: "Validating artifact paths, manifests, traces, and evidence files.",
      statusText: "loading",
      tone,
      issuePreview: []
    };
  }

  if (status === "error") {
    return {
      title: "Health unavailable",
      detail: error ?? "The daemon did not return artifact health.",
      statusText: "error",
      tone,
      issuePreview: []
    };
  }

  if (!health) {
    return {
      title: "Health unavailable",
      detail: "Artifact health did not include a readable summary.",
      statusText: "invalid",
      tone,
      issuePreview: []
    };
  }

  const source = health.source ? ` from ${health.source}` : "";
  const target = health.artifactDir ?? health.target;
  const targetDetail = target ? ` Target: ${target}` : "";
  const title = health.ok && health.summary.errorCount === 0
    ? health.summary.warningCount > 0 || health.summary.issueCount > 0
      ? "Evidence warnings"
      : "Evidence healthy"
    : "Evidence errors";

  return {
    title,
    detail: `Validated ${health.summary.sessionCount} session${health.summary.sessionCount === 1 ? "" : "s"}${source}.${targetDetail}`,
    statusText: health.ok ? "ok" : "needs attention",
    tone,
    issuePreview: artifactHealthIssuePreview(health)
  };
}

export function artifactHealthIssuePreview(health: ArtifactHealth | undefined, limit = 3): ArtifactHealthIssuePreview[] {
  const issues = health?.report?.issues ?? [];
  return issues.slice(0, Math.max(0, limit)).map((issue) => ({
    severity: issueSeverityLabel(issue),
    tone: issueSeverityTone(issue.severity),
    message: issue.message,
    path: issue.path
  }));
}

export function buildAgentHandoffBrief(input: AgentHandoffInput): AgentHandoffBrief {
  const resolvedSession = input.session ?? input.sessionSummary?.session;
  const resolvedSessionId = resolvedSession?.id;
  const storage = input.sessionSummary?.storage;
  const latestScreenshot = agentHandoffScreenshot(input);
  const latestAction = agentHandoffLatestAction(input.sessionSummary, input.events);
  const latestError = latestTraceError(input.events) ?? input.sessionSummary?.events.latestError;
  const notices: AgentHandoffNotice[] = [];
  const sessionIsRunning = resolvedSession?.status === "running";

  const addNotice = (notice: AgentHandoffNotice): void => {
    if (notices.some((existing) => existing.title === notice.title && existing.detail === notice.detail && existing.path === notice.path)) return;
    notices.push(notice);
  };

  if (input.health === "offline") {
    addNotice({
      title: "Daemon offline",
      detail: "The viewer cannot refresh sessions, screenshots, actions, or artifact health.",
      tone: "bad"
    });
  } else if (input.health === "checking") {
    addNotice({
      title: "Daemon check pending",
      detail: "Waiting for /healthz before trusting session evidence.",
      tone: "warn"
    });
  }

  if (!resolvedSession) {
    addNotice({
      title: "No session loaded",
      detail: input.params.sessionId === "latest" ? "Latest has not resolved to a concrete session yet." : `Session ${input.params.sessionId} is not loaded.`,
      tone: "warn"
    });
  } else if (isPendingSessionStatus(resolvedSession.status)) {
    addNotice({
      title: "Session still preparing",
      detail: `Current status is ${resolvedSession.status}. Wait for running evidence before handoff.`,
      tone: "warn"
    });
  } else if (resolvedSession.status === "failed") {
    addNotice({
      title: "Session failed",
      detail: resolvedSession.error?.message ?? "The loaded session is marked failed.",
      tone: "bad"
    });
  } else if (resolvedSession.status === "ended") {
    addNotice({
      title: "Read-only session",
      detail: "This session has ended. Evidence can be inspected, but actions should target a live session.",
      tone: "warn"
    });
  } else if (!sessionIsRunning) {
    addNotice({
      title: "Session not running",
      detail: `Current status is ${resolvedSession.status ?? "unknown"}. Wait for running evidence before handoff.`,
      tone: "warn"
    });
  }

  if (resolvedSession?.error) {
    addNotice({
      title: "Session error",
      detail: resolvedSession.error.message,
      tone: "bad"
    });
  }

  if (latestAction.tone === "bad") {
    addNotice({
      title: "Latest action failed",
      detail: latestAction.error ?? latestAction.detail,
      tone: "bad"
    });
  } else if (latestAction.label === "Action running") {
    addNotice({
      title: "Action still running",
      detail: latestAction.detail,
      tone: "warn"
    });
  } else if (latestAction.label === "No action result") {
    addNotice({
      title: "No action result",
      detail: "No completed action is available in the loaded session evidence.",
      tone: "warn"
    });
  }

  if (latestError) {
    addNotice({
      title: latestError.code ?? "Latest error",
      detail: latestError.message,
      tone: "bad"
    });
  }

  if (input.artifactHealthStatus === "error") {
    addNotice({
      title: "Artifact health unavailable",
      detail: input.artifactHealthError ?? "The daemon did not return artifact health.",
      tone: "bad"
    });
  } else if (input.artifactHealthStatus === "loading") {
    addNotice({
      title: "Artifact health loading",
      detail: "Evidence paths and manifests are still being checked.",
      tone: "warn"
    });
  } else if (input.artifactHealthStatus === "ready") {
    if (!input.artifactHealth) {
      addNotice({
        title: "Artifact health unavailable",
        detail: "The daemon returned ready state without a readable artifact health summary.",
        tone: "bad"
      });
    } else if (!input.artifactHealth.ok || input.artifactHealth.summary.errorCount > 0) {
      const summary = input.artifactHealth.summary;
      addNotice({
        title: "Artifact health errors",
        detail: `${summary.errorCount} error${summary.errorCount === 1 ? "" : "s"} and ${summary.warningCount} warning${summary.warningCount === 1 ? "" : "s"} reported.`,
        tone: "bad"
      });
    } else if (input.artifactHealth.summary.warningCount > 0 || input.artifactHealth.summary.issueCount > 0) {
      const summary = input.artifactHealth.summary;
      addNotice({
        title: "Artifact health warnings",
        detail: `${summary.warningCount} warning${summary.warningCount === 1 ? "" : "s"} across ${summary.issueCount} issue${summary.issueCount === 1 ? "" : "s"}.`,
        tone: "warn"
      });
    }
  }

  if (storage?.warnings.length) {
    addNotice({
      title: "Storage warnings",
      detail: `${storage.warnings.length} persisted storage warning${storage.warnings.length === 1 ? "" : "s"} reported in the summary.`,
      tone: "warn"
    });
  }

  if (input.screenshot.status === "loading") {
    addNotice({
      title: "Screenshot loading",
      detail: "The viewer has not rendered the latest screenshot yet.",
      tone: "warn"
    });
  } else if (input.screenshot.status === "empty") {
    addNotice({
      title: "No screenshot",
      detail: input.screenshot.message,
      tone: "warn"
    });
  } else if (input.screenshot.status === "error") {
    addNotice({
      title: "Screenshot unavailable",
      detail: input.screenshot.message,
      tone: "bad"
    });
  } else if (input.screenshot.status === "stale") {
    addNotice({
      title: "Screenshot stale",
      detail: `Using the previous image because refresh failed: ${input.screenshot.message}`,
      tone: "warn"
    });
  }

  if (resolvedSession && input.artifacts.length === 0 && (input.sessionSummary?.artifacts.total ?? 0) === 0) {
    addNotice({
      title: "No artifacts listed",
      detail: "The session has no loaded screenshots, logs, traces, or metadata artifacts yet.",
      tone: "warn"
    });
  }

  const hasBlocker = notices.some((notice) => notice.tone === "bad");
  const hasWaiting = notices.some((notice) =>
    [
      "Daemon check pending",
      "No session loaded",
      "Session still preparing",
      "Session not running",
      "Artifact health loading",
      "Screenshot loading",
      "No screenshot",
      "Action still running",
      "No action result"
    ].includes(notice.title)
  );
  const hasWarning = notices.some((notice) => notice.tone === "warn");
  const hasPositiveEvidence =
    sessionIsRunning &&
    input.screenshot.status === "ready" &&
    input.artifactHealthStatus === "ready" &&
    input.artifactHealth?.ok === true &&
    input.artifactHealth.summary.errorCount === 0 &&
    input.artifactHealth.summary.warningCount === 0 &&
    latestAction.tone === "good";
  const readiness: AgentHandoffReadiness = hasBlocker
    ? "blocked"
    : hasPositiveEvidence && !hasWarning
      ? "ready"
      : hasWaiting
        ? "waiting"
        : "needs-attention";
  const tone: UiTone = readiness === "ready" ? "good" : readiness === "blocked" ? "bad" : "warn";
  const identifiers = agentHandoffIdentifiers(input, resolvedSessionId);
  const nextSteps = agentHandoffNextSteps(input, readiness, latestAction, notices);
  const visibleNotices = notices.slice(0, 6);
  const bundleSummary = agentHandoffBundleSummary(input, resolvedSessionId);
  const copyPayloads = agentHandoffCopyPayloads(
    input,
    readiness,
    resolvedSessionId,
    identifiers,
    latestScreenshot,
    latestAction,
    notices,
    nextSteps,
    bundleSummary
  );
  const commandPreview = agentHandoffCommandPreview(copyPayloads.find((payload) => payload.id === "commands")?.value);

  return {
    readiness,
    title: agentHandoffTitle(readiness),
    detail: agentHandoffDetail(readiness),
    statusText: readinessLabel(readiness),
    tone,
    identifiers,
    latestScreenshot,
    latestAction,
    notices: visibleNotices,
    nextSteps,
    copyPayloads,
    bundleSummary,
    commandPreview
  };
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
  if (artifact.sha256) rows.push({ label: "SHA-256", value: artifact.sha256, mono: true });

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

function issueSeverityLabel(issue: ArtifactHealthIssue): string {
  if (issue.severity === "error") return "error";
  if (issue.severity === "warning") return "warning";
  return issue.severity ?? "issue";
}

function issueSeverityTone(severity: ArtifactHealthIssue["severity"]): UiTone {
  if (severity === "error") return "bad";
  if (severity === "warning") return "warn";
  return "neutral";
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

function agentHandoffIdentifiers(input: AgentHandoffInput, resolvedSessionId: string | undefined): AgentHandoffIdentifier[] {
  const summary = input.sessionSummary;
  const storage = summary?.storage;
  const artifactCount = summary?.artifacts.total ?? input.artifacts.length;
  const eventCount = summary?.events.total ?? input.events.length;
  const storageValue = storage ? `${storage.source}${storage.artifactBacked ? ", artifact-backed" : ", not artifact-backed"}` : "--";

  return [
    { label: "Viewer", value: input.params.sessionId, mono: true },
    { label: "Session", value: resolvedSessionId ?? "--", mono: true },
    { label: "Daemon", value: input.params.daemonUrl, mono: true },
    { label: "Storage", value: storageValue },
    { label: "Artifacts", value: String(artifactCount), mono: true },
    { label: "Events", value: String(eventCount), mono: true }
  ];
}

function agentHandoffScreenshot(input: AgentHandoffInput): AgentHandoffSnapshot {
  const latestArtifact = input.sessionSummary?.artifacts.latestScreenshot ?? latestArtifactOfType(input.artifacts, "screenshot");
  const path = input.sessionSummary?.artifacts.latestScreenshotPath ?? latestArtifact?.path;
  const fallbackPath = input.screenshot.status === "ready" || input.screenshot.status === "stale" ? input.screenshot.src : "--";
  const displayPath = path ?? fallbackPath;

  if (input.screenshot.status === "ready") {
    return {
      path: displayPath,
      source: input.screenshot.source,
      detail: `Updated ${formatDateTime(input.screenshot.updatedAt)}`,
      tone: "good"
    };
  }

  if (input.screenshot.status === "stale") {
    return {
      path: displayPath,
      source: input.screenshot.source,
      detail: `Stale since ${formatDateTime(input.screenshot.staleAt)}. ${input.screenshot.message}`,
      tone: "warn"
    };
  }

  if (input.screenshot.status === "error") {
    return {
      path: displayPath,
      source: "error",
      detail: input.screenshot.message,
      tone: "bad"
    };
  }

  if (input.screenshot.status === "empty") {
    return {
      path: path ?? "--",
      source: "empty",
      detail: input.screenshot.message,
      tone: "warn"
    };
  }

  return {
    path: path ?? "--",
    source: "loading",
    detail: path ? "Artifact reported; image fetch is still loading." : "Waiting for latest screenshot.",
    tone: "neutral"
  };
}

function agentHandoffLatestAction(summary: SessionSummary | undefined, events: TraceEvent[]): AgentHandoffActionSummary {
  let latestResult: { result: ActionResultLike & { artifactCount?: number }; at?: string } | undefined = summary?.events.latestAction
    ? { result: summary.events.latestAction, at: summary.events.latestAction.endedAt ?? summary.events.latestAction.startedAt }
    : undefined;
  let latestStarted: TraceEvent | undefined;

  for (const event of events) {
    if (event.type === "action.completed" && event.result) {
      const candidate = { result: event.result, at: event.result.endedAt ?? event.at };
      if (!latestResult || timestampMs(candidate.at) > timestampMs(latestResult.at)) latestResult = candidate;
    } else if (event.type === "action.started" && event.action) {
      if (!latestStarted || timestampMs(event.action.createdAt ?? event.at) > timestampMs(latestStarted.action?.createdAt ?? latestStarted.at)) {
        latestStarted = event;
      }
    }
  }

  if (latestStarted?.action && (!latestResult || timestampMs(latestStarted.action.createdAt ?? latestStarted.at) > timestampMs(latestResult.at))) {
    return {
      label: "Action running",
      detail: `${latestStarted.action.kind} ${latestStarted.action.id}`,
      tone: "warn"
    };
  }

  if (latestResult) {
    const artifactCount = latestResult.result.artifactCount ?? latestResult.result.artifacts?.length ?? 0;
    const artifactLabel = artifactCount === 1 ? "1 artifact" : `${artifactCount} artifacts`;
    return {
      label: latestResult.result.ok ? "Last action passed" : "Last action failed",
      detail: latestResult.result.ok
        ? `${latestResult.result.actionId}, ${artifactLabel}, ${formatDateTime(latestResult.at)}`
        : `${latestResult.result.actionId}, ${formatDateTime(latestResult.at)}`,
      tone: latestResult.result.ok ? "good" : "bad",
      error: latestResult.result.error?.message
    };
  }

  return {
    label: "No action result",
    detail: "No completed viewer action in loaded events.",
    tone: "neutral"
  };
}

function latestTraceError(events: TraceEvent[]): TraceEvent["error"] | undefined {
  let latestError: TraceEvent | undefined;
  for (const event of events) {
    if (event.type !== "error" || !event.error) continue;
    if (!latestError || timestampMs(event.at) > timestampMs(latestError.at)) latestError = event;
  }
  return latestError?.error;
}

function agentHandoffNextSteps(
  input: AgentHandoffInput,
  readiness: AgentHandoffReadiness,
  latestAction: AgentHandoffActionSummary,
  notices: AgentHandoffNotice[]
): string[] {
  const steps: string[] = [];
  const addStep = (step: string): void => {
    if (!steps.includes(step)) steps.push(step);
  };

  if (input.health === "offline") addStep("Start the local daemon, then reconnect this viewer URL.");
  if (!input.session && !input.sessionSummary?.session) addStep("Start an atlas-loop run or keep latest selected until a session appears.");
  if (input.screenshot.status === "empty" || input.screenshot.status === "error") addStep("Capture a screenshot from Actions once the simulator is stable.");
  if (input.screenshot.status === "stale") addStep("Refresh evidence or capture a new screenshot before handing off visual state.");
  if (input.artifactHealthStatus === "error" || notices.some((notice) => notice.title === "Artifact health errors")) addStep("Fix artifact health errors before treating the evidence set as complete.");
  if (input.sessionSummary?.storage.warnings.length) addStep("Review storage warnings and preserve missing paths before archive or handoff.");
  if (latestAction.tone === "bad") addStep("Inspect the failed action in the timeline, correct the UI state, then retry locally.");
  if (latestAction.label === "Action running") addStep("Wait for the running action to complete before handing off.");
  if (latestAction.label === "No action result") addStep("Run one meaningful action or capture a screenshot before another agent takes over.");

  if (readiness === "ready") {
    addStep("Pass the daemon URL and resolved session id to the next agent.");
    addStep("Capture one fresh screenshot if the UI changed after the last action.");
  } else if (steps.length === 0) {
    addStep("Resolve the listed warnings, then recheck the latest screenshot and artifact health.");
  }

  return steps.slice(0, 4);
}

function agentHandoffCopyPayloads(
  input: AgentHandoffInput,
  readiness: AgentHandoffReadiness,
  resolvedSessionId: string | undefined,
  identifiers: AgentHandoffIdentifier[],
  latestScreenshot: AgentHandoffSnapshot,
  latestAction: AgentHandoffActionSummary,
  notices: AgentHandoffNotice[],
  nextSteps: string[],
  bundleSummary: AgentHandoffBundleSummary | undefined
): AgentHandoffCopyPayload[] {
  return [
    {
      id: "note",
      label: "Copy note",
      ariaLabel: "Copy compact local handoff note",
      value: agentHandoffNote(
        readiness,
        identifiers,
        latestScreenshot,
        latestAction,
        notices,
        nextSteps,
        bundleSummary
      )
    },
    {
      id: "nextSteps",
      label: "Copy steps",
      ariaLabel: "Copy all handoff next steps",
      value: agentHandoffNextStepsPayload(nextSteps, bundleSummary)
    },
    {
      id: "commands",
      label: "Copy commands",
      ariaLabel: "Copy local handoff command snippets",
      value: agentHandoffCommands(input, resolvedSessionId)
    }
  ];
}

function agentHandoffNote(
  readiness: AgentHandoffReadiness,
  identifiers: AgentHandoffIdentifier[],
  latestScreenshot: AgentHandoffSnapshot,
  latestAction: AgentHandoffActionSummary,
  notices: AgentHandoffNotice[],
  nextSteps: string[],
  bundleSummary: AgentHandoffBundleSummary | undefined
): string {
  const noticeLines = notices.length > 0
    ? notices.map((notice) => `- ${notice.title}: ${notice.detail}${notice.path ? ` (${notice.path})` : ""}`)
    : ["- none"];
  const bundleLines = bundleSummary
    ? [
        `Bundle directory: ${bundleSummary.directory}`,
        `Bundle manifest: ${bundleSummary.manifestPath}`,
        `Bundle verify: ${bundleSummary.verifyCommand}`,
        `MCP verify: ${bundleSummary.mcpVerifyToolCall}`,
        `Bundle detail: ${bundleSummary.detail}`
      ]
    : [];

  return [
    "Atlas Loop handoff",
    `Status: ${readinessLabel(readiness)}`,
    `Readiness: ${agentHandoffTitle(readiness)} - ${agentHandoffDetail(readiness)}`,
    ...identifiers.map((identifier) => `${identifier.label}: ${identifier.value}`),
    ...bundleLines,
    `Screenshot: ${latestScreenshot.path} (${latestScreenshot.source}) - ${latestScreenshot.detail}`,
    `Action: ${latestAction.label} - ${latestAction.error ?? latestAction.detail}`,
    "Blockers/warnings:",
    ...noticeLines,
    "Next steps:",
    ...numberedLines(nextSteps).split("\n")
  ].join("\n");
}

function agentHandoffBundleSummary(input: AgentHandoffInput, resolvedSessionId: string | undefined): AgentHandoffBundleSummary | undefined {
  if (!resolvedSessionId) return undefined;

  const directory = `./atlas-loop-handoffs/${resolvedSessionId}`;
  return {
    label: "Bundle output",
    directory,
    manifestPath: `${directory}/manifest.json`,
    command: agentHandoffBundleCommand(input, resolvedSessionId),
    verifyCommand: agentHandoffBundleVerifyCommand(resolvedSessionId),
    mcpVerifyToolCall: agentHandoffMcpVerifyToolCall(resolvedSessionId),
    detail: "Local-only output; writes handoff.json, handoff.md, README.md, manifest.json, and optional exports."
  };
}

function agentHandoffCommands(input: AgentHandoffInput, resolvedSessionId: string | undefined): string {
  const rawSessionId = resolvedSessionId ?? input.params.sessionId;
  const sessionId = encodeURIComponent(rawSessionId);
  const baseUrl = input.params.daemonUrl.replace(/\/+$/, "");
  const cliSession = shellSingleQuote(rawSessionId);
  const cliDaemon = shellSingleQuote(baseUrl);
  const endpoints = [
    `${baseUrl}/healthz`,
    `${baseUrl}/v1/sessions/${sessionId}`,
    `${baseUrl}/v1/sessions/${sessionId}/summary`,
    `${baseUrl}/v1/sessions/${sessionId}/artifacts`,
    `${baseUrl}/v1/sessions/${sessionId}/artifacts/health`
  ];

  return [
    "# Local atlas-loop CLI handoff commands",
    `atlas-loop artifacts health --session ${cliSession} --daemon-url ${cliDaemon}`,
    agentHandoffBundleCommand(input, rawSessionId),
    agentHandoffBundleVerifyCommand(rawSessionId),
    agentHandoffMcpVerifyToolCall(rawSessionId),
    `atlas-loop evidence report --session ${cliSession} --daemon-url ${cliDaemon}`,
    `atlas-loop evidence export --session ${cliSession} --out ${shellSingleQuote(`./atlas-loop-evidence/${rawSessionId}`)} --daemon-url ${cliDaemon}`,
    `atlas-loop events export --session ${cliSession} --out ${shellSingleQuote(`./atlas-loop-events/${rawSessionId}.json`)} --daemon-url ${cliDaemon}`,
    "",
    "# Read-only local daemon checks",
    ...endpoints.map((endpoint) => `curl -fsS ${shellSingleQuote(endpoint)}`)
  ].join("\n");
}

function agentHandoffBundleCommand(input: AgentHandoffInput, rawSessionId: string): string {
  const baseUrl = input.params.daemonUrl.replace(/\/+$/, "");
  const viewerBaseUrl = (input.params.viewerBaseUrl ?? "http://127.0.0.1:5173").replace(/\/+$/, "");

  return [
    "atlas-loop session handoff",
    `--session ${shellSingleQuote(rawSessionId)}`,
    `--bundle ${shellSingleQuote(`./atlas-loop-handoffs/${rawSessionId}`)}`,
    `--viewer-base-url ${shellSingleQuote(viewerBaseUrl)}`,
    `--daemon-url ${shellSingleQuote(baseUrl)}`
  ].join(" ");
}

function agentHandoffBundleVerifyCommand(rawSessionId: string): string {
  return [
    "atlas-loop handoff verify",
    `--bundle ${shellSingleQuote(`./atlas-loop-handoffs/${rawSessionId}`)}`
  ].join(" ");
}

function agentHandoffMcpVerifyToolCall(rawSessionId: string): string {
  return `atlas.verifyHandoffBundle(${JSON.stringify({ bundleDir: `./atlas-loop-handoffs/${rawSessionId}` })})`;
}

function agentHandoffCommandPreview(value: string | undefined): AgentHandoffCommandPreview | undefined {
  const lines = (value ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return undefined;

  const visibleLines = lines.slice(0, 8);
  const hiddenLines = lines.slice(visibleLines.length);

  return {
    label: "Local handoff command preview",
    detail: "Local handoff bundle, CLI exports, and daemon GET checks",
    visibleLines,
    hiddenLines,
    hiddenLineCount: hiddenLines.length,
    totalLineCount: lines.length
  };
}

function agentHandoffNextStepsPayload(nextSteps: string[], bundleSummary: AgentHandoffBundleSummary | undefined): string {
  const steps = numberedLines(nextSteps);
  return bundleSummary
    ? `${steps}\n\nBundle verify command:\n${bundleSummary.verifyCommand}\n\nMCP verify tool:\n${bundleSummary.mcpVerifyToolCall}`
    : steps;
}

function numberedLines(items: string[]): string {
  return items.length > 0 ? items.map((item, index) => `${index + 1}. ${item}`).join("\n") : "No next steps from loaded viewer data.";
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function agentHandoffTitle(readiness: AgentHandoffReadiness): string {
  switch (readiness) {
    case "ready":
      return "Ready for handoff";
    case "waiting":
      return "Waiting for evidence";
    case "needs-attention":
      return "Evidence needs review";
    case "blocked":
      return "Handoff blocked";
  }
}

function agentHandoffDetail(readiness: AgentHandoffReadiness): string {
  switch (readiness) {
    case "ready":
      return "Running session, fresh screenshot, successful action, and healthy artifacts are present.";
    case "waiting":
      return "The viewer is still waiting on live session or evidence data.";
    case "needs-attention":
      return "The session is readable, but warnings should be checked before another agent takes over.";
    case "blocked":
      return "Resolve blockers before trusting this session for agent handoff.";
  }
}

function readinessLabel(readiness: AgentHandoffReadiness): string {
  return readiness.replace("-", " ");
}

function isPendingSessionStatus(status: SessionStatus | undefined): boolean {
  return status === "created" || status === "booting" || status === "building" || status === "installing" || status === "launching";
}

function timestampMs(value: string | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function stringifyMetadata(metadata: ArtifactRef["metadata"]): string | undefined {
  if (!metadata) return undefined;
  try {
    return JSON.stringify(metadata);
  } catch {
    return Object.keys(metadata).join(" ");
  }
}
