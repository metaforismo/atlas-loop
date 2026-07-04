import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  fetchArtifacts,
  fetchEvents,
  fetchHealth,
  fetchLatestScreenshot,
  fetchSession,
  fetchSessionSummary,
  fetchSessions,
  isDisplayableScreenshot,
  markScreenshotFetchFailed,
  mergeScreenshotFetchResult,
  performViewerAction,
  screenshotArtifactIdentity,
  screenshotObjectUrl
} from "./api.js";
import { buildTimelineItems, mergeTraceEvents, sortArtifacts } from "./timeline.js";
import type {
  ActionResultLike,
  ArtifactRef,
  HealthState,
  ScreenshotState,
  Session,
  SessionListItem,
  SessionSummary,
  TraceEvent,
  ViewerActionDraft,
  ViewerActionKind,
  ViewerParams
} from "./types.js";
import {
  artifactDetailRows,
  artifactDisplayName,
  artifactTypeOptions,
  eventModeTone,
  filterArtifacts,
  filterTimelineItems,
  formatDateTime,
  formatTime,
  healthTone,
  latestArtifactOfType,
  latestSessionEmptyState,
  sessionSignal,
  sessionTone,
  sessionUpdatedAt,
  sortSessionList,
  timelineFilterOptions,
  type TimelineFilter,
  type UiTone
} from "./viewerPresentation.js";
import { DEFAULT_SESSION_ID, buildSessionUrl, readViewerParams, writeViewerSearch } from "./viewerParams.js";

const TRACE_EVENT_TYPES = [
  "session.created",
  "session.statusChanged",
  "action.started",
  "action.completed",
  "artifact.created",
  "error"
];

const VIEWER_ACTION_LABELS: Record<ViewerActionKind, string> = {
  screenshot: "Screenshot",
  wait: "Wait",
  tap: "Tap",
  typeText: "Type",
  swipe: "Swipe"
};

interface ViewerActionFormState {
  screenshotReason: string;
  waitDurationMs: string;
  tapX: string;
  tapY: string;
  typeText: string;
  swipeFromX: string;
  swipeFromY: string;
  swipeToX: string;
  swipeToY: string;
  swipeDurationMs: string;
}

type ViewerActionFormField = keyof ViewerActionFormState;

type ViewerActionSubmitState =
  | { status: "idle" }
  | { status: "pending"; label: string }
  | { status: "success"; label: string; message: string }
  | { status: "error"; label: string; message: string };

interface ScreenshotTapTarget {
  x: number;
  y: number;
  markerLeftPercent: number;
  markerTopPercent: number;
  label: string;
}

type ScreenshotTargetStyle = CSSProperties & {
  "--target-left": string;
  "--target-top": string;
};

interface RenderedImageBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const DEFAULT_ACTION_FORM: ViewerActionFormState = {
  screenshotReason: "",
  waitDurationMs: "500",
  tapX: "0.5",
  tapY: "0.5",
  typeText: "",
  swipeFromX: "0.5",
  swipeFromY: "0.82",
  swipeToX: "0.5",
  swipeToY: "0.18",
  swipeDurationMs: "300"
};

function useViewerParams(): ViewerParams {
  const [params, setParams] = useState(() => readViewerParams(window.location.search));

  useEffect(() => {
    const handlePopState = (): void => setParams(readViewerParams(window.location.search));
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return params;
}

function useAtlasLoopData(params: ViewerParams) {
  const [health, setHealth] = useState<HealthState>("checking");
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [sessionListStatus, setSessionListStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sessionListError, setSessionListError] = useState<string | undefined>();
  const [session, setSession] = useState<Session | undefined>();
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | undefined>();
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ status: "loading" });
  const [screenshotRetryNonce, setScreenshotRetryNonce] = useState(0);
  const [eventMode, setEventMode] = useState<"connecting" | "sse" | "polling">("connecting");
  const [lastError, setLastError] = useState<string | undefined>();
  const screenshotUrlRef = useRef<string | undefined>(undefined);
  const resolvedScreenshotKeyRef = useRef<string | undefined>(undefined);
  const latestScreenshotKey = useMemo(() => screenshotArtifactIdentity(sessionSummary, artifacts), [sessionSummary, artifacts]);

  useEffect(() => {
    setHealth("checking");
    setSessions([]);
    setSessionListStatus("loading");
    setSessionListError(undefined);
  }, [params.daemonUrl]);

  useEffect(() => {
    setSession(undefined);
    setSessionSummary(undefined);
    setArtifacts([]);
    setEvents([]);
    setScreenshot({ status: "loading" });
    setScreenshotRetryNonce(0);
    setEventMode("connecting");
    setLastError(undefined);
    resolvedScreenshotKeyRef.current = undefined;
    if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current);
    screenshotUrlRef.current = undefined;
  }, [params.daemonUrl, params.sessionId]);

  useEffect(() => {
    return () => {
      if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current);
      screenshotUrlRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      const online = await fetchHealth(params.daemonUrl, controller.signal);
      if (controller.signal.aborted) return;
      setHealth(online ? "online" : "offline");
      if (!online) {
        setSessionListStatus("error");
        setSessionListError("Daemon is offline or not reachable.");
        setLastError("Daemon is offline or not reachable.");
        return;
      }

      try {
        const nextSessions = await fetchSessions(params.daemonUrl, controller.signal);
        if (controller.signal.aborted) return;
        setSessions(sortSessionList(nextSessions));
        setSessionListStatus("ready");
        setSessionListError(undefined);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSessionListStatus("error");
        setSessionListError(error instanceof Error ? error.message : "Failed to load sessions.");
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [params.daemonUrl]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const [nextSession, nextSummary, nextArtifacts] = await Promise.all([
          fetchSession(params, controller.signal),
          fetchSessionSummary(params, controller.signal),
          fetchArtifacts(params, controller.signal)
        ]);
        if (controller.signal.aborted) return;
        setSession(nextSession);
        setSessionSummary(nextSummary);
        setArtifacts(sortArtifacts(nextArtifacts));
        setLastError(undefined);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLastError(error instanceof Error ? error.message : "Failed to load session data.");
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [params.daemonUrl, params.sessionId]);

  useEffect(() => {
    const controller = new AbortController();
    const hasStableArtifactKey = latestScreenshotKey !== undefined;

    if (hasStableArtifactKey && resolvedScreenshotKeyRef.current === latestScreenshotKey) return;

    let loading = false;
    let retryTimer: number | undefined;

    const load = async (): Promise<void> => {
      if (loading) return;
      loading = true;

      try {
        const nextScreenshot = await fetchLatestScreenshot(params, controller.signal);
        if (controller.signal.aborted) return;
        setScreenshot((previous) => {
          const resolvedScreenshot = mergeScreenshotFetchResult(previous, nextScreenshot, { hasStableArtifactKey });
          const previousObjectUrl = screenshotObjectUrl(previous);
          const nextObjectUrl = screenshotObjectUrl(resolvedScreenshot);
          if (previousObjectUrl && previousObjectUrl !== nextObjectUrl) URL.revokeObjectURL(previousObjectUrl);
          screenshotUrlRef.current = nextObjectUrl;
          return resolvedScreenshot;
        });
        if (hasStableArtifactKey && nextScreenshot.status === "ready") {
          resolvedScreenshotKeyRef.current = latestScreenshotKey;
        } else if (hasStableArtifactKey && nextScreenshot.status === "empty") {
          retryTimer = window.setTimeout(() => setScreenshotRetryNonce((nonce) => nonce + 1), 2500);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Failed to load screenshot.";
        setScreenshot((previous) => {
          const nextScreenshot = markScreenshotFetchFailed(previous, message);
          screenshotUrlRef.current = screenshotObjectUrl(nextScreenshot);
          return nextScreenshot;
        });
        if (hasStableArtifactKey) {
          retryTimer = window.setTimeout(() => setScreenshotRetryNonce((nonce) => nonce + 1), 2500);
        }
      } finally {
        loading = false;
      }
    };

    void load();
    const timer = hasStableArtifactKey ? undefined : window.setInterval(() => void load(), 1200);
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [params, latestScreenshotKey, screenshotRetryNonce]);

  useEffect(() => {
    let closed = false;
    let pollTimer: number | undefined;
    let source: EventSource | undefined;

    const mergeIncoming = (incoming: TraceEvent[]): void => {
      setEvents((current) => mergeTraceEvents(current, incoming));
    };

    const poll = async (): Promise<void> => {
      try {
        const nextEvents = await fetchEvents(params);
        if (!closed) mergeIncoming(nextEvents);
      } catch {
        if (!closed) setEventMode("polling");
      }
    };

    const startPolling = (): void => {
      if (pollTimer !== undefined) return;
      setEventMode("polling");
      void poll();
      pollTimer = window.setInterval(() => void poll(), 2000);
    };

    if ("EventSource" in window) {
      try {
        source = new EventSource(buildSessionUrl(params, "events"));
        source.onopen = () => {
          if (!closed) setEventMode("sse");
        };
        source.onmessage = (message) => {
          const parsed = parseEventMessage(message.data);
          if (parsed) mergeIncoming([parsed]);
        };
        for (const type of TRACE_EVENT_TYPES) {
          source.addEventListener(type, (message) => {
            const parsed = parseEventMessage((message as MessageEvent<string>).data, type);
            if (parsed) mergeIncoming([parsed]);
          });
        }
        source.onerror = () => {
          source?.close();
          startPolling();
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      closed = true;
      source?.close();
      if (pollTimer !== undefined) window.clearInterval(pollTimer);
    };
  }, [params.daemonUrl, params.sessionId]);

  return {
    health,
    sessions,
    sessionListStatus,
    sessionListError,
    session,
    sessionSummary,
    artifacts,
    events,
    screenshot,
    eventMode,
    lastError,
    timeline: buildTimelineItems(events, artifacts)
  };
}

function parseEventMessage(data: string, type?: string): TraceEvent | undefined {
  try {
    const parsed = JSON.parse(data) as TraceEvent;
    if (type && !parsed.type) return { ...parsed, type };
    return parsed.type ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function screenshotTapTargetFromClientPoint(image: HTMLImageElement, clientX: number, clientY: number): ScreenshotTapTarget | undefined {
  const rect = image.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;

  const box = containedImageBox(rect, image.naturalWidth, image.naturalHeight);
  const xInImage = clientX - rect.left - box.left;
  const yInImage = clientY - rect.top - box.top;

  if (xInImage < 0 || yInImage < 0 || xInImage > box.width || yInImage > box.height) return undefined;

  const x = clampNormalizedCoordinate(xInImage / box.width);
  const y = clampNormalizedCoordinate(yInImage / box.height);
  const markerLeftPercent = ((box.left + x * box.width) / rect.width) * 100;
  const markerTopPercent = ((box.top + y * box.height) / rect.height) * 100;

  return {
    x,
    y,
    markerLeftPercent,
    markerTopPercent,
    label: `x ${formatTapCoordinate(x)} y ${formatTapCoordinate(y)}`
  };
}

function containedImageBox(rect: DOMRect, naturalWidth: number, naturalHeight: number): RenderedImageBox {
  if (rect.width <= 0 || rect.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) {
    return { left: 0, top: 0, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }

  const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return {
    left: (rect.width - width) / 2,
    top: (rect.height - height) / 2,
    width,
    height
  };
}

function clampNormalizedCoordinate(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function formatTapCoordinate(value: number): string {
  return clampNormalizedCoordinate(value).toFixed(3);
}

export function App() {
  const params = useViewerParams();
  const { health, sessions, sessionListStatus, sessionListError, session, sessionSummary, artifacts, screenshot, eventMode, lastError, timeline } =
    useAtlasLoopData(params);
  const [draft, setDraft] = useState(params);
  const [artifactTypeFilter, setArtifactTypeFilter] = useState("all");
  const [artifactQuery, setArtifactQuery] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>();
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [timelineQuery, setTimelineQuery] = useState("");
  const [actionForm, setActionForm] = useState<ViewerActionFormState>(DEFAULT_ACTION_FORM);
  const [tapTarget, setTapTarget] = useState<ScreenshotTapTarget | undefined>();

  useEffect(() => {
    setDraft(params);
  }, [params]);

  useEffect(() => {
    setArtifactTypeFilter("all");
    setArtifactQuery("");
    setSelectedArtifactId(undefined);
    setTimelineFilter("all");
    setTimelineQuery("");
  }, [params.daemonUrl, params.sessionId]);

  const latestArtifact = artifacts[0];
  const latestScreenshotArtifact = useMemo(() => latestArtifactOfType(artifacts, "screenshot"), [artifacts]);
  const artifactFilters = useMemo(() => artifactTypeOptions(artifacts), [artifacts]);
  const filteredArtifacts = useMemo(
    () => filterArtifacts(artifacts, { type: artifactTypeFilter, query: artifactQuery }),
    [artifacts, artifactTypeFilter, artifactQuery]
  );
  const timelineFilters = useMemo(() => timelineFilterOptions(timeline), [timeline]);
  const visibleTimeline = useMemo(
    () => filterTimelineItems(timeline, { filter: timelineFilter, query: timelineQuery }),
    [timeline, timelineFilter, timelineQuery]
  );
  const selectedSessionId = session?.id ?? params.sessionId;
  const isFollowingLatest = params.sessionId === DEFAULT_SESSION_ID;
  const hasDraftChanges = draft.daemonUrl !== params.daemonUrl || draft.sessionId !== params.sessionId;
  const isLatestFirstRun = isFollowingLatest && !session && artifacts.length === 0 && timeline.length === 0;
  const firstRunState = latestSessionEmptyState(health);
  const sessionListLabel =
    sessionListStatus === "ready"
      ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}`
      : sessionListStatus === "loading"
        ? "loading"
        : "unavailable";
  const sessionListStatusMessage =
    health === "offline"
      ? "Daemon offline. Sessions cannot be refreshed."
      : sessionListStatus === "ready"
        ? `${sessions.length} session${sessions.length === 1 ? "" : "s"} available.`
        : sessionListStatus === "loading"
          ? "Loading sessions."
          : `Session list unavailable. ${sessionListError ?? ""}`.trim();
  const storageWarnings = sessionSummary?.storage.warnings ?? [];
  const selectedArtifact = useMemo(
    () => filteredArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? filteredArtifacts[0],
    [filteredArtifacts, selectedArtifactId]
  );
  const showLastError = Boolean(lastError && !(isLatestFirstRun && (health !== "online" || /^404\b/.test(lastError))));
  const screenshotIsDisplayable = isDisplayableScreenshot(screenshot);
  const screenshotTone: UiTone = screenshot.status === "error" ? "bad" : screenshot.status === "stale" ? "warn" : screenshot.status === "ready" ? "good" : "neutral";
  const screenshotTargetKey = screenshotIsDisplayable ? `${screenshot.src}|${screenshot.updatedAt}` : undefined;

  useEffect(() => {
    if (!selectedArtifact) {
      if (selectedArtifactId) setSelectedArtifactId(undefined);
      return;
    }

    if (selectedArtifact.id !== selectedArtifactId) setSelectedArtifactId(selectedArtifact.id);
  }, [selectedArtifact, selectedArtifactId]);

  useEffect(() => {
    setTapTarget(undefined);
  }, [params.daemonUrl, params.sessionId, screenshotTargetKey]);

  const updateActionFormField = (field: ViewerActionFormField, value: string): void => {
    setActionForm((current) => ({ ...current, [field]: value }));
    if (field === "tapX" || field === "tapY") setTapTarget(undefined);
  };

  const selectScreenshotTapTarget = (target: ScreenshotTapTarget): void => {
    setTapTarget(target);
    setActionForm((current) => ({ ...current, tapX: formatTapCoordinate(target.x), tapY: formatTapCoordinate(target.y) }));
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    applyViewerParams(draft);
  };

  const applyViewerParams = (nextParams: ViewerParams): void => {
    window.history.pushState(null, "", writeViewerSearch(nextParams));
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  const selectSession = (sessionId: string): void => {
    const nextParams = { daemonUrl: params.daemonUrl, sessionId };
    setDraft(nextParams);
    applyViewerParams(nextParams);
  };

  const focusArtifactOption = (artifactId: string): void => {
    window.requestAnimationFrame(() => document.getElementById(artifactOptionId(artifactId))?.focus());
  };

  const selectArtifactAtIndex = (index: number): void => {
    const nextArtifact = filteredArtifacts[index];
    if (!nextArtifact) return;
    setSelectedArtifactId(nextArtifact.id);
    focusArtifactOption(nextArtifact.id);
  };

  const handleArtifactListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (filteredArtifacts.length === 0) return;

    const currentIndex = Math.max(
      0,
      filteredArtifacts.findIndex((artifact) => artifact.id === selectedArtifact?.id)
    );

    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        selectArtifactAtIndex(Math.min(filteredArtifacts.length - 1, currentIndex + 1));
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        selectArtifactAtIndex(Math.max(0, currentIndex - 1));
        break;
      case "Home":
        event.preventDefault();
        selectArtifactAtIndex(0);
        break;
      case "End":
        event.preventDefault();
        selectArtifactAtIndex(filteredArtifacts.length - 1);
        break;
    }
  };

  return (
    <main className="viewer-shell">
      <aside className="rail panel" aria-label="Viewer connection and session list">
        <div className="brand-block">
          <div>
            <p className="kicker">Atlas Loop</p>
            <h1>Runtime evidence</h1>
          </div>
          <span className={`health-dot ${health}`} aria-label={`Daemon ${health}`} title={`Daemon ${health}`} />
        </div>

        <form className="connection-form" onSubmit={submit}>
          <label>
            <span>Daemon URL</span>
            <input
              value={draft.daemonUrl}
              onChange={(event) => setDraft((current) => ({ ...current, daemonUrl: event.target.value }))}
              spellCheck={false}
              aria-label="Daemon URL"
            />
          </label>
          <label>
            <span>Session ID</span>
            <input
              value={draft.sessionId}
              onChange={(event) => setDraft((current) => ({ ...current, sessionId: event.target.value }))}
              spellCheck={false}
              aria-label="Session ID"
            />
          </label>
          <button type="submit">{hasDraftChanges ? "Apply connection" : "Reconnect"}</button>
        </form>

        <section className="session-list" aria-label="Sessions" aria-busy={sessionListStatus === "loading"}>
          <div className="panel-title-row">
            <h2>Sessions</h2>
            <span>{sessionListLabel}</span>
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {sessionListStatusMessage}
          </p>
          <button
            type="button"
            className={`session-row session-choice ${isFollowingLatest ? "selected" : ""} tone-${sessionTone(isFollowingLatest ? session?.status : undefined)}`}
            aria-current={isFollowingLatest ? "true" : undefined}
            onClick={() => selectSession(DEFAULT_SESSION_ID)}
          >
            <div>
              <strong>{DEFAULT_SESSION_ID}</strong>
              <span>{isFollowingLatest && session ? `Following ${session.id}` : "Follow newest session"}</span>
            </div>
            <span className="session-row-meta">
              <small>{isFollowingLatest ? (session?.status ?? "auto") : "auto"}</small>
              <time>{isFollowingLatest && session ? formatDateTime(sessionUpdatedAt(session)) : "--"}</time>
            </span>
          </button>

          <div className="session-browser-list">
            <SessionBrowserContent
              health={health}
              sessions={sessions}
              status={sessionListStatus}
              error={sessionListError}
              selectedSessionId={isFollowingLatest ? undefined : params.sessionId}
              onSelect={selectSession}
            />
          </div>
        </section>

        <section className="status-stack" aria-label="Runtime status">
          <StatusRow label="Daemon" value={health} tone={healthTone(health)} />
          <StatusRow label="Events" value={eventMode} tone={eventModeTone(eventMode)} />
          <StatusRow label="Session" value={session?.status ?? "pending"} tone={sessionTone(session?.status)} />
          <StatusRow label="Storage" value={sessionSummary?.storage.source ?? "--"} tone={sessionSummary?.storage.source === "disk" ? "warn" : "neutral"} />
          <StatusRow label="Warnings" value={String(storageWarnings.length)} tone={storageWarnings.length > 0 ? "warn" : "neutral"} />
          <StatusRow label="Artifacts" value={String(artifacts.length)} tone="neutral" />
        </section>

        {showLastError ? <ErrorNotice message={lastError!} /> : null}
      </aside>

      <section className="stage panel" aria-label="Latest iPhone screenshot">
        <div className="stage-topbar">
          <div>
            <p className="kicker">Live device viewport</p>
            <h2>{selectedSessionId}</h2>
            <span className="stage-subtitle">{session?.app?.bundleId ?? session?.app?.scheme ?? "No app metadata yet"}</span>
          </div>
          <div className="stage-actions">
            <span className={`live-badge tone-${healthTone(health)}`}>{health === "online" ? "live" : health}</span>
            <span className={`session-chip status-${session?.status ?? "pending"}`}>{session?.status ?? "pending"}</span>
          </div>
        </div>

        <div className="device-workbench">
          <div className="viewport-meta" aria-label="Screenshot metadata">
            <MetricTile label="Screenshot" value={screenshot.status} tone={screenshotTone} />
            <MetricTile label="Updated" value={screenshotIsDisplayable ? formatTime(screenshot.updatedAt) : "--"} />
            <MetricTile label="Source" value={screenshotIsDisplayable ? screenshot.source : "--"} />
          </div>

          <div className="phone-stand">
            <div className="phone-frame">
              <div className="phone-speaker" />
              <ScreenshotView
                screenshot={screenshot}
                emptyMessage={isLatestFirstRun ? firstRunState.detail : undefined}
                tapTarget={tapTarget}
                onTapTarget={selectScreenshotTapTarget}
              />
            </div>
          </div>

          <div className="viewport-footer">
            <span>{latestScreenshotArtifact ? `Artifact ${latestScreenshotArtifact.id}` : "No screenshot artifact reported"}</span>
            {screenshotIsDisplayable ? (
              <a href={screenshot.src} target="_blank" rel="noreferrer">
                Open image
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <aside className="inspector panel" aria-label="Session metadata and artifacts">
        <section className="inspector-section">
          <div className="panel-title-row">
            <h2>Evidence inspector</h2>
            <span>{session?.updatedAt ? formatTime(session.updatedAt) : "--"}</span>
          </div>
          {session ? <MetadataGrid session={session} /> : <MetadataSkeleton />}
          {sessionSummary ? <SummaryEvidence summary={sessionSummary} /> : null}
          {session?.error ? <ErrorNotice message={session.error.message} compact /> : null}
        </section>

        <ActionPanel params={params} selectedSessionId={selectedSessionId} form={actionForm} onFieldChange={updateActionFormField} />

        <section className="inspector-section artifact-section">
          <div className="panel-title-row">
            <h2>Artifacts</h2>
            <span>
              {artifacts.length > 0 && filteredArtifacts.length !== artifacts.length
                ? `${filteredArtifacts.length}/${artifacts.length} shown`
                : latestArtifact
                  ? formatDateTime(latestArtifact.createdAt)
                  : "--"}
            </span>
          </div>

          {artifacts.length > 0 ? (
            <div className="evidence-controls">
              <div className="filter-strip" aria-label="Artifact type filters">
                {artifactFilters.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={artifactTypeFilter === option.value ? "selected" : ""}
                    aria-pressed={artifactTypeFilter === option.value}
                    onClick={() => setArtifactTypeFilter(option.value)}
                  >
                    <span>{option.label}</span>
                    <strong>{option.count}</strong>
                  </button>
                ))}
              </div>
              <label className="search-field">
                <span className="sr-only">Search artifacts</span>
                <input value={artifactQuery} onChange={(event) => setArtifactQuery(event.target.value)} placeholder="Search artifacts" />
              </label>
            </div>
          ) : null}

          <div className="artifact-browser">
            {artifacts.length === 0 ? (
              <EmptyState
                title={isLatestFirstRun ? firstRunState.title : "No artifacts yet"}
                detail={
                  isLatestFirstRun
                    ? firstRunState.detail
                    : "Screenshots, logs, traces, and bundles will appear here as the daemon reports them."
                }
              />
            ) : filteredArtifacts.length === 0 ? (
              <EmptyState title="No matching artifacts" detail="Clear the artifact search or switch the type filter to inspect the full evidence set." />
            ) : (
              <>
                <div
                  className="artifact-list"
                  role="listbox"
                  aria-label="Artifacts"
                  aria-orientation="vertical"
                  onKeyDown={handleArtifactListKeyDown}
                >
                  {filteredArtifacts.map((artifact) => (
                    <ArtifactRow
                      key={artifact.id}
                      id={artifactOptionId(artifact.id)}
                      artifact={artifact}
                      selected={selectedArtifact?.id === artifact.id}
                      onSelect={() => setSelectedArtifactId(artifact.id)}
                    />
                  ))}
                </div>
                <ArtifactDetails artifact={selectedArtifact} />
              </>
            )}
          </div>
        </section>
      </aside>

      <section className="timeline-panel panel" aria-label="Action and artifact timeline">
        <div className="panel-title-row">
          <h2>Action timeline</h2>
          <span>{visibleTimeline.length === timeline.length ? `${timeline.length} items` : `${visibleTimeline.length}/${timeline.length} shown`}</span>
        </div>
        {timeline.length > 0 ? (
          <div className="timeline-controls">
            <div className="filter-strip compact" aria-label="Timeline filters">
              {timelineFilters.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={timelineFilter === option.value ? "selected" : ""}
                  aria-pressed={timelineFilter === option.value}
                  onClick={() => setTimelineFilter(option.value)}
                >
                  <span>{option.label}</span>
                  <strong>{option.count}</strong>
                </button>
              ))}
            </div>
            <label className="search-field compact">
              <span className="sr-only">Search timeline</span>
              <input value={timelineQuery} onChange={(event) => setTimelineQuery(event.target.value)} placeholder="Search actions" />
            </label>
          </div>
        ) : null}
        <div className="timeline-strip">
          {timeline.length === 0 ? (
            <EmptyState
              title={isLatestFirstRun ? firstRunState.title : "Waiting for events"}
              detail={
                isLatestFirstRun
                  ? firstRunState.detail
                  : "The bottom rail fills with session state changes, actions, errors, and artifact captures."
              }
              horizontal
            />
          ) : visibleTimeline.length === 0 ? (
            <EmptyState title="No matching actions" detail="Clear the timeline search or switch the filter to bring the action stream back." horizontal />
          ) : (
            visibleTimeline.map((item) => (
              <article className={`timeline-card tone-${item.tone}`} key={item.id}>
                <time>{formatTime(item.at)}</time>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function SessionBrowserContent({
  health,
  sessions,
  status,
  error,
  selectedSessionId,
  onSelect
}: {
  health: HealthState;
  sessions: SessionListItem[];
  status: "loading" | "ready" | "error";
  error?: string;
  selectedSessionId?: string;
  onSelect: (sessionId: string) => void;
}) {
  if (health === "offline") {
    return <EmptyState title="Daemon offline" detail="Start the daemon or paste a reachable daemon URL to browse saved sessions." compact />;
  }

  if (status === "loading") {
    return <EmptyState title="Loading sessions" detail="The viewer is asking the daemon for live and saved sessions." compact />;
  }

  if (status === "error") {
    return <EmptyState title="Session list unavailable" detail={error ?? "The daemon did not return a readable session list."} compact />;
  }

  if (sessions.length === 0) {
    return <EmptyState title="No sessions found" detail="Start an atlas-loop run or keep latest selected until the daemon reports one." compact />;
  }

  return (
    <div role="list">
      {sessions.map((listedSession) => (
        <SessionBrowserRow
          key={listedSession.id}
          session={listedSession}
          selected={listedSession.id === selectedSessionId}
          onSelect={() => onSelect(listedSession.id)}
        />
      ))}
    </div>
  );
}

function SessionBrowserRow({ session, selected, onSelect }: { session: SessionListItem; selected: boolean; onSelect: () => void }) {
  return (
    <div role="listitem">
      <button
        type="button"
        className={`session-row session-choice ${selected ? "selected" : ""} tone-${sessionTone(session.status)}`}
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
      >
        <div>
          <strong>{session.id}</strong>
          <span>{sessionSignal(session)}</span>
        </div>
        <span className="session-row-meta">
          <small>{session.status ?? "unknown"}</small>
          <time>{formatDateTime(sessionUpdatedAt(session))}</time>
        </span>
      </button>
    </div>
  );
}

function ActionPanel({
  params,
  selectedSessionId,
  form,
  onFieldChange
}: {
  params: ViewerParams;
  selectedSessionId: string;
  form: ViewerActionFormState;
  onFieldChange: (field: ViewerActionFormField, value: string) => void;
}) {
  const [submitState, setSubmitState] = useState<ViewerActionSubmitState>({ status: "idle" });
  const actionParams: ViewerParams = { ...params, sessionId: selectedSessionId };
  const isPending = submitState.status === "pending";
  const statusTone = actionSubmitTone(submitState);

  useEffect(() => {
    setSubmitState({ status: "idle" });
  }, [params.daemonUrl, selectedSessionId]);

  const submitAction = async (draft: ViewerActionDraft, label: string): Promise<void> => {
    setSubmitState({ status: "pending", label });
    try {
      const result = await performViewerAction(actionParams, draft);
      if (!result.ok) {
        setSubmitState({ status: "error", label, message: result.error?.message ?? `${label} failed.` });
        return;
      }
      setSubmitState({ status: "success", label, message: actionResultMessage(result) });
    } catch (error) {
      setSubmitState({ status: "error", label, message: error instanceof Error ? error.message : `${label} failed.` });
    }
  };

  const onSubmit = (draft: ViewerActionDraft, label: string) => (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isPending) return;
    void submitAction(draft, label);
  };

  return (
    <section className="inspector-section action-panel" aria-label="Actions" aria-busy={isPending}>
      <div className="panel-title-row">
        <h2>Actions</h2>
        <span>{selectedSessionId}</span>
      </div>

      <div className="action-panel-grid">
        <form className="action-row" onSubmit={onSubmit({ kind: "screenshot", reason: form.screenshotReason }, VIEWER_ACTION_LABELS.screenshot)}>
          <ActionTextInput
            id="action-screenshot-reason"
            label="Reason"
            value={form.screenshotReason}
            placeholder="manual"
            onChange={(value) => onFieldChange("screenshotReason", value)}
          />
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.screenshot} pending={isPending} />
        </form>

        <form className="action-row" onSubmit={onSubmit({ kind: "wait", durationMs: form.waitDurationMs }, VIEWER_ACTION_LABELS.wait)}>
          <ActionNumberInput
            id="action-wait-duration"
            label="Duration ms"
            value={form.waitDurationMs}
            min={0}
            step={100}
            onChange={(value) => onFieldChange("waitDurationMs", value)}
          />
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.wait} pending={isPending} />
        </form>

        <form className="action-row" onSubmit={onSubmit({ kind: "tap", x: form.tapX, y: form.tapY }, VIEWER_ACTION_LABELS.tap)}>
          <div className="action-coordinate-pair">
            <ActionNumberInput
              id="action-tap-x"
              label="X 0-1"
              value={form.tapX}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("tapX", value)}
            />
            <ActionNumberInput
              id="action-tap-y"
              label="Y 0-1"
              value={form.tapY}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("tapY", value)}
            />
          </div>
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.tap} pending={isPending} />
        </form>

        <form className="action-row" onSubmit={onSubmit({ kind: "typeText", text: form.typeText }, VIEWER_ACTION_LABELS.typeText)}>
          <ActionTextInput
            id="action-type-text"
            label="Text"
            value={form.typeText}
            placeholder="Hello"
            onChange={(value) => onFieldChange("typeText", value)}
          />
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.typeText} pending={isPending} />
        </form>

        <form
          className="action-row action-row-wide"
          onSubmit={onSubmit(
            {
              kind: "swipe",
              from: { x: form.swipeFromX, y: form.swipeFromY },
              to: { x: form.swipeToX, y: form.swipeToY },
              durationMs: form.swipeDurationMs
            },
            VIEWER_ACTION_LABELS.swipe
          )}
        >
          <div className="action-swipe-grid">
            <ActionNumberInput
              id="action-swipe-from-x"
              label="From X 0-1"
              value={form.swipeFromX}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeFromX", value)}
            />
            <ActionNumberInput
              id="action-swipe-from-y"
              label="From Y 0-1"
              value={form.swipeFromY}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeFromY", value)}
            />
            <ActionNumberInput
              id="action-swipe-to-x"
              label="To X 0-1"
              value={form.swipeToX}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeToX", value)}
            />
            <ActionNumberInput
              id="action-swipe-to-y"
              label="To Y 0-1"
              value={form.swipeToY}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) => onFieldChange("swipeToY", value)}
            />
            <ActionNumberInput
              id="action-swipe-duration"
              label="Duration ms"
              value={form.swipeDurationMs}
              min={0}
              step={50}
              onChange={(value) => onFieldChange("swipeDurationMs", value)}
            />
          </div>
          <ActionSubmitButton label={VIEWER_ACTION_LABELS.swipe} pending={isPending} />
        </form>
      </div>

      <div className={`action-status tone-${statusTone}`} role="status" aria-live="polite" aria-atomic="true">
        <strong>{actionStatusTitle(submitState)}</strong>
        <span>{actionStatusMessage(submitState)}</span>
      </div>
    </section>
  );
}

function ActionNumberInput({
  id,
  label,
  value,
  min,
  max,
  step,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  min?: number;
  max?: number;
  step: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="action-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        required
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ActionTextInput({
  id,
  label,
  value,
  placeholder,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="action-field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ActionSubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Pending" : label}
    </button>
  );
}

function ScreenshotView({
  screenshot,
  emptyMessage,
  tapTarget,
  onTapTarget
}: {
  screenshot: ScreenshotState;
  emptyMessage?: string;
  tapTarget?: ScreenshotTapTarget;
  onTapTarget: (target: ScreenshotTapTarget) => void;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const image = imageRef.current;
    if (!image) return;

    const target = screenshotTapTargetFromClientPoint(image, event.clientX, event.clientY);
    if (!target) return;
    event.preventDefault();
    onTapTarget(target);
  };

  if (isDisplayableScreenshot(screenshot)) {
    const targetStyle = tapTarget
      ? ({
          "--target-left": `${tapTarget.markerLeftPercent}%`,
          "--target-top": `${tapTarget.markerTopPercent}%`
        } as ScreenshotTargetStyle)
      : undefined;

    return (
      <button
        type="button"
        className={`screenshot-image-wrap ${screenshot.status}`}
        aria-label="Select normalized tap target from screenshot"
        onPointerDown={handlePointerDown}
      >
        <img
          ref={imageRef}
          className="screenshot-image"
          src={screenshot.src}
          alt={screenshot.status === "stale" ? "Stale iOS Simulator screenshot" : "Latest iOS Simulator screenshot"}
          draggable={false}
        />
        {tapTarget ? (
          <>
            <span className="screenshot-target-readout" role="status" aria-live="polite" aria-atomic="true">
              {tapTarget.label}
            </span>
            <span className="screenshot-target-marker" style={targetStyle} aria-hidden="true" />
          </>
        ) : null}
        {screenshot.status === "stale" ? (
          <span className="screenshot-stale-banner" role="status" aria-live="polite" aria-atomic="true">
            <strong>Stale image</strong>
            <span>{`Refresh failed: ${screenshot.message}`}</span>
          </span>
        ) : null}
      </button>
    );
  }

  const message =
    screenshot.status === "loading"
      ? "Loading latest screenshot..."
      : screenshot.status === "empty"
        ? (emptyMessage ?? screenshot.message)
        : (emptyMessage ?? `Screenshot unavailable: ${screenshot.message}`);

  return (
    <div className={`screenshot-placeholder ${screenshot.status}`} role="status" aria-live="polite" aria-atomic="true">
      {screenshot.status === "loading" ? (
        <div className="screenshot-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      <span>{message}</span>
    </div>
  );
}

function MetadataGrid({ session }: { session: Session }) {
  return (
    <dl className="meta-grid">
      <dt>Simulator</dt>
      <dd>{session.simulator?.name ?? "--"}</dd>
      <dt>Runtime</dt>
      <dd>{session.simulator?.runtime ?? "--"}</dd>
      <dt>Backend</dt>
      <dd>{session.backend ?? "--"}</dd>
      <dt>Bundle</dt>
      <dd>{session.app?.bundleId ?? "--"}</dd>
      <dt>Workspace</dt>
      <dd>{session.app?.workspacePath ?? session.app?.projectPath ?? "--"}</dd>
      <dt>Created</dt>
      <dd>{formatDateTime(session.createdAt)}</dd>
      <dt>Artifact dir</dt>
      <dd>{session.artifactDir ?? "--"}</dd>
    </dl>
  );
}

function MetadataSkeleton() {
  return (
    <div className="meta-skeleton" aria-label="Loading metadata">
      {Array.from({ length: 6 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function SummaryEvidence({ summary }: { summary: SessionSummary }) {
  const latestAction = summary.events.latestAction;
  const latestError = summary.events.latestError;
  const warnings = summary.storage.warnings ?? [];

  return (
    <section className="summary-evidence" aria-label="Evidence storage summary">
      <div className="summary-evidence-grid">
        <div>
          <span>Storage</span>
          <strong>{summary.storage.source}</strong>
          <small>{summary.storage.artifactBacked ? "artifact-backed" : "not artifact-backed"}</small>
        </div>
        <div>
          <span>Events</span>
          <strong>{summary.events.total}</strong>
          <small>{latestAction ? `${latestAction.ok ? "last passed" : "last failed"} at ${formatDateTime(latestAction.endedAt)}` : "no action results"}</small>
        </div>
        <div>
          <span>Artifacts</span>
          <strong>{summary.artifacts.total}</strong>
          <small>{summary.artifacts.latestScreenshotId ? `latest ${summary.artifacts.latestScreenshotId}` : "no screenshots"}</small>
        </div>
      </div>

      {latestError ? <ErrorNotice message={`${latestError.code ?? "ERROR"}: ${latestError.message}`} compact /> : null}

      {warnings.length > 0 ? (
        <div className="warning-list" role="status" aria-live="polite">
          <strong>{warnings.length} evidence warning{warnings.length === 1 ? "" : "s"}</strong>
          <ul>
            {warnings.slice(0, 3).map((warning) => (
              <li key={`${warning.path}:${warning.message}`}>
                <span>{warning.message}</span>
                <code>{warning.path}</code>
              </li>
            ))}
          </ul>
          {warnings.length > 3 ? <small>+{warnings.length - 3} more warning{warnings.length - 3 === 1 ? "" : "s"}</small> : null}
        </div>
      ) : null}
    </section>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: UiTone }) {
  return (
    <div className={`status-row tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: UiTone }) {
  return (
    <div className={`metric-tile tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function artifactOptionId(artifactId: string): string {
  return `artifact-option-${artifactId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

function ArtifactRow({ id, artifact, selected, onSelect }: { id: string; artifact: ArtifactRef; selected: boolean; onSelect: () => void }) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      className={`artifact-row ${selected ? "selected" : ""}`}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
    >
      <span className="artifact-row-top">
        <span className="artifact-type">{artifact.type}</span>
        <small>{formatDateTime(artifact.createdAt)}</small>
      </span>
      <strong>{artifactDisplayName(artifact)}</strong>
      <small>{artifact.path}</small>
    </button>
  );
}

function ArtifactDetails({ artifact }: { artifact: ArtifactRef | undefined }) {
  if (!artifact) {
    return <EmptyState title="No artifact selected" detail="Select an artifact from the list to inspect path, hash, and metadata details." />;
  }

  const href = artifact.url;
  const rows = artifactDetailRows(artifact);

  return (
    <section className="artifact-detail" aria-label="Selected artifact details">
      <div className="artifact-detail-head">
        <div>
          <span className="artifact-type">{artifact.type}</span>
          <strong>{artifactDisplayName(artifact)}</strong>
        </div>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : (
          <span>Path only</span>
        )}
      </div>
      <dl className="artifact-detail-grid">
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd className={row.mono ? "mono" : ""}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function EmptyState({ title, detail, horizontal = false, compact = false }: { title: string; detail: string; horizontal?: boolean; compact?: boolean }) {
  return (
    <div className={`empty-state ${horizontal ? "horizontal" : ""} ${compact ? "compact" : ""}`}>
      <span className="empty-glyph" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function ErrorNotice({ message, compact = false }: { message: string; compact?: boolean }) {
  return (
    <p className={`inline-error ${compact ? "compact" : ""}`} role="alert" aria-live="assertive">
      {message}
    </p>
  );
}

function actionResultMessage(result: ActionResultLike): string {
  const artifactCount = result.artifacts?.length ?? 0;
  const artifactLabel = artifactCount === 1 ? "1 artifact" : `${artifactCount} artifacts`;
  return `${result.actionId} completed, ${artifactLabel}.`;
}

function actionSubmitTone(state: ViewerActionSubmitState): UiTone {
  if (state.status === "success") return "good";
  if (state.status === "error") return "bad";
  if (state.status === "pending") return "warn";
  return "neutral";
}

function actionStatusTitle(state: ViewerActionSubmitState): string {
  if (state.status === "idle") return "Ready";
  if (state.status === "pending") return `${state.label} pending`;
  if (state.status === "success") return `${state.label} complete`;
  return `${state.label} failed`;
}

function actionStatusMessage(state: ViewerActionSubmitState): string {
  if (state.status === "idle") return "No action submitted.";
  if (state.status === "pending") return "Waiting for daemon response.";
  return state.message;
}
