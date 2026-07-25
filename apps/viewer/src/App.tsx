import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  BookOpen01Icon,
  ChartRelationshipIcon,
  CheckListIcon,
  CursorPointer02Icon,
  DashboardSquare01Icon,
  FileVerifiedIcon,
  SidebarLeft01Icon,
  FolderFileStorageIcon,
  GridViewIcon,
  LibraryIcon,
  SmartPhone01Icon,
  SourceCodeIcon,
  TimelineListIcon,
  WorkflowSquare03Icon
} from "@hugeicons/core-free-icons";
import { isDisplayableScreenshot, toResourceUrl } from "./api.js";
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
import { DeviceLocationPanel } from "./components/DeviceLocationPanel.js";
import { DeviceLogsPanel } from "./components/DeviceLogsPanel.js";
import { EmptyState, ErrorNotice, MetricTile, StatusRow } from "./components/common.js";
import { ImageLightbox } from "./components/ImageLightbox.js";
import { IOSDeviceFrame } from "./components/IOSDeviceFrame.js";
import { LibraryWorkspace } from "./components/LibraryWorkspace.js";
import { LiveMonitor } from "./components/LiveMonitor.js";
import { EvidenceHealthPanel } from "./components/EvidenceHealthPanel.js";
import { FlowRunPanel } from "./components/FlowRunPanel.js";
import { AgentHandoffPanel } from "./components/HandoffPanel.js";
import { MetadataGrid, MetadataSkeleton, SummaryEvidence } from "./components/MetadataPanel.js";
import { ReplayPanel } from "./components/ReplayPanel.js";
import { ScreenshotView } from "./components/ScreenshotView.js";
import { RunScrubber } from "./components/RunScrubber.js";
import { EvidencePanels, type EvidenceHeadline } from "./components/EvidencePanels.js";
import { PanelTabs } from "./components/PanelTabs.js";
import { SessionBrowserContent } from "./components/SessionBrowser.js";
import { SessionWorkspace } from "./components/SessionWorkspace.js";
import { StartSessionPopover } from "./components/StartSessionPopover.js";
import { ObservedAppsWorkspace } from "./components/ObservedAppsWorkspace.js";
import { ProductIcon } from "./components/ProductIcon.js";
import { WorkspaceOverview, type OverviewDestination } from "./components/WorkspaceOverview.js";
import { WorkspaceCommandMenu, type WorkspaceCommandId } from "./components/WorkspaceCommandMenu.js";
import { TestWorkspace } from "./components/TestWorkspace.js";
import { WorkflowWorkspace, type WorkflowMonitorActivity } from "./components/WorkflowWorkspace.js";
import { useAtlasLoopData, useViewerParams } from "./hooks/useAtlasLoopData.js";
import { formatTapCoordinate, type ScreenshotTapTarget } from "./screenshotGeometry.js";
import type { ViewerParams, ViewerWorkspace, EvidenceTab, InspectorTab } from "./types.js";
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
import { DEFAULT_SESSION_ID, writeViewerSearch, normalizeEvidenceTab, normalizeInspectorTab } from "./viewerParams.js";
import { loadRailCollapsed, saveRailCollapsed } from "./railPreference.js";
import { buildRunScrubberModel, fractionOfItem, fractionOfTime, resolveRunMoment, timeOfFraction } from "./runScrubber.js";
import { capList } from "./cappedList.js";
import { IssueExportDialog } from "./components/IssueExportDialog.js";
import { loadIssueRepository, saveIssueRepository } from "./issueRepositoryStorage.js";
import type { LocalTestModuleSeed } from "./localTestModules.js";
import type { LocalLaunchProfile } from "./localLaunchProfiles.js";

type RailIcon = Parameters<typeof ProductIcon>[0]["icon"];

/**
 * Rail entries keep their label in an element rather than a bare text node so
 * the collapsed rail can hide it, and carry a `title` so the icon-only state
 * still names its destination on hover.
 */
function RailNavButton({
  label,
  icon,
  selected = false,
  onClick
}: {
  label: string;
  icon: RailIcon;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`viewer-nav-item ${selected ? "selected" : ""}`}
      aria-current={selected ? "page" : undefined}
      title={label}
      onClick={onClick}
    >
      <ProductIcon className="viewer-nav-icon" icon={icon} />
      <span>{label}</span>
    </button>
  );
}

function RailNavLink({ label, icon, href }: { label: string; icon: RailIcon; href: string }) {
  return (
    <a className="viewer-nav-item" href={href} title={label} target="_blank" rel="noreferrer">
      <ProductIcon className="viewer-nav-icon" icon={icon} />
      <span>{label}</span>
    </a>
  );
}

/**
 * Which inspector tab owns each deep-link anchor.
 *
 * The rail, the command palette, and the workspace overview all scroll to these
 * ids. Now that the sections are tabs, the tab has to open first — a hidden
 * panel has no layout to scroll to.
 */
/**
 * How many rows each long list renders before holding the rest back.
 *
 * Measured on a six hundred artifact session: mounting every row cost a 22.6
 * second first paint and 1.2 to 3.5 seconds of lag per keystroke in the filter.
 */
const ARTIFACT_PAGE = 60;
const TIMELINE_PAGE = 80;

const INSPECTOR_TAB_FOR_ANCHOR: Record<string, InspectorTab> = {
  "viewer-actions": "actions",
  "viewer-artifacts": "artifacts",
  "viewer-handoff": "handoff",
  "viewer-health": "session"
};

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
  const inspectorTab = normalizeInspectorTab(params.inspector);
  const evidenceTab = normalizeEvidenceTab(params.evidence);
  const [evidenceHeadlines, setEvidenceHeadlines] = useState<Partial<Record<EvidenceTab, EvidenceHeadline>>>({});
  const setInspectorTab = (inspector: InspectorTab): void => applyViewerParams({ ...params, inspector });
  const setEvidenceTab = (evidence: EvidenceTab): void => applyViewerParams({ ...params, evidence });
  const [stageZoomed, setStageZoomed] = useState(false);
  const [flowFocus, setFlowFocus] = useState(false);
  const [runtimeSettingsOpen, setRuntimeSettingsOpen] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<ViewerWorkspace>(params.workspace ?? "evidence");
  const [startSessionRequest, setStartSessionRequest] = useState(0);
  const [startSessionBundleId, setStartSessionBundleId] = useState<string>();
  const [startSessionLaunchProfile, setStartSessionLaunchProfile] = useState<LocalLaunchProfile>();
  const [testComposerSeed, setTestComposerSeed] = useState<LocalTestModuleSeed>();
  const [workflowActivity, setWorkflowActivity] = useState<WorkflowMonitorActivity>({ status: "idle" });
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [issueExportOpen, setIssueExportOpen] = useState(false);
  const [issueRepository, setIssueRepository] = useState("");
  /**
   * Undefined means "follow the live run"; a number replays that instant.
   * Stored as a moment, not a fraction, so a parked playhead stays on the same
   * moment while a live run keeps extending the track underneath it.
   */
  const [scrubAtMs, setScrubAtMs] = useState<number | undefined>();
  const autoOpenedOverview = useRef(false);

  useEffect(() => {
    setDraft(params);
  }, [params]);

  // Read after mount so a blocked or empty store just leaves the rail expanded.
  useEffect(() => {
    setRailCollapsed(loadRailCollapsed());
    setIssueRepository(loadIssueRepository());
  }, []);

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
  const [artifactLimit, setArtifactLimit] = useState(ARTIFACT_PAGE);
  const [timelineLimit, setTimelineLimit] = useState(TIMELINE_PAGE);
  const timelineFilters = useMemo(() => timelineFilterOptions(timeline), [timeline]);
  const visibleTimeline = useMemo(
    () => filterTimelineItems(timeline, { filter: timelineFilter, query: timelineQuery }),
    [timeline, timelineFilter, timelineQuery]
  );
  const cappedArtifacts = useMemo(
    () => capList(filteredArtifacts, { limit: artifactLimit, page: ARTIFACT_PAGE, noun: "artifact" }),
    [filteredArtifacts, artifactLimit]
  );
  const cappedTimeline = useMemo(
    () => capList(visibleTimeline, { limit: timelineLimit, page: TIMELINE_PAGE, noun: "item" }),
    [visibleTimeline, timelineLimit]
  );

  // Narrowing a list is a fresh look at it, so the page count starts over.
  useEffect(() => setArtifactLimit(ARTIFACT_PAGE), [artifactTypeFilter, artifactQuery, params.sessionId]);
  useEffect(() => setTimelineLimit(TIMELINE_PAGE), [timelineFilter, timelineQuery, params.sessionId]);

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
  const scrubberModel = useMemo(() => buildRunScrubberModel(timeline), [timeline]);
  const scrubbing = scrubAtMs !== undefined && scrubberModel !== undefined;
  const scrubFraction = scrubbing ? fractionOfTime(scrubberModel, scrubAtMs) : undefined;
  const scrubMoment = scrubbing ? resolveRunMoment(scrubberModel, scrubFraction!) : undefined;
  // Replaying shows what the device was displaying then, not what it shows now.
  const replayScreenshot = useMemo(() => {
    if (!scrubMoment) return undefined;
    const artifact = artifacts.find((candidate) => candidate.id === scrubMoment.screenshotArtifactId);
    if (!artifact) return undefined;
    const source = artifact.url ?? artifact.path;
    // An artifact with no recorded capture time falls back to the position
    // being replayed, which is the closest thing the evidence supports.
    return {
      status: "ready",
      src: toResourceUrl(source, params.daemonUrl),
      source: "url",
      updatedAt: artifact.createdAt ?? scrubMoment.at
    } as const;
  }, [scrubMoment, artifacts, params.daemonUrl]);
  const stageScreenshot = replayScreenshot ?? screenshot;
  // The whole stage — tiles, footer, lightbox — describes whatever frame it is
  // showing, so a replayed frame is never labelled as the live one.
  const stageIsDisplayable = isDisplayableScreenshot(stageScreenshot);
  const stageTone: UiTone =
    stageScreenshot.status === "error" ? "bad" : stageScreenshot.status === "stale" ? "warn" : stageScreenshot.status === "ready" ? "good" : "neutral";
  const stageArtifactId = (scrubbing ? scrubMoment?.screenshotArtifactId : latestScreenshotArtifact?.id) ?? undefined;
  const stageArtifactPath = artifacts.find((entry) => entry.id === stageArtifactId)?.path;
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

  const toggleRail = (): void => {
    setRailCollapsed((current) => saveRailCollapsed(!current));
  };

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

  const openRuntimeSettings = (): void => {
    setRuntimeSettingsOpen(true);
    openWorkspaceSection("viewer-connection-panel");
    window.requestAnimationFrame(() => document.getElementById("daemon-url-input")?.focus());
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
    const tab = INSPECTOR_TAB_FOR_ANCHOR[id];
    if (tab) setInspectorTab(tab);
    window.requestAnimationFrame(() => scrollToWorkspaceSection(id));
  };

  const requestStartSession = (bundleId?: string, launchProfile?: LocalLaunchProfile): void => {
    setStartSessionBundleId(launchProfile?.bundleId.trim() || bundleId?.trim() || undefined);
    setStartSessionLaunchProfile(launchProfile);
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
    if (destination === "library") {
      openWorkspaceView("library");
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
      library: "library-workspace",
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
    if (command === "library") {
      openWorkspaceView("library");
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

  /* Lifted out of the tree so the tab list stays readable; the markup and
     its `viewer-artifacts` anchor are unchanged. */
  const artifactsBody = (
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
                    <input
                      type="search"
                      value={artifactQuery}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={(event) => setArtifactQuery(event.target.value)}
                      placeholder="Search artifacts…"
                    />
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
                      {cappedArtifacts.visible.map((artifact) => (
                        <ArtifactRow
                          key={artifact.id}
                          id={artifactOptionId(artifact.id)}
                          artifact={artifact}
                          selected={selectedArtifact?.id === artifact.id}
                          onSelect={() => setSelectedArtifactId(artifact.id)}
                        />
                      ))}
                    </div>
                    {cappedArtifacts.moreLabel ? (
                      <button type="button" className="list-more" onClick={() => setArtifactLimit(cappedArtifacts.nextLimit)}>
                        {cappedArtifacts.moreLabel}
                      </button>
                    ) : null}
                    <ArtifactDetails artifact={selectedArtifact} />
                  </>
                )}
              </div>
            </section>
  );

  return (
    <main className={`viewer-shell health-${health} ${railCollapsed ? "rail-collapsed" : ""} ${flowFocus ? "flow-focus" : ""} ${workspaceView === "overview" ? "workspace-overview-active" : ""} ${workspaceView === "tests" ? "workspace-tests-active" : ""} ${workspaceView === "library" ? "workspace-library-active" : ""} ${workspaceView === "sessions" ? "workspace-sessions-active" : ""} ${workspaceView === "apps" ? "workspace-apps-active" : ""} ${workspaceView === "workflows" ? "workspace-workflows-active" : ""}`}>
      <a className="skip-link" href={workspaceView === "overview" ? "#workspace-overview" : workspaceView === "tests" ? "#test-workspace" : workspaceView === "library" ? "#library-workspace" : workspaceView === "sessions" ? "#session-workspace" : workspaceView === "apps" ? "#observed-apps-workspace" : workspaceView === "workflows" ? "#workflow-workspace" : "#viewer-stage"}>
        {workspaceView === "overview" ? "Skip to workspace overview" : workspaceView === "tests" ? "Skip to local tests" : workspaceView === "library" ? "Skip to local module library" : workspaceView === "sessions" ? "Skip to session history" : workspaceView === "apps" ? "Skip to observed apps" : workspaceView === "workflows" ? "Skip to workflow library" : "Skip to device viewport"}
      </a>
      <header className="viewer-topbar" aria-label="Viewer navigation">
        <button
          type="button"
          className="rail-collapse-toggle"
          aria-expanded={!railCollapsed}
          aria-controls="viewer-connection-panel"
          title={railCollapsed ? "Expand the workspace rail" : "Collapse the workspace rail"}
          onClick={toggleRail}
        >
          <ProductIcon className="viewer-nav-icon" icon={SidebarLeft01Icon} />
          <span className="sr-only">{railCollapsed ? "Expand the workspace rail" : "Collapse the workspace rail"}</span>
        </button>
        <nav className="viewer-breadcrumb" aria-label="Breadcrumb">
          <a href="/">Home</a>
          <span aria-hidden="true">/</span>
          <strong>{workspaceView === "overview" ? "Overview" : workspaceView === "tests" ? "Tests" : workspaceView === "library" ? "Library" : workspaceView === "sessions" ? "Sessions" : workspaceView === "apps" ? "Apps" : workspaceView === "workflows" ? "Workflows" : "Evidence"}</strong>
        </nav>
        <div className="viewer-topbar-actions">
          <WorkspaceCommandMenu onSelect={runWorkspaceCommand} />
          <LiveMonitor
            health={health}
            sessions={sessions}
            sessionListStatus={sessionListStatus}
            sessionListError={sessionListError}
            selectedSessionId={selectedSessionId}
            selectedSession={session}
            artifactCount={artifacts.length}
            eventCount={events.length}
            workflowActivity={workflowActivity}
            onOpenSession={selectSession}
            onOpenEvidence={() => openWorkspaceView("evidence")}
            onOpenWorkflows={() => openWorkspaceView("workflows")}
            onStartSession={requestStartSession}
            onOpenRuntime={openRuntimeSettings}
          />
          <StartSessionPopover
            daemonUrl={params.daemonUrl}
            disabled={health !== "online"}
            disabledReason="Start the Atlas Loop daemon before creating a session."
            onStarted={(createdSession) => selectSession(createdSession.id)}
            openRequest={startSessionRequest}
            requestedBundleId={startSessionBundleId}
            requestedLaunchProfile={startSessionLaunchProfile}
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
          <RailNavButton label="Overview" icon={DashboardSquare01Icon} selected={workspaceView === "overview"} onClick={() => openWorkspaceView("overview")} />
          <p>Workspace</p>
          <RailNavButton label="Tests" icon={CheckListIcon} selected={workspaceView === "tests"} onClick={() => openWorkspaceView("tests")} />
          <RailNavButton label="Apps" icon={GridViewIcon} selected={workspaceView === "apps"} onClick={() => openWorkspaceView("apps")} />
          <RailNavButton label="Workflows" icon={WorkflowSquare03Icon} selected={workspaceView === "workflows"} onClick={() => openWorkspaceView("workflows")} />
          <RailNavButton label="Library" icon={BookOpen01Icon} selected={workspaceView === "library"} onClick={() => openWorkspaceView("library")} />
          <RailNavButton label="Sessions" icon={TimelineListIcon} selected={workspaceView === "sessions"} onClick={() => openWorkspaceView("sessions")} />
          <RailNavButton label="Live evidence" icon={SmartPhone01Icon} selected={workspaceView === "evidence"} onClick={() => openWorkspaceSection("viewer-stage")} />
          <RailNavButton label="Actions" icon={CursorPointer02Icon} onClick={() => openWorkspaceSection("viewer-actions")} />
          <RailNavButton
            label="Atlas map"
            icon={ChartRelationshipIcon}
            onClick={() => applyViewerParams({ daemonUrl: params.daemonUrl, sessionId: params.sessionId, view: "atlas" })}
          />
          <p>System</p>
          <RailNavButton label="Artifacts" icon={FolderFileStorageIcon} onClick={() => openWorkspaceSection("viewer-artifacts")} />
          <RailNavButton label="Evidence health" icon={FileVerifiedIcon} onClick={() => openWorkspaceSection("viewer-health")} />
          <p>Resources</p>
          <RailNavLink label="Documentation" icon={LibraryIcon} href="https://github.com/metaforismo/atlas-loop#readme" />
          <RailNavLink label="Source" icon={SourceCodeIcon} href="https://github.com/metaforismo/atlas-loop" />
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
          composerSeed={testComposerSeed}
          onComposerSeedHandled={() => setTestComposerSeed(undefined)}
        />
      ) : null}

      {workspaceView === "library" ? (
        <LibraryWorkspace
          onCreateTest={(seed) => { setTestComposerSeed(seed); openWorkspaceView("tests"); }}
          onStartWithProfile={(profile) => requestStartSession(profile.bundleId, profile)}
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
          onOpenRuntimeSettings={openRuntimeSettings}
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
          onRunActivityChange={setWorkflowActivity}
        />
      ) : null}

      <section id="viewer-stage" className="stage panel" aria-label="Latest iPhone screenshot" tabIndex={-1}>
        <div className="stage-topbar">
          <div>
            <p className="kicker">{scrubbing ? "Replaying run" : "Live device viewport"}</p>
            <h2>{selectedSessionId}</h2>
            <span className="stage-subtitle">{session?.app?.bundleId ?? session?.app?.scheme ?? "No app metadata yet"}</span>
          </div>
          <div className="stage-actions">
            <span className={`live-badge tone-${scrubbing ? "warn" : healthTone(health)}`}>
              {scrubbing ? "replay" : health === "online" ? "live" : health}
            </span>
            <span className={`session-chip status-${session?.status ?? "pending"}`}>{session?.status ?? "pending"}</span>
          </div>
        </div>

        <div className="device-workbench">
          {/* One dense line rather than three tiles: this said "ready / 16:55 /
              blob" across 52px of the stage's most valuable space, while the
              device it describes was being squeezed out of view. */}
          <div className="viewport-meta" aria-label="Screenshot metadata">
            <span className={`viewport-meta-status tone-${stageTone}`}>{stageScreenshot.status}</span>
            <span className="viewport-meta-sep" aria-hidden="true">·</span>
            <span>
              {scrubbing ? "captured" : "updated"} {stageIsDisplayable ? formatTime(stageScreenshot.updatedAt) : "--"}
            </span>
            <span className="viewport-meta-sep" aria-hidden="true">·</span>
            <span>{scrubbing ? "replay" : stageIsDisplayable ? stageScreenshot.source : "--"}</span>
          </div>

          {/* The device and the evidence sit side by side. Stacked, they shared
              571px of height and the device collapsed; the column is 1150px
              wide, so the space to spend was horizontal all along. */}
          <div className="workbench-main">
          <div className="device-column">
          <div className="phone-stand">
            <IOSDeviceFrame
              label={`${session?.simulator?.name ?? "iPhone Simulator"} live viewport`}
              meta={`${session?.simulator?.runtime ?? session?.platform ?? "iOS runtime"} · ${session?.inputBackend ?? session?.backend ?? "input pending"}`}
              status={health === "online" ? "online" : health === "checking" ? "idle" : "offline"}
              variant="viewer"
            >
              <ScreenshotView
                screenshot={stageScreenshot}
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
            </IOSDeviceFrame>
          </div>

          <div className="viewport-footer">
            <span>{stageArtifactId ? `Artifact ${stageArtifactId}` : "No screenshot artifact reported"}</span>
            {stageIsDisplayable ? (
              <span className="viewport-footer-actions">
                <button type="button" onClick={() => setStageZoomed(true)}>
                  Zoom
                </button>
                <a href={stageScreenshot.src} target="_blank" rel="noreferrer">
                  Open image
                </a>
              </span>
            ) : null}
          </div>
          </div>

          <EvidencePanels
            params={params}
            session={session}
            events={events}
            selectedActionId={selectedActionId}
            cursorAt={scrubMoment?.at}
            selected={evidenceTab}
            onSelect={setEvidenceTab}
            headlines={evidenceHeadlines}
            onHeadlines={setEvidenceHeadlines}
          />
          </div>

          {stageZoomed && stageIsDisplayable ? (
            <ImageLightbox
              src={stageScreenshot.src}
              alt="Latest simulator screenshot"
              caption={stageArtifactPath}
              onClose={() => setStageZoomed(false)}
            />
          ) : null}

          {scrubberModel ? (
            <RunScrubber
              model={scrubberModel}
              // Following the run means sitting at its newest moment, not its
              // first; parking the head at zero implied the opposite.
              fraction={scrubFraction ?? 1}
              scrubbing={scrubbing}
              onScrub={(next) => {
                setScrubAtMs(timeOfFraction(scrubberModel, next));
                // One playhead: the step follows the position too.
                const moment = resolveRunMoment(scrubberModel, next);
                if (moment.actionId) setSelectedActionId(moment.actionId);
              }}
              onExit={() => setScrubAtMs(undefined)}
            />
          ) : null}
          {replayModel ? <ReplayPanel replay={replayModel} /> : null}
          <DeviceLogsPanel params={params} sessionStatus={session?.status} selectedActionId={selectedActionId} />
        </div>
      </section>

      <aside className="inspector panel" aria-label="Session metadata and artifacts">
        {/* One at a time: stacked, these four cost 4103px inside a 664px column,
            so reaching the last meant scrolling past the rest every time. */}
        <PanelTabs
          label="Inspector section"
          selected={inspectorTab}
          onSelect={setInspectorTab}
          tabs={[
            {
              id: "session" as const,
              label: "Session",
              attention: artifactHealth?.ok === false || Boolean(session?.error),
              body: (
                <section className="inspector-section session-overview">
                  <div className="panel-title-row">
                    <h2>Evidence inspector</h2>
                    <span>{session?.updatedAt ? formatTime(session.updatedAt) : "--"}</span>
                  </div>
                  {session ? <MetadataGrid session={session} /> : <MetadataSkeleton />}
                  {sessionSummary ? <SummaryEvidence summary={sessionSummary} /> : null}
                  <ActionDetailPanel pairs={actionEvidencePairs} selectedActionId={selectedActionId} onSelect={setSelectedActionId} />
                  <div id="viewer-health"><EvidenceHealthPanel health={artifactHealth} status={artifactHealthStatus} error={artifactHealthError} /></div>
                  {session?.error ? <ErrorNotice message={session.error.message} compact /> : null}
                </section>
              )
            },
            {
              id: "actions" as const,
              label: "Actions",
              body: (
                <div id="viewer-actions">
                  {/* Tap and type are reached constantly; location is set once
                      per run, so it sits below rather than above them. */}
                  <ActionPanel
                    params={params}
                    selectedSessionId={selectedSessionId}
                    mutationState={actionMutationState}
                    form={actionForm}
                    onFieldChange={updateActionFormField}
                  />
                  <DeviceLocationPanel params={params} selectedSessionId={selectedSessionId} mutationState={actionMutationState} />
                </div>
              )
            },
            {
              id: "artifacts" as const,
              label: "Artifacts",
              badge: artifacts.length > 0 ? String(artifacts.length) : undefined,
              body: artifactsBody
            },
            {
              id: "handoff" as const,
              label: "Handoff",
              attention: flowRunSummary.failed > 0,
              body: (
                <div id="viewer-handoff" className="inspector-section">
                  <AgentHandoffPanel brief={handoffBrief} />
                  <button type="button" className="issue-export-trigger" onClick={() => setIssueExportOpen(true)}>
                    <span>Create an issue from this run</span>
                    <small>{flowRunSummary.failed > 0 ? `${flowRunSummary.failed} failed action${flowRunSummary.failed === 1 ? "" : "s"} to attach` : "Run context and evidence link attached"}</small>
                  </button>
                </div>
              )
            }
          ]}
        />
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
              <input
                type="search"
                value={timelineQuery}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(event) => setTimelineQuery(event.target.value)}
                placeholder="Search actions…"
              />
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
            cappedTimeline.visible.map((item) => {
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
                    // While replaying, picking a moment on the timeline moves the
                    // playhead to it. Live, it must not yank the view off live.
                    const at = scrubbing && scrubberModel ? fractionOfItem(scrubberModel, item.id) : undefined;
                    if (at !== undefined) setScrubAtMs(timeOfFraction(scrubberModel!, at));
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

      {issueExportOpen ? (
        <IssueExportDialog
          input={{
            session,
            sessionSummary,
            artifacts,
            events,
            artifactHealth,
            evidenceUrl: `${window.location.origin}${writeViewerSearch({ ...params, sessionId: selectedSessionId })}`
          }}
          repository={issueRepository}
          onRepositoryChange={(value) => setIssueRepository(value)}
          onClose={() => {
            // Normalise on close so a half-typed slug is never stored.
            setIssueRepository(saveIssueRepository(issueRepository));
            setIssueExportOpen(false);
          }}
        />
      ) : null}
    </main>
  );
}
