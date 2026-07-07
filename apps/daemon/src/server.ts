import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  appendActionRecord,
  artifactFromPath,
  copyScreenshot,
  createSessionArtifacts,
  getSessionArtifactLayout,
  listPersistedSessions,
  markLatestScreenshot,
  recordTrace,
  readPersistedSession,
  resolveContainedArtifactPath,
  writeLog,
  writeManifest,
  writeMetadata,
  writeSession,
  type PersistedSessionRecord,
  type PersistedSessionWarning,
  type SessionArtifacts
} from "@atlas-loop/artifacts";
import { loadConfig, type AtlasLoopConfig } from "@atlas-loop/config";
import { HidClient, type HidClientOptions } from "@atlas-loop/hid-client";
import {
  atlasError,
  makeId,
  materializeAction,
  nowIso,
  type Action,
  type ActionInput,
  type ActionResult,
  type ApiEnvelope,
  type ArtifactRef,
  type ArtifactType,
  type AtlasLoopError,
  type AtlasLoopErrorCode,
  type BuildRequest,
  type CreateSessionRequest,
  type InstallAction,
  type InstallRequest,
  type LaunchAction,
  type LaunchRequest,
  type PerformActionRequest,
  type AtlasMap,
  type Session,
  type SessionHistoryItem,
  type SessionHistoryResult,
  type SessionStatus,
  type TraceEvent
} from "@atlas-loop/protocol";
import { parseTraceLine } from "@atlas-loop/traces";
import { createSimulator, type RecordingHandle } from "@atlas-loop/simulator";
import { validateArtifactTarget, type ValidationReport } from "../../../scripts/verify-artifacts.ts";
import { deriveAtlasMap, loadHashCache, saveHashCache } from "@atlas-loop/atlas-map";
import { XcuitestRunnerManager } from "@atlas-loop/xcuitest-client";
import { parseLaunchPid, startMetricsSampler, type MetricsSample, type MetricsSamplerHandle } from "./metricsSampler.ts";
import { createCgEventBackend } from "./backends/cgevent.ts";
import { createXcuitestBackend, type XcuitestManagerLike } from "./backends/xcuitest.ts";
import type { InputAction, InputBackend } from "./backends/types.ts";

export type SimulatorApi = ReturnType<typeof createSimulator>;

export interface DaemonOptions {
  cwd?: string;
  host?: string;
  port?: number;
  artifactRoot?: string;
  hidHelperPath?: string;
  autoScreenshot?: boolean;
  metricsIntervalMs?: number;
  simulator?: SimulatorApi;
  hidClientFactory?: (options: HidClientOptions) => HidClient;
  xcuitestManagerFactory?: () => XcuitestManagerLike;
}

export interface StartedDaemon {
  server: Server;
  url: string;
  close: () => Promise<void>;
}

interface SessionState {
  session: Session;
  layout: SessionArtifacts;
  artifacts: ArtifactRef[];
  sequence: number;
  source: "memory" | "disk";
  warnings: PersistedSessionWarning[];
  recording?: { handle: RecordingHandle; path: string; startedAt: string };
  metrics?: { handle: MetricsSamplerHandle; path: string; startedAt: string };
}

interface DaemonState {
  startedAt: number;
  config: AtlasLoopConfig;
  host: string;
  port: number;
  simulator: SimulatorApi;
  hidClientFactory: (options: HidClientOptions) => HidClient;
  xcuitestManagerFactory: () => XcuitestManagerLike;
  xcuitestManager?: XcuitestManagerLike;
  xcuitestTargets: Map<string, string>;
  metricsIntervalMs: number;
  sessions: Map<string, SessionState>;
}

interface SessionSummary {
  session: Session;
  paths: {
    artifactDir: string;
    manifest: string;
    trace: string;
    screenshots: string;
  };
  artifacts: {
    total: number;
    byType: Partial<Record<ArtifactType, number>>;
    latestScreenshot?: ArtifactRef;
    latestScreenshotId?: string;
    latestScreenshotPath?: string;
    latestScreenshotCreatedAt?: string;
  };
  events: {
    total: number;
    latestAction?: Pick<ActionResult, "actionId" | "ok" | "startedAt" | "endedAt" | "error"> & {
      artifactCount: number;
    };
    latestError?: AtlasLoopError;
  };
  storage: {
    source: "memory" | "disk";
    artifactBacked: boolean;
    warnings: PersistedSessionWarning[];
  };
  recording: { active: boolean; startedAt: string; path: string } | null;
}

interface SessionArtifactHealth {
  ok: boolean;
  target: string;
  sessionId: string;
  requestedSessionId: string;
  source: SessionState["source"];
  artifactDir: string;
  report: ValidationReport;
  summary: {
    sessionCount: number;
    errorCount: number;
    warningCount: number;
    issueCount: number;
  };
}

export async function startDaemonServer(options: DaemonOptions = {}): Promise<StartedDaemon> {
  const config = await loadConfig(options.cwd ?? process.cwd());
  const state: DaemonState = {
    startedAt: Date.now(),
    config: {
      ...config,
      artifactRoot: options.artifactRoot ?? config.artifactRoot,
      hidHelperPath: options.hidHelperPath ?? config.hidHelperPath,
      autoScreenshot: options.autoScreenshot ?? config.autoScreenshot
    },
    host: options.host ?? "127.0.0.1",
    port: options.port ?? config.daemonPort,
    simulator: options.simulator ?? createSimulator(),
    hidClientFactory: options.hidClientFactory ?? ((hidOptions) => new HidClient(hidOptions)),
    xcuitestManagerFactory:
      options.xcuitestManagerFactory ??
      (() =>
        new XcuitestRunnerManager({
          projectPath: config.driverRunnerProjectPath,
          derivedDataPath: config.driverRunnerDerivedData,
          portRange: config.driverPortRange
        })),
    xcuitestTargets: new Map(),
    metricsIntervalMs: options.metricsIntervalMs ?? 1_000,
    sessions: new Map()
  };

  const server = createServer((request, response) => {
    void handleRequest(state, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(state.port, state.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : state.port;
  const url = `http://${state.host}:${actualPort}`;
  return {
    server,
    url,
    close: async () => {
      await state.xcuitestManager?.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // Long-lived responses (SSE event streams) would otherwise keep
        // close() waiting forever; severing them triggers their own cleanup.
        server.closeAllConnections();
      });
    }
  };
}

async function handleRequest(state: DaemonState, request: IncomingMessage, response: ServerResponse): Promise<void> {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${state.host}:${state.port}`}`);
    const baseUrl = `${url.protocol}//${url.host}`;
    const rawParts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const parts = rawParts[0] === "v1" ? rawParts.slice(1) : rawParts;

    if (request.method === "GET" && parts.length === 1 && (parts[0] === "health" || parts[0] === "healthz")) {
      sendJson(response, 200, {
        ok: true,
        data: {
          status: "ok",
          sessions: state.sessions.size,
          uptimeSeconds: Math.round((Date.now() - state.startedAt) / 1000)
        }
      });
      return;
    }

    if (parts[0] === "atlas") {
      if (request.method === "GET" && parts.length === 2 && parts[1] === "map") {
        sendJson(response, 200, { ok: true, data: await getAtlasMapView(state, false) });
        return;
      }
      if (request.method === "POST" && parts.length === 3 && parts[1] === "map" && parts[2] === "rebuild") {
        sendJson(response, 200, { ok: true, data: await getAtlasMapView(state, true) });
        return;
      }
      if (request.method === "GET" && parts.length === 4 && parts[1] === "screens" && parts[3] === "image") {
        await sendAtlasScreenImage(state, response, parts[2], url.searchParams);
        return;
      }
      throw atlasError("NOT_FOUND", `route not found: ${url.pathname}`);
    }

    if (parts[0] !== "sessions") {
      throw atlasError("NOT_FOUND", `route not found: ${url.pathname}`);
    }

    if (request.method === "GET" && parts.length === 1) {
      sendJson(response, 200, { ok: true, data: (await listSessionStates(state)).map((entry) => entry.session) });
      return;
    }

    if (request.method === "POST" && parts.length === 1) {
      const body = await readJsonBody<CreateSessionRequest>(request);
      const session = await createSession(state, body);
      sendJson(response, 201, { ok: true, data: session });
      return;
    }

    if (request.method === "GET" && parts.length === 2 && parts[1] === "history") {
      const limit = parseHistoryLimit(url.searchParams);
      sendJson(response, 200, { ok: true, data: await getSessionHistory(state, limit) });
      return;
    }

    const sessionId = parts[1];

    if (request.method === "GET" && parts.length === 2) {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      sendJson(response, 200, { ok: true, data: sessionState.session });
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "summary") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      const summary = await getSessionSummary(sessionState);
      if (summary.artifacts.latestScreenshot) {
        summary.artifacts.latestScreenshot = artifactWithContentUrl(baseUrl, summary.artifacts.latestScreenshot);
      }
      sendJson(response, 200, { ok: true, data: summary });
      return;
    }

    if (request.method === "GET" && parts.length === 4 && parts[2] === "artifacts" && parts[3] === "health") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      sendJson(response, 200, { ok: true, data: await getSessionArtifactHealth(sessionState, sessionId) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "end") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      const session = await setStatus(sessionState, "ended");
      sendJson(response, 200, { ok: true, data: session });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "build") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      const body = await readJsonBody<BuildRequest>(request);
      sendJson(response, 200, { ok: true, data: await buildApp(state, sessionState, body) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "install") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      const body = await readJsonBody<InstallRequest>(request);
      sendJson(response, 200, { ok: true, data: await installApp(state, sessionState, body) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "launch") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      const body = await readJsonBody<LaunchRequest>(request);
      sendJson(response, 200, { ok: true, data: await launchApp(state, sessionState, body) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "actions") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      const body = await readJsonBody<PerformActionRequest>(request);
      sendJson(response, 200, {
        ok: true,
        data: await performAction(state, sessionState, body.action, { skipScreenshot: body.skipScreenshot })
      });
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[2] === "recording" && parts[3] === "start") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      sendJson(response, 200, { ok: true, data: await startSessionRecording(state, sessionState) });
      return;
    }

    if (request.method === "POST" && parts.length === 4 && parts[2] === "recording" && parts[3] === "stop") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      sendJson(response, 200, { ok: true, data: artifactWithContentUrl(baseUrl, await stopSessionRecording(sessionState)) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "screenshot") {
      const sessionState = resolveActiveSessionState(state, sessionId);
      const body = await readJsonBody<{ reason?: string }>(request);
      sendJson(response, 200, {
        ok: true,
        data: await performAction(state, sessionState, { kind: "screenshot", reason: body.reason })
      });
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "artifacts") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      sendJson(response, 200, { ok: true, data: sessionState.artifacts.map((artifact) => artifactWithContentUrl(baseUrl, artifact)) });
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "metrics") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      sendJson(response, 200, { ok: true, data: await readSessionMetrics(sessionState) });
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "latest-screenshot") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      await sendLatestScreenshotImage(response, sessionState);
      return;
    }

    if (request.method === "GET" && parts.length === 4 && parts[2] === "artifacts" && parts[3] === "latest-screenshot") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      sendJson(response, 200, { ok: true, data: artifactWithContentUrl(baseUrl, await latestScreenshot(sessionState)) });
      return;
    }

    if (request.method === "GET" && parts.length === 5 && parts[2] === "artifacts" && parts[4] === "content") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      await sendArtifactContent(request, response, sessionState, parts[3]);
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "events") {
      const sessionState = await resolveReadableSessionState(state, sessionId);
      if ((request.headers.accept ?? "").includes("text/event-stream")) {
        await sendEventStream(request, response, sessionState);
        return;
      }
      sendJson(response, 200, { ok: true, data: await readEvents(sessionState) });
      return;
    }

    throw atlasError("NOT_FOUND", `route not found: ${url.pathname}`);
  } catch (error) {
    const atlasLoopError = normalizeError(error);
    sendJson(response, statusForError(atlasLoopError), { ok: false, error: atlasLoopError });
  }
}

async function createSession(state: DaemonState, request: CreateSessionRequest): Promise<Session> {
  if (request.inputBackend && request.inputBackend !== "cgevent" && request.inputBackend !== "xcuitest") {
    throw atlasError("INVALID_REQUEST", `unknown input backend: ${String(request.inputBackend)}`);
  }
  const id = makeId("sess");
  const layout = await createSessionArtifacts(request.artifactRoot ?? state.config.artifactRoot, id);
  const at = nowIso();
  const session: Session = {
    id,
    schemaVersion: "atlas-loop.session.v1",
    platform: "ios-simulator",
    status: "created",
    createdAt: at,
    updatedAt: at,
    simulator: request.simulator ?? {},
    artifactDir: layout.sessionPath,
    viewerUrl: request.viewer ? `/sessions/${id}/artifacts/latest-screenshot` : undefined,
    backend: "local-daemon",
    inputBackend: request.inputBackend ?? "cgevent"
  };
  const sessionState: SessionState = { session, layout, artifacts: [], sequence: 0, source: "memory", warnings: [] };
  state.sessions.set(id, sessionState);
  await writeSession(layout, session);
  await writeManifest(layout, []);
  await recordTrace(layout, { type: "session.created", at, session });
  if (request.record) {
    await startSessionRecording(state, sessionState);
  }
  return session;
}

async function startSessionRecording(
  state: DaemonState,
  sessionState: SessionState
): Promise<{ active: boolean; startedAt: string; path: string }> {
  if (sessionState.recording) {
    throw atlasError("INVALID_REQUEST", `session ${sessionState.session.id} is already recording`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = join(sessionState.layout.videoDir, `${stamp}.mp4`);
  const handle = state.simulator.startRecordVideo({
    simulator: sessionState.session.simulator,
    outputPath
  });
  const recording = { handle, path: outputPath, startedAt: handle.startedAt };
  sessionState.recording = recording;
  await recordTrace(sessionState.layout, {
    type: "video.started",
    at: handle.startedAt,
    sessionId: sessionState.session.id,
    path: outputPath
  });

  // Surface recorder deaths (unbootable device, disk full, ...) as evidence
  // instead of leaving a silently dead recording behind.
  handle.done.catch(async (error) => {
    if (sessionState.recording?.handle !== handle) return;
    sessionState.recording = undefined;
    await recordTrace(sessionState.layout, {
      type: "video.stopped",
      at: nowIso(),
      sessionId: sessionState.session.id,
      error: normalizeError(error)
    }).catch(() => undefined);
  });

  return { active: true, startedAt: handle.startedAt, path: outputPath };
}

async function stopSessionRecording(sessionState: SessionState): Promise<ArtifactRef> {
  const recording = sessionState.recording;
  if (!recording) {
    throw atlasError("INVALID_REQUEST", `session ${sessionState.session.id} has no active recording`);
  }
  sessionState.recording = undefined;

  try {
    await recording.handle.stop();
  } catch (error) {
    const atlasLoopError = normalizeError(error);
    await recordTrace(sessionState.layout, {
      type: "video.stopped",
      at: nowIso(),
      sessionId: sessionState.session.id,
      error: atlasLoopError
    }).catch(() => undefined);
    throw atlasLoopError;
  }

  const artifact = await artifactFromPath(sessionState.layout, "video", recording.path, {
    videoStartedAt: recording.startedAt,
    videoEndedAt: nowIso()
  });
  const stored = await addArtifact(sessionState, artifact);
  await recordTrace(sessionState.layout, {
    type: "video.stopped",
    at: nowIso(),
    sessionId: sessionState.session.id,
    artifactId: stored.id
  });
  return stored;
}

async function resolveReadableSessionState(state: DaemonState, sessionId: string): Promise<SessionState> {
  if (sessionId === "latest") return latestReadableSessionState(state);

  const sessionState = state.sessions.get(sessionId);
  if (sessionState) return sessionState;

  const persisted = await readPersistedSession(state.config.artifactRoot, sessionId);
  if (persisted) return sessionStateFromPersisted(persisted);

  throw atlasError("NOT_FOUND", `session not found: ${sessionId}`);
}

function resolveActiveSessionState(state: DaemonState, sessionId: string): SessionState {
  if (sessionId === "latest") return latestActiveSessionState(state);
  const sessionState = state.sessions.get(sessionId);
  if (!sessionState || isTerminalSessionStatus(sessionState.session.status)) {
    throw atlasError("NOT_FOUND", `active session not found: ${sessionId}`);
  }
  return sessionState;
}

async function listSessionStates(state: DaemonState): Promise<SessionState[]> {
  const merged = new Map(state.sessions);
  for (const persisted of await listPersistedSessions(state.config.artifactRoot)) {
    if (!merged.has(persisted.session.id)) merged.set(persisted.session.id, sessionStateFromPersisted(persisted));
  }
  return [...merged.values()];
}

function sessionStateFromPersisted(record: PersistedSessionRecord): SessionState {
  return {
    session: record.session,
    layout: record.layout,
    artifacts: record.artifacts,
    sequence: 0,
    source: "disk",
    warnings: record.warnings
  };
}

function latestActiveSessionState(state: DaemonState): SessionState {
  const sessions = [...state.sessions.values()];
  if (sessions.length === 0) {
    throw atlasError("NOT_FOUND", "no active sessions are available for latest alias");
  }

  const active = sessions.filter((entry) => !isTerminalSessionStatus(entry.session.status));
  if (active.length === 0) {
    throw atlasError("NOT_FOUND", "no active sessions are available for latest alias");
  }
  return mostRecentlyUpdated(active);
}

async function latestReadableSessionState(state: DaemonState): Promise<SessionState> {
  const sessions = await listSessionStates(state);
  if (sessions.length === 0) {
    throw atlasError("NOT_FOUND", "no sessions are available for latest alias");
  }

  const activeMemory = sessions.filter((entry) => (
    entry.source === "memory" && !isTerminalSessionStatus(entry.session.status)
  ));
  if (activeMemory.length > 0) return mostRecentlyUpdated(activeMemory);

  return mostRecentlyUpdated(sessions);
}

function isTerminalSessionStatus(status: Session["status"]): boolean {
  return status === "ended" || status === "failed";
}

function mostRecentlyUpdated(sessions: SessionState[]): SessionState {
  return sessions.reduce((latest, candidate) => (
    timestamp(candidate.session.updatedAt) >= timestamp(latest.session.updatedAt) ? candidate : latest
  ));
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function buildApp(state: DaemonState, sessionState: SessionState, request: BuildRequest): Promise<unknown> {
  await setStatus(sessionState, "building");
  try {
    const result = await state.simulator.build({
      ...request,
      derivedDataPath: request.derivedDataPath ?? sessionState.layout.buildDir
    });
    const artifacts = await recordCommandArtifacts(sessionState, "build", result);
    sessionState.session.app = { ...sessionState.session.app, ...request };
    await writeSession(sessionState.layout, sessionState.session);
    await setStatus(sessionState, "created");
    return { result, artifacts, session: sessionState.session };
  } catch (error) {
    await failSession(sessionState, error);
    throw error;
  }
}

async function installApp(state: DaemonState, sessionState: SessionState, request: InstallRequest): Promise<ActionResult> {
  await setStatus(sessionState, "installing");
  const action: InstallAction = {
    id: makeId("act"),
    sessionId: sessionState.session.id,
    kind: "install",
    appPath: request.appPath,
    sequence: ++sessionState.sequence,
    createdAt: nowIso()
  };
  return executeAction(sessionState, action, async () => {
    const result = await state.simulator.install({ simulator: sessionState.session.simulator, appPath: request.appPath });
    const artifacts = await recordCommandArtifacts(sessionState, "install", result, action);
    sessionState.session.app = { ...sessionState.session.app, appPath: request.appPath };
    await writeSession(sessionState.layout, sessionState.session);
    await setStatus(sessionState, "installed");
    return artifacts;
  });
}

async function launchApp(state: DaemonState, sessionState: SessionState, request: LaunchRequest): Promise<ActionResult> {
  await setStatus(sessionState, "launching");
  const action: LaunchAction = {
    id: makeId("act"),
    sessionId: sessionState.session.id,
    kind: "launch",
    bundleId: request.bundleId,
    arguments: request.arguments,
    environment: request.environment,
    sequence: ++sessionState.sequence,
    createdAt: nowIso()
  };
  return executeAction(sessionState, action, async () => {
    const result = await state.simulator.launch({ simulator: sessionState.session.simulator, ...request });
    const artifacts = await recordCommandArtifacts(sessionState, "launch", result, action);
    sessionState.session.app = { ...sessionState.session.app, bundleId: request.bundleId };
    await writeSession(sessionState.layout, sessionState.session);
    await setStatus(sessionState, "running");
    await startSessionMetrics(state, sessionState, parseLaunchPid(result.stdout));
    return artifacts;
  });
}

async function startSessionMetrics(state: DaemonState, sessionState: SessionState, pid: number | undefined): Promise<void> {
  // A re-launch replaces the previous sampler; its samples become evidence.
  if (sessionState.metrics) {
    await stopSessionMetrics(sessionState);
  }
  if (pid === undefined) return;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const metricsPath = join(sessionState.layout.metadataDir, `metrics-${stamp}.jsonl`);
  const startedAt = nowIso();
  const handle = startMetricsSampler({
    pid,
    metricsPath,
    intervalMs: state.metricsIntervalMs,
    runCommand: async (command, args) => {
      const result = await state.simulator.runCommand(command, args);
      return { exitCode: result.exitCode, stdout: result.stdout };
    },
    onProcessExit: () => {
      if (sessionState.metrics?.handle === handle) {
        void finalizeSessionMetrics(sessionState);
      }
    }
  });
  sessionState.metrics = { handle, path: metricsPath, startedAt };
}

async function stopSessionMetrics(sessionState: SessionState): Promise<void> {
  const metrics = sessionState.metrics;
  if (!metrics) return;
  await metrics.handle.stop();
  await finalizeSessionMetrics(sessionState);
}

async function finalizeSessionMetrics(sessionState: SessionState): Promise<void> {
  const metrics = sessionState.metrics;
  if (!metrics) return;
  sessionState.metrics = undefined;
  if (metrics.handle.sampleCount() === 0) return;

  try {
    const artifact = await artifactFromPath(sessionState.layout, "metadata", metrics.path, {
      kind: "performance-metrics",
      pid: metrics.handle.pid,
      sampleCount: metrics.handle.sampleCount(),
      metricsStartedAt: metrics.startedAt
    });
    await addArtifact(sessionState, artifact);
  } catch (error) {
    await recordTrace(sessionState.layout, {
      type: "error",
      at: nowIso(),
      sessionId: sessionState.session.id,
      error: normalizeError(error, "ARTIFACT_WRITE_FAILED")
    }).catch(() => undefined);
  }
}

interface SessionMetricsView {
  schemaVersion: "atlas-loop.metrics.v1";
  sessionId: string;
  active: boolean;
  sampleCount: number;
  samples: MetricsSample[];
}

async function readSessionMetrics(sessionState: SessionState): Promise<SessionMetricsView> {
  const paths: string[] = [];
  for (const artifact of sessionState.artifacts) {
    if (artifact.type === "metadata" && artifact.metadata?.kind === "performance-metrics") {
      paths.push(artifact.path);
    }
  }
  if (sessionState.metrics && !paths.includes(sessionState.metrics.path)) {
    paths.push(sessionState.metrics.path);
  }

  const samples: MetricsSample[] = [];
  for (const path of paths) {
    const safePath = await resolveContainedArtifactPath(sessionState.layout, "metadata", path);
    if (!safePath) continue;
    let text: string;
    try {
      text = await readFile(safePath, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as MetricsSample;
        if (parsed.schemaVersion === "atlas-loop.metrics-sample.v1") samples.push(parsed);
      } catch {
        // Skip malformed sample lines; the rest of the series stays usable.
      }
    }
  }
  samples.sort((left, right) => left.at.localeCompare(right.at));

  return {
    schemaVersion: "atlas-loop.metrics.v1",
    sessionId: sessionState.session.id,
    active: Boolean(sessionState.metrics),
    sampleCount: samples.length,
    samples
  };
}

async function performAction(
  state: DaemonState,
  sessionState: SessionState,
  input: ActionInput,
  options: { skipScreenshot?: boolean } = {}
): Promise<ActionResult> {
  const action = materializeAction(sessionState.session.id, ++sessionState.sequence, input);
  return executeAction(sessionState, action, async () => {
    switch (action.kind) {
      case "screenshot":
        return [await captureScreenshot(state, sessionState, action)];
      case "wait":
        await delay(action.durationMs);
        return [];
      case "tap":
      case "typeText":
      case "swipe":
      case "edgeGesture":
      case "tapElement":
      case "assertVisible": {
        const backend = createInputBackend(state, sessionState.session);
        if (!backend.supports(action.kind)) {
          throw atlasError(
            "INVALID_REQUEST",
            `the ${backend.name} input backend does not support ${action.kind}; start the session with --input-backend xcuitest`
          );
        }
        const backendDetail = backend.describe(sessionState.session);
        try {
          const actionDetail = await backend.performAction(sessionState.session, action);
          const artifacts = [
            await recordInputActionMetadata(sessionState, action, { ok: true }, backend.name, {
              ...backendDetail,
              ...actionDetail
            })
          ];
          if (state.config.autoScreenshot && !options.skipScreenshot) {
            const afterShot = await tryCaptureActionScreenshot(state, sessionState, action, actionDetail);
            if (afterShot) artifacts.push(afterShot);
          }
          return artifacts;
        } catch (error) {
          const atlasLoopError = normalizeError(error, "HID_FAILED");
          const artifact = await recordInputActionMetadata(
            sessionState,
            action,
            { ok: false, error: atlasLoopError },
            backend.name,
            backendDetail
          );
          throw { ...atlasLoopError, artifacts: [artifact] };
        } finally {
          await backend.close();
        }
      }
      default:
        throw atlasError("INVALID_REQUEST", `unsupported action kind: ${(action as { kind: string }).kind}`);
    }
  });
}

async function executeAction(
  sessionState: SessionState,
  action: Action,
  run: () => Promise<ArtifactRef[]>
): Promise<ActionResult> {
  const startedAt = nowIso();
  await recordTrace(sessionState.layout, { type: "action.started", at: startedAt, action });
  try {
    const artifacts = await run();
    const result: ActionResult = {
      actionId: action.id,
      ok: true,
      startedAt,
      endedAt: nowIso(),
      artifacts
    };
    await appendActionRecord(sessionState.layout, action, result);
    await recordTrace(sessionState.layout, { type: "action.completed", at: result.endedAt, result });
    return result;
  } catch (error) {
    const atlasLoopError = normalizeError(error);
    const artifacts = artifactRefsFromError(error);
    const endedAt = nowIso();
    const result: ActionResult = {
      actionId: action.id,
      ok: false,
      startedAt,
      endedAt,
      artifacts,
      error: atlasLoopError
    };
    await appendActionRecord(sessionState.layout, action, result);
    await recordTrace(sessionState.layout, { type: "error", at: endedAt, sessionId: sessionState.session.id, error: atlasLoopError });
    await recordTrace(sessionState.layout, { type: "action.completed", at: endedAt, result });
    await failSession(sessionState, atlasLoopError);
    return result;
  }
}

function createInputBackend(state: DaemonState, session: Session): InputBackend {
  if (session.inputBackend === "xcuitest") {
    return createXcuitestBackend({
      manager: getXcuitestManager(state),
      targets: state.xcuitestTargets,
      resolveUdid: (targetSession) => resolveSimulatorUdid(state, targetSession)
    });
  }
  return createCgEventBackend({
    helperPath: state.config.hidHelperPath,
    hidClientFactory: state.hidClientFactory
  });
}

function getXcuitestManager(state: DaemonState): XcuitestManagerLike {
  if (!state.xcuitestManager) {
    state.xcuitestManager = state.xcuitestManagerFactory();
  }
  return state.xcuitestManager;
}

async function resolveSimulatorUdid(state: DaemonState, session: Session): Promise<string> {
  if (session.simulator.udid) return session.simulator.udid;

  const result = await state.simulator.runCommand("xcrun", ["simctl", "list", "devices", "booted", "-j"]);
  let devices: Record<string, Array<{ udid?: string; name?: string; state?: string }>>;
  try {
    devices = (JSON.parse(result.stdout) as { devices?: typeof devices }).devices ?? {};
  } catch {
    throw atlasError("SIMULATOR_NOT_FOUND", "could not parse booted simulator list to resolve a udid for the xcuitest backend");
  }

  const booted = Object.values(devices).flat().filter((device) => device.state === "Booted" && device.udid);
  const match = session.simulator.name
    ? booted.find((device) => device.name === session.simulator.name) ?? booted[0]
    : booted[0];
  if (!match?.udid) {
    throw atlasError(
      "SIMULATOR_NOT_FOUND",
      "the xcuitest backend needs a booted simulator udid; boot a simulator or create the session with --udid"
    );
  }

  session.simulator = { ...session.simulator, udid: match.udid };
  return match.udid;
}

async function recordInputActionMetadata(
  sessionState: SessionState,
  action: InputAction,
  result: { ok: boolean; error?: AtlasLoopError },
  inputBackend: InputBackend["name"],
  backendDetail: Record<string, unknown>
): Promise<ArtifactRef> {
  const sequence = action.sequence ?? 0;
  const artifact = await writeMetadata(
    sessionState.layout,
    `input-action-${sequence || action.id}.json`,
    {
      schemaVersion: "atlas-loop.input-action.v1",
      sessionId: sessionState.session.id,
      createdAt: nowIso(),
      inputBackend,
      backend: sessionState.session.backend ?? "local-daemon",
      simulator: sessionState.session.simulator,
      ...backendDetail,
      action,
      result
    },
    {
      ...actionMetadata(action),
      operation: "input-action",
      inputAction: true,
      inputBackend,
      ok: result.ok,
      backend: sessionState.session.backend ?? "local-daemon"
    }
  );
  return addArtifact(sessionState, artifact);
}

async function captureScreenshot(
  state: DaemonState,
  sessionState: SessionState,
  action: Extract<Action, { kind: "screenshot" }>
): Promise<ArtifactRef> {
  return captureScreenshotArtifact(state, sessionState, {
    ...actionMetadata(action),
    reason: action.reason
  });
}

async function captureScreenshotArtifact(
  state: DaemonState,
  sessionState: SessionState,
  metadata: Record<string, unknown>
): Promise<ArtifactRef> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempPath = join(sessionState.layout.screenshotsDir, `.tmp-${makeId("shot")}.png`);
  await state.simulator.screenshot({ simulator: sessionState.session.simulator, outputPath: tempPath });
  const artifact = await copyScreenshot(sessionState.layout, tempPath, `${stamp}.png`, metadata);
  await rm(tempPath, { force: true });
  return addArtifact(sessionState, artifact);
}

async function tryCaptureActionScreenshot(
  state: DaemonState,
  sessionState: SessionState,
  action: InputAction,
  actionDetail?: Record<string, unknown>
): Promise<ArtifactRef | undefined> {
  const screenId = screenIdFromActionDetail(action, actionDetail);
  try {
    return await captureScreenshotArtifact(state, sessionState, {
      ...actionMetadata(action),
      role: "after",
      ...actionCoordinateMetadata(action),
      ...(screenId ? { screenId } : {})
    });
  } catch (error) {
    // Evidence enrichment must not fail the action; leave a trace instead.
    await recordTrace(sessionState.layout, {
      type: "error",
      at: nowIso(),
      sessionId: sessionState.session.id,
      error: normalizeError(error, "ARTIFACT_WRITE_FAILED")
    }).catch(() => undefined);
    return undefined;
  }
}

/**
 * Asserting a screen-level container names the screen: the driver reports
 * coversScreen when the asserted element fills most of the app window, and
 * that identifier becomes the Atlas map screen id for the after-screenshot.
 */
function screenIdFromActionDetail(action: InputAction, actionDetail?: Record<string, unknown>): string | undefined {
  if (action.kind !== "assertVisible") return undefined;
  if (action.markScreen === true) return action.identifier;
  const driverData = actionDetail?.driverData;
  if (!driverData || typeof driverData !== "object") return undefined;
  return (driverData as { coversScreen?: unknown }).coversScreen === true ? action.identifier : undefined;
}

function actionCoordinateMetadata(action: InputAction): Record<string, unknown> {
  switch (action.kind) {
    case "tap":
      return { tapX: action.x, tapY: action.y };
    case "swipe":
      return { fromX: action.from.x, fromY: action.from.y, toX: action.to.x, toY: action.to.y };
    case "edgeGesture":
      return { edge: action.edge, distance: action.distance };
    case "tapElement":
    case "assertVisible":
      return { identifier: action.identifier };
    default:
      return {};
  }
}

async function recordCommandArtifacts(
  sessionState: SessionState,
  prefix: string,
  result: {
    command: string;
    args: string[];
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
  },
  action?: Action
): Promise<ArtifactRef[]> {
  const stamp = Date.now();
  const commandLine = [result.command, ...result.args].join(" ");
  const metadata = {
    ...actionMetadata(action),
    operation: prefix,
    command: commandLine,
    exitCode: result.exitCode,
    durationMs: result.durationMs
  };
  const log = await writeLog(
    sessionState.layout,
    `${prefix}-${stamp}.log`,
    `$ ${commandLine}\n\n[stdout]\n${result.stdout}\n[stderr]\n${result.stderr}\n`,
    metadata
  );
  const metadataArtifact = await writeMetadata(sessionState.layout, `${prefix}-${stamp}.json`, result, metadata);
  const storedLog = await addArtifact(sessionState, log);
  const storedMetadata = await addArtifact(sessionState, metadataArtifact);
  return [storedLog, storedMetadata];
}

async function addArtifact(sessionState: SessionState, artifact: ArtifactRef): Promise<ArtifactRef> {
  sessionState.artifacts = markLatestScreenshot([...sessionState.artifacts, artifact]);
  const storedArtifact = sessionState.artifacts.find((entry) => entry.id === artifact.id && entry.path === artifact.path) ?? artifact;
  await writeManifest(sessionState.layout, sessionState.artifacts);
  await recordTrace(sessionState.layout, { type: "artifact.created", at: nowIso(), artifact: storedArtifact });
  return storedArtifact;
}

async function latestScreenshot(sessionState: SessionState): Promise<ArtifactRef> {
  for (const artifact of [...sessionState.artifacts].reverse()) {
    if (artifact.type !== "screenshot") continue;
    const safePath = await resolveContainedArtifactPath(sessionState.layout, "screenshot", artifact.path);
    if (safePath) return { ...artifact, path: safePath };
  }

  const latestPath = join(sessionState.layout.screenshotsDir, "latest.png");
  const safeLatestPath = await resolveContainedArtifactPath(sessionState.layout, "screenshot", latestPath);
  if (!safeLatestPath) {
    throw atlasError("NOT_FOUND", `no screenshot artifact for session ${sessionState.session.id}`);
  }
  return artifactFromPath(sessionState.layout, "screenshot", safeLatestPath, {
    latest: true,
    latestScreenshot: true
  });
}

async function tryLatestScreenshot(sessionState: SessionState): Promise<ArtifactRef | undefined> {
  try {
    return await latestScreenshot(sessionState);
  } catch (error) {
    const atlasLoopError = normalizeError(error);
    if (atlasLoopError.code === "NOT_FOUND") return undefined;
    throw error;
  }
}

async function getSessionSummary(sessionState: SessionState): Promise<SessionSummary> {
  const events = await readEvents(sessionState);
  const completedActions = events.filter((event): event is Extract<TraceEvent, { type: "action.completed" }> => (
    event.type === "action.completed"
  ));
  const errorEvents = events.filter((event): event is Extract<TraceEvent, { type: "error" }> => event.type === "error");
  const latestAction = completedActions.at(-1)?.result;
  const latestScreenshotArtifact = await tryLatestScreenshot(sessionState);

  return {
    session: sessionState.session,
    paths: {
      artifactDir: sessionState.layout.sessionPath,
      manifest: sessionState.layout.manifestPath,
      trace: sessionState.layout.tracePath,
      screenshots: sessionState.layout.screenshotsDir
    },
    artifacts: {
      total: sessionState.artifacts.length,
      byType: countArtifactsByType(sessionState.artifacts),
      latestScreenshot: latestScreenshotArtifact,
      latestScreenshotId: latestScreenshotArtifact?.id,
      latestScreenshotPath: latestScreenshotArtifact?.path,
      latestScreenshotCreatedAt: latestScreenshotArtifact?.createdAt
    },
    events: {
      total: events.length,
      latestAction: latestAction ? {
        actionId: latestAction.actionId,
        ok: latestAction.ok,
        startedAt: latestAction.startedAt,
        endedAt: latestAction.endedAt,
        artifactCount: Array.isArray(latestAction.artifacts) ? latestAction.artifacts.length : 0,
        error: latestAction.error
      } : undefined,
      latestError: errorEvents.at(-1)?.error
    },
    storage: {
      source: sessionState.source,
      artifactBacked: true,
      warnings: sessionState.warnings
    },
    recording: sessionState.recording
      ? { active: true, startedAt: sessionState.recording.startedAt, path: sessionState.recording.path }
      : null
  };
}

async function getSessionHistory(state: DaemonState, limit: number | null): Promise<SessionHistoryResult> {
  const sessionStates = (await listSessionStates(state)).sort(compareSessionStatesForHistory);
  const limitedSessionStates = limit === null ? sessionStates : sessionStates.slice(0, limit);
  const sessions = (await Promise.all(
    limitedSessionStates.map((sessionState) => getSessionHistoryItem(sessionState))
  )).sort(compareSessionHistoryItems);
  return {
    schemaVersion: "atlas-loop.session-history.v1",
    generatedAt: nowIso(),
    total: sessionStates.length,
    count: sessions.length,
    limit,
    sessions
  };
}

async function getSessionHistoryItem(sessionState: SessionState): Promise<SessionHistoryItem> {
  const summary = await getSessionSummary(sessionState);
  const warningCount = summary.storage.warnings.length;
  const latestScreenshotPath = summary.artifacts.latestScreenshotPath;
  const hasScreenshot = Boolean(latestScreenshotPath);
  const canMutate = summary.storage.source === "memory" && !isTerminalSessionStatus(summary.session.status);
  return {
    session: summary.session,
    sessionId: summary.session.id,
    status: summary.session.status,
    createdAt: summary.session.createdAt,
    updatedAt: summary.session.updatedAt,
    artifactDir: summary.paths.artifactDir,
    storage: {
      source: summary.storage.source,
      artifactBacked: summary.storage.artifactBacked,
      warningCount
    },
    artifacts: {
      total: summary.artifacts.total,
      byType: summary.artifacts.byType,
      ...(latestScreenshotPath ? { latestScreenshotPath } : {}),
      ...(summary.artifacts.latestScreenshotCreatedAt
        ? { latestScreenshotCreatedAt: summary.artifacts.latestScreenshotCreatedAt }
        : {})
    },
    events: {
      total: summary.events.total,
      ...(summary.events.latestAction ? { latestAction: summary.events.latestAction } : {}),
      ...(summary.events.latestError ? { latestError: summary.events.latestError } : {})
    },
    canMutate,
    hasScreenshot,
    ready: summary.session.status === "running" && hasScreenshot && !summary.events.latestError && warningCount === 0
  };
}

function compareSessionHistoryItems(left: SessionHistoryItem, right: SessionHistoryItem): number {
  return sessionHistorySortTimestamp(right) - sessionHistorySortTimestamp(left)
    || timestamp(right.createdAt) - timestamp(left.createdAt)
    || right.sessionId.localeCompare(left.sessionId);
}

function compareSessionStatesForHistory(left: SessionState, right: SessionState): number {
  return sessionStateHistorySortTimestamp(right) - sessionStateHistorySortTimestamp(left)
    || timestamp(right.session.createdAt) - timestamp(left.session.createdAt)
    || right.session.id.localeCompare(left.session.id);
}

function sessionHistorySortTimestamp(item: SessionHistoryItem): number {
  return timestamp(item.updatedAt) || timestamp(item.createdAt);
}

function sessionStateHistorySortTimestamp(item: SessionState): number {
  return timestamp(item.session.updatedAt) || timestamp(item.session.createdAt);
}

async function getSessionArtifactHealth(
  sessionState: SessionState,
  requestedSessionId: string
): Promise<SessionArtifactHealth> {
  const report = await validateArtifactTarget(sessionState.layout.sessionPath);
  return {
    ok: report.ok,
    target: report.target,
    sessionId: sessionState.session.id,
    requestedSessionId,
    source: sessionState.source,
    artifactDir: sessionState.layout.sessionPath,
    report,
    summary: summarizeValidationReport(report)
  };
}

function summarizeValidationReport(report: ValidationReport): SessionArtifactHealth["summary"] {
  const errorCount = report.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = report.issues.filter((issue) => issue.severity === "warning").length;
  return {
    sessionCount: report.sessionCount,
    errorCount,
    warningCount,
    issueCount: report.issues.length
  };
}

function actionMetadata(action?: Action): Record<string, unknown> {
  if (!action) return {};
  return {
    actionId: action.id,
    actionSequence: action.sequence,
    actionKind: action.kind
  };
}

function countArtifactsByType(artifacts: ArtifactRef[]): Partial<Record<ArtifactType, number>> {
  return artifacts.reduce<Partial<Record<ArtifactType, number>>>((counts, artifact) => {
    counts[artifact.type] = (counts[artifact.type] ?? 0) + 1;
    return counts;
  }, {});
}

function artifactWithContentUrl(baseUrl: string, artifact: ArtifactRef): ArtifactRef {
  return {
    ...artifact,
    url: `${baseUrl}/v1/sessions/${encodeURIComponent(artifact.sessionId)}/artifacts/${encodeURIComponent(artifact.id)}/content`
  };
}

type ByteRange = { start: number; end: number };

function parseByteRange(header: string | undefined, size: number): ByteRange | "invalid" | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return "invalid";
  if (size === 0) return "invalid";

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return "invalid";
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

async function sendArtifactContent(
  request: IncomingMessage,
  response: ServerResponse,
  sessionState: SessionState,
  artifactId: string
): Promise<void> {
  const artifact = sessionState.artifacts.find((entry) => entry.id === artifactId);
  if (!artifact) {
    throw atlasError("NOT_FOUND", `artifact ${artifactId} not found for session ${sessionState.session.id}`);
  }

  const safePath = await resolveContainedArtifactPath(sessionState.layout, artifact.type, artifact.path);
  if (!safePath) {
    throw atlasError("NOT_FOUND", `artifact ${artifactId} content is unavailable for session ${sessionState.session.id}`);
  }

  const info = await stat(safePath);
  if (!info.isFile()) {
    throw atlasError("NOT_FOUND", `artifact ${artifactId} content is not a regular file`);
  }

  const mediaType = typeof artifact.metadata?.mediaType === "string" ? artifact.metadata.mediaType : "application/octet-stream";
  const range = parseByteRange(request.headers.range, info.size);

  if (range === "invalid") {
    response.writeHead(416, {
      "content-range": `bytes */${info.size}`,
      "accept-ranges": "bytes",
      "cache-control": "no-store"
    });
    response.end();
    return;
  }

  const headers: Record<string, string | number> = {
    "content-type": mediaType,
    "accept-ranges": "bytes",
    "cache-control": "no-store"
  };

  if (range) {
    response.writeHead(206, {
      ...headers,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${info.size}`
    });
  } else {
    response.writeHead(200, { ...headers, "content-length": info.size });
  }

  await new Promise<void>((resolve, reject) => {
    createReadStream(safePath, range ? { start: range.start, end: range.end } : undefined)
      .on("error", reject)
      .on("end", resolve)
      .pipe(response);
  });
}

interface AtlasMapView {
  source: "cache" | "rebuilt";
  map: AtlasMap;
  warnings: Array<{ sessionId?: string; path?: string; message: string }>;
}

function atlasDirFor(state: DaemonState): string {
  return resolve(state.config.artifactRoot, "..", "atlas");
}

async function getAtlasMapView(state: DaemonState, force: boolean): Promise<AtlasMapView> {
  const atlasDir = atlasDirFor(state);
  const mapPath = join(atlasDir, "map.json");
  const cachePath = join(atlasDir, "hash-cache.json");

  if (!force) {
    const cached = await tryReadCachedMap(mapPath);
    if (cached && (await atlasMapIsFresh(state, cached))) {
      return { source: "cache", map: cached, warnings: [] };
    }
  }

  const hashCache = await loadHashCache(cachePath);
  const derivation = await deriveAtlasMap({ artifactRoot: state.config.artifactRoot, hashCache });
  await mkdir(atlasDir, { recursive: true });
  await saveHashCache(cachePath, derivation.hashCache);
  await writeFile(mapPath, `${JSON.stringify(derivation.map, null, 2)}\n`, "utf8");
  return { source: "rebuilt", map: derivation.map, warnings: derivation.warnings };
}

async function tryReadCachedMap(mapPath: string): Promise<AtlasMap | undefined> {
  try {
    const parsed = JSON.parse(await readFile(mapPath, "utf8")) as AtlasMap;
    return parsed.schemaVersion === "atlas-loop.atlas-map.v1" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function atlasMapIsFresh(state: DaemonState, map: AtlasMap): Promise<boolean> {
  const generatedAtMs = Date.parse(map.generatedAt);
  if (!Number.isFinite(generatedAtMs)) return false;

  let entries;
  try {
    entries = await readdir(state.config.artifactRoot, { withFileTypes: true });
  } catch {
    return true;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const evidenceFile of ["session.json", "actions.jsonl", "manifest.json"]) {
      try {
        const info = await stat(join(state.config.artifactRoot, entry.name, evidenceFile));
        if (info.mtimeMs > generatedAtMs) return false;
      } catch {
        // Missing evidence files do not affect freshness.
      }
    }
  }
  return true;
}

async function sendAtlasScreenImage(
  state: DaemonState,
  response: ServerResponse,
  screenId: string,
  searchParams: URLSearchParams
): Promise<void> {
  const view = await getAtlasMapView(state, false);
  const screen = view.map.screens.find((candidate) => candidate.id === screenId || candidate.screenId === screenId);
  if (!screen) {
    throw atlasError("NOT_FOUND", `atlas screen not found: ${screenId}`);
  }

  let shot = screen.representative;
  const variantParam = searchParams.get("variant");
  if (variantParam !== null) {
    const index = Number(variantParam);
    if (!Number.isInteger(index) || index < 0 || index >= screen.variants.length) {
      throw atlasError("NOT_FOUND", `variant ${variantParam} not found for atlas screen ${screenId}`);
    }
    shot = screen.variants[index];
  }

  const layout = getSessionArtifactLayout(state.config.artifactRoot, shot.sessionId);
  const safePath = await resolveContainedArtifactPath(layout, "screenshot", shot.path);
  if (!safePath) {
    throw atlasError("NOT_FOUND", `screenshot for atlas screen ${screenId} is unavailable`);
  }

  const info = await stat(safePath);
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": info.size,
    "cache-control": "no-store"
  });
  await new Promise<void>((resolvePipe, reject) => {
    createReadStream(safePath)
      .on("error", reject)
      .on("end", resolvePipe)
      .pipe(response);
  });
}

async function sendLatestScreenshotImage(response: ServerResponse, sessionState: SessionState): Promise<void> {
  const artifact = await latestScreenshot(sessionState);
  const safePath = await resolveContainedArtifactPath(sessionState.layout, "screenshot", artifact.path);
  if (!safePath) {
    throw atlasError("NOT_FOUND", `screenshot artifact is unavailable for session ${sessionState.session.id}`);
  }
  const info = await stat(safePath);
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": info.size,
    "cache-control": "no-store"
  });
  await new Promise<void>((resolve, reject) => {
    createReadStream(safePath)
      .on("error", reject)
      .on("end", resolve)
      .pipe(response);
  });
}

const SSE_POLL_INTERVAL_MS = 400;
const SSE_HEARTBEAT_INTERVAL_MS = 15000;

async function sendEventStream(request: IncomingMessage, response: ServerResponse, sessionState: SessionState): Promise<void> {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive"
  });
  response.write(": connected\n\n");

  let sentCount = 0;
  let pushing = false;
  const pushNewEvents = async (): Promise<void> => {
    if (pushing || response.writableEnded) return;
    pushing = true;
    try {
      const events = await readEvents(sessionState);
      for (const event of events.slice(sentCount)) {
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      sentCount = Math.max(sentCount, events.length);
    } catch {
      // Transient trace read failures resolve on the next poll; keep the stream open.
    } finally {
      pushing = false;
    }
  };

  await pushNewEvents();
  const pollTimer = setInterval(() => void pushNewEvents(), SSE_POLL_INTERVAL_MS);
  const heartbeatTimer = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, SSE_HEARTBEAT_INTERVAL_MS);

  await new Promise<void>((resolve) => {
    request.on("close", resolve);
  });
  clearInterval(pollTimer);
  clearInterval(heartbeatTimer);
  if (!response.writableEnded) response.end();
}

async function readEvents(sessionState: SessionState): Promise<TraceEvent[]> {
  const safeTracePath = await resolveContainedArtifactPath(sessionState.layout, "trace", sessionState.layout.tracePath);
  if (!safeTracePath) return [];
  const text = await readFile(safeTracePath, "utf8");
  const events: TraceEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(parseTraceLine(line));
    } catch {
      if (sessionState.source === "memory") throw atlasError("ARTIFACT_WRITE_FAILED", "trace.jsonl contains malformed JSON");
    }
  }
  return events;
}

async function setStatus(sessionState: SessionState, status: SessionStatus): Promise<Session> {
  if ((status === "ended" || status === "failed") && sessionState.recording) {
    try {
      await stopSessionRecording(sessionState);
    } catch {
      // The stop failure is already recorded as a video.stopped trace event.
    }
  }
  if ((status === "ended" || status === "failed") && sessionState.metrics) {
    await stopSessionMetrics(sessionState);
  }
  const from = sessionState.session.status;
  sessionState.session = {
    ...sessionState.session,
    status,
    updatedAt: nowIso(),
    error: status === "failed" ? sessionState.session.error : undefined
  };
  await writeSession(sessionState.layout, sessionState.session);
  if (from !== status) {
    await recordTrace(sessionState.layout, {
      type: "session.statusChanged",
      at: sessionState.session.updatedAt,
      sessionId: sessionState.session.id,
      from,
      to: status
    });
  }
  return sessionState.session;
}

async function failSession(sessionState: SessionState, error: unknown): Promise<void> {
  const atlasLoopError = normalizeError(error);
  sessionState.session = { ...sessionState.session, error: atlasLoopError };
  await setStatus(sessionState, "failed");
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw atlasError("INVALID_REQUEST", "request body must be valid JSON", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

function parseHistoryLimit(searchParams: URLSearchParams): number | null {
  const rawLimit = searchParams.get("limit");
  if (rawLimit === null) return null;
  if (!/^\d+$/.test(rawLimit)) {
    throw atlasError("INVALID_REQUEST", "limit must be a non-negative integer", { limit: rawLimit });
  }
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit)) {
    throw atlasError("INVALID_REQUEST", "limit must be a non-negative integer", { limit: rawLimit });
  }
  return limit;
}

function sendJson<T>(response: ServerResponse, statusCode: number, envelope: ApiEnvelope<T>): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(envelope)}\n`);
}

function normalizeError(error: unknown, fallback: AtlasLoopErrorCode = "COMMAND_FAILED"): AtlasLoopError {
  if (isAtlasLoopError(error)) {
    // Materialize a plain object: Error subclasses carry message as a
    // non-enumerable property, which spread-based rethrows would drop.
    return { code: error.code, message: error.message, retryable: error.retryable, details: error.details };
  }
  if (error instanceof Error) {
    return atlasError(fallback, error.message, { name: error.name });
  }
  return atlasError(fallback, String(error));
}

function isAtlasLoopError(error: unknown): error is AtlasLoopError {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function artifactRefsFromError(error: unknown): ArtifactRef[] {
  if (!error || typeof error !== "object") return [];
  const artifacts = (error as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(artifacts)) return [];
  return artifacts.filter((artifact): artifact is ArtifactRef => (
    Boolean(
      artifact &&
      typeof artifact === "object" &&
      typeof (artifact as { id?: unknown }).id === "string" &&
      typeof (artifact as { type?: unknown }).type === "string" &&
      typeof (artifact as { path?: unknown }).path === "string"
    )
  ));
}

function statusForError(error: AtlasLoopError): number {
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "INVALID_REQUEST") return 400;
  if (error.code === "ELEMENT_NOT_FOUND") return 400;
  if (error.code === "DRIVER_UNAVAILABLE") return 503;
  if (error.code === "ACTION_TIMEOUT") return 504;
  return 500;
}



function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
