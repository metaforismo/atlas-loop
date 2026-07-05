#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  exportSessionArtifacts,
  verifySessionHandoffBundle,
  type SessionHandoffBundleFileIntegrity,
  type SessionHandoffBundleFiles,
  type SessionHandoffBundleIntegrity,
  type SessionHandoffBundleManifest,
  type SessionHandoffBundleResult
} from "@atlas-loop/artifacts";
import { createSimulator } from "@atlas-loop/simulator";
import { loadConfig } from "@atlas-loop/config";
import {
  buildEvidenceHtmlReport,
  collectEvidenceHtmlAssets,
  buildEvidenceMarkdownReport,
  buildSessionHandoff,
  buildSessionHandoffMarkdownNote,
  type CompactEvidenceSummary,
  DaemonClient,
  DaemonClientError,
  evidenceReportDataFromSessionSummary,
  type EvidenceReportData,
  type SessionHandoff,
  type SessionSummary
} from "@atlas-loop/daemon-client";
import { startDaemonServer } from "../../daemon/src/server.ts";
import type { ActionInput, ArtifactRef, AtlasMap, TraceEvent } from "@atlas-loop/protocol";
import { deriveAtlasMap, loadHashCache, saveHashCache } from "@atlas-loop/atlas-map";
import { validateArtifactTarget, type ValidationReport } from "../../../scripts/verify-artifacts.ts";

export { verifySessionHandoffBundle };

type Args = string[];
const DEFAULT_VIEWER_BASE_URL = "http://127.0.0.1:5173";

interface EvidenceClient {
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
  latestScreenshot(sessionId: string): Promise<ArtifactRef>;
  listArtifacts?(sessionId: string): Promise<ArtifactRef[]>;
}

interface SessionReadyClient {
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
}

interface ArtifactValidationClient {
  getSessionSummary(sessionId: string): Promise<SessionSummary>;
}

interface EventClient {
  events(sessionId: string): Promise<TraceEvent[]>;
}

interface SessionHistoryClient {
  listSessionHistory?(params: { limit?: number }): Promise<unknown>;
  request?<T>(method: string, path: string, body?: unknown): Promise<T>;
}

interface ArtifactHealthClient {
  getSessionArtifactHealth?(sessionId: string): Promise<ArtifactHealth>;
  getArtifactHealth?(sessionId: string): Promise<ArtifactHealth>;
  request?<T>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface SessionReadiness {
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

export interface ArtifactVerification {
  ok: boolean;
  target: string;
  source: "session" | "path";
  requestedSessionId?: string;
  sessionId?: string;
  artifactDir?: string;
  requestedPath?: string;
  report: ValidationReport;
}

export interface ArtifactHealth {
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

export interface EventListOptions {
  sessionId: string;
  type?: string;
  limit?: number;
}

export interface EventExportOptions extends EventListOptions {
  outPath: string;
}

export interface EventListResult {
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

export interface EventExportResult extends EventListResult {
  schemaVersion: "atlas-loop.events-export.v1";
  exportedAt: string;
  outPath: string;
  localOnly: true;
  uploaded: false;
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

  if (command === "handoff" && subcommand === "verify") {
    const flags = parseFlags(rest);
    const result = await verifySessionHandoffBundle({
      bundleDir: handoffVerifyBundleDir(flags)
    });
    printJson(result);
    return result.ok ? 0 : 1;
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
        viewer: booleanFlag(flags, "viewer"),
        inputBackend: inputBackendFlag(flags),
        record: booleanFlag(flags, "record")
      });
      printJson(session);
      return 0;
    }
    if (subcommand === "list" || subcommand === "ls") {
      printJson(await client.listSessions());
      return 0;
    }
    if (subcommand === "history" || subcommand === "hist") {
      printJson(await listSessionHistory(client, {
        limit: integerFlag(flags, "limit")
      }));
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
    if (subcommand === "ready") {
      printJson(await buildSessionReadiness(client, {
        sessionId: requireFlag(flags, "session"),
        daemonUrl,
        viewerBaseUrl: stringFlag(flags, "viewer-base-url")
      }));
      return 0;
    }
    if (subcommand === "handoff") {
      const format = handoffFormat(flags);
      const bundleDir = handoffBundleDir(flags);
      const handoff = await buildSessionHandoff(client, {
        sessionId: requireFlag(flags, "session"),
        daemonUrl,
        viewerBaseUrl: stringFlag(flags, "viewer-base-url")
      });
      if (bundleDir) {
        await outputSessionHandoffBundle(client, handoff, bundleDir);
        return 0;
      }
      await outputSessionHandoff(handoff, flags, format);
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
      configuration: configurationFlag(flags),
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

  if (command === "tap-element") {
    return action(client, flags, {
      kind: "tapElement",
      identifier: identifierFlag(flags),
      timeoutMs: numberFlag(flags, "timeout-ms")
    } as ActionInput);
  }

  if (command === "assert-visible") {
    return action(client, flags, {
      kind: "assertVisible",
      identifier: identifierFlag(flags),
      timeoutMs: numberFlag(flags, "timeout-ms")
    } as ActionInput);
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
      edge: requireFlag(flags, "edge") as "left" | "right" | "top" | "bottom",
      distance: numberFlag(flags, "distance") ?? 0.75,
      durationMs: numberFlag(flags, "duration-ms") ?? 350
    } as ActionInput);
  }

  if (command === "wait") {
    return action(client, flags, { kind: "wait", durationMs: numberFlagRequired(flags, "duration-ms") });
  }

  if (command === "screenshot") {
    printJson(await client.screenshot(requireFlag(flags, "session"), stringFlag(flags, "reason")));
    return 0;
  }

  if (command === "map" && subcommand === "build") {
    const config = await loadConfig();
    const artifactRoot = stringFlag(flags, "artifact-root") ?? config.artifactRoot;
    const atlasDir = resolve(artifactRoot, "..", "atlas");
    const outPath = stringFlag(flags, "out") ?? join(atlasDir, "map.json");
    const cachePath = join(atlasDir, "hash-cache.json");

    const hashCache = await loadHashCache(cachePath);
    const derivation = await deriveAtlasMap({
      artifactRoot,
      sessionIds: csvFlag(flags, "sessions"),
      threshold: numberFlag(flags, "threshold"),
      hashCache
    });
    await mkdir(dirname(outPath), { recursive: true });
    await saveHashCache(cachePath, derivation.hashCache);
    await writeFile(outPath, `${JSON.stringify(derivation.map, null, 2)}\n`, "utf8");

    printJson(
      booleanFlag(flags, "json")
        ? derivation.map
        : { ...atlasMapSummary(derivation.map), mapPath: resolve(outPath), warnings: derivation.warnings }
    );
    return 0;
  }

  if (command === "map" && subcommand === "show") {
    const config = await loadConfig();
    const artifactRoot = stringFlag(flags, "artifact-root") ?? config.artifactRoot;
    const mapPath = stringFlag(flags, "map") ?? join(resolve(artifactRoot, "..", "atlas"), "map.json");

    let map: AtlasMap;
    try {
      map = JSON.parse(await readFile(mapPath, "utf8")) as AtlasMap;
    } catch {
      throw new Error(`no atlas map found at ${mapPath}; run: atlas-loop map build`);
    }

    printJson(booleanFlag(flags, "json") ? map : { ...atlasMapSummary(map), mapPath: resolve(mapPath) });
    return 0;
  }

  if (command === "recording" && subcommand === "start") {
    printJson(await client.startRecording(requireFlag(flags, "session")));
    return 0;
  }

  if (command === "recording" && subcommand === "stop") {
    printJson(await client.stopRecording(requireFlag(flags, "session")));
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

  if (command === "artifacts" && subcommand === "verify") {
    const result = await verifyArtifacts(client, {
      sessionId: stringFlag(flags, "session"),
      path: stringFlag(flags, "path")
    });
    printJson(result);
    return result.ok ? 0 : 1;
  }

  if (command === "artifacts" && subcommand === "health") {
    const result = await getArtifactHealth(client, requireFlag(flags, "session"));
    printJson(result);
    return result.ok ? 0 : 1;
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

  if (command === "events" && (subcommand === "list" || subcommand === "ls")) {
    printJson(await listSessionEvents(client, {
      sessionId: requireFlag(flags, "session"),
      type: stringFlag(flags, "type"),
      limit: integerFlag(flags, "limit")
    }));
    return 0;
  }

  if (command === "events" && subcommand === "export") {
    printJson(await exportSessionEvents(client, {
      sessionId: requireFlag(flags, "session"),
      type: stringFlag(flags, "type"),
      limit: integerFlag(flags, "limit"),
      outPath: requireFlag(flags, "out")
    }));
    return 0;
  }

  if (command === "evidence") {
    const viewerBaseUrl = stringFlag(flags, "viewer-base-url") ?? DEFAULT_VIEWER_BASE_URL;
    if (subcommand === "export" || stringFlag(flags, "_0") === "export") {
      printJson(await exportLocalEvidence(client, {
        sessionId: requireFlag(flags, "session"),
        outDir: requireFlag(flags, "out")
      }));
      return 0;
    }
    if (subcommand === "report" || stringFlag(flags, "_0") === "report") {
      const format = stringFlag(flags, "format") ?? "markdown";
      if (format !== "markdown" && format !== "html") {
        throw new Error("--format must be markdown or html");
      }
      const evidence = await buildEvidenceReportData(client, {
        sessionId: requireFlag(flags, "session"),
        daemonUrl,
        viewerBaseUrl
      });
      if (format === "html") {
        await outputEvidenceHtmlReport(client, evidence, flags);
        return 0;
      }
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

export async function listSessionEvents(client: EventClient, params: EventListOptions): Promise<EventListResult> {
  const limit = normalizeEventLimit(params.limit, "limit");
  const events = await client.events(params.sessionId);
  const matchingEvents = params.type
    ? events.filter((event) => event.type === params.type)
    : events;
  const selectedEvents = limit === undefined
    ? matchingEvents
    : limit === 0
      ? []
      : matchingEvents.slice(-limit);

  return {
    requestedSessionId: params.sessionId,
    filters: eventFilters(params.type, limit),
    total: events.length,
    matched: matchingEvents.length,
    count: selectedEvents.length,
    events: selectedEvents
  };
}

export async function exportSessionEvents(client: EventClient, params: EventExportOptions): Promise<EventExportResult> {
  const outPath = resolveLocalPath(params.outPath, "event export out path");
  const result = await listSessionEvents(client, params);
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

async function listSessionHistory(client: SessionHistoryClient, params: { limit?: number }): Promise<unknown> {
  const request = params.limit === undefined ? {} : { limit: params.limit };
  if (typeof client.listSessionHistory === "function") {
    return client.listSessionHistory(request);
  }
  if (typeof client.request === "function") {
    return client.request("GET", sessionHistoryPath(params.limit));
  }
  throw new Error("daemon client does not support session history");
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

export async function buildSessionReadiness(
  client: SessionReadyClient,
  params: { sessionId: string; daemonUrl: string; viewerBaseUrl?: string }
): Promise<SessionReadiness> {
  const summary = await client.getSessionSummary(params.sessionId);
  const sessionId = firstString(summary.session?.id) ?? params.sessionId;
  const status = firstString(summary.session?.status) ?? "unknown";
  const artifactDir = firstString(summary.paths?.artifactDir);
  if (!artifactDir) throw new Error("session summary did not include paths.artifactDir");

  const storageSource = firstString(summary.storage?.source) ?? "unknown";
  const storageWarnings = Array.isArray(summary.storage?.warnings) ? summary.storage.warnings : [];
  const latestScreenshotPath = firstString(summary.artifacts?.latestScreenshot?.path)
    ?? firstString(summary.artifacts?.latestScreenshotPath)
    ?? null;
  const latestAction = latestActionSummary(summary.events?.latestAction);
  const viewerBaseUrl = trimTrailingSlash(params.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL);

  return {
    sessionId,
    requestedSessionId: params.sessionId,
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
    viewerUrl: buildViewerUrl({ daemonUrl: params.daemonUrl, sessionId, viewerBaseUrl }),
    daemonUrl: params.daemonUrl,
    viewerBaseUrl,
    canMutate: storageSource === "memory" && isLiveSessionStatus(status),
    hasScreenshot: latestScreenshotPath !== null
  };
}

export async function buildEvidenceReportData(
  client: EvidenceClient,
  params: { sessionId: string; daemonUrl: string; viewerBaseUrl?: string }
): Promise<EvidenceReportData> {
  const summary = await client.getSessionSummary(params.sessionId);
  const sessionId = summary.session.id;
  const latestScreenshot = summary.artifacts.latestScreenshot ?? await tryLatestScreenshot(client, sessionId);
  const artifactHighlights = await tryListArtifacts(client, sessionId);
  const viewerBaseUrl = trimTrailingSlash(params.viewerBaseUrl ?? DEFAULT_VIEWER_BASE_URL);
  return evidenceReportDataFromSessionSummary(summary, {
    requestedSessionId: params.sessionId,
    daemonUrl: params.daemonUrl,
    viewerBaseUrl,
    viewerUrl: buildViewerUrl({ daemonUrl: params.daemonUrl, sessionId, viewerBaseUrl }),
    latestScreenshot,
    artifactHighlights
  });
}

async function outputEvidenceHtmlReport(
  client: DaemonClient,
  evidence: EvidenceReportData,
  flags: Map<string, string | boolean>
): Promise<void> {
  const outPath = stringFlag(flags, "out");
  const reportPath = outPath ? resolve(outPath) : undefined;
  const [artifacts, events, metrics] = await Promise.all([
    client.listArtifacts(evidence.sessionId),
    client.events(evidence.sessionId),
    client.getSessionMetrics(evidence.sessionId).catch(() => ({ active: false, sampleCount: 0, samples: [] }))
  ]);

  const assets = await collectEvidenceHtmlAssets({
    artifacts,
    events,
    metrics: metrics.samples,
    maxScreenshots: integerFlag(flags, "max-screenshots") ?? 20,
    readFile: (path) => readFile(path),
    videoPathResolver: (path) => (reportPath ? relative(dirname(reportPath), path) : path)
  });
  const html = buildEvidenceHtmlReport(evidence, assets, { generatedAt: new Date().toISOString() });

  if (!reportPath) {
    console.log(html);
    return;
  }

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, html, "utf8");
  printJson({
    ok: true,
    format: "html",
    reportPath,
    sessionId: evidence.sessionId,
    screenshotCount: assets.screenshots.length,
    truncatedScreenshots: assets.truncatedScreenshots,
    videoRelativePath: assets.videoRelativePath ?? null
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

async function outputSessionHandoff(handoff: SessionHandoff, flags: Map<string, string | boolean>, format: "json" | "markdown"): Promise<void> {
  const output = format === "markdown"
    ? buildSessionHandoffMarkdownNote(handoff)
    : `${JSON.stringify(handoff, null, 2)}\n`;
  const outPath = stringFlag(flags, "out");
  if (!outPath) {
    console.log(output.trimEnd());
    return;
  }

  const handoffPath = resolveLocalPath(outPath, "handoff out path");
  await mkdir(dirname(handoffPath), { recursive: true });
  await writeFile(handoffPath, output, "utf8");
  printJson({
    ok: true,
    format,
    handoffPath,
    sessionId: handoff.sessionId,
    requestedSessionId: handoff.requestedSessionId,
    ready: handoff.ready,
    viewerUrl: handoff.viewerUrl,
    latestScreenshotPath: handoff.latestScreenshotPath,
    localOnly: true,
    uploaded: false
  });
}

async function outputSessionHandoffBundle(
  client: EventClient & EvidenceClient,
  handoff: SessionHandoff,
  bundleDir: string
): Promise<void> {
  const createdAt = new Date().toISOString();
  const manifestPath = join(bundleDir, "manifest.json");
  const handoffJsonPath = join(bundleDir, "handoff.json");
  const handoffMarkdownPath = join(bundleDir, "handoff.md");
  const readmePath = join(bundleDir, "README.md");
  const eventsJsonPath = join(bundleDir, "events.json");
  const evidenceReportPath = join(bundleDir, "evidence-report.md");
  const warnings: string[] = [];

  await mkdir(bundleDir, { recursive: true });
  await rm(eventsJsonPath, { force: true });
  await rm(evidenceReportPath, { force: true });
  await writeFile(handoffJsonPath, `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  await writeFile(handoffMarkdownPath, buildSessionHandoffMarkdownNote(handoff), "utf8");

  let eventsJson: string | null = eventsJsonPath;
  try {
    await exportSessionEvents(client, {
      sessionId: handoff.sessionId,
      outPath: eventsJsonPath
    });
  } catch (error) {
    eventsJson = null;
    warnings.push(`events.json unavailable: ${formatErrorMessage(error)}`);
  }

  let evidenceReport: string | null = evidenceReportPath;
  try {
    const evidence = await buildEvidenceReportData(client, {
      sessionId: handoff.sessionId,
      daemonUrl: handoff.daemonUrl,
      viewerBaseUrl: handoff.viewerBaseUrl
    });
    await writeFile(evidenceReportPath, buildEvidenceMarkdownReport(evidence), "utf8");
  } catch (error) {
    evidenceReport = null;
    warnings.push(`evidence-report.md unavailable: ${formatErrorMessage(error)}`);
  }

  const exportedAt = new Date().toISOString();
  const files: SessionHandoffBundleFiles = {
    manifest: manifestPath,
    handoffJson: handoffJsonPath,
    handoffMarkdown: handoffMarkdownPath,
    readme: readmePath,
    eventsJson,
    evidenceReport
  };
  await writeFile(readmePath, buildSessionHandoffBundleReadme(handoff, bundleDir, files, warnings), "utf8");
  const integrity = await buildSessionHandoffBundleIntegrity(files);
  const manifest: SessionHandoffBundleManifest = {
    schemaVersion: "atlas-loop.handoff-bundle.v1",
    sessionId: handoff.sessionId,
    requestedSessionId: handoff.requestedSessionId,
    createdAt,
    exportedAt,
    ready: handoff.ready,
    localOnly: true,
    uploaded: false,
    viewerUrl: handoff.viewerUrl,
    artifactDir: handoff.artifactDir,
    bundleDir,
    files,
    integrity,
    warnings
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const result: SessionHandoffBundleResult = {
    ok: true,
    schemaVersion: manifest.schemaVersion,
    bundleDir,
    manifestPath,
    sessionId: manifest.sessionId,
    requestedSessionId: manifest.requestedSessionId,
    ready: manifest.ready,
    localOnly: true,
    uploaded: false,
    files,
    integrity,
    warnings
  };
  printJson(result);
}

function buildSessionHandoffBundleReadme(
  handoff: SessionHandoff,
  bundleDir: string,
  files: SessionHandoffBundleFiles,
  warnings: string[]
): string {
  const lines = [
    "# Atlas Loop Handoff Bundle",
    "",
    "Local-only handoff bundle. Nothing in this directory is uploaded.",
    "",
    "## Session",
    `- Resolved session: ${code(handoff.sessionId)}`,
    `- Requested session: ${code(handoff.requestedSessionId)}`,
    `- Viewer URL: ${handoff.viewerUrl}`
  ];

  if (handoff.artifactDir) lines.push(`- Artifact directory: ${code(handoff.artifactDir)}`);

  lines.push(
    "",
    "## Available Files",
    `- ${code(relative(bundleDir, files.manifest))}: bundle metadata and integrity`,
    `- ${code(relative(bundleDir, files.handoffJson))}: structured handoff JSON`,
    `- ${code(relative(bundleDir, files.handoffMarkdown))}: Markdown handoff note`,
    `- ${code(relative(bundleDir, files.readme))}: local bundle instructions`
  );

  if (files.eventsJson) lines.push(`- ${code(relative(bundleDir, files.eventsJson))}: exported daemon events`);
  if (files.evidenceReport) lines.push(`- ${code(relative(bundleDir, files.evidenceReport))}: Markdown evidence report`);

  if (warnings.length > 0) {
    lines.push("", "## Warnings");
    for (const warning of warnings) lines.push(`- ${markdownText(warning)}`);
  }

  lines.push(
    "",
    "## Verify",
    `Run ${code(`atlas-loop handoff verify --bundle ${shellSingleQuote(bundleDir)}`)} to check this bundle's local self-consistency before handoff.`,
    "",
    "Open the viewer URL from this machine and use `manifest.json` to inspect file hashes and sizes manually when needed."
  );
  return `${lines.join("\n")}\n`;
}

async function buildSessionHandoffBundleIntegrity(files: SessionHandoffBundleFiles): Promise<SessionHandoffBundleIntegrity> {
  const integrity: SessionHandoffBundleIntegrity = {
    handoffJson: await readFileIntegrity(files.handoffJson),
    handoffMarkdown: await readFileIntegrity(files.handoffMarkdown),
    readme: await readFileIntegrity(files.readme)
  };
  if (files.eventsJson) integrity.eventsJson = await readFileIntegrity(files.eventsJson);
  if (files.evidenceReport) integrity.evidenceReport = await readFileIntegrity(files.evidenceReport);
  return integrity;
}

async function readFileIntegrity(filePath: string): Promise<SessionHandoffBundleFileIntegrity> {
  const contents = await readFile(filePath);
  return {
    sha256: createHash("sha256").update(contents).digest("hex"),
    sizeBytes: contents.byteLength
  };
}

export async function exportLocalEvidence(
  client: Pick<EvidenceClient, "getSessionSummary">,
  params: { sessionId: string; outDir: string }
): Promise<LocalEvidenceExportMetadata> {
  const summary = await client.getSessionSummary(params.sessionId);
  const sessionId = summary.session.id;
  const sourceArtifactDir = resolveLocalPath(summary.paths.artifactDir, "session summary paths.artifactDir");
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

export async function verifyArtifacts(
  client: ArtifactValidationClient,
  params: { sessionId?: string; path?: string }
): Promise<ArtifactVerification> {
  const requestedSessionId = params.sessionId;
  const requestedPath = params.path;
  const hasSessionId = Boolean(requestedSessionId);
  const hasPath = Boolean(requestedPath);
  if (hasSessionId === hasPath) {
    throw new Error("Provide exactly one of --session or --path for artifacts verify");
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

export async function getArtifactHealth(client: ArtifactHealthClient, sessionId: string): Promise<ArtifactHealth> {
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

async function tryLatestScreenshot(client: EvidenceClient, sessionId: string): Promise<ArtifactRef | null> {
  try {
    return await client.latestScreenshot(sessionId);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function tryListArtifacts(client: EvidenceClient, sessionId: string): Promise<ArtifactRef[]> {
  if (typeof client.listArtifacts !== "function") return [];
  try {
    return await client.listArtifacts(sessionId);
  } catch (error) {
    if (isNotFoundError(error)) return [];
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

function atlasMapSummary(map: AtlasMap): Record<string, unknown> {
  return {
    schemaVersion: map.schemaVersion,
    generatedAt: map.generatedAt,
    hashThreshold: map.hashThreshold,
    sessions: map.sessions.length,
    screens: map.screens.map((screen) => ({
      id: screen.id,
      screenId: screen.screenId,
      screenshots: screen.screenshotCount,
      sessions: screen.sessionIds.length
    })),
    transitions: map.transitions.length,
    topTransitions: map.transitions.slice(0, 10).map((transition) => ({ id: transition.id, count: transition.count }))
  };
}

function inputBackendFlag(flags: Map<string, string | boolean>): "cgevent" | "xcuitest" | undefined {
  const value = stringFlag(flags, "input-backend");
  if (value === undefined) return undefined;
  if (value !== "cgevent" && value !== "xcuitest") {
    throw new Error("--input-backend must be cgevent or xcuitest");
  }
  return value;
}

function identifierFlag(flags: Map<string, string | boolean>): string {
  const value = stringFlag(flags, "id") ?? stringFlag(flags, "identifier");
  if (!value) throw new Error("Missing required --id (accessibility identifier)");
  return value;
}

function integerFlag(flags: Map<string, string | boolean>, name: string): number | undefined {
  if (flags.has(name) && typeof flags.get(name) !== "string") {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  const value = numberFlag(flags, name);
  if (value === undefined) return undefined;
  return normalizeEventLimit(value, `--${name}`);
}

function csvFlag(flags: Map<string, string | boolean>, name: string): string[] | undefined {
  const value = stringFlag(flags, name);
  return value ? value.split(",").filter(Boolean) : undefined;
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function latestActionSummary(action: SessionSummary["events"]["latestAction"] | undefined): SessionReadiness["latestAction"] | undefined {
  if (!action?.actionId) return undefined;
  return { id: action.actionId, ok: action.ok };
}

function isLiveSessionStatus(status: string): boolean {
  return status !== "ended" && status !== "failed" && status !== "unknown";
}

function configurationFlag(flags: Map<string, string | boolean>): "Debug" | "Release" | undefined {
  const value = stringFlag(flags, "configuration");
  if (value === undefined || value === "Debug" || value === "Release") return value;
  throw new Error("--configuration must be Debug or Release");
}

function handoffFormat(flags: Map<string, string | boolean>): "json" | "markdown" {
  const rawValue = flags.get("format");
  if (rawValue === undefined) return "json";
  if (typeof rawValue !== "string" || rawValue.length === 0) throw new Error("--format must be json or markdown");
  const value = rawValue;
  if (value === "json" || value === "markdown") return value;
  throw new Error("--format must be json or markdown");
}

function handoffBundleDir(flags: Map<string, string | boolean>): string | undefined {
  const rawValue = flags.get("bundle");
  if (rawValue === undefined) return undefined;
  if (flags.has("out")) throw new Error("Use either --bundle or --out for session handoff, not both");
  if (typeof rawValue !== "string" || rawValue.length === 0) throw new Error("Missing required --bundle");
  return resolveLocalPath(rawValue, "handoff bundle path");
}

function handoffVerifyBundleDir(flags: Map<string, string | boolean>): string {
  const rawValue = flags.get("bundle");
  if (typeof rawValue !== "string" || rawValue.length === 0) throw new Error("Missing required --bundle");
  return resolveLocalPath(rawValue, "handoff bundle path");
}

function normalizeEventLimit(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function eventFilters(type: string | undefined, limit: number | undefined): EventListResult["filters"] {
  const filters: EventListResult["filters"] = {};
  if (type !== undefined) filters.type = type;
  if (limit !== undefined) filters.limit = limit;
  return filters;
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

function resolveLocalPath(path: string, label: string): string {
  if (!path || path.includes("://")) throw new Error(`${label} must be a local filesystem path`);
  return resolve(path);
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}

function code(value: string): string {
  return `\`${value.replaceAll("`", "\\`")}\``;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function markdownText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("*", "\\*")
    .replaceAll("_", "\\_")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
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

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function printHelp(): void {
  console.log(`Atlas Loop CLI

Usage:
  atlas-loop doctor
  atlas-loop daemon start --port 4317
  atlas-loop session start --simulator "iPhone 16" [--viewer] [--input-backend cgevent|xcuitest] [--record]
  atlas-loop recording start --session <id|latest>
  atlas-loop recording stop --session <id|latest>
  atlas-loop map build [--sessions id,id] [--threshold 10] [--out artifacts/atlas/map.json] [--json]
  atlas-loop map show [--json]
  atlas-loop session list [--json]
  atlas-loop session history [--limit 20]
  atlas-loop session latest
  atlas-loop session status --session <id|latest>
  atlas-loop session ready --session <id|latest>
  atlas-loop session handoff --session <id|latest> [--format json|markdown] [--out handoff.md]
  atlas-loop session handoff --session <id|latest> --bundle <dir>
  atlas-loop handoff verify --bundle <dir>
  atlas-loop session stop --session <id|latest>
  atlas-loop build --session <id|latest> --project <path> --scheme <scheme>
  atlas-loop install --session <id|latest> --app <path.app>
  atlas-loop launch --session <id|latest> --bundle-id <bundle>
  atlas-loop tap --session <id|latest> --x 0.5 --y 0.5
  atlas-loop tap-element --session <id|latest> --id cart.continue [--timeout-ms 5000]
  atlas-loop assert-visible --session <id|latest> --id confirmation [--timeout-ms 5000]
  atlas-loop type --session <id|latest> --text "Ada Lovelace"
  atlas-loop swipe --session <id|latest> --from 0.5,0.8 --to 0.5,0.2 --duration-ms 350
  atlas-loop edge --session <id|latest> --edge left --distance 0.75 --duration-ms 350
  atlas-loop wait --session <id|latest> --duration-ms 1000
  atlas-loop screenshot --session <id|latest> [--reason label]
  atlas-loop artifacts list --session <id|latest>
  atlas-loop artifacts latest-screenshot --session <id|latest>
  atlas-loop artifacts path --session <id|latest>
  atlas-loop artifacts verify --session <id|latest>
  atlas-loop artifacts verify --path <dir>
  atlas-loop artifacts health --session <id|latest>
  atlas-loop artifacts open --session <id|latest> [--latest-screenshot]
  atlas-loop events list --session <id|latest> [--type action.completed] [--limit 20]
  atlas-loop events export --session <id|latest> --out events.json [--type action.completed] [--limit 20]
  atlas-loop evidence --session <id|latest>
  atlas-loop evidence report --session <id|latest> [--out report.md] [--format markdown|html] [--max-screenshots 20]
  atlas-loop evidence export --session <id|latest> --out <dir>
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
