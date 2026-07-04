#!/usr/bin/env tsx
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig as loadAtlasLoopConfig } from "@atlas-loop/config";
import {
  buildEvidenceMarkdownReport,
  type CompactEvidenceSummary,
  DaemonClient,
  DaemonClientError,
  evidenceReportDataFromSessionSummary,
  type EvidenceReportData,
  type SessionSummary
} from "@atlas-loop/daemon-client";
import type { ArtifactRef, AtlasLoopError } from "@atlas-loop/protocol";

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
  createSession(args: Record<string, unknown>): Promise<unknown>;
  getSession(sessionId: string): Promise<unknown>;
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
  performAction(sessionId: string, request: unknown): Promise<unknown>;
  screenshot(sessionId: string, reason?: string): Promise<unknown>;
  listArtifacts(sessionId: string): Promise<unknown>;
  latestScreenshot(sessionId: string): Promise<Partial<ArtifactRef>>;
  endSession(sessionId: string): Promise<unknown>;
  build(sessionId: string, request: unknown): Promise<unknown>;
  install(sessionId: string, request: unknown): Promise<unknown>;
  launch(sessionId: string, request: unknown): Promise<unknown>;
}

interface ToolRuntime {
  client?: McpDaemonClient;
  loadConfig?: () => Promise<{ daemonUrl: string }>;
  viewerBaseUrl?: string;
}

export const tools = [
  { name: "atlas.health", description: "Check local daemon readiness.", inputSchema: objectSchema([]) },
  { name: "atlas.listSessions", description: "List active and persisted local iOS Simulator sessions.", inputSchema: objectSchema([]) },
  { name: "atlas.getLatestSession", description: "Return the newest readable session using the daemon latest alias.", inputSchema: objectSchema([]) },
  { name: "atlas.createSession", description: "Create a local iOS Simulator session.", inputSchema: createSessionSchema() },
  { name: "atlas.getSession", description: "Get a session by id.", inputSchema: sessionIdSchema() },
  { name: "atlas.getSessionSummary", description: "Get session status, artifact paths, counts, latest action, and latest screenshot metadata.", inputSchema: sessionIdSchema() },
  { name: "atlas.performAction", description: "Perform tap/type/swipe/wait/screenshot action.", inputSchema: performActionSchema() },
  { name: "atlas.takeScreenshot", description: "Capture a screenshot artifact.", inputSchema: objectSchema(["sessionId"], { ...sessionIdProperty(), reason: { type: "string" } }) },
  { name: "atlas.listArtifacts", description: "List local evidence artifacts.", inputSchema: sessionIdSchema() },
  { name: "atlas.latestScreenshot", description: "Return the latest screenshot artifact reference.", inputSchema: sessionIdSchema() },
  { name: "atlas.getArtifactPath", description: "Return the local artifact directory path for a session.", inputSchema: objectSchema(["sessionId"], { sessionId: { type: "string" } }) },
  { name: "atlas.getLatestScreenshotPath", description: "Return the local path for the latest screenshot artifact.", inputSchema: objectSchema(["sessionId"], { sessionId: { type: "string" } }) },
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
    description: "Return compact evidence plus a paste-ready Markdown report.",
    inputSchema: objectSchema(["sessionId"], {
      sessionId: { type: "string", description: "Session id or latest." },
      daemonUrl: { type: "string", description: "Optional daemon URL override." },
      viewerBaseUrl: { type: "string", description: "Optional viewer app base URL override." }
    })
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
  const client = runtime.client ?? await defaultDaemonClient(args, runtime);
  switch (name) {
    case "atlas.health":
      return client.health();
    case "atlas.listSessions":
      return client.listSessions();
    case "atlas.getLatestSession":
      return client.getSession("latest");
    case "atlas.createSession":
      return client.createSession(args);
    case "atlas.getSession":
      return client.getSession(requireString(args, "sessionId"));
    case "atlas.getSessionSummary":
      return client.getSessionSummary(requireString(args, "sessionId"));
    case "atlas.performAction":
      return client.performAction(requireString(args, "sessionId"), { action: args.action as never });
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
    case "atlas.getViewerUrl":
      return getViewerUrl(args, runtime);
    case "atlas.getEvidence":
      return getEvidence(client, args, runtime);
    case "atlas.getEvidenceReport":
      return getEvidenceReport(client, args, runtime);
    case "atlas.endSession":
      return client.endSession(requireString(args, "sessionId"));
    case "atlas.build":
      return client.build(requireString(args, "sessionId"), withoutSessionId(args) as never);
    case "atlas.install":
      return client.install(requireString(args, "sessionId"), { appPath: requireString(args, "appPath") });
    case "atlas.launch":
      return client.launch(requireString(args, "sessionId"), withoutSessionId(args) as never);
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

async function getLatestScreenshotPath(client: McpDaemonClient, args: Record<string, unknown>): Promise<{ path: string; artifact: unknown }> {
  const artifact = await client.latestScreenshot(requireString(args, "sessionId"));
  if (typeof artifact.path !== "string" || !artifact.path) throw new Error("latest screenshot did not include a path");
  return { path: artifact.path, artifact };
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

async function getEvidenceReport(
  client: McpDaemonClient,
  args: Record<string, unknown>,
  runtime: ToolRuntime
): Promise<{ evidence: EvidenceReportData; report: string }> {
  const evidence = await getEvidenceReportData(client, args, runtime);
  return {
    evidence,
    report: buildEvidenceMarkdownReport(evidence)
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
  const viewer = await getViewerUrl({ ...args, sessionId }, runtime);

  return evidenceReportDataFromSessionSummary({
    ...summary,
    session: { ...summary.session, id: sessionId }
  }, {
    requestedSessionId,
    daemonUrl: viewer.daemonUrl,
    viewerBaseUrl: viewer.viewerBaseUrl,
    viewerUrl: viewer.url,
    latestScreenshot: latestScreenshot as ArtifactRef | null
  });
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

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function artifactPath(artifact: unknown): string | undefined {
  if (!artifact || typeof artifact !== "object") return undefined;
  return firstString((artifact as { path?: unknown }).path);
}

function requireArtifactPath(artifact: unknown): string {
  const path = artifactPath(artifact);
  if (!path) throw new Error("latest screenshot did not include a path");
  return path;
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof DaemonClientError) return error.code === "NOT_FOUND";
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "NOT_FOUND"
  );
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
    viewer: { type: "boolean" }
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

function withoutSessionId(args: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _sessionId, ...request } = args;
  return request;
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
