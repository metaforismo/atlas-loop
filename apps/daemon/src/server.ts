import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  appendActionRecord,
  artifactFromPath,
  copyScreenshot,
  createSessionArtifacts,
  recordTrace,
  writeLog,
  writeManifest,
  writeMetadata,
  writeSession,
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
  type AtlasLoopError,
  type AtlasLoopErrorCode,
  type BuildRequest,
  type CreateSessionRequest,
  type InstallAction,
  type InstallRequest,
  type LaunchAction,
  type LaunchRequest,
  type PerformActionRequest,
  type Session,
  type SessionStatus,
  type TraceEvent
} from "@atlas-loop/protocol";
import { parseTraceLine } from "@atlas-loop/traces";
import { createSimulator } from "@atlas-loop/simulator";

export type SimulatorApi = ReturnType<typeof createSimulator>;

export interface DaemonOptions {
  cwd?: string;
  host?: string;
  port?: number;
  artifactRoot?: string;
  hidHelperPath?: string;
  simulator?: SimulatorApi;
  hidClientFactory?: (options: HidClientOptions) => HidClient;
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
}

interface DaemonState {
  startedAt: number;
  config: AtlasLoopConfig;
  host: string;
  port: number;
  simulator: SimulatorApi;
  hidClientFactory: (options: HidClientOptions) => HidClient;
  sessions: Map<string, SessionState>;
}

export async function startDaemonServer(options: DaemonOptions = {}): Promise<StartedDaemon> {
  const config = await loadConfig(options.cwd ?? process.cwd());
  const state: DaemonState = {
    startedAt: Date.now(),
    config: {
      ...config,
      artifactRoot: options.artifactRoot ?? config.artifactRoot,
      hidHelperPath: options.hidHelperPath ?? config.hidHelperPath
    },
    host: options.host ?? "127.0.0.1",
    port: options.port ?? config.daemonPort,
    simulator: options.simulator ?? createSimulator(),
    hidClientFactory: options.hidClientFactory ?? ((hidOptions) => new HidClient(hidOptions)),
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
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
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

    if (parts[0] !== "sessions") {
      throw atlasError("NOT_FOUND", `route not found: ${url.pathname}`);
    }

    if (request.method === "GET" && parts.length === 1) {
      sendJson(response, 200, { ok: true, data: [...state.sessions.values()].map((entry) => entry.session) });
      return;
    }

    if (request.method === "POST" && parts.length === 1) {
      const body = await readJsonBody<CreateSessionRequest>(request);
      const session = await createSession(state, body);
      sendJson(response, 201, { ok: true, data: session });
      return;
    }

    const sessionId = parts[1];
    const sessionState = state.sessions.get(sessionId);
    if (!sessionState) throw atlasError("NOT_FOUND", `session not found: ${sessionId}`);

    if (request.method === "GET" && parts.length === 2) {
      sendJson(response, 200, { ok: true, data: sessionState.session });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "end") {
      const session = await setStatus(sessionState, "ended");
      sendJson(response, 200, { ok: true, data: session });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "build") {
      const body = await readJsonBody<BuildRequest>(request);
      sendJson(response, 200, { ok: true, data: await buildApp(state, sessionState, body) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "install") {
      const body = await readJsonBody<InstallRequest>(request);
      sendJson(response, 200, { ok: true, data: await installApp(state, sessionState, body) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "launch") {
      const body = await readJsonBody<LaunchRequest>(request);
      sendJson(response, 200, { ok: true, data: await launchApp(state, sessionState, body) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "actions") {
      const body = await readJsonBody<PerformActionRequest>(request);
      sendJson(response, 200, { ok: true, data: await performAction(state, sessionState, body.action) });
      return;
    }

    if (request.method === "POST" && parts.length === 3 && parts[2] === "screenshot") {
      const body = await readJsonBody<{ reason?: string }>(request);
      sendJson(response, 200, {
        ok: true,
        data: await performAction(state, sessionState, { kind: "screenshot", reason: body.reason })
      });
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "artifacts") {
      sendJson(response, 200, { ok: true, data: sessionState.artifacts });
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "latest-screenshot") {
      await sendLatestScreenshotImage(response, sessionState);
      return;
    }

    if (request.method === "GET" && parts.length === 4 && parts[2] === "artifacts" && parts[3] === "latest-screenshot") {
      sendJson(response, 200, { ok: true, data: await latestScreenshot(sessionState) });
      return;
    }

    if (request.method === "GET" && parts.length === 3 && parts[2] === "events") {
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
    backend: "local-daemon"
  };
  const sessionState: SessionState = { session, layout, artifacts: [], sequence: 0 };
  state.sessions.set(id, sessionState);
  await writeSession(layout, session);
  await writeManifest(layout, []);
  await recordTrace(layout, { type: "session.created", at, session });
  return session;
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
    const artifacts = await recordCommandArtifacts(sessionState, "install", result);
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
    const artifacts = await recordCommandArtifacts(sessionState, "launch", result);
    sessionState.session.app = { ...sessionState.session.app, bundleId: request.bundleId };
    await writeSession(sessionState.layout, sessionState.session);
    await setStatus(sessionState, "running");
    return artifacts;
  });
}

async function performAction(state: DaemonState, sessionState: SessionState, input: ActionInput): Promise<ActionResult> {
  const action = materializeAction(sessionState.session.id, ++sessionState.sequence, input);
  return executeAction(sessionState, action, async () => {
    switch (action.kind) {
      case "screenshot":
        return [await captureScreenshot(state, sessionState, action.reason)];
      case "wait":
        await delay(action.durationMs);
        return [];
      case "tap":
      case "typeText":
      case "swipe":
      case "edgeGesture": {
        const hid = state.hidClientFactory({ helperPath: state.config.hidHelperPath });
        try {
          await hid.attach(simulatorAttachOptions(sessionState.session));
          await hid.performAction(simulatorTarget(sessionState.session), action);
        } finally {
          hid.close();
        }
        return [];
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
    const endedAt = nowIso();
    const result: ActionResult = {
      actionId: action.id,
      ok: false,
      startedAt,
      endedAt,
      artifacts: [],
      error: atlasLoopError
    };
    await appendActionRecord(sessionState.layout, action, result);
    await recordTrace(sessionState.layout, { type: "error", at: endedAt, sessionId: sessionState.session.id, error: atlasLoopError });
    await recordTrace(sessionState.layout, { type: "action.completed", at: endedAt, result });
    await failSession(sessionState, atlasLoopError);
    return result;
  }
}

async function captureScreenshot(
  state: DaemonState,
  sessionState: SessionState,
  reason?: string
): Promise<ArtifactRef> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tempPath = join(sessionState.layout.screenshotsDir, `.tmp-${makeId("shot")}.png`);
  await state.simulator.screenshot({ simulator: sessionState.session.simulator, outputPath: tempPath });
  const artifact = await copyScreenshot(sessionState.layout, tempPath, `${stamp}.png`);
  await rm(tempPath, { force: true });
  artifact.metadata = { ...artifact.metadata, reason };
  await addArtifact(sessionState, artifact);
  return artifact;
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
  }
): Promise<ArtifactRef[]> {
  const stamp = Date.now();
  const commandLine = [result.command, ...result.args].join(" ");
  const log = await writeLog(
    sessionState.layout,
    `${prefix}-${stamp}.log`,
    `$ ${commandLine}\n\n[stdout]\n${result.stdout}\n[stderr]\n${result.stderr}\n`
  );
  const metadata = await writeMetadata(sessionState.layout, `${prefix}-${stamp}.json`, result);
  await addArtifact(sessionState, log);
  await addArtifact(sessionState, metadata);
  return [log, metadata];
}

async function addArtifact(sessionState: SessionState, artifact: ArtifactRef): Promise<void> {
  sessionState.artifacts.push(artifact);
  await writeManifest(sessionState.layout, sessionState.artifacts);
  await recordTrace(sessionState.layout, { type: "artifact.created", at: nowIso(), artifact });
}

async function latestScreenshot(sessionState: SessionState): Promise<ArtifactRef> {
  const artifact = [...sessionState.artifacts].reverse().find((candidate) => candidate.type === "screenshot");
  if (artifact) return artifact;

  const latestPath = join(sessionState.layout.screenshotsDir, "latest.png");
  if (!existsSync(latestPath)) {
    throw atlasError("NOT_FOUND", `no screenshot artifact for session ${sessionState.session.id}`);
  }
  return artifactFromPath(sessionState.layout, "screenshot", latestPath, { latest: true });
}

async function sendLatestScreenshotImage(response: ServerResponse, sessionState: SessionState): Promise<void> {
  const artifact = await latestScreenshot(sessionState);
  const info = await stat(artifact.path);
  response.writeHead(200, {
    "content-type": "image/png",
    "content-length": info.size,
    "cache-control": "no-store"
  });
  await new Promise<void>((resolve, reject) => {
    createReadStream(artifact.path)
      .on("error", reject)
      .on("end", resolve)
      .pipe(response);
  });
}

async function readEvents(sessionState: SessionState): Promise<TraceEvent[]> {
  if (!existsSync(sessionState.layout.tracePath)) return [];
  const text = await readFile(sessionState.layout.tracePath, "utf8");
  return text.split("\n").filter(Boolean).map(parseTraceLine);
}

async function setStatus(sessionState: SessionState, status: SessionStatus): Promise<Session> {
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

function sendJson<T>(response: ServerResponse, statusCode: number, envelope: ApiEnvelope<T>): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(envelope)}\n`);
}

function normalizeError(error: unknown, fallback: AtlasLoopErrorCode = "COMMAND_FAILED"): AtlasLoopError {
  if (isAtlasLoopError(error)) return error;
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

function statusForError(error: AtlasLoopError): number {
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "INVALID_REQUEST") return 400;
  if (error.code === "ACTION_TIMEOUT") return 504;
  return 500;
}

function simulatorTarget(session: Session): string {
  return session.simulator.udid ?? session.simulator.name ?? "booted";
}

function simulatorAttachOptions(session: Session): { appName: string; windowTitleContains?: string } {
  return {
    appName: "Simulator",
    ...(session.simulator.name ? { windowTitleContains: session.simulator.name } : {})
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
