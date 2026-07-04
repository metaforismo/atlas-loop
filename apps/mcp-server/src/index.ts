#!/usr/bin/env tsx
import { createInterface } from "node:readline";
import { DaemonClient, DaemonClientError } from "@atlas-loop/daemon-client";
import type { AtlasLoopError } from "@atlas-loop/protocol";

const client = new DaemonClient();

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const tools = [
  { name: "atlas.health", description: "Check local daemon readiness.", inputSchema: objectSchema([]) },
  { name: "atlas.listSessions", description: "List active local iOS Simulator sessions.", inputSchema: objectSchema([]) },
  { name: "atlas.createSession", description: "Create a local iOS Simulator session.", inputSchema: { type: "object" } },
  { name: "atlas.getSession", description: "Get a session by id.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.getSessionSummary", description: "Get session status, artifact paths, counts, latest action, and latest screenshot metadata.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.performAction", description: "Perform tap/type/swipe/wait/screenshot action.", inputSchema: objectSchema(["sessionId", "action"]) },
  { name: "atlas.takeScreenshot", description: "Capture a screenshot artifact.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.listArtifacts", description: "List local evidence artifacts.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.latestScreenshot", description: "Return the latest screenshot artifact reference.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.endSession", description: "End a local session.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.build", description: "Build an iOS app through xcodebuild.", inputSchema: objectSchema(["sessionId", "scheme"]) },
  { name: "atlas.install", description: "Install a simulator .app.", inputSchema: objectSchema(["sessionId", "appPath"]) },
  { name: "atlas.launch", description: "Launch an installed bundle.", inputSchema: objectSchema(["sessionId", "bundleId"]) }
];

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
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
      const result = await callToolWithEnvelope(name, args);
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

async function callToolWithEnvelope(name: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: AtlasLoopError }> {
  try {
    return { ok: true, data: await callTool(name, args) };
  } catch (error) {
    return { ok: false, error: normalizeToolError(error) };
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
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

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} is required`);
  return value;
}

function objectSchema(required: string[]): Record<string, unknown> {
  return { type: "object", properties: {}, required };
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
