import { useEffect, useMemo, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { isDisplayableScreenshot } from "./api.js";
import {
  ARTIFACT_KIND_LABELS,
  ArtifactDetails,
  ArtifactRow,
  artifactKind,
  artifactKindClassName,
  artifactOptionId,
  timelineArtifactId,
  timelineKindClassName,
  timelineSourceLabel
} from "./components/ArtifactBrowser.js";
import {
  ActionPanel,
  DEFAULT_ACTION_FORM,
  getActionMutationState,
  type ViewerActionFormField,
  type ViewerActionFormState
} from "./components/ActionPanel.js";
import { AtlasView } from "./atlas/AtlasView.js";
import { ActionDetailPanel } from "./components/ActionDetailPanel.js";
import { EmptyState, ErrorNotice, MetricTile, StatusRow } from "./components/common.js";
import { ImageLightbox } from "./components/ImageLightbox.js";
import { EvidenceHealthPanel } from "./components/EvidenceHealthPanel.js";
import { AgentHandoffPanel } from "./components/HandoffPanel.js";
import { MetadataGrid, MetadataSkeleton, SummaryEvidence } from "./components/MetadataPanel.js";
import { MetricsPanel } from "./components/MetricsPanel.js";
import { ReplayPanel } from "./components/ReplayPanel.js";
import { ScreenshotView } from "./components/ScreenshotView.js";
import { SessionBrowserContent } from "./components/SessionBrowser.js";
import { useAtlasLoopData, useViewerParams } from "./hooks/useAtlasLoopData.js";
import { formatTapCoordinate, type ScreenshotTapTarget } from "./screenshotGeometry.js";
import type { ViewerParams } from "./types.js";
import {
  artifactTypeOptions,
  buildActionEvidencePairs,
  buildAgentHandoffBrief,
  buildVideoReplayModel,
  eventModeTone,
  filterArtifacts,
  filterTimelineItems,
  formatDateTime,
  formatTime,
  healthTone,
  latestArtifactOfType,
  latestSessionEmptyState,
  sessionTone,
  sessionUpdatedAt,
  timelineFilterOptions,
  type TimelineFilter,
  type UiTone
} from "./viewerPresentation.js";
import { DEFAULT_SESSION_ID, writeViewerSearch } from "./viewerParams.js";

export function App() {
  const params = useViewerParams();
  const {
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
    timeline
  } = useAtlasLoopData(params);
  const [draft, setDraft] = useState(params);
  const [artifactTypeFilter, setArtifactTypeFilter] = useState("all");
  const [artifactQuery, setArtifactQuery] = useState("");
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | undefined>();
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [timelineQuery, setTimelineQuery] = useState("");
  const [actionForm, setActionForm] = useState<ViewerActionFormState>(DEFAULT_ACTION_FORM);
  const [tapTarget, setTapTarget] = useState<ScreenshotTapTarget | undefined>();
  const [selectedActionId, setSelectedActionId] = useState<string | undefined>();
  const [stageZoomed, setStageZoomed] = useState(false);

  useEffect(() => {
    setDraft(params);
  }, [params]);

  useEffect(() => {
    setArtifactTypeFilter("all");
    setArtifactQuery("");
    setSelectedArtifactId(undefined);
    setSelectedActionId(undefined);
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
  const actionMutationState = useMemo(
    () => getActionMutationState(health, sessionSummary?.storage.source, session?.status),
    [health, sessionSummary?.storage.source, session?.status]
  );
  const replayModel = useMemo(() => buildVideoReplayModel(artifacts, events), [artifacts, events]);
  const actionEvidencePairs = useMemo(() => buildActionEvidencePairs(events, artifacts), [events, artifacts]);
  const handoffBrief = useMemo(
    () =>
      buildAgentHandoffBrief({
        health,
        params,
        session,
        sessionSummary,
        artifactHealth,
        artifactHealthStatus,
        artifactHealthError,
        screenshot,
        artifacts,
        events
      }),
    [health, params, session, sessionSummary, artifactHealth, artifactHealthStatus, artifactHealthError, screenshot, artifacts, events]
  );

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

  const selectArtifactFromTimeline = (artifactId: string): void => {
    setArtifactTypeFilter("all");
    setArtifactQuery("");
    setSelectedArtifactId(artifactId);
    focusArtifactOption(artifactId);
  };

  if (params.view === "atlas") {
    return (
      <AtlasView
        params={params}
        onSwitchToSessions={() => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId })}
        onOpenSession={(sessionId) => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId })}
      />
    );
  }

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

        <button
          type="button"
          className="atlas-switch"
          onClick={() => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, view: "atlas" })}
        >
          Atlas map →
        </button>

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
              <span className="viewport-footer-actions">
                <button type="button" onClick={() => setStageZoomed(true)}>
                  Zoom
                </button>
                <a href={screenshot.src} target="_blank" rel="noreferrer">
                  Open image
                </a>
              </span>
            ) : null}
          </div>
          {stageZoomed && screenshotIsDisplayable ? (
            <ImageLightbox
              src={screenshot.src}
              alt="Latest simulator screenshot"
              caption={latestScreenshotArtifact?.path}
              onClose={() => setStageZoomed(false)}
            />
          ) : null}

          {replayModel ? <ReplayPanel replay={replayModel} /> : null}
          <MetricsPanel params={params} sessionStatus={session?.status} events={events} />
        </div>
      </section>

      <aside className="inspector panel" aria-label="Session metadata and artifacts">
        <section className="inspector-section session-overview">
          <div className="panel-title-row">
            <h2>Evidence inspector</h2>
            <span>{session?.updatedAt ? formatTime(session.updatedAt) : "--"}</span>
          </div>
          {session ? <MetadataGrid session={session} /> : <MetadataSkeleton />}
          {sessionSummary ? <SummaryEvidence summary={sessionSummary} /> : null}
          <ActionDetailPanel pairs={actionEvidencePairs} selectedActionId={selectedActionId} onSelect={setSelectedActionId} />
          <AgentHandoffPanel brief={handoffBrief} />
          <EvidenceHealthPanel health={artifactHealth} status={artifactHealthStatus} error={artifactHealthError} />
          {session?.error ? <ErrorNotice message={session.error.message} compact /> : null}
        </section>

        <ActionPanel
          params={params}
          selectedSessionId={selectedSessionId}
          mutationState={actionMutationState}
          form={actionForm}
          onFieldChange={updateActionFormField}
        />

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
            visibleTimeline.map((item) => {
              const artifactId = timelineArtifactId(item, artifacts);
              const artifact = artifactId ? artifacts.find((candidate) => candidate.id === artifactId) : undefined;
              const kindClassName = artifact ? artifactKindClassName(artifact) : timelineKindClassName(item);
              const sourceLabel = artifact ? ARTIFACT_KIND_LABELS[artifactKind(artifact)] : timelineSourceLabel(item);
              const cardClassName = `timeline-card tone-${item.tone} ${kindClassName}`;
              const content = (
                <>
                  <span className="timeline-card-head">
                    <time>{formatTime(item.at)}</time>
                    <span className="timeline-source">{sourceLabel}</span>
                  </span>
                  <strong title={item.title}>{item.title}</strong>
                  <span title={item.detail}>{item.detail}</span>
                </>
              );

              const timelineActionId = item.actionId;
              return artifactId || timelineActionId ? (
                <button
                  type="button"
                  className={`${cardClassName} timeline-card-button`}
                  key={item.id}
                  onClick={() => {
                    if (timelineActionId) setSelectedActionId(timelineActionId);
                    if (artifactId) selectArtifactFromTimeline(artifactId);
                  }}
                  aria-label={
                    artifactId
                      ? `Select artifact ${artifactId} from timeline`
                      : `Select action ${timelineActionId} from timeline`
                  }
                >
                  {content}
                </button>
              ) : (
                <article className={cardClassName} key={item.id}>
                  {content}
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
