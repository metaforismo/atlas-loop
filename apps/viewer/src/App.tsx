import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArtifacts,
  fetchEvents,
  fetchHealth,
  fetchLatestScreenshot,
  fetchSession,
  toResourceUrl
} from "./api.js";
import { buildTimelineItems, mergeTraceEvents, sortArtifacts } from "./timeline.js";
import type { ArtifactRef, HealthState, ScreenshotState, Session, TraceEvent, ViewerParams } from "./types.js";
import {
  eventModeTone,
  formatDateTime,
  formatTime,
  healthTone,
  latestArtifactOfType,
  sessionTone,
  summarizeArtifacts,
  type UiTone
} from "./viewerPresentation.js";
import { buildSessionUrl, readViewerParams, writeViewerSearch } from "./viewerParams.js";

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
  const [session, setSession] = useState<Session | undefined>();
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ status: "loading" });
  const [eventMode, setEventMode] = useState<"connecting" | "sse" | "polling">("connecting");
  const [lastError, setLastError] = useState<string | undefined>();
  const screenshotUrlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    setHealth("checking");
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
      if (!online) setLastError("Daemon is offline or not reachable.");
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
  const { health, session, artifacts, screenshot, eventMode, lastError, timeline } = useAtlasLoopData(params);
  const [draft, setDraft] = useState(params);

  useEffect(() => {
    setDraft(params);
  }, [params]);

  const latestArtifact = artifacts[0];
  const latestScreenshotArtifact = useMemo(() => latestArtifactOfType(artifacts, "screenshot"), [artifacts]);
  const artifactSummaries = useMemo(() => summarizeArtifacts(artifacts), [artifacts]);
  const selectedSessionId = session?.id ?? params.sessionId;
  const hasDraftChanges = draft.daemonUrl !== params.daemonUrl || draft.sessionId !== params.sessionId;

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    window.history.pushState(null, "", writeViewerSearch(draft));
    window.dispatchEvent(new PopStateEvent("popstate"));
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

        <section className="session-list" aria-label="Sessions">
          <div className="panel-title-row">
            <h2>Session focus</h2>
            <span>{eventMode}</span>
          </div>
          <article className={`session-row tone-${sessionTone(session?.status)}`} aria-current="true">
            <div>
              <strong>{selectedSessionId}</strong>
              <span>{session?.simulator?.name ?? "Waiting for simulator metadata"}</span>
            </div>
            <small>{session?.status ?? "pending"}</small>
          </article>
          <p className="hint-text">Point this panel at a session ID or keep `latest` to follow the newest local run.</p>
        </section>

        <section className="status-stack" aria-label="Runtime status">
          <StatusRow label="Daemon" value={health} tone={healthTone(health)} />
          <StatusRow label="Events" value={eventMode} tone={eventModeTone(eventMode)} />
          <StatusRow label="Session" value={session?.status ?? "pending"} tone={sessionTone(session?.status)} />
          <StatusRow label="Artifacts" value={String(artifacts.length)} tone="neutral" />
        </section>

        {lastError ? <ErrorNotice message={lastError} /> : null}
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
              <ScreenshotView screenshot={screenshot} />
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
            <span>{latestArtifact ? formatDateTime(latestArtifact.createdAt) : "--"}</span>
          </div>

          {artifactSummaries.length > 0 ? (
            <div className="artifact-counts">
              {artifactSummaries.map((summary) => (
                <span key={summary.type}>
                  <strong>{summary.count}</strong> {summary.type}
                </span>
              ))}
            </div>
          ) : null}

          <div className="artifact-list">
            {artifacts.length === 0 ? (
              <EmptyState title="No artifacts yet" detail="Screenshots, logs, traces, and bundles will appear here as the daemon reports them." />
            ) : (
              artifacts.slice(0, 12).map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} daemonUrl={params.daemonUrl} />)
            )}
          </div>
        </section>
      </aside>

      <section className="timeline-panel panel" aria-label="Action and artifact timeline">
        <div className="panel-title-row">
          <h2>Action timeline</h2>
          <span>{timeline.length} items</span>
        </div>
        <div className="timeline-strip">
          {timeline.length === 0 ? (
            <EmptyState title="Waiting for events" detail="The bottom rail fills with session state changes, actions, errors, and artifact captures." horizontal />
          ) : (
            timeline.map((item) => (
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

function ScreenshotView({ screenshot }: { screenshot: ScreenshotState }) {
  if (screenshot.status === "ready") {
    return <img className="screenshot-image" src={screenshot.src} alt="Latest iOS Simulator screenshot" />;
  }

  const message =
    screenshot.status === "loading"
      ? "Loading latest screenshot..."
      : screenshot.status === "empty"
        ? screenshot.message
        : `Screenshot unavailable: ${screenshot.message}`;

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

function ArtifactRow({ artifact, daemonUrl }: { artifact: ArtifactRef; daemonUrl: string }) {
  const href = artifact.url ?? (artifact.path.startsWith("/") ? toResourceUrl(artifact.path, daemonUrl) : undefined);
  const body = (
    <>
      <span className="artifact-type">{artifact.type}</span>
      <strong>{artifact.path}</strong>
      <small>{formatDateTime(artifact.createdAt)}</small>
    </>
  );

  return href ? (
    <a className="artifact-row" href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <div className="artifact-row">{body}</div>
  );
}

function EmptyState({ title, detail, horizontal = false }: { title: string; detail: string; horizontal?: boolean }) {
  return (
    <div className={`empty-state ${horizontal ? "horizontal" : ""}`}>
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
