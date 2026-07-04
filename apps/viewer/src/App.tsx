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
  const artifactCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const artifact of artifacts) counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [artifacts]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    window.history.pushState(null, "", writeViewerSearch(draft));
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <main className="viewer-shell">
      <aside className="rail panel">
        <div className="brand-block">
          <div>
            <p className="kicker">Atlas Loop</p>
            <h1>Live Viewer</h1>
          </div>
          <span className={`health-dot ${health}`} aria-label={`Daemon ${health}`} />
        </div>

        <form className="connection-form" onSubmit={submit}>
          <label>
            Daemon URL
            <input
              value={draft.daemonUrl}
              onChange={(event) => setDraft((current) => ({ ...current, daemonUrl: event.target.value }))}
              spellCheck={false}
            />
          </label>
          <label>
            Session ID
            <input
              value={draft.sessionId}
              onChange={(event) => setDraft((current) => ({ ...current, sessionId: event.target.value }))}
              spellCheck={false}
            />
          </label>
          <button type="submit">Connect</button>
        </form>

        <section className="status-stack" aria-label="Session status">
          <StatusRow label="Daemon" value={health} tone={health === "online" ? "good" : health === "offline" ? "bad" : "warn"} />
          <StatusRow label="Events" value={eventMode} tone={eventMode === "sse" ? "good" : "warn"} />
          <StatusRow label="Session" value={session?.status ?? "pending"} tone={session?.status === "failed" ? "bad" : session?.status === "running" ? "good" : "neutral"} />
          <StatusRow label="Artifacts" value={String(artifacts.length)} tone="neutral" />
        </section>

        {lastError ? <p className="inline-error">{lastError}</p> : null}
      </aside>

      <section className="stage panel" aria-label="Latest iPhone screenshot">
        <div className="stage-topbar">
          <div>
            <p className="kicker">Session</p>
            <h2>{session?.id ?? params.sessionId}</h2>
          </div>
          <span className={`session-chip status-${session?.status ?? "pending"}`}>{session?.status ?? "pending"}</span>
        </div>

        <div className="phone-stand">
          <div className="phone-frame">
            <div className="phone-speaker" />
            <ScreenshotView screenshot={screenshot} />
          </div>
        </div>
      </section>

      <aside className="inspector panel" aria-label="Session metadata and artifacts">
        <section>
          <div className="panel-title-row">
            <h2>Metadata</h2>
            <span>{session?.updatedAt ? formatTime(session.updatedAt) : "--"}</span>
          </div>
          <dl className="meta-grid">
            <dt>Simulator</dt>
            <dd>{session?.simulator?.name ?? "--"}</dd>
            <dt>Runtime</dt>
            <dd>{session?.simulator?.runtime ?? "--"}</dd>
            <dt>Backend</dt>
            <dd>{session?.backend ?? "--"}</dd>
            <dt>Bundle</dt>
            <dd>{session?.app?.bundleId ?? "--"}</dd>
            <dt>Artifact dir</dt>
            <dd>{session?.artifactDir ?? "--"}</dd>
          </dl>
        </section>

        <section>
          <div className="panel-title-row">
            <h2>Artifacts</h2>
            <span>{latestArtifact ? formatTime(latestArtifact.createdAt) : "--"}</span>
          </div>

          {artifactCounts.length > 0 ? (
            <div className="artifact-counts">
              {artifactCounts.map(([type, count]) => (
                <span key={type}>
                  {type} {count}
                </span>
              ))}
            </div>
          ) : null}

          <div className="artifact-list">
            {artifacts.length === 0 ? (
              <p className="muted">No artifacts reported.</p>
            ) : (
              artifacts.slice(0, 8).map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} daemonUrl={params.daemonUrl} />)
            )}
          </div>
        </section>
      </aside>

      <section className="timeline-panel panel" aria-label="Action and artifact timeline">
        <div className="panel-title-row">
          <h2>Timeline</h2>
          <span>{timeline.length} item(s)</span>
        </div>
        <div className="timeline-strip">
          {timeline.length === 0 ? (
            <p className="muted">Waiting for actions, events, or artifacts.</p>
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
      <span>{message}</span>
    </div>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: "neutral" | "good" | "warn" | "bad" }) {
  return (
    <div className={`status-row tone-${tone}`}>
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
      <small>{formatTime(artifact.createdAt)}</small>
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

function formatTime(value: string | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
