#!/usr/bin/env tsx
import { createInterface } from "node:readline";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportSessionArtifacts, verifySessionHandoffBundle } from "@atlas-loop/artifacts";
import { loadConfig as loadAtlasLoopConfig } from "@atlas-loop/config";
import {
  buildEvidenceHtmlReport,
  collectEvidenceHtmlAssets,
  buildEvidenceMarkdownReport,
  buildSessionHandoff,
  type CompactEvidenceSummary,
  DaemonClient,
  DaemonClientError,
  evidenceHtmlAtlasFromMapView,
  evidenceReportDataFromSessionSummary,
  type EvidenceReportData,
  type SessionSummary
} from "@atlas-loop/daemon-client";
import { validateActionInput, type ActionInput, type ArtifactRef, type AtlasLoopError, type BuildRequest, type Edge, type LaunchRequest, type TraceEvent } from "@atlas-loop/protocol";
import { DEFAULT_DIFF_THRESHOLD, diffPngs } from "@atlas-loop/atlas-map";
import { validateArtifactTarget, type ValidationReport } from "../../../scripts/verify-artifacts.ts";

const DEFAULT_VIEWER_BASE_URL = "http://127.0.0.1:5173";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface McpDaemonClient {
  health(): Promise<unknown>;
  listSessions(): Promise<unknown>;
  listSessionHistory?(params: { limit?: number }): Promise<unknown>;
  createSession(args: Record<string, unknown>): Promise<unknown>;
  getSession(sessionId: string): Promise<unknown>;
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
  getSessionArtifactHealth?(sessionId: string): Promise<ArtifactHealth>;
  getArtifactHealth?(sessionId: string): Promise<ArtifactHealth>;
  events(sessionId: string): Promise<TraceEvent[]>;
  performAction(sessionId: string, request: unknown): Promise<unknown>;
  screenshot(sessionId: string, reason?: string): Promise<unknown>;
  listArtifacts(sessionId: string): Promise<unknown>;
  latestScreenshot(sessionId: string): Promise<Partial<ArtifactRef>>;
  endSession(sessionId: string): Promise<unknown>;
  getAtlasMap?(rebuild?: boolean): Promise<unknown>;
  getSessionMetrics?(sessionId: string): Promise<{ samples: Array<{ at: string; cpuPercent: number; rssBytes: number }> }>;
  startRecording?(sessionId: string): Promise<unknown>;
  stopRecording?(sessionId: string): Promise<unknown>;
  build(sessionId: string, request: unknown): Promise<unknown>;
  install(sessionId: string, request: unknown): Promise<unknown>;
  launch(sessionId: string, request: unknown): Promise<unknown>;
  request?<T>(method: string, path: string, body?: unknown): Promise<T>;
}

interface ToolRuntime {
  client?: McpDaemonClient;
  loadConfig?: () => Promise<{ daemonUrl: string }>;
  viewerBaseUrl?: string;
}

interface SessionReadiness {
  sessionId: string;
  requestedSessionId: string;
  status: string;
  storage: {
    source: string;
    artifactBacked: boolean;
    warningCount: number;
  };
  artifactDir: string;
  latestScreenshotPath: string | null;
  latestAction?: {
    id: string;
    ok: boolean;
  };
  latestError?: SessionSummary["events"]["latestError"];
  viewerUrl: string;
  daemonUrl: string;
  viewerBaseUrl: string;
  canMutate: boolean;
  hasScreenshot: boolean;
}

interface LocalEvidenceExportMetadata {
  schemaVersion: "atlas-loop.evidence-export.v1";
  sessionId: string;
  requestedSessionId: string;
  exportedAt: string;
  bundleDir: string;
  metadataPath: string;
  artifactExportMetadataPath: string;
  sourceArtifactDir: string;
  localOnly: true;
  uploaded: false;
  artifactTotal: number;
  fileCount: number;
  byteCount: number;
  latestScreenshotPath: string | null;
  exportedLatestScreenshotPath: string | null;
  storage: SessionSummary["storage"];
}

interface ArtifactVerification {
  ok: boolean;
  target: string;
  source: "session" | "path";
  requestedSessionId?: string;
  sessionId?: string;
  artifactDir?: string;
  requestedPath?: string;
  report: ValidationReport;
}

interface ArtifactHealth {
  ok: boolean;
  target: string;
  source: string;
  requestedSessionId: string;
  sessionId: string;
  artifactDir: string;
  report: unknown;
  summary: {
    sessionCount: number;
    errorCount: number;
    warningCount: number;
    issueCount: number;
  };
}

interface EventListResult {
  requestedSessionId: string;
  filters: {
    type?: string;
    limit?: number;
  };
  total: number;
  matched: number;
  count: number;
  events: TraceEvent[];
}

interface EventExportResult extends EventListResult {
  schemaVersion: "atlas-loop.events-export.v1";
  exportedAt: string;
  outPath: string;
  localOnly: true;
  uploaded: false;
}

export const tools = [
  { name: "atlas.health", description: "Check local daemon readiness.", inputSchema: objectSchema([]) },
  { name: "atlas.listSessions", description: "List active and persisted local iOS Simulator sessions.", inputSchema: objectSchema([]) },
  {
    name: "atlas.listSessionHistory",
    description: "List local evidence history across active and persisted sessions.",
    inputSchema: sessionHistorySchema()
  },
  { name: "atlas.getLatestSession", description: "Return the newest readable session using the daemon latest alias.", inputSchema: objectSchema([]) },
  { name: "atlas.createSession", description: "Create a local iOS Simulator session.", inputSchema: createSessionSchema() },
  { name: "atlas.getSession", description: "Get a session by id.", inputSchema: sessionIdSchema() },
  { name: "atlas.getSessionSummary", description: "Get session status, artifact paths, counts, latest action, and latest screenshot metadata.", inputSchema: sessionIdSchema() },
  {
    name: "atlas.sessionReady",
    description: "Return compact readiness for one session: resolved id, status, storage, evidence signals, viewer URL, and mutation safety.",
    inputSchema: objectSchema(["sessionId"], {
      ...sessionIdProperty(),
      daemonUrl: { type: "string", description: "Optional daemon URL override." },
      viewerBaseUrl: { type: "string", description: "Optional viewer app base URL override." }
    })
  },
  {
    name: "atlas.getSessionHandoff",
    description: "Return structured local session handoff data for coding agents, including evidence paths, health summary, blockers, and next CLI commands.",
    inputSchema: objectSchema(["sessionId"], {
      ...sessionIdProperty(),
      daemonUrl: { type: "string", description: "Optional daemon URL override." },
      viewerBaseUrl: { type: "string", description: "Optional viewer app base URL override." }
    })
  },
  {
    name: "atlas.listEvents",
    description: "List local daemon trace events for a session with optional exact type filtering and newest-event limiting.",
    inputSchema: eventListSchema()
  },
  {
    name: "atlas.exportEvents",
    description: "Write filtered local daemon trace events to a local JSON file for agent handoff. Does not upload data.",
    inputSchema: eventExportSchema()
  },
  { name: "atlas.performAction", description: "Perform tap/type/swipe/tapElement/assertVisible/wait/screenshot action.", inputSchema: performActionSchema() },
  {
    name: "atlas.compareBaseline",
    description: "Compare a session screenshot against a locally saved baseline (visual regression); returns changed-pixel ratio and pass/fail.",
    inputSchema: objectSchema(["sessionId", "name"], {
      ...sessionIdProperty(),
      name: { type: "string", minLength: 1, description: "Baseline name saved with: atlas-loop baseline save" },
      artifactId: { type: "string", description: "Compare a specific screenshot artifact instead of the latest." },
      threshold: { type: "number", minimum: 0, description: "Per-pixel channel delta threshold (default 24)." },
      maxDiffRatio: { type: "number", minimum: 0, maximum: 1, description: "Maximum passing changed-pixel ratio (default 0.005)." }
    })
  },
  {
    name: "atlas.getMap",
    description: "Return the Atlas screen map derived from local session evidence: screens, transitions, and observing sessions.",
    inputSchema: objectSchema([], {
      rebuild: { type: "boolean", description: "Force a rebuild instead of serving the cached map." },
      summaryOnly: { type: "boolean", description: "Return a compact summary instead of the full map." }
    })
  },
  { name: "atlas.startRecording", description: "Start a local session video recording (saved under the session's video/ directory).", inputSchema: sessionIdSchema() },
  { name: "atlas.stopRecording", description: "Stop the active session video recording and register the local video artifact.", inputSchema: sessionIdSchema() },
  { name: "atlas.takeScreenshot", description: "Capture a screenshot artifact.", inputSchema: objectSchema(["sessionId"], { ...sessionIdProperty(), reason: { type: "string" } }) },
  { name: "atlas.listArtifacts", description: "List local evidence artifacts.", inputSchema: sessionIdSchema() },
  { name: "atlas.latestScreenshot", description: "Return the latest screenshot artifact reference.", inputSchema: sessionIdSchema() },
  { name: "atlas.getArtifactPath", description: "Return the local artifact directory path for a session.", inputSchema: objectSchema(["sessionId"], { sessionId: { type: "string" } }) },
  { name: "atlas.getLatestScreenshotPath", description: "Return the local path for the latest screenshot artifact.", inputSchema: objectSchema(["sessionId"], { sessionId: { type: "string" } }) },
  {
    name: "atlas.verifyArtifacts",
    description: "Validate a session artifact directory or explicit local artifact target and return a structured report.",
    inputSchema: verifyArtifactsSchema()
  },
  {
    name: "atlas.verifyHandoffBundle",
    description: "Validate an explicit local handoff bundle directory. Local-only: does not call the daemon, open network connections, or upload data.",
    inputSchema: verifyHandoffBundleSchema()
  },
  {
    name: "atlas.getArtifactHealth",
    description: "Inspect daemon-backed artifact health for a session and return the structured health report.",
    inputSchema: sessionIdSchema()
  },
  {
    name: "atlas.getViewerUrl",
    description: "Return the local viewer URL for a session without opening a browser.",
    inputSchema: objectSchema(["sessionId"], {
      sessionId: { type: "string" },
      daemonUrl: { type: "string", description: "Optional daemon URL override." },
      viewerBaseUrl: { type: "string", description: "Optional viewer app base URL override." }
    })
  },
  {
    name: "atlas.getEvidence",
    description: "Return compact agent evidence: artifact directory, latest screenshot path, and viewer URL.",
    inputSchema: objectSchema(["sessionId"], {
      sessionId: { type: "string", description: "Session id or latest." },
      daemonUrl: { type: "string", description: "Optional daemon URL override." },
      viewerBaseUrl: { type: "string", description: "Optional viewer app base URL override." }
    })
  },
  {
    name: "atlas.getEvidenceReport",
    description: "Return compact evidence plus a paste-ready report (Markdown, or a self-contained HTML file with inlined screenshots).",
    inputSchema: objectSchema(["sessionId"], {
      sessionId: { type: "string", description: "Session id or latest." },
      daemonUrl: { type: "string", description: "Optional daemon URL override." },
      viewerBaseUrl: { type: "string", description: "Optional viewer app base URL override." },
      format: { type: "string", enum: ["markdown", "html"], description: "Report format; html inlines screenshots as data URIs." },
      maxScreenshots: { type: "number", minimum: 0, description: "Cap on inlined screenshots for html (default 20)." }
    })
  },
  {
    name: "atlas.exportEvidence",
    description: "Copy a session's local artifact directory into a local export bundle and return metadata. Does not upload artifacts.",
    inputSchema: evidenceExportSchema()
  },
  { name: "atlas.endSession", description: "End a local session.", inputSchema: sessionIdSchema() },
  { name: "atlas.build", description: "Build an iOS app through xcodebuild.", inputSchema: buildSchema() },
  { name: "atlas.install", description: "Install a simulator .app.", inputSchema: installSchema() },
  { name: "atlas.launch", description: "Launch an installed bundle.", inputSchema: launchSchema() }
];

export function startStdioServer(runtime: ToolRuntime = {}): void {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    void handleLine(line, runtime);
  });
}

async function handleLine(line: string, runtime: ToolRuntime): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }

  try {
    if (request.method === "initialize") {
      write({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "atlas-loop", version: "0.1.0" }, capabilities: { tools: {} } } });
      return;
    }
    if (request.method === "tools/list") {
      write({ jsonrpc: "2.0", id: request.id, result: { tools } });
      return;
    }
    if (request.method === "tools/call") {
      const name = String(request.params?.name ?? "");
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      const result = await callToolWithEnvelope(name, args, runtime);
      write({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: !result.ok
        }
      });
      return;
    }
    write({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Unknown method ${request.method}` } });
  } catch (error) {
    write({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: (error as Error).message } });
  }
}

export async function callToolWithEnvelope(name: string, args: Record<string, unknown>, runtime: ToolRuntime = {}): Promise<{ ok: true; data: unknown } | { ok: false; error: AtlasLoopError }> {
  try {
    return { ok: true, data: await callTool(name, args, runtime) };
  } catch (error) {
    return { ok: false, error: normalizeToolError(error) };
  }
}

async function callTool(name: string, args: Record<string, unknown>, runtime: ToolRuntime): Promise<unknown> {
  if (name === "atlas.verifyHandoffBundle") {
    return verifyHandoffBundle(args);
  }

  const client = runtime.client ?? await defaultDaemonClient(args, runtime);
  switch (name) {
    case "atlas.health":
      return client.health();
    case "atlas.listSessions":
      return client.listSessions();
    case "atlas.listSessionHistory":
      return listSessionHistory(client, args);
    case "atlas.getLatestSession":
      return client.getSession("latest");
    case "atlas.createSession":
      return client.createSession(args);
    case "atlas.getSession":
      return client.getSession(requireString(args, "sessionId"));
    case "atlas.getSessionSummary":
      return client.getSessionSummary(requireString(args, "sessionId"));
    case "atlas.sessionReady":
      return getSessionReady(client, args, runtime);
    case "atlas.getSessionHandoff":
      return getSessionHandoff(client, args, runtime);
    case "atlas.listEvents":
      return listEvents(client, args);
    case "atlas.exportEvents":
      return exportEvents(client, args);
    case "atlas.performAction":
      return client.performAction(requireString(args, "sessionId"), { action: requireActionInput(args.action) });
    case "atlas.takeScreenshot":
      return client.screenshot(requireString(args, "sessionId"), typeof args.reason === "string" ? args.reason : undefined);
    case "atlas.listArtifacts":
      return client.listArtifacts(requireString(args, "sessionId"));
    case "atlas.latestScreenshot":
      return client.latestScreenshot(requireString(args, "sessionId"));
    case "atlas.getArtifactPath":
      return getArtifactPath(client, args);
    case "atlas.getLatestScreenshotPath":
      return getLatestScreenshotPath(client, args);
    case "atlas.verifyArtifacts":
      return verifyArtifacts(client, args);
    case "atlas.getArtifactHealth":
      return getArtifactHealth(client, requireString(args, "sessionId"));
    case "atlas.getViewerUrl":
      return getViewerUrl(args, runtime);
    case "atlas.getEvidence":
      return getEvidence(client, args, runtime);
    case "atlas.getEvidenceReport":
      return getEvidenceReport(client, args, runtime);
    case "atlas.exportEvidence":
      return exportLocalEvidence(client, {
        sessionId: requireString(args, "sessionId"),
        outDir: requireString(args, "outDir")
      });
    case "atlas.endSession":
      return client.endSession(requireString(args, "sessionId"));
    case "atlas.compareBaseline":
      return compareBaseline(client, args, runtime);
    case "atlas.getMap": {
      if (!client.getAtlasMap) throw new Error("daemon client does not support getAtlasMap");
      const view = (await client.getAtlasMap(args.rebuild === true)) as {
        source?: string;
        map?: { generatedAt?: string; sessions?: unknown[]; screens?: Array<Record<string, unknown>>; transitions?: Array<Record<string, unknown>> };
        warnings?: unknown[];
      };
      if (args.summaryOnly === true && view?.map) {
        return {
          source: view.source,
          generatedAt: view.map.generatedAt,
          sessions: view.map.sessions?.length ?? 0,
          screens: (view.map.screens ?? []).map((screen) => ({
            id: screen.id,
            screenId: screen.screenId,
            screenshotCount: screen.screenshotCount,
            sessionIds: screen.sessionIds
          })),
          transitions: (view.map.transitions ?? []).length,
          topTransitions: (view.map.transitions ?? []).slice(0, 10).map((transition) => ({
            id: transition.id,
            count: transition.count
          })),
          warnings: view.warnings ?? []
        };
      }
      return view;
    }
    case "atlas.startRecording": {
      if (!client.startRecording) throw new Error("daemon client does not support startRecording");
      return client.startRecording(requireString(args, "sessionId"));
    }
    case "atlas.stopRecording": {
      if (!client.stopRecording) throw new Error("daemon client does not support stopRecording");
      return client.stopRecording(requireString(args, "sessionId"));
    }
    case "atlas.build":
      return client.build(requireString(args, "sessionId"), buildRequest(args));
    case "atlas.install":
      return client.install(requireString(args, "sessionId"), { appPath: requireString(args, "appPath") });
    case "atlas.launch":
      return client.launch(requireString(args, "sessionId"), launchRequest(args));
    default:
      throw Object.assign(new Error(`Unknown tool ${name}`), { code: "NOT_FOUND" });
  }
}

async function getArtifactPath(client: McpDaemonClient, args: Record<string, unknown>): Promise<{ path: string }> {
  const summary = await client.getSessionSummary(requireString(args, "sessionId"));
  const path = summary.paths?.artifactDir;
  if (typeof path !== "string" || !path) throw new Error("session summary did not include paths.artifactDir");
  return { path };
}

async function listEvents(client: Pick<McpDaemonClient, "events">, args: Record<string, unknown>): Promise<EventListResult> {
  const sessionId = requireString(args, "sessionId");
  const type = optionalString(args, "type");
  const limit = optionalNonNegativeInteger(args, "limit");
  const events = await client.events(sessionId);
  const matchingEvents = type
    ? events.filter((event) => event.type === type)
    : events;
  const selectedEvents = limit === undefined
    ? matchingEvents
    : limit === 0
      ? []
      : matchingEvents.slice(-limit);

  return {
    requestedSessionId: sessionId,
    filters: eventFilters(type, limit),
    total: events.length,
    matched: matchingEvents.length,
    count: selectedEvents.length,
    events: selectedEvents
  };
}

async function listSessionHistory(
  client: Pick<McpDaemonClient, "listSessionHistory" | "request">,
  args: Record<string, unknown>
): Promise<unknown> {
  const limit = optionalNonNegativeInteger(args, "limit");
  const request = limit === undefined ? {} : { limit };
  if (typeof client.listSessionHistory === "function") {
    return client.listSessionHistory(request);
  }
  if (typeof client.request === "function") {
    return client.request("GET", sessionHistoryPath(limit));
  }
  throw new Error("daemon client does not support session history");
}

async function exportEvents(client: Pick<McpDaemonClient, "events">, args: Record<string, unknown>): Promise<EventExportResult> {
  const outPath = resolveLocalPath(requireString(args, "outPath"), "event export outPath");
  const result = await listEvents(client, args);
  const payload: EventExportResult = {
    schemaVersion: "atlas-loop.events-export.v1",
    ...result,
    exportedAt: new Date().toISOString(),
    outPath,
    localOnly: true,
    uploaded: false
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

async function getSessionReady(
  client: McpDaemonClient,
  args: Record<string, unknown>,
  runtime: ToolRuntime
): Promise<SessionReadiness> {
  const requestedSessionId = requireString(args, "sessionId");
  const summary = await client.getSessionSummary(requestedSessionId);
  const sessionId = firstString(summary.session?.id) ?? requestedSessionId;
  const status = firstString(summary.session?.status) ?? "unknown";
  const artifactDir = firstString(summary.paths?.artifactDir);
  if (!artifactDir) throw new Error("session summary did not include paths.artifactDir");

  const storageSource = firstString(summary.storage?.source) ?? "unknown";
  const storageWarnings = Array.isArray(summary.storage?.warnings) ? summary.storage.warnings : [];
  const latestScreenshotPath = firstString(summary.artifacts?.latestScreenshot?.path)
    ?? firstString(summary.artifacts?.latestScreenshotPath)
    ?? null;
  const latestAction = latestActionSummary(summary.events?.latestAction);
  const viewer = await getViewerUrl({ ...args, sessionId }, runtime);

  return {
    sessionId,
    requestedSessionId,
    status,
    storage: {
      source: storageSource,
      artifactBacked: Boolean(summary.storage?.artifactBacked),
      warningCount: storageWarnings.length
    },
    artifactDir,
    latestScreenshotPath,
    ...(latestAction ? { latestAction } : {}),
    ...(summary.events?.latestError ? { latestError: summary.events.latestError } : {}),
    viewerUrl: viewer.url,
    daemonUrl: viewer.daemonUrl,
    viewerBaseUrl: viewer.viewerBaseUrl,
    canMutate: storageSource === "memory" && isLiveSessionStatus(status),
    hasScreenshot: latestScreenshotPath !== null
  };
}

async function getSessionHandoff(
  client: McpDaemonClient,
  args: Record<string, unknown>,
  runtime: ToolRuntime
) {
  const handoffClient = {
    getSessionSummary: (sessionId: string) => client.getSessionSummary(sessionId),
    getSessionArtifactHealth: (sessionId: string) => getArtifactHealth(client, sessionId)
  };
  return buildSessionHandoff(handoffClient, {
    sessionId: requireString(args, "sessionId"),
    daemonUrl: await resolveRuntimeDaemonUrl(args, runtime),
    viewerBaseUrl: optionalString(args, "viewerBaseUrl") ?? runtime.viewerBaseUrl
  });
}

async function getLatestScreenshotPath(client: McpDaemonClient, args: Record<string, unknown>): Promise<{ path: string; artifact: unknown }> {
  const artifact = await client.latestScreenshot(requireString(args, "sessionId"));
  if (typeof artifact.path !== "string" || !artifact.path) throw new Error("latest screenshot did not include a path");
  return { path: artifact.path, artifact };
}

async function verifyArtifacts(client: Pick<McpDaemonClient, "getSessionSummary">, args: Record<string, unknown>): Promise<ArtifactVerification> {
  const requestedSessionId = optionalString(args, "sessionId");
  const requestedPath = optionalString(args, "path");
  const hasSessionId = requestedSessionId !== undefined;
  const hasPath = requestedPath !== undefined;
  if (hasSessionId === hasPath) {
    throw Object.assign(new Error("Provide exactly one of sessionId or path"), { code: "INVALID_REQUEST" });
  }

  if (requestedSessionId) {
    const summary = await client.getSessionSummary(requestedSessionId);
    const artifactDir = firstString(summary.paths?.artifactDir);
    if (!artifactDir) throw new Error("session summary did not include paths.artifactDir");
    const report = await validateArtifactTarget(resolveLocalPath(artifactDir, "session summary paths.artifactDir"));
    return {
      ok: report.ok,
      target: report.target,
      source: "session",
      requestedSessionId,
      sessionId: firstString(summary.session?.id) ?? requestedSessionId,
      artifactDir,
      report
    };
  }

  const report = await validateArtifactTarget(resolveLocalPath(requestedPath as string, "artifact validation path"));
  return {
    ok: report.ok,
    target: report.target,
    source: "path",
    requestedPath,
    report
  };
}

async function getArtifactHealth(client: Pick<McpDaemonClient, "getSessionArtifactHealth" | "getArtifactHealth" | "request">, sessionId: string): Promise<ArtifactHealth> {
  if (typeof client.getSessionArtifactHealth === "function") {
    return client.getSessionArtifactHealth(sessionId);
  }
  if (typeof client.getArtifactHealth === "function") {
    return client.getArtifactHealth(sessionId);
  }
  if (typeof client.request === "function") {
    return client.request<ArtifactHealth>("GET", artifactHealthPath(sessionId));
  }
  throw new Error("daemon client does not support artifact health");
}

async function getEvidence(
  client: McpDaemonClient,
  args: Record<string, unknown>,
  runtime: ToolRuntime
): Promise<CompactEvidenceSummary> {
  const requestedSessionId = requireString(args, "sessionId");
  const summary = await client.getSessionSummary(requestedSessionId);
  const sessionId = firstString(summary.session.id) ?? requestedSessionId;
  const artifactDir = firstString(summary.paths?.artifactDir);
  if (!artifactDir) throw new Error("session summary did not include paths.artifactDir");

  const latestScreenshot = await evidenceLatestScreenshot(client, sessionId, summary);
  if (latestScreenshot) requireArtifactPath(latestScreenshot);
  const viewer = await getViewerUrl({ ...args, sessionId }, runtime);

  return {
    sessionId,
    requestedSessionId,
    artifactDir,
    latestScreenshotPath: latestScreenshot ? requireArtifactPath(latestScreenshot) : null,
    latestScreenshot: latestScreenshot as ArtifactRef | null,
    viewerUrl: viewer.url,
    daemonUrl: viewer.daemonUrl,
    viewerBaseUrl: viewer.viewerBaseUrl
  };
}

async function compareBaseline(
  client: McpDaemonClient,
  args: Record<string, unknown>,
  runtime: ToolRuntime
): Promise<Record<string, unknown>> {
  const sessionId = requireString(args, "sessionId");
  const name = requireString(args, "name");
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) {
    throw new Error("baseline name must be 1-64 chars of letters, digits, dot, dash, or underscore");
  }
  void runtime;

  const config = await loadAtlasLoopConfig();
  const baselinePath = join(resolve(config.artifactRoot, ".."), "baselines", `${name}.png`);
  let baselineData: Buffer;
  try {
    baselineData = await readFile(baselinePath);
  } catch {
    throw new Error(`no baseline named ${name} at ${baselinePath}; save one with: atlas-loop baseline save --session latest --name ${name}`);
  }

  let artifact: Partial<ArtifactRef>;
  const artifactId = typeof args.artifactId === "string" ? args.artifactId : undefined;
  if (artifactId) {
    const artifacts = (await client.listArtifacts(sessionId)) as ArtifactRef[];
    const match = artifacts.find((candidate) => candidate.id === artifactId);
    if (!match) throw new Error(`artifact ${artifactId} not found in session ${sessionId}`);
    if (match.type !== "screenshot") throw new Error(`artifact ${artifactId} is ${match.type}, not a screenshot`);
    artifact = match;
  } else {
    artifact = await client.latestScreenshot(sessionId);
  }
  if (!artifact.path) throw new Error("screenshot artifact has no local path");

  const threshold = typeof args.threshold === "number" ? args.threshold : DEFAULT_DIFF_THRESHOLD;
  const maxDiffRatio = typeof args.maxDiffRatio === "number" ? args.maxDiffRatio : 0.005;
  const result = diffPngs(baselineData, await readFile(artifact.path), threshold);
  const pass = result.changedRatio <= maxDiffRatio;

  return {
    pass,
    name,
    changedRatio: result.changedRatio,
    changedPercent: Number((result.changedRatio * 100).toFixed(4)),
    changedCount: result.changedCount,
    totalCount: result.totalCount,
    threshold,
    maxDiffRatio,
    baselinePath,
    screenshotPath: artifact.path,
    screenshotArtifactId: artifact.id,
    localOnly: true
  };
}

async function getEvidenceReport(
  client: McpDaemonClient,
  args: Record<string, unknown>,
  runtime: ToolRuntime
): Promise<{ evidence: EvidenceReportData; report: string; format: "markdown" | "html" }> {
  const format = args.format === "html" ? "html" : "markdown";
  const evidence = await getEvidenceReportData(client, args, runtime);
  if (format === "html") {
    const [artifacts, events, metrics, atlasMapView] = await Promise.all([
      client.listArtifacts(evidence.sessionId) as Promise<import("@atlas-loop/protocol").ArtifactRef[]>,
      client.events(evidence.sessionId),
      client.getSessionMetrics?.(evidence.sessionId).catch(() => ({ samples: [] })) ?? Promise.resolve({ samples: [] }),
      client.getAtlasMap?.(false).catch(() => undefined) ?? Promise.resolve(undefined)
    ]);
    const assets = await collectEvidenceHtmlAssets({
      artifacts,
      events,
      metrics: metrics.samples,
      maxScreenshots: typeof args.maxScreenshots === "number" ? args.maxScreenshots : 20,
      readFile: (path) => readFile(path)
    });
    const atlas = evidenceHtmlAtlasFromMapView(atlasMapView, evidence.sessionId);
    if (atlas) assets.atlas = atlas;
    return { evidence, report: buildEvidenceHtmlReport(evidence, assets), format };
  }
  return {
    evidence,
    report: buildEvidenceMarkdownReport(evidence),
    format
  };
}

async function getEvidenceReportData(
  client: McpDaemonClient,
  args: Record<string, unknown>,
  runtime: ToolRuntime
): Promise<EvidenceReportData> {
  const requestedSessionId = requireString(args, "sessionId");
  const summary = await client.getSessionSummary(requestedSessionId);
  const sessionId = firstString(summary.session.id) ?? requestedSessionId;
  const artifactDir = firstString(summary.paths?.artifactDir);
  if (!artifactDir) throw new Error("session summary did not include paths.artifactDir");
  const latestScreenshot = await evidenceLatestScreenshot(client, sessionId, summary);
  if (latestScreenshot) requireArtifactPath(latestScreenshot);
  const artifactHighlights = await evidenceArtifactHighlights(client, sessionId);
  const viewer = await getViewerUrl({ ...args, sessionId }, runtime);

  return evidenceReportDataFromSessionSummary({
    ...summary,
    session: { ...summary.session, id: sessionId }
  }, {
    requestedSessionId,
    daemonUrl: viewer.daemonUrl,
    viewerBaseUrl: viewer.viewerBaseUrl,
    viewerUrl: viewer.url,
    latestScreenshot: latestScreenshot as ArtifactRef | null,
    artifactHighlights
  });
}

async function exportLocalEvidence(
  client: Pick<McpDaemonClient, "getSessionSummary">,
  params: { sessionId: string; outDir: string }
): Promise<LocalEvidenceExportMetadata> {
  const summary = await client.getSessionSummary(params.sessionId);
  const sessionId = firstString(summary.session?.id) ?? params.sessionId;
  const artifactDir = firstString(summary.paths?.artifactDir);
  if (!artifactDir) throw new Error("session summary did not include paths.artifactDir");

  const sourceArtifactDir = resolveLocalPath(artifactDir, "session summary paths.artifactDir");
  const exported = await exportSessionArtifacts(dirname(sourceArtifactDir), basename(sourceArtifactDir), {
    outputDir: resolve(params.outDir)
  });

  const artifacts = summary.artifacts ?? { total: 0, byType: {} };
  const storage: SessionSummary["storage"] = summary.storage ?? { source: "memory", artifactBacked: false, warnings: [] };
  const latestScreenshotPath = artifacts.latestScreenshot?.path ?? artifacts.latestScreenshotPath ?? null;
  const metadataPath = join(exported.outputDir, "atlas-evidence-export.json");
  const metadata: LocalEvidenceExportMetadata = {
    schemaVersion: "atlas-loop.evidence-export.v1",
    sessionId,
    requestedSessionId: params.sessionId,
    exportedAt: exported.metadata.exportedAt,
    bundleDir: exported.outputDir,
    metadataPath,
    artifactExportMetadataPath: exported.metadataPath,
    sourceArtifactDir: exported.metadata.sourceSessionDir,
    localOnly: true,
    uploaded: false,
    artifactTotal: artifacts.total ?? 0,
    fileCount: exported.metadata.fileCount,
    byteCount: exported.metadata.byteCount,
    latestScreenshotPath,
    exportedLatestScreenshotPath: latestScreenshotPath
      ? mapSourcePathToBundle(sourceArtifactDir, exported.outputDir, latestScreenshotPath)
      : null,
    storage
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

async function evidenceLatestScreenshot(
  client: McpDaemonClient,
  sessionId: string,
  summary: SessionSummary
): Promise<unknown | null> {
  const summaryScreenshot = summary.artifacts?.latestScreenshot;
  if (artifactPath(summaryScreenshot)) return summaryScreenshot;
  try {
    const latestScreenshot = await client.latestScreenshot(sessionId);
    return artifactPath(latestScreenshot) ? latestScreenshot : null;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function evidenceArtifactHighlights(client: McpDaemonClient, sessionId: string): Promise<ArtifactRef[]> {
  if (typeof client.listArtifacts !== "function") return [];
  try {
    const artifacts = await client.listArtifacts(sessionId);
    return Array.isArray(artifacts) ? artifacts.filter(isArtifactRef) : [];
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

async function getViewerUrl(args: Record<string, unknown>, runtime: ToolRuntime): Promise<{ url: string; sessionId: string; daemonUrl: string; viewerBaseUrl: string }> {
  const sessionId = requireString(args, "sessionId");
  const daemonUrl = await resolveRuntimeDaemonUrl(args, runtime);
  const viewerBaseUrl = optionalString(args, "viewerBaseUrl") ?? runtime.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL;
  return {
    url: buildViewerUrl({ daemonUrl, sessionId, viewerBaseUrl }),
    sessionId,
    daemonUrl,
    viewerBaseUrl: trimTrailingSlash(viewerBaseUrl)
  };
}

async function defaultDaemonClient(args: Record<string, unknown>, runtime: ToolRuntime): Promise<McpDaemonClient> {
  return new DaemonClient({ baseUrl: await resolveRuntimeDaemonUrl(args, runtime) });
}

async function resolveRuntimeDaemonUrl(args: Record<string, unknown>, runtime: ToolRuntime): Promise<string> {
  return optionalString(args, "daemonUrl") ?? (await (runtime.loadConfig ?? loadAtlasLoopConfig)()).daemonUrl;
}

export function buildViewerUrl(params: { daemonUrl: string; sessionId: string; viewerBaseUrl?: string }): string {
  const viewerBaseUrl = trimTrailingSlash(params.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL);
  return `${viewerBaseUrl}?daemonUrl=${encodeURIComponent(params.daemonUrl)}&sessionId=${encodeURIComponent(params.sessionId)}`;
}

async function verifyHandoffBundle(args: Record<string, unknown>): Promise<unknown> {
  const bundleDir = resolveLocalPath(requireString(args, "bundleDir"), "handoff bundle path");
  return verifySessionHandoffBundle({ bundleDir });
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} is required`);
  return value;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function optionalNonNegativeInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${key} must be a non-negative integer`);
  }
  return value;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${key} must be an array of strings`);
  return value;
}

function optionalStringRecord(args: Record<string, unknown>, key: string): Record<string, string> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} must be an object of string values`);
  const entries = Object.entries(value);
  if (entries.some(([entryKey, entryValue]) => !entryKey || typeof entryValue !== "string")) {
    throw new Error(`${key} must be an object of string values`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

function optionalBuildConfiguration(args: Record<string, unknown>): BuildRequest["configuration"] {
  const configuration = optionalString(args, "configuration");
  if (configuration === undefined || configuration === "Debug" || configuration === "Release") return configuration;
  throw new Error("configuration must be Debug or Release");
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function artifactPath(artifact: unknown): string | undefined {
  if (!artifact || typeof artifact !== "object") return undefined;
  return firstString((artifact as { path?: unknown }).path);
}

function isArtifactRef(artifact: unknown): artifact is ArtifactRef {
  return Boolean(
    artifact &&
    typeof artifact === "object" &&
    firstString((artifact as { id?: unknown }).id) &&
    firstString((artifact as { type?: unknown }).type) &&
    firstString((artifact as { path?: unknown }).path)
  );
}

function requireArtifactPath(artifact: unknown): string {
  const path = artifactPath(artifact);
  if (!path) throw new Error("latest screenshot did not include a path");
  return path;
}

function latestActionSummary(action: SessionSummary["events"]["latestAction"] | undefined): SessionReadiness["latestAction"] | undefined {
  if (!action?.actionId) return undefined;
  return { id: action.actionId, ok: action.ok };
}

function isLiveSessionStatus(status: string): boolean {
  return status !== "ended" && status !== "failed" && status !== "unknown";
}

function resolveLocalPath(path: string, label: string): string {
  if (!path || path.includes("://")) throw new Error(`${label} must be a local filesystem path`);
  return resolve(path);
}

function mapSourcePathToBundle(sourceDir: string, bundleDir: string, sourcePath: string): string | null {
  const resolvedPath = resolve(sourcePath);
  const relativePath = relative(sourceDir, resolvedPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return join(bundleDir, relativePath);
}

function artifactHealthPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}/artifacts/health`;
}

function sessionHistoryPath(limit: number | undefined): string {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  const query = params.toString();
  return `/sessions/history${query ? `?${query}` : ""}`;
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof DaemonClientError) return error.code === "NOT_FOUND";
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "NOT_FOUND"
  );
}

function requireActionInput(value: unknown): ActionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("action is required");
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (typeof kind !== "string") throw new Error("action.kind is required");

  const action = normalizeActionInput(kind, record);
  validateActionInput(action);
  return action;
}

function normalizeActionInput(kind: string, record: Record<string, unknown>): ActionInput {
  switch (kind) {
    case "tap":
      return { kind, x: numberField(record, "x"), y: numberField(record, "y") };
    case "typeText":
      return { kind, text: stringField(record, "text") };
    case "swipe":
      return {
        kind,
        from: pointField(record, "from"),
        to: pointField(record, "to"),
        durationMs: numberField(record, "durationMs")
      };
    case "edgeGesture":
      return {
        kind,
        edge: stringField(record, "edge") as Edge,
        distance: numberField(record, "distance"),
        durationMs: numberField(record, "durationMs")
      };
    case "tapElement":
    case "assertVisible": {
      const timeoutMs = record.timeoutMs;
      return {
        kind,
        identifier: stringField(record, "identifier"),
        ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
        ...(kind === "assertVisible" && record.markScreen === true ? { markScreen: true } : {})
      };
    }
    case "screenshot": {
      const reason = record.reason;
      return optionalStringValue(reason) ? { kind, reason } : { kind };
    }
    case "wait":
      return { kind, durationMs: numberField(record, "durationMs") };
    default:
      throw new Error(`unknown action ${kind}`);
  }
}

function pointField(record: Record<string, unknown>, key: string): { x: number; y: number } {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`action.${key} must be a point`);
  const point = value as Record<string, unknown>;
  return { x: numberField(point, "x"), y: numberField(point, "y") };
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") throw new Error(`action.${key} must be a number`);
  return value;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`action.${key} must be a string`);
  return value;
}

function optionalStringValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function buildRequest(args: Record<string, unknown>): BuildRequest {
  return definedRequest({
    workspacePath: optionalString(args, "workspacePath"),
    projectPath: optionalString(args, "projectPath"),
    scheme: requireString(args, "scheme"),
    configuration: optionalBuildConfiguration(args),
    derivedDataPath: optionalString(args, "derivedDataPath")
  });
}

function launchRequest(args: Record<string, unknown>): LaunchRequest {
  return definedRequest({
    bundleId: requireString(args, "bundleId"),
    arguments: optionalStringArray(args, "arguments"),
    environment: optionalStringRecord(args, "environment")
  });
}

function definedRequest<T extends Record<string, unknown>>(request: T): T {
  return Object.fromEntries(Object.entries(request).filter(([, value]) => value !== undefined)) as T;
}

function sessionIdProperty(): Record<string, unknown> {
  return { sessionId: { type: "string", description: "Session id or latest." } };
}

function sessionIdSchema(): Record<string, unknown> {
  return objectSchema(["sessionId"], sessionIdProperty());
}

function createSessionSchema(): Record<string, unknown> {
  return objectSchema([], {
    simulator: objectSchema([], {
      udid: { type: "string" },
      name: { type: "string" },
      runtime: { type: "string" },
      booted: { type: "boolean" }
    }),
    artifactRoot: { type: "string" },
    viewer: { type: "boolean" },
    inputBackend: {
      type: "string",
      enum: ["cgevent", "xcuitest"],
      description: "Input backend for the session. xcuitest drives real headless input including tapElement/assertVisible."
    },
    record: {
      type: "boolean",
      description: "Start a session-long local video recording immediately (explicit opt-in)."
    }
  });
}

function buildSchema(): Record<string, unknown> {
  return objectSchema(["sessionId", "scheme"], {
    ...sessionIdProperty(),
    workspacePath: { type: "string", description: "Path to an .xcworkspace." },
    projectPath: { type: "string", description: "Path to an .xcodeproj." },
    scheme: { type: "string" },
    configuration: { type: "string", enum: ["Debug", "Release"] },
    derivedDataPath: { type: "string" }
  });
}

function installSchema(): Record<string, unknown> {
  return objectSchema(["sessionId", "appPath"], {
    ...sessionIdProperty(),
    appPath: { type: "string", description: "Path to a Simulator-compatible .app bundle." }
  });
}

function launchSchema(): Record<string, unknown> {
  return objectSchema(["sessionId", "bundleId"], {
    ...sessionIdProperty(),
    bundleId: { type: "string" },
    arguments: { type: "array", items: { type: "string" } },
    environment: { type: "object", additionalProperties: { type: "string" } }
  });
}

function evidenceExportSchema(): Record<string, unknown> {
  return objectSchema(["sessionId", "outDir"], {
    ...sessionIdProperty(),
    outDir: { type: "string", description: "Local directory where the export bundle will be written." }
  });
}

function sessionHistorySchema(): Record<string, unknown> {
  return objectSchema([], {
    limit: { type: "integer", minimum: 0, description: "Return at most this many newest history entries." },
    daemonUrl: { type: "string", description: "Optional daemon URL override." }
  });
}

function eventListSchema(): Record<string, unknown> {
  return objectSchema(["sessionId"], {
    ...sessionIdProperty(),
    type: { type: "string", description: "Exact trace event type to include." },
    limit: { type: "integer", minimum: 0, description: "Return at most this many newest matching events." },
    daemonUrl: { type: "string", description: "Optional daemon URL override." }
  });
}

function eventExportSchema(): Record<string, unknown> {
  return objectSchema(["sessionId", "outPath"], {
    ...sessionIdProperty(),
    outPath: { type: "string", description: "Local JSON file path to write." },
    type: { type: "string", description: "Exact trace event type to include." },
    limit: { type: "integer", minimum: 0, description: "Return at most this many newest matching events." },
    daemonUrl: { type: "string", description: "Optional daemon URL override." }
  });
}

function verifyArtifactsSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      sessionId: { type: "string", description: "Session id or latest." },
      path: { type: "string", description: "Local artifact directory or artifact root to validate." }
    },
    oneOf: [
      { required: ["sessionId"] },
      { required: ["path"] }
    ],
    additionalProperties: false
  };
}

function verifyHandoffBundleSchema(): Record<string, unknown> {
  return objectSchema(["bundleDir"], {
    bundleDir: {
      type: "string",
      description: "Local handoff bundle directory to verify. Local-only: does not call the daemon or upload data."
    }
  });
}

function performActionSchema(): Record<string, unknown> {
  return objectSchema(["sessionId", "action"], {
    ...sessionIdProperty(),
    action: {
      oneOf: [
        objectSchema(["kind", "x", "y"], {
          kind: { const: "tap" },
          x: normalizedNumberSchema(),
          y: normalizedNumberSchema()
        }),
        objectSchema(["kind", "text"], {
          kind: { const: "typeText" },
          text: { type: "string", minLength: 1 }
        }),
        objectSchema(["kind", "from", "to", "durationMs"], {
          kind: { const: "swipe" },
          from: pointSchema(),
          to: pointSchema(),
          durationMs: { type: "number", minimum: 0 }
        }),
        objectSchema(["kind", "edge", "distance", "durationMs"], {
          kind: { const: "edgeGesture" },
          edge: { type: "string", enum: ["left", "right", "top", "bottom"] },
          distance: normalizedNumberSchema(),
          durationMs: { type: "number", minimum: 0 }
        }),
        objectSchema(["kind", "identifier"], {
          kind: { const: "tapElement" },
          identifier: { type: "string", minLength: 1 },
          timeoutMs: { type: "number", minimum: 0 }
        }),
        objectSchema(["kind", "identifier"], {
          kind: { const: "assertVisible" },
          identifier: { type: "string", minLength: 1 },
          timeoutMs: { type: "number", minimum: 0 },
          markScreen: { type: "boolean", description: "Mark the asserted element as a screen-level container for Atlas map naming." }
        }),
        objectSchema(["kind"], {
          kind: { const: "screenshot" },
          reason: { type: "string" }
        }),
        objectSchema(["kind", "durationMs"], {
          kind: { const: "wait" },
          durationMs: { type: "number", minimum: 0 }
        })
      ]
    }
  });
}

function pointSchema(): Record<string, unknown> {
  return objectSchema(["x", "y"], {
    x: normalizedNumberSchema(),
    y: normalizedNumberSchema()
  });
}

function normalizedNumberSchema(): Record<string, unknown> {
  return { type: "number", minimum: 0, maximum: 1 };
}

function objectSchema(required: string[], properties: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

function eventFilters(type: string | undefined, limit: number | undefined): EventListResult["filters"] {
  const filters: EventListResult["filters"] = {};
  if (type !== undefined) filters.type = type;
  if (limit !== undefined) filters.limit = limit;
  return filters;
}

function normalizeToolError(error: unknown): AtlasLoopError {
  if (error instanceof DaemonClientError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      details: error.details
    };
  }
  if (isAtlasLoopError(error)) return error;
  if (error instanceof Error) {
    const maybeCode = (error as { code?: unknown }).code;
    const code = typeof maybeCode === "string"
      ? maybeCode as AtlasLoopError["code"]
      : "INVALID_REQUEST";
    return { code, message: error.message };
  }
  return { code: "COMMAND_FAILED", message: String(error) };
}

function isAtlasLoopError(error: unknown): error is AtlasLoopError {
  return Boolean(
    error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isEntrypoint(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
}

if (isEntrypoint()) {
  startStdioServer();
}
