#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createSimulator } from "@atlas-loop/simulator";
import { loadConfig } from "@atlas-loop/config";
import {
  buildEvidenceMarkdownReport,
  type CompactEvidenceSummary,
  DaemonClient,
  DaemonClientError,
  evidenceReportDataFromSessionSummary,
  type EvidenceReportData,
  type SessionSummary
} from "@atlas-loop/daemon-client";
import { startDaemonServer } from "../../daemon/src/server.ts";
import type { ActionInput, ArtifactRef } from "@atlas-loop/protocol";

type Args = string[];
const DEFAULT_VIEWER_BASE_URL = "http://127.0.0.1:5173";

interface EvidenceClient {
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
  latestScreenshot(sessionId: string): Promise<ArtifactRef>;
}

export async function main(args: Args): Promise<number> {
  const [command, subcommand, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "doctor") return doctor();

  if (command === "daemon" && subcommand === "start") {
    const flags = parseFlags(rest);
    const port = numberFlag(flags, "port") ?? (await loadConfig()).daemonPort;
    const started = await startDaemonServer({ port });
    console.log(JSON.stringify({ ok: true, url: started.url }, null, 2));
    await new Promise(() => undefined);
    return 0;
  }

  const flags = parseFlags([subcommand, ...rest].filter(Boolean));
  const daemonUrl = await resolveDaemonUrl(flags);
  const client = new DaemonClient({ baseUrl: daemonUrl });

  if (command === "session") {
    if (subcommand === "start" || subcommand === "create") {
      const session = await client.createSession({
        simulator: {
          name: stringFlag(flags, "simulator"),
          udid: stringFlag(flags, "udid")
        },
        viewer: booleanFlag(flags, "viewer")
      });
      printJson(session);
      return 0;
    }
    if (subcommand === "list" || subcommand === "ls") {
      printJson(await client.listSessions());
      return 0;
    }
    if (subcommand === "latest") {
      printJson(await client.getSession("latest"));
      return 0;
    }
    if (subcommand === "status" || subcommand === "summary") {
      printJson(await client.getSessionSummary(requireFlag(flags, "session")));
      return 0;
    }
    if (subcommand === "stop" || subcommand === "end") {
      printJson(await client.endSession(requireFlag(flags, "session")));
      return 0;
    }
  }

  if (command === "build") {
    printJson(await client.build(requireFlag(flags, "session"), {
      workspacePath: stringFlag(flags, "workspace"),
      projectPath: stringFlag(flags, "project"),
      scheme: requireFlag(flags, "scheme"),
      configuration: stringFlag(flags, "configuration") as "Debug" | "Release" | undefined,
      derivedDataPath: stringFlag(flags, "derived-data")
    }));
    return 0;
  }

  if (command === "install") {
    printJson(await client.install(requireFlag(flags, "session"), { appPath: requireFlag(flags, "app") }));
    return 0;
  }

  if (command === "launch") {
    printJson(await client.launch(requireFlag(flags, "session"), {
      bundleId: requireFlag(flags, "bundle-id"),
      arguments: csvFlag(flags, "args")
    }));
    return 0;
  }

  if (command === "tap") {
    return action(client, flags, { kind: "tap", x: numberFlagRequired(flags, "x"), y: numberFlagRequired(flags, "y") });
  }

  if (command === "type") {
    return action(client, flags, { kind: "typeText", text: requireFlag(flags, "text") });
  }

  if (command === "swipe") {
    return action(client, flags, {
      kind: "swipe",
      from: parsePoint(requireFlag(flags, "from")),
      to: parsePoint(requireFlag(flags, "to")),
      durationMs: numberFlag(flags, "duration-ms") ?? 350
    });
  }

  if (command === "edge") {
    return action(client, flags, {
      kind: "edgeGesture",
      edge: requireFlag(flags, "edge") as ActionInput & string,
      distance: numberFlag(flags, "distance") ?? 0.75,
      durationMs: numberFlag(flags, "duration-ms") ?? 350
    } as ActionInput);
  }

  if (command === "screenshot") {
    printJson(await client.screenshot(requireFlag(flags, "session"), stringFlag(flags, "reason")));
    return 0;
  }

  if (command === "artifacts" && subcommand === "list") {
    printJson(await client.listArtifacts(requireFlag(flags, "session")));
    return 0;
  }

  if (command === "artifacts" && (subcommand === "latest-screenshot" || subcommand === "latest")) {
    printJson(await client.latestScreenshot(requireFlag(flags, "session")));
    return 0;
  }

  if (command === "artifacts" && subcommand === "path") {
    const summary = await client.getSessionSummary(requireFlag(flags, "session"));
    printJson({ path: summary.paths.artifactDir });
    return 0;
  }

  if (command === "artifacts" && subcommand === "open") {
    const sessionId = requireFlag(flags, "session");
    const path = booleanFlag(flags, "latest-screenshot")
      ? (await client.latestScreenshot(sessionId)).path
      : (await client.getSessionSummary(sessionId)).paths.artifactDir;
    openPath(path);
    printJson({ ok: true, path });
    return 0;
  }

  if (command === "evidence") {
    const viewerBaseUrl = stringFlag(flags, "viewer-base-url") ?? DEFAULT_VIEWER_BASE_URL;
    if (subcommand === "report" || stringFlag(flags, "_0") === "report") {
      const evidence = await buildEvidenceReportData(client, {
        sessionId: requireFlag(flags, "session"),
        daemonUrl,
        viewerBaseUrl
      });
      await outputEvidenceReport(evidence, flags);
      return 0;
    }
    printJson(await buildEvidenceSummary(client, {
      sessionId: requireFlag(flags, "session"),
      daemonUrl,
      viewerBaseUrl
    }));
    return 0;
  }

  if (command === "viewer" && (subcommand === "open" || subcommand === "url")) {
    const sessionId = requireFlag(flags, "session");
    const viewerBaseUrl = stringFlag(flags, "viewer-base-url") ?? DEFAULT_VIEWER_BASE_URL;
    const url = buildViewerUrl({ daemonUrl, sessionId, viewerBaseUrl });
    if (subcommand === "url") {
      printJson({ url, sessionId, daemonUrl, viewerBaseUrl: trimTrailingSlash(viewerBaseUrl) });
      return 0;
    }
    console.log(url);
    if (booleanFlag(flags, "launch")) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return 0;
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

export async function resolveDaemonUrl(flags: Map<string, string | boolean>): Promise<string> {
  return stringFlag(flags, "daemon-url") ?? (await loadConfig()).daemonUrl;
}

export async function buildEvidenceSummary(
  client: EvidenceClient,
  params: { sessionId: string; daemonUrl: string; viewerBaseUrl?: string }
): Promise<CompactEvidenceSummary> {
  const summary = await client.getSessionSummary(params.sessionId);
  const sessionId = summary.session.id;
  const latestScreenshot = summary.artifacts.latestScreenshot ?? await tryLatestScreenshot(client, sessionId);
  const viewerBaseUrl = trimTrailingSlash(params.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL);
  return {
    sessionId,
    requestedSessionId: params.sessionId,
    artifactDir: summary.paths.artifactDir,
    latestScreenshotPath: latestScreenshot?.path ?? null,
    latestScreenshot,
    viewerUrl: buildViewerUrl({ daemonUrl: params.daemonUrl, sessionId, viewerBaseUrl }),
    daemonUrl: params.daemonUrl,
    viewerBaseUrl
  };
}

export async function buildEvidenceReportData(
  client: EvidenceClient,
  params: { sessionId: string; daemonUrl: string; viewerBaseUrl?: string }
): Promise<EvidenceReportData> {
  const summary = await client.getSessionSummary(params.sessionId);
  const sessionId = summary.session.id;
  const latestScreenshot = summary.artifacts.latestScreenshot ?? await tryLatestScreenshot(client, sessionId);
  const viewerBaseUrl = trimTrailingSlash(params.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL);
  return evidenceReportDataFromSessionSummary(summary, {
    requestedSessionId: params.sessionId,
    daemonUrl: params.daemonUrl,
    viewerBaseUrl,
    viewerUrl: buildViewerUrl({ daemonUrl: params.daemonUrl, sessionId, viewerBaseUrl }),
    latestScreenshot
  });
}

async function outputEvidenceReport(evidence: EvidenceReportData, flags: Map<string, string | boolean>): Promise<void> {
  const report = buildEvidenceMarkdownReport(evidence);
  const outPath = stringFlag(flags, "out");
  if (!outPath) {
    console.log(report.trimEnd());
    return;
  }

  const reportPath = resolve(outPath);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, report, "utf8");
  printJson({
    ok: true,
    reportPath,
    sessionId: evidence.sessionId,
    viewerUrl: evidence.viewerUrl,
    latestScreenshotPath: evidence.latestScreenshotPath
  });
}

async function tryLatestScreenshot(client: EvidenceClient, sessionId: string): Promise<ArtifactRef | null> {
  try {
    return await client.latestScreenshot(sessionId);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  if (error instanceof DaemonClientError) return error.code === "NOT_FOUND";
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "NOT_FOUND"
  );
}

async function action(client: DaemonClient, flags: Map<string, string | boolean>, actionInput: ActionInput): Promise<number> {
  printJson(await client.performAction(requireFlag(flags, "session"), actionInput));
  return 0;
}

async function doctor(): Promise<number> {
  const config = await loadConfig();
  const simulator = createSimulator();
  const checks = await simulator.doctor();
  const helperExists = existsSync(config.hidHelperPath);
  printJson({
    ok: checks.ok,
    checks: [
      ...checks.checks,
      {
        name: "ios-hid-helper",
        ok: helperExists,
        message: helperExists ? config.hidHelperPath : `missing helper at ${config.hidHelperPath}`
      }
    ]
  });
  return checks.ok ? 0 : 1;
}

function parseFlags(args: Args): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    index += 1;
  }
  positional.forEach((value, index) => flags.set(`_${index}`, value));
  return flags;
}

function stringFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function requireFlag(flags: Map<string, string | boolean>, name: string): string {
  const value = stringFlag(flags, name);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function booleanFlag(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true || flags.get(name) === "true";
}

function numberFlag(flags: Map<string, string | boolean>, name: string): number | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function numberFlagRequired(flags: Map<string, string | boolean>, name: string): number {
  const value = numberFlag(flags, name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

function csvFlag(flags: Map<string, string | boolean>, name: string): string[] | undefined {
  const value = stringFlag(flags, name);
  return value ? value.split(",").filter(Boolean) : undefined;
}

function parsePoint(value: string): { x: number; y: number } {
  const [x, y] = value.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Invalid point ${value}; expected x,y`);
  return { x, y };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function openPath(path: string): void {
  spawn("open", [path], { stdio: "ignore", detached: true }).unref();
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function printHelp(): void {
  console.log(`Atlas Loop CLI

Usage:
  atlas-loop doctor
  atlas-loop daemon start --port 4317
  atlas-loop session start --simulator "iPhone 16" [--viewer]
  atlas-loop session list [--json]
  atlas-loop session latest
  atlas-loop session status --session <id|latest>
  atlas-loop session stop --session <id|latest>
  atlas-loop build --session <id|latest> --project <path> --scheme <scheme>
  atlas-loop install --session <id|latest> --app <path.app>
  atlas-loop launch --session <id|latest> --bundle-id <bundle>
  atlas-loop tap --session <id|latest> --x 0.5 --y 0.5
  atlas-loop type --session <id|latest> --text "Ada Lovelace"
  atlas-loop swipe --session <id|latest> --from 0.5,0.8 --to 0.5,0.2 --duration-ms 350
  atlas-loop screenshot --session <id|latest> [--reason label]
  atlas-loop artifacts list --session <id|latest>
  atlas-loop artifacts latest-screenshot --session <id|latest>
  atlas-loop artifacts path --session <id|latest>
  atlas-loop artifacts open --session <id|latest> [--latest-screenshot]
  atlas-loop evidence --session <id|latest>
  atlas-loop evidence report --session <id|latest> [--out report.md]
  atlas-loop viewer url --session <id|latest>
  atlas-loop viewer open --session <id|latest> [--launch]

Options:
  --daemon-url <url>  Local daemon URL (default: ATLAS_LOOP_DAEMON_URL or http://127.0.0.1:4317)
  --viewer-base-url <url>  Local viewer URL (default: http://127.0.0.1:5173)
`);
}

export function buildViewerUrl(params: { daemonUrl: string; sessionId: string; viewerBaseUrl?: string }): string {
  const viewerBaseUrl = trimTrailingSlash(params.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL);
  return `${viewerBaseUrl}?daemonUrl=${encodeURIComponent(params.daemonUrl)}&sessionId=${encodeURIComponent(params.sessionId)}`;
}

function isEntrypoint(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href);
}

if (isEntrypoint()) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`[atlas-loop] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
