#!/usr/bin/env tsx
import { createInterface } from "node:readline";
import { DaemonClient } from "@atlas-loop/daemon-client";

const client = new DaemonClient();

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const tools = [
  { name: "atlas.createSession", description: "Create a local iOS Simulator session.", inputSchema: { type: "object" } },
  { name: "atlas.getSession", description: "Get a session by id.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.performAction", description: "Perform tap/type/swipe/wait/screenshot action.", inputSchema: objectSchema(["sessionId", "action"]) },
  { name: "atlas.takeScreenshot", description: "Capture a screenshot artifact.", inputSchema: objectSchema(["sessionId"]) },
  { name: "atlas.listArtifacts", description: "List local evidence artifacts.", inputSchema: objectSchema(["sessionId"]) },
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
      const result = await callTool(name, args);
      write({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
      return;
    }
    write({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Unknown method ${request.method}` } });
  } catch (error) {
    write({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: (error as Error).message } });
  }
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "atlas.createSession":
      return client.createSession(args);
    case "atlas.getSession":
      return client.getSession(requireString(args, "sessionId"));
    case "atlas.performAction":
      return client.performAction(requireString(args, "sessionId"), { action: args.action as never });
    case "atlas.takeScreenshot":
      return client.screenshot(requireString(args, "sessionId"), typeof args.reason === "string" ? args.reason : undefined);
    case "atlas.listArtifacts":
      return client.listArtifacts(requireString(args, "sessionId"));
    case "atlas.endSession":
      return client.endSession(requireString(args, "sessionId"));
    case "atlas.build":
      return client.build(requireString(args, "sessionId"), args as never);
    case "atlas.install":
      return client.install(requireString(args, "sessionId"), { appPath: requireString(args, "appPath") });
    case "atlas.launch":
      return client.launch(requireString(args, "sessionId"), { bundleId: requireString(args, "bundleId") });
    default:
      throw new Error(`Unknown tool ${name}`);
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

function write(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
