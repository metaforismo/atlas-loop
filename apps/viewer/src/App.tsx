import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ChartRelationshipIcon,
  CheckListIcon,
  CursorPointer02Icon,
  DashboardSquare01Icon,
  FileVerifiedIcon,
  FolderFileStorageIcon,
  GridViewIcon,
  LibraryIcon,
  SmartPhone01Icon,
  SourceCodeIcon,
  TimelineListIcon,
  WorkflowSquare03Icon
} from "@hugeicons/core-free-icons";
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
import { FlowRunPanel } from "./components/FlowRunPanel.js";
import { AgentHandoffPanel } from "./components/HandoffPanel.js";
import { MetadataGrid, MetadataSkeleton, SummaryEvidence } from "./components/MetadataPanel.js";
import { MetricsPanel } from "./components/MetricsPanel.js";
import { ReplayPanel } from "./components/ReplayPanel.js";
import { ScreenshotView } from "./components/ScreenshotView.js";
import { SessionBrowserContent } from "./components/SessionBrowser.js";
import { SessionWorkspace } from "./components/SessionWorkspace.js";
import { StartSessionPopover } from "./components/StartSessionPopover.js";
import { ObservedAppsWorkspace } from "./components/ObservedAppsWorkspace.js";
import { ProductIcon } from "./components/ProductIcon.js";
import { WorkspaceOverview, type OverviewDestination } from "./components/WorkspaceOverview.js";
import { WorkspaceCommandMenu, type WorkspaceCommandId } from "./components/WorkspaceCommandMenu.js";
import { TestWorkspace } from "./components/TestWorkspace.js";
import { WorkflowWorkspace } from "./components/WorkflowWorkspace.js";
import { useAtlasLoopData, useViewerParams } from "./hooks/useAtlasLoopData.js";
import { formatTapCoordinate, type ScreenshotTapTarget } from "./screenshotGeometry.js";
import type { ViewerParams, ViewerWorkspace } from "./types.js";
import {
  artifactTypeOptions,
  buildActionEvidencePairs,
  buildFlowRunSummary,
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
  const [flowFocus, setFlowFocus] = useState(false);
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<ViewerWorkspace>(params.workspace ?? "evidence");
  const [startSessionRequest, setStartSessionRequest] = useState(0);
  const [startSessionBundleId, setStartSessionBundleId] = useState<string>();
  const autoOpenedOverview = useRef(false);

  useEffect(() => {
    setDraft(params);
  }, [params]);

  useEffect(() => {
    setWorkspaceView(params.workspace ?? "evidence");
  }, [params.workspace]);

  useEffect(() => {
    setArtifactTypeFilter("all");
    setArtifactQuery("");
    setSelectedArtifactId(params.artifactId);
    setSelectedActionId(params.actionId);
    setTimelineFilter("all");
    setTimelineQuery("");
  }, [params.daemonUrl, params.sessionId, params.artifactId, params.actionId]);

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
  const flowRunSummary = useMemo(() => buildFlowRunSummary(events, session?.status), [events, session?.status]);
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
    const confirmedFirstRun = sessionListStatus === "error" || (sessionListStatus === "ready" && sessions.length === 0);
    // An explicit deep link is user intent. The first-run overview is only a
    // fallback for an unscoped root visit, never a redirect away from Tests,
    // Apps, Workflows, Sessions, or another requested workspace.
    if (params.workspace || autoOpenedOverview.current || !isLatestFirstRun || !confirmedFirstRun) return;
    autoOpenedOverview.current = true;
    setWorkspaceView("overview");
  }, [isLatestFirstRun, params.workspace, sessionListStatus, sessions.length]);

  useEffect(() => {
    // No clearing when the list is empty: a deep-linked artifactId must survive
    // until artifacts finish loading.
    if (!selectedArtifact) return;

    if (selectedArtifact.id !== selectedArtifactId) setSelectedArtifactId(selectedArtifact.id);
  }, [selectedArtifact, selectedArtifactId]);

  useEffect(() => {
    setTapTarget(undefined);
  }, [params.daemonUrl, params.sessionId, screenshotTargetKey]);

  useEffect(() => {
    if (health === "offline") setRuntimeSettingsOpen(true);
  }, [health]);

  useEffect(() => {
    if (!flowFocus) return;
    const exitFocus = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFlowFocus(false);
    };
    window.addEventListener("keydown", exitFocus);
    return () => window.removeEventListener("keydown", exitFocus);
  }, [flowFocus]);

  const toggleFlowFocus = (): void => {
    setFlowFocus((current) => {
      const next = !current;
      if (next) setTimelineFilter("actions");
      return next;
    });
  };

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

  const openWorkspaceView = (workspace: ViewerWorkspace): void => {
    setFlowFocus(false);
    setWorkspaceView(workspace);
    if ((params.workspace ?? "evidence") === workspace) return;
    applyViewerParams({
      ...params,
      view: undefined,
      workspace: workspace === "evidence" ? undefined : workspace
    });
  };

  const selectSession = (sessionId: string): void => {
    const nextParams = { daemonUrl: params.daemonUrl, sessionId };
    setDraft(nextParams);
    setWorkspaceView("evidence");
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

  const scrollToWorkspaceSection = (id: string): void => {
    document.getElementById(id)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  const openWorkspaceSection = (id: string): void => {
    openWorkspaceView("evidence");
    window.requestAnimationFrame(() => scrollToWorkspaceSection(id));
  };

  const requestStartSession = (bundleId?: string): void => {
    setStartSessionBundleId(bundleId?.trim() || undefined);
    setStartSessionRequest((current) => current + 1);
  };

  const openOverviewDestination = (destination: OverviewDestination): void => {
    if (destination === "atlas") {
      applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, view: "atlas" });
      return;
    }
    if (destination === "start") {
      requestStartSession();
      return;
    }
    if (destination === "runtime") {
      setRuntimeSettingsOpen(true);
      openWorkspaceSection("viewer-connection-panel");
      window.requestAnimationFrame(() => document.getElementById("daemon-url-input")?.focus());
      return;
    }
    if (destination === "workflows") {
      openWorkspaceView("workflows");
      return;
    }
    if (destination === "tests") {
      openWorkspaceView("tests");
      return;
    }
    if (destination === "sessions") {
      openWorkspaceView("sessions");
      return;
    }
    if (destination === "apps") {
      openWorkspaceView("apps");
      return;
    }
    openWorkspaceSection(destination === "actions" ? "viewer-actions" : "viewer-stage");
  };

  const runWorkspaceCommand = (command: WorkspaceCommandId): void => {
    const targets: Partial<Record<WorkspaceCommandId, string>> = {
      overview: "viewer-stage",
      tests: "test-workspace",
      apps: "observed-apps-workspace",
      workflows: "workflow-workspace",
      sessions: "session-workspace",
      evidence: "viewer-stage",
      actions: "viewer-actions",
      artifacts: "viewer-artifacts",
      health: "viewer-health"
    };
    if (command === "overview") {
      openWorkspaceView("overview");
      return;
    }
    if (command === "workflows") {
      openWorkspaceView("workflows");
      return;
    }
    if (command === "tests") {
      openWorkspaceView("tests");
      return;
    }
    if (command === "apps") {
      openWorkspaceView("apps");
      return;
    }
    if (command === "sessions") {
      openWorkspaceView("sessions");
      return;
    }
    if (command === "atlas") {
      applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, view: "atlas" });
      return;
    }
    if (command === "home") {
      window.location.assign("/");
      return;
    }
    const target = targets[command];
    if (target) openWorkspaceSection(target);
  };

  if (params.view === "atlas") {
    return (
      <AtlasView
        params={params}
        onSwitchToSessions={() => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, workspace: "sessions" })}
        onOpenSession={(sessionId, target) => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId, ...target })}
      />
    );
  }

  return (
    <main className={`viewer-shell health-${health} ${flowFocus ? "flow-focus" : ""} ${workspaceView === "overview" ? "workspace-overview-active" : ""} ${workspaceView === "tests" ? "workspace-tests-active" : ""} ${workspaceView === "sessions" ? "workspace-sessions-active" : ""} ${workspaceView === "apps" ? "workspace-apps-active" : ""} ${workspaceView === "workflows" ? "workspace-workflows-active" : ""}`}>
      <a className="skip-link" href={workspaceView === "overview" ? "#workspace-overview" : workspaceView === "tests" ? "#test-workspace" : workspaceView === "sessions" ? "#session-workspace" : workspaceView === "apps" ? "#observed-apps-workspace" : workspaceView === "workflows" ? "#workflow-workspace" : "#viewer-stage"}>
        {workspaceView === "overview" ? "Skip to workspace overview" : workspaceView === "tests" ? "Skip to local tests" : workspaceView === "sessions" ? "Skip to session history" : workspaceView === "apps" ? "Skip to observed apps" : workspaceView === "workflows" ? "Skip to workflow library" : "Skip to device viewport"}
      </a>
      <header className="viewer-topbar" aria-label="Viewer navigation">
        <nav className="viewer-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Home</a>
          <span aria-hidden="true">/</span>
          <strong>{workspaceView === "overview" ? "Overview" : workspaceView === "tests" ? "Tests" : workspaceView === "sessions" ? "Sessions" : workspaceView === "apps" ? "Apps" : workspaceView === "workflows" ? "Workflows" : "Evidence"}</strong>
        </nav>
        <div className="viewer-topbar-actions">
          <WorkspaceCommandMenu onSelect={runWorkspaceCommand} />
          <StartSessionPopover
            daemonUrl={params.daemonUrl}
            disabled={health !== "online"}
            disabledReason="Start the Atlas Loop daemon before creating a session."
            onStarted={(createdSession) => selectSession(createdSession.id)}
            openRequest={startSessionRequest}
            requestedBundleId={startSessionBundleId}
          />
          <span className={`viewer-runtime-state tone-${healthTone(health)}`}>
            <span aria-hidden="true" />
            {health === "online" ? "Daemon live" : health === "checking" ? "Checking daemon" : "Daemon offline"}
          </span>
          <button
            type="button"
            className="viewer-mobile-atlas-link"
            onClick={() => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, view: "atlas" })}
          >
            Atlas
          </button>
          {workspaceView === "evidence" ? (
            <button
              type="button"
              className="flow-focus-toggle"
              aria-pressed={flowFocus}
              onClick={toggleFlowFocus}
              title={flowFocus ? "Return to the full evidence workspace" : "Put the device and observed flow side by side"}
            >
              {flowFocus ? "Exit focus" : "Flow focus"}
            </button>
          ) : null}
        </div>
      </header>
      <aside id="viewer-connection-panel" className="rail panel" aria-label="Viewer connection and session list">
        <div className="brand-block">
          <a className="viewer-home-link" href="/" aria-label="Back to Atlas Loop home">
            <img className="viewer-brand-mark" src="/atlas-loop-mark.png" alt="" />
            <div className="viewer-brand-copy">
              <p className="kicker">Atlas Loop</p>
              <h1>Runtime evidence</h1>
            </div>
          </a>
          <span className={`health-dot ${health}`} aria-label={`Daemon ${health}`} title={`Daemon ${health}`} />
        </div>

        <nav className="viewer-nav" aria-label="Workspace navigation">
          <p>Home</p>
          <button type="button" className={`viewer-nav-item ${workspaceView === "overview" ? "selected" : ""}`} aria-current={workspaceView === "overview" ? "page" : undefined} onClick={() => openWorkspaceView("overview")}>
            <ProductIcon className="viewer-nav-icon" icon={DashboardSquare01Icon} />
            Overview
          </button>
          <p>Workspace</p>
          <button type="button" className={`viewer-nav-item ${workspaceView === "tests" ? "selected" : ""}`} aria-current={workspaceView === "tests" ? "page" : undefined} onClick={() => openWorkspaceView("tests")}>
            <ProductIcon className="viewer-nav-icon" icon={CheckListIcon} />
            Tests
          </button>
          <button type="button" className={`viewer-nav-item ${workspaceView === "apps" ? "selected" : ""}`} aria-current={workspaceView === "apps" ? "page" : undefined} onClick={() => openWorkspaceView("apps")}>
            <ProductIcon className="viewer-nav-icon" icon={GridViewIcon} />
            Apps
          </button>
          <button type="button" className={`viewer-nav-item ${workspaceView === "workflows" ? "selected" : ""}`} aria-current={workspaceView === "workflows" ? "page" : undefined} onClick={() => openWorkspaceView("workflows")}>
            <ProductIcon className="viewer-nav-icon" icon={WorkflowSquare03Icon} />
            Workflows
          </button>
          <button type="button" className={`viewer-nav-item ${workspaceView === "sessions" ? "selected" : ""}`} aria-current={workspaceView === "sessions" ? "page" : undefined} onClick={() => openWorkspaceView("sessions")}>
            <ProductIcon className="viewer-nav-icon" icon={TimelineListIcon} />
            Sessions
          </button>
          <button type="button" className={`viewer-nav-item ${workspaceView === "evidence" ? "selected" : ""}`} aria-current={workspaceView === "evidence" ? "page" : undefined} onClick={() => openWorkspaceSection("viewer-stage")}>
            <ProductIcon className="viewer-nav-icon" icon={SmartPhone01Icon} />
            Live evidence
          </button>
          <button type="button" className="viewer-nav-item" onClick={() => openWorkspaceSection("viewer-actions")}>
            <ProductIcon className="viewer-nav-icon" icon={CursorPointer02Icon} />
            Actions
          </button>
          <button
            type="button"
            className="viewer-nav-item"
            onClick={() => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, view: "atlas" })}
          >
            <ProductIcon className="viewer-nav-icon" icon={ChartRelationshipIcon} />
            Atlas map
          </button>
          <p>System</p>
          <button type="button" className="viewer-nav-item" onClick={() => openWorkspaceSection("viewer-artifacts")}>
            <ProductIcon className="viewer-nav-icon" icon={FolderFileStorageIcon} />
            Artifacts
          </button>
          <button type="button" className="viewer-nav-item" onClick={() => openWorkspaceSection("viewer-health")}>
            <ProductIcon className="viewer-nav-icon" icon={FileVerifiedIcon} />
            Evidence health
          </button>
          <p>Resources</p>
          <a className="viewer-nav-item" href="https://github.com/metaforismo/atlas-loop#readme" target="_blank" rel="noreferrer">
            <ProductIcon className="viewer-nav-icon" icon={LibraryIcon} />
            Documentation
          </a>
          <a className="viewer-nav-item" href="https://github.com/metaforismo/atlas-loop" target="_blank" rel="noreferrer">
            <ProductIcon className="viewer-nav-icon" icon={SourceCodeIcon} />
            Source
          </a>
        </nav>

        <details className="rail-runtime-settings" open={runtimeSettingsOpen} onToggle={(event) => setRuntimeSettingsOpen(event.currentTarget.open)}>
          <summary><span>Local runtime</span><small>{selectedSessionId}</small></summary>
          <form className="connection-form" aria-label="Local runtime connection" onSubmit={submit}>
            <label>
              <span>Daemon URL</span>
              <input
                id="daemon-url-input"
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
        </details>

        <section id="viewer-sessions" className="session-list" aria-label="Sessions" aria-busy={sessionListStatus === "loading"}>
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

      <WorkspaceOverview
        health={health}
        session={session}
        sessions={sessions}
        sessionListStatus={sessionListStatus}
        artifacts={artifacts}
        eventCount={events.length}
        screenshotStatus={screenshot.status}
        artifactHealth={artifactHealth}
        artifactHealthStatus={artifactHealthStatus}
        onStartSession={() => requestStartSession()}
        onOpen={openOverviewDestination}
        onSelectSession={selectSession}
      />

      {workspaceView === "tests" ? (
        <TestWorkspace
          params={params}
          selectedSessionId={selectedSessionId}
          session={session}
          mutationState={actionMutationState}
          onOpenEvidence={() => openWorkspaceView("evidence")}
          onStartSession={requestStartSession}
        />
      ) : null}

      {workspaceView === "sessions" ? (
        <SessionWorkspace
          sessions={sessions}
          status={sessionListStatus}
          error={sessionListError}
          health={health}
          onOpenSession={selectSession}
          onStartSession={requestStartSession}
          onOpenAtlas={() => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, view: "atlas" })}
          onOpenRuntimeSettings={() => {
            setRuntimeSettingsOpen(true);
            openWorkspaceSection("viewer-connection-panel");
            window.requestAnimationFrame(() => document.getElementById("daemon-url-input")?.focus());
          }}
        />
      ) : null}

      {workspaceView === "apps" ? (
        <ObservedAppsWorkspace
          sessions={sessions}
          status={sessionListStatus}
          error={sessionListError}
          onOpenSession={selectSession}
          onStartSession={requestStartSession}
        />
      ) : null}

      {workspaceView === "workflows" ? (
        <WorkflowWorkspace
          params={params}
          selectedSessionId={selectedSessionId}
          session={session}
          mutationState={actionMutationState}
          onOpenActions={() => openWorkspaceSection("viewer-actions")}
          onOpenEvidence={() => openWorkspaceView("evidence")}
        />
      ) : null}

      <section id="viewer-stage" className="stage panel" aria-label="Latest iPhone screenshot" tabIndex={-1}>
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
                emptyAction={health === "offline" ? {
                  label: "Connection settings",
                  onSelect: () => {
                    document.getElementById("viewer-connection-panel")?.scrollIntoView({ block: "start" });
                    document.getElementById("daemon-url-input")?.focus();
                  }
                } : undefined}
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
          <div id="viewer-handoff"><AgentHandoffPanel brief={handoffBrief} /></div>
          <div id="viewer-health"><EvidenceHealthPanel health={artifactHealth} status={artifactHealthStatus} error={artifactHealthError} /></div>
          {session?.error ? <ErrorNotice message={session.error.message} compact /> : null}
        </section>

        <div id="viewer-actions">
          <ActionPanel
            params={params}
            selectedSessionId={selectedSessionId}
            mutationState={actionMutationState}
            form={actionForm}
            onFieldChange={updateActionFormField}
          />
        </div>

        <section id="viewer-artifacts" className="inspector-section artifact-section">
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
          <div>
            <p className="kicker">Store of record</p>
            <h2>Observed flow</h2>
          </div>
          <span>{visibleTimeline.length === timeline.length ? `${timeline.length} items` : `${visibleTimeline.length}/${timeline.length} shown`}</span>
        </div>
        <FlowRunPanel summary={flowRunSummary} />
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
