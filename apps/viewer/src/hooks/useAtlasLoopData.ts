import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchArtifactHealth,
  fetchArtifacts,
  fetchEvents,
  fetchHealth,
  fetchLatestScreenshot,
  fetchSession,
  fetchSessionSummary,
  fetchSessions,
  markScreenshotFetchFailed,
  mergeScreenshotFetchResult,
  screenshotArtifactIdentity,
  screenshotObjectUrl
} from "../api.js";
import { buildTimelineItems, mergeTraceEvents, sortArtifacts } from "../timeline.js";
import type {
  ArtifactHealth,
  ArtifactRef,
  HealthState,
  ScreenshotState,
  Session,
  SessionHistoryItem,
  SessionSummary,
  TraceEvent,
  ViewerParams
} from "../types.js";
import { sortSessionList, type ArtifactHealthStatus } from "../viewerPresentation.js";
import { buildSessionUrl, readViewerParams } from "../viewerParams.js";

const TRACE_EVENT_TYPES = [
  "session.created",
  "session.statusChanged",
  "action.started",
  "action.completed",
  "artifact.created",
  "error"
];

export function useViewerParams(): ViewerParams {
  const readCurrentParams = (): ViewerParams => readViewerParams(window.location.search, window.location.origin);
  const [params, setParams] = useState(readCurrentParams);

  useEffect(() => {
    const handlePopState = (): void => setParams(readCurrentParams());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return params;
}

export function useAtlasLoopData(params: ViewerParams) {
  const [health, setHealth] = useState<HealthState>("checking");
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
  const [sessionListStatus, setSessionListStatus] = useState<"loading" | "ready" | "error">("loading");
  const [sessionListError, setSessionListError] = useState<string | undefined>();
  const [session, setSession] = useState<Session | undefined>();
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | undefined>();
  const [artifactHealth, setArtifactHealth] = useState<ArtifactHealth | undefined>();
  const [artifactHealthStatus, setArtifactHealthStatus] = useState<ArtifactHealthStatus>("loading");
  const [artifactHealthError, setArtifactHealthError] = useState<string | undefined>();
  const [artifacts, setArtifacts] = useState<ArtifactRef[]>([]);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [screenshot, setScreenshot] = useState<ScreenshotState>({ status: "loading" });
  const [screenshotRetryNonce, setScreenshotRetryNonce] = useState(0);
  const [eventMode, setEventMode] = useState<"connecting" | "sse" | "polling">("connecting");
  const [lastError, setLastError] = useState<string | undefined>();
  const screenshotUrlRef = useRef<string | undefined>(undefined);
  const resolvedScreenshotKeyRef = useRef<string | undefined>(undefined);
  const latestScreenshotKey = useMemo(() => screenshotArtifactIdentity(sessionSummary, artifacts), [sessionSummary, artifacts]);
  const artifactHealthRefreshKey = [
    session?.id,
    session?.status,
    session?.updatedAt,
    sessionSummary?.artifacts.total,
    sessionSummary?.events.total,
    latestScreenshotKey
  ].join("|");

  useEffect(() => {
    setHealth("checking");
    setSessions([]);
    setSessionListStatus("loading");
    setSessionListError(undefined);
  }, [params.daemonUrl]);

  useEffect(() => {
    setSession(undefined);
    setSessionSummary(undefined);
    setArtifactHealth(undefined);
    setArtifactHealthStatus("loading");
    setArtifactHealthError(undefined);
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
    if (health === "checking") {
      setArtifactHealthStatus("loading");
      setArtifactHealthError(undefined);
      return;
    }

    if (health === "offline") {
      setArtifactHealth(undefined);
      setArtifactHealthStatus("offline");
      setArtifactHealthError("Daemon is offline or not reachable.");
      return;
    }

    const controller = new AbortController();
    let loading = false;

    const load = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      setArtifactHealthStatus((current) => (current === "ready" ? current : "loading"));
      setArtifactHealthError(undefined);

      try {
        const nextHealth = await fetchArtifactHealth(params, controller.signal);
        if (controller.signal.aborted) return;
        setArtifactHealth(nextHealth);
        setArtifactHealthStatus("ready");
      } catch (error) {
        if (controller.signal.aborted) return;
        setArtifactHealth(undefined);
        setArtifactHealthStatus("error");
        setArtifactHealthError(error instanceof Error ? error.message : "Failed to load artifact health.");
      } finally {
        loading = false;
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [health, params.daemonUrl, params.sessionId, artifactHealthRefreshKey]);

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
    artifactHealth,
    artifactHealthStatus,
    artifactHealthError,
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
