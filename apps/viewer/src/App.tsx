import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArtifacts,
  fetchEvents,
  fetchHealth,
  fetchLatestScreenshot,
  fetchSession,
  fetchSessions
} from "./api.js";
import { buildTimelineItems, mergeTraceEvents, sortArtifacts } from "./timeline.js";
import type { ArtifactRef, HealthState, ScreenshotState, Session, SessionListItem, TraceEvent, ViewerParams } from "./types.js";
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
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ status: "loading" });
  const [eventMode, setEventMode] = useState<"connecting" | "sse" | "polling">("connecting");
  const [lastError, setLastError] = useState<string | undefined>();
  const screenshotUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setHealth("checking");
    setSessions([]);
    setSessionListStatus("loading");
    setSessionListError(undefined);
  }, [params.daemonUrl]);

  useEffect(() => {
    setSession(undefined);
    setArtifacts([]);
    setEvents([]);
    setScreenshot({ status: "loading" });
    setEventMode("connecting");
    setLastError(undefined);
  }, [params.daemonUrl, params.sessionId]);

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
        const [nextSession, nextArtifacts] = await Promise.all([
          fetchSession(params, controller.signal),
          fetchArtifacts(params, controller.signal)
        ]);
        if (controller.signal.aborted) return;
        setSession(nextSession);
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

    const load = async (): Promise<void> => {
      try {
        const nextScreenshot = await fetchLatestScreenshot(params, controller.signal);
        if (controller.signal.aborted) return;
        setScreenshot((previous) => {
          const nextBlobUrl = nextScreenshot.status === "ready" && nextScreenshot.source === "blob" ? nextScreenshot.src : undefined;
          if (previous.status === "ready" && previous.source === "blob" && previous.src !== nextBlobUrl) {
            URL.revokeObjectURL(previous.src);
          }
          if (nextBlobUrl) {
            screenshotUrlRef.current = nextBlobUrl;
          } else {
            screenshotUrlRef.current = undefined;
          }
          return nextScreenshot;
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setScreenshot({
          status: "error",
          message: error instanceof Error ? error.message : "Failed to load screenshot."
        });
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 1200);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      if (screenshotUrlRef.current) URL.revokeObjectURL(screenshotUrlRef.current);
      screenshotUrlRef.current = undefined;
    };
  }, [params.daemonUrl, params.sessionId]);

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

export function App() {
  const params = useViewerParams();
  const { health, sessions, sessionListStatus, sessionListError, session, artifacts, screenshot, eventMode, lastError, timeline } =
    useAtlasLoopData(params);
  const [draft, setDraft] = useState(params);
  const [artifactTypeFilter, setArtifactTypeFilter] = useState("all");
  const [artifactQuery, setArtifactQuery] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>();
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [timelineQuery, setTimelineQuery] = useState("");

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
  const selectedArtifact = useMemo(
    () => filteredArtifacts.find((artifact) => artifact.id === selectedArtifactId) ?? filteredArtifacts[0],
    [filteredArtifacts, selectedArtifactId]
  );
  const showLastError = Boolean(lastError && !(isLatestFirstRun && (health !== "online" || /^404\b/.test(lastError))));

  useEffect(() => {
    if (!selectedArtifact) {
      if (selectedArtifactId) setSelectedArtifactId(undefined);
      return;
    }

    if (selectedArtifact.id !== selectedArtifactId) setSelectedArtifactId(selectedArtifact.id);
  }, [selectedArtifact, selectedArtifactId]);

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

          <div className="session-browser-list" role="list">
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
            <MetricTile label="Screenshot" value={screenshot.status} tone={screenshot.status === "error" ? "bad" : screenshot.status === "ready" ? "good" : "neutral"} />
            <MetricTile label="Updated" value={screenshot.status === "ready" ? formatTime(screenshot.updatedAt) : "--"} />
            <MetricTile label="Source" value={screenshot.status === "ready" ? screenshot.source : "--"} />
          </div>

          <div className="phone-stand">
            <div className="phone-frame">
              <div className="phone-speaker" />
              <ScreenshotView screenshot={screenshot} emptyMessage={isLatestFirstRun ? firstRunState.detail : undefined} />
            </div>
          </div>

          <div className="viewport-footer">
            <span>{latestScreenshotArtifact ? `Artifact ${latestScreenshotArtifact.id}` : "No screenshot artifact reported"}</span>
            {screenshot.status === "ready" ? (
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
          {session?.error ? <ErrorNotice message={session.error.message} compact /> : null}
        </section>

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
                <div className="artifact-list">
                  {filteredArtifacts.map((artifact) => (
                    <ArtifactRow
                      key={artifact.id}
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
    <>
      {sessions.map((listedSession) => (
        <SessionBrowserRow
          key={listedSession.id}
          session={listedSession}
          selected={listedSession.id === selectedSessionId}
          onSelect={() => onSelect(listedSession.id)}
        />
      ))}
    </>
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

function ScreenshotView({ screenshot, emptyMessage }: { screenshot: ScreenshotState; emptyMessage?: string }) {
  if (screenshot.status === "ready") {
    return <img className="screenshot-image" src={screenshot.src} alt="Latest iOS Simulator screenshot" />;
  }

  const message =
    screenshot.status === "loading"
      ? "Loading latest screenshot..."
      : screenshot.status === "empty"
        ? (emptyMessage ?? screenshot.message)
        : (emptyMessage ?? `Screenshot unavailable: ${screenshot.message}`);

  return (
    <div className={`screenshot-placeholder ${screenshot.status}`}>
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

function ArtifactRow({ artifact, selected, onSelect }: { artifact: ArtifactRef; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`artifact-row ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onSelect}>
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
  return <p className={`inline-error ${compact ? "compact" : ""}`}>{message}</p>;
}
