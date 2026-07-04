#!/usr/bin/env tsx
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig as loadAtlasLoopConfig } from "@atlas-loop/config";
import { DaemonClient, DaemonClientError } from "@atlas-loop/daemon-client";
import type { AtlasLoopError } from "@atlas-loop/protocol";

const DEFAULT_VIEWER_BASE_URL = "http://127.0.0.1:5173";
const defaultClient = new DaemonClient();

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
  getSessionSummary(sessionId: string): Promise<{ paths?: { artifactDir?: unknown } }>;
  performAction(sessionId: string, request: unknown): Promise<unknown>;
  screenshot(sessionId: string, reason?: string): Promise<unknown>;
  listArtifacts(sessionId: string): Promise<unknown>;
  latestScreenshot(sessionId: string): Promise<{ path?: unknown }>;
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
  { name: "atlas.listSessions", description: "List active local iOS Simulator sessions.", inputSchema: objectSchema([]) },
  { name: "atlas.createSession", description: "Create a local iOS Simulator session.", inputSchema: { type: "object" } },
  { name: "atlas.getSession", description: "Get a session by id.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.getSessionSummary", description: "Get session status, artifact paths, counts, latest action, and latest screenshot metadata.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.performAction", description: "Perform tap/type/swipe/wait/screenshot action.", inputSchema: objectSchema(["sessionId", "action"]) },
  { name: "atlas.takeScreenshot", description: "Capture a screenshot artifact.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.listArtifacts", description: "List local evidence artifacts.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.latestScreenshot", description: "Return the latest screenshot artifact reference.", inputSchema: objectSchema(["sessionId"]) },
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
  { name: "atlas.endSession", description: "End a local session.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.build", description: "Build an iOS app through xcodebuild.", inputSchema: objectSchema(["sessionId", "scheme"]) },
  { name: "atlas.install", description: "Install a simulator .app.", inputSchema: objectSchema(["sessionId", "appPath"]) },
  { name: "atlas.launch", description: "Launch an installed bundle.", inputSchema: objectSchema(["sessionId", "bundleId"]) }
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
  const client = runtime.client ?? defaultClient;
  switch (name) {
    case "atlas.health":
      return client.health();
    case "atlas.listSessions":
      return client.listSessions();
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

async function getViewerUrl(args: Record<string, unknown>, runtime: ToolRuntime): Promise<{ url: string; sessionId: string; daemonUrl: string; viewerBaseUrl: string }> {
  const sessionId = requireString(args, "sessionId");
  const config = optionalString(args, "daemonUrl") ? undefined : await (runtime.loadConfig ?? loadAtlasLoopConfig)();
  const daemonUrl = optionalString(args, "daemonUrl") ?? config?.daemonUrl ?? "http://127.0.0.1:4317";
  const viewerBaseUrl = optionalString(args, "viewerBaseUrl") ?? runtime.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL;
  return {
    url: buildViewerUrl({ daemonUrl, sessionId, viewerBaseUrl }),
    sessionId,
    daemonUrl,
    viewerBaseUrl: trimTrailingSlash(viewerBaseUrl)
  };
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

function objectSchema(required: string[], properties: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: "object", properties, required };
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
