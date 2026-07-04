import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { Action, ActionResult, ArtifactRef, Session, TraceEvent } from "@atlas-loop/protocol";
import { makeId, nowIso } from "@atlas-loop/protocol";
import { appendTrace } from "@atlas-loop/traces";

export interface SessionArtifacts {
  root: string;
  sessionPath: string;
  manifestPath: string;
  actionsPath: string;
  tracePath: string;
  screenshotsDir: string;
  logsDir: string;
  metadataDir: string;
  videoDir: string;
  buildDir: string;
}

export interface PersistedSessionWarning {
  path: string;
  message: string;
}

export interface PersistedSessionRecord {
  session: Session;
  layout: SessionArtifacts;
  artifacts: ArtifactRef[];
  warnings: PersistedSessionWarning[];
}

interface ArtifactCandidate {
  artifact: unknown;
  sourcePath: string;
  metadata?: Record<string, unknown>;
}

const sessionStatuses = new Set<Session["status"]>([
  "created",
  "booting",
  "booted",
  "building",
  "installing",
  "installed",
  "launching",
  "running",
  "ended",
  "failed"
]);

const artifactTypeDirs: Record<ArtifactRef["type"], string> = {
  screenshot: "screenshots",
  video: "video",
  log: "logs",
  trace: ".",
  metadata: "metadata",
  "app-bundle": "build",
  action: "."
};

export async function createSessionArtifacts(artifactRoot: string, sessionId: string): Promise<SessionArtifacts> {
  const layout = getSessionArtifactLayout(artifactRoot, sessionId);
  await Promise.all([
    mkdir(layout.screenshotsDir, { recursive: true }),
    mkdir(layout.logsDir, { recursive: true }),
    mkdir(layout.metadataDir, { recursive: true }),
    mkdir(layout.videoDir, { recursive: true }),
    mkdir(layout.buildDir, { recursive: true })
  ]);
  return layout;
}

export function getSessionArtifactLayout(artifactRoot: string, sessionId: string): SessionArtifacts {
  const root = resolve(artifactRoot);
  return sessionLayoutFromPath(root, join(root, sessionId));
}

export async function listPersistedSessions(artifactRoot: string): Promise<PersistedSessionRecord[]> {
  const root = resolve(artifactRoot);
  const rootStat = await tryLstat(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return [];

  let rootReal: string;
  try {
    rootReal = await realpath(root);
  } catch {
    return [];
  }

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => readPersistedSessionDir(root, rootReal, join(root, entry.name), entry.name))
  );
  return records.filter((record): record is PersistedSessionRecord => Boolean(record));
}

export async function readPersistedSession(artifactRoot: string, sessionId: string): Promise<PersistedSessionRecord | undefined> {
  if (!isSafeSessionId(sessionId)) return undefined;

  const root = resolve(artifactRoot);
  const rootStat = await tryLstat(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) return undefined;

  return readPersistedSessionDir(root, await realpath(root), join(root, sessionId), sessionId);
}

export async function writeSession(layout: SessionArtifacts, session: Session): Promise<void> {
  await writeJson(join(layout.sessionPath, "session.json"), session);
}

export async function writeManifest(layout: SessionArtifacts, artifacts: ArtifactRef[]): Promise<void> {
  await writeJson(layout.manifestPath, {
    schemaVersion: "atlas-loop.manifest.v1",
    updatedAt: nowIso(),
    artifacts
  });
}

export async function appendActionRecord(layout: SessionArtifacts, action: Action, result?: ActionResult): Promise<void> {
  await appendFile(layout.actionsPath, `${JSON.stringify({ action, result })}\n`, "utf8");
}

export async function recordTrace(layout: SessionArtifacts, event: TraceEvent): Promise<void> {
  await appendTrace(layout.tracePath, event);
}

export async function writeLog(
  layout: SessionArtifacts,
  name: string,
  text: string,
  metadata?: Record<string, unknown>
): Promise<ArtifactRef> {
  const path = join(layout.logsDir, name);
  await appendFile(path, text, "utf8");
  return artifactFromPath(layout, "log", path, metadata);
}

export async function writeMetadata(
  layout: SessionArtifacts,
  name: string,
  data: unknown,
  metadata?: Record<string, unknown>
): Promise<ArtifactRef> {
  const path = join(layout.metadataDir, name);
  await writeJson(path, data);
  return artifactFromPath(layout, "metadata", path, metadata);
}

export async function copyScreenshot(
  layout: SessionArtifacts,
  sourcePath: string,
  name: string,
  metadata?: Record<string, unknown>
): Promise<ArtifactRef> {
  const path = join(layout.screenshotsDir, name.endsWith(".png") ? name : `${name}.png`);
  await copyFile(sourcePath, path);
  await copyFile(path, join(layout.screenshotsDir, "latest.png"));
  return artifactFromPath(layout, "screenshot", path, metadata);
}

export async function artifactFromPath(
  layout: SessionArtifacts,
  type: ArtifactRef["type"],
  path: string,
  metadata?: Record<string, unknown>
): Promise<ArtifactRef> {
  const artifactMetadata = await metadataForArtifact(type, path, metadata);
  return {
    id: makeId(type),
    sessionId: basename(layout.sessionPath),
    type,
    path: resolve(path),
    createdAt: nowIso(),
    sha256: await sha256File(path),
    metadata: artifactMetadata
  };
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function resolveContainedArtifactPath(
  layout: SessionArtifacts,
  type: ArtifactRef["type"],
  path: string
): Promise<string | undefined> {
  const sessionDir = resolve(layout.sessionPath);
  const requiredRoot = expectedArtifactRoot(layout, type);
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(sessionDir, path);

  if (!isPathInsideOrEqual(sessionDir, absolutePath) || !isPathInsideOrEqual(requiredRoot, absolutePath)) {
    return undefined;
  }

  const targetStat = await tryLstat(absolutePath);
  const allowDirectory = type === "app-bundle";
  if (!targetStat || targetStat.isSymbolicLink() || (!targetStat.isFile() && !(allowDirectory && targetStat.isDirectory()))) {
    return undefined;
  }

  let realSessionDir: string;
  let realRequiredRoot: string;
  let realTarget: string;
  try {
    [realSessionDir, realRequiredRoot, realTarget] = await Promise.all([
      realpath(sessionDir),
      realpath(requiredRoot),
      realpath(absolutePath)
    ]);
  } catch {
    return undefined;
  }

  if (!isPathInsideOrEqual(realSessionDir, realTarget) || !isPathInsideOrEqual(realRequiredRoot, realTarget)) {
    return undefined;
  }

  return absolutePath;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function sessionLayoutFromPath(root: string, sessionPath: string): SessionArtifacts {
  return {
    root,
    sessionPath,
    manifestPath: join(sessionPath, "manifest.json"),
    actionsPath: join(sessionPath, "actions.jsonl"),
    tracePath: join(sessionPath, "trace.jsonl"),
    screenshotsDir: join(sessionPath, "screenshots"),
    logsDir: join(sessionPath, "logs"),
    metadataDir: join(sessionPath, "metadata"),
    videoDir: join(sessionPath, "video"),
    buildDir: join(sessionPath, "build")
  };
}

async function readPersistedSessionDir(
  root: string,
  rootReal: string,
  sessionDir: string,
  expectedSessionId: string
): Promise<PersistedSessionRecord | undefined> {
  const resolvedSessionDir = resolve(sessionDir);
  if (!isPathInsideOrEqual(root, resolvedSessionDir)) return undefined;

  const dirStat = await tryLstat(resolvedSessionDir);
  if (!dirStat?.isDirectory() || dirStat.isSymbolicLink()) return undefined;

  let sessionReal: string;
  try {
    sessionReal = await realpath(resolvedSessionDir);
  } catch {
    return undefined;
  }
  if (!isPathInsideOrEqual(rootReal, sessionReal)) return undefined;

  const warnings: PersistedSessionWarning[] = [];
  const sessionPath = join(resolvedSessionDir, "session.json");
  const rawSession = await readContainedJson<unknown>(sessionPath, warnings, { required: false });
  if (!rawSession || !isValidSession(rawSession, resolvedSessionDir, expectedSessionId, warnings)) {
    return undefined;
  }

  const layout = sessionLayoutFromPath(root, resolvedSessionDir);
  const session: Session = { ...rawSession, artifactDir: layout.sessionPath };
  return {
    session,
    layout,
    artifacts: await readPersistedArtifacts(layout, session.id, warnings),
    warnings
  };
}

async function readPersistedArtifacts(
  layout: SessionArtifacts,
  sessionId: string,
  warnings: PersistedSessionWarning[]
): Promise<ArtifactRef[]> {
  const candidates: ArtifactCandidate[] = [];
  const manifest = await readContainedJson<{ artifacts?: unknown }>(layout.manifestPath, warnings, { required: false });
  if (manifest) {
    if (Array.isArray(manifest.artifacts)) {
      for (const [index, artifact] of manifest.artifacts.entries()) {
        candidates.push({ artifact, sourcePath: `${layout.manifestPath}#artifacts[${index}]` });
      }
    } else {
      warnings.push({ path: layout.manifestPath, message: "manifest artifacts must be an array" });
    }
  }

  const actionArtifacts = await readActionArtifacts(layout, warnings);
  candidates.push(...actionArtifacts);

  const artifacts = new Map<string, ArtifactRef>();
  for (const candidate of candidates) {
    const artifact = await normalizeArtifactRef(
      layout,
      sessionId,
      candidate.artifact,
      candidate.sourcePath,
      warnings,
      candidate.metadata
    );
    if (!artifact) continue;

    const key = `${artifact.id}\0${artifact.path}`;
    const existing = artifacts.get(key);
    artifacts.set(key, existing ? mergeArtifactRefs(existing, artifact) : artifact);
  }

  return markLatestScreenshot([...artifacts.values()].sort((left, right) => timestamp(left.createdAt) - timestamp(right.createdAt)));
}

async function readActionArtifacts(
  layout: SessionArtifacts,
  warnings: PersistedSessionWarning[]
): Promise<ArtifactCandidate[]> {
  const actionsStat = await tryLstat(layout.actionsPath);
  if (!actionsStat) return [];
  if (!actionsStat.isFile() || actionsStat.isSymbolicLink()) {
    warnings.push({ path: layout.actionsPath, message: "actions.jsonl is not a regular file" });
    return [];
  }

  const artifacts: ArtifactCandidate[] = [];
  const lines = (await readFile(layout.actionsPath, "utf8")).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const sourcePath = `${layout.actionsPath}:${index + 1}`;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      warnings.push({ path: sourcePath, message: `invalid action JSONL record: ${(error as Error).message}` });
      continue;
    }

    if (!isRecord(record) || !isRecord(record.result) || !Array.isArray(record.result.artifacts)) continue;
    const actionMetadata = actionMetadataFromRecord(record.action);
    for (const [artifactIndex, artifact] of record.result.artifacts.entries()) {
      artifacts.push({ artifact, sourcePath: `${sourcePath}#artifacts[${artifactIndex}]`, metadata: actionMetadata });
    }
  }
  return artifacts;
}

async function normalizeArtifactRef(
  layout: SessionArtifacts,
  sessionId: string,
  artifact: unknown,
  sourcePath: string,
  warnings: PersistedSessionWarning[],
  metadata?: Record<string, unknown>
): Promise<ArtifactRef | undefined> {
  if (!isRecord(artifact)) {
    warnings.push({ path: sourcePath, message: "artifact entry must be an object" });
    return undefined;
  }

  if (typeof artifact.id !== "string" || !artifact.id) {
    warnings.push({ path: sourcePath, message: "artifact id must be a non-empty string" });
    return undefined;
  }
  if (artifact.sessionId !== sessionId) {
    warnings.push({ path: sourcePath, message: `artifact sessionId must match ${sessionId}` });
    return undefined;
  }
  if (!isArtifactType(artifact.type)) {
    warnings.push({ path: sourcePath, message: "artifact type is not recognized" });
    return undefined;
  }
  if (typeof artifact.path !== "string" || !artifact.path) {
    warnings.push({ path: sourcePath, message: "artifact path must be a non-empty string" });
    return undefined;
  }
  if (typeof artifact.createdAt !== "string" || Number.isNaN(Date.parse(artifact.createdAt))) {
    warnings.push({ path: sourcePath, message: "artifact createdAt must be an ISO timestamp" });
    return undefined;
  }
  if (artifact.metadata !== undefined && !isRecord(artifact.metadata)) {
    warnings.push({ path: sourcePath, message: "artifact metadata must be an object when present" });
    return undefined;
  }

  const containedPath = await resolveContainedArtifactPath(layout, artifact.type, artifact.path);
  if (!containedPath) {
    warnings.push({ path: sourcePath, message: `artifact ${artifact.id} path is missing or escapes the session directory` });
    return undefined;
  }

  return {
    id: artifact.id,
    sessionId,
    type: artifact.type,
    path: containedPath,
    createdAt: artifact.createdAt,
    sha256: typeof artifact.sha256 === "string" ? artifact.sha256 : undefined,
    metadata: await metadataForArtifact(
      artifact.type,
      containedPath,
      mergeMetadata(isRecord(artifact.metadata) ? artifact.metadata : undefined, metadata)
    )
  };
}

function actionMetadataFromRecord(action: unknown): Record<string, unknown> | undefined {
  if (!isRecord(action)) return undefined;
  return compactMetadata({
    actionId: typeof action.id === "string" ? action.id : undefined,
    actionSequence: typeof action.sequence === "number" ? action.sequence : undefined,
    actionKind: typeof action.kind === "string" ? action.kind : undefined
  });
}

async function metadataForArtifact(
  type: ArtifactRef["type"],
  path: string,
  metadata?: Record<string, unknown>
): Promise<Record<string, unknown> | undefined> {
  const fileStat = await tryLstat(path);
  return compactMetadata({
    ...metadata,
    sizeBytes: fileStat?.isFile() ? fileStat.size : metadata?.sizeBytes,
    mediaType: inferMediaType(type, path) ?? metadata?.mediaType
  });
}

function inferMediaType(type: ArtifactRef["type"], path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  if (type === "screenshot") {
    if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
    return "image/png";
  }
  if (type === "video") {
    if (extension === ".mov") return "video/quicktime";
    if (extension === ".mp4") return "video/mp4";
    return "video/mp4";
  }
  if (type === "log") return "text/plain";
  if (type === "trace") return "application/x-ndjson";
  if (type === "metadata" || type === "action") return "application/json";
  if (type === "app-bundle") return "application/vnd.apple.application-bundle";
  return undefined;
}

function mergeArtifactRefs(existing: ArtifactRef, next: ArtifactRef): ArtifactRef {
  return {
    ...existing,
    sha256: existing.sha256 ?? next.sha256,
    metadata: mergeMetadata(existing.metadata, next.metadata)
  };
}

function mergeMetadata(
  existing?: Record<string, unknown>,
  next?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!existing && !next) return undefined;
  return compactMetadata({ ...next, ...existing });
}

export function markLatestScreenshot(artifacts: ArtifactRef[]): ArtifactRef[] {
  let latestScreenshotIndex = -1;
  for (let index = artifacts.length - 1; index >= 0; index -= 1) {
    if (artifacts[index].type === "screenshot") {
      latestScreenshotIndex = index;
      break;
    }
  }

  return artifacts.map((artifact, index) => {
    if (artifact.type !== "screenshot") return artifact;
    return {
      ...artifact,
      metadata: compactMetadata({
        ...artifact.metadata,
        latest: index === latestScreenshotIndex,
        latestScreenshot: index === latestScreenshotIndex
      })
    };
  });
}

async function readContainedJson<T>(
  path: string,
  warnings: PersistedSessionWarning[],
  options: { required: boolean }
): Promise<T | undefined> {
  const stat = await tryLstat(path);
  if (!stat) {
    if (options.required) warnings.push({ path, message: "file is missing" });
    return undefined;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    warnings.push({ path, message: "file is not a regular JSON file" });
    return undefined;
  }

  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    warnings.push({ path, message: `could not parse JSON: ${(error as Error).message}` });
    return undefined;
  }
}

function isValidSession(
  session: unknown,
  sessionDir: string,
  expectedSessionId: string,
  warnings: PersistedSessionWarning[]
): session is Session {
  const sessionPath = join(sessionDir, "session.json");
  let valid = true;
  const fail = (message: string) => {
    warnings.push({ path: sessionPath, message });
    valid = false;
  };

  if (!isRecord(session)) {
    fail("session must be an object");
    return false;
  }
  if (session.schemaVersion !== "atlas-loop.session.v1") fail("session schemaVersion must be atlas-loop.session.v1");
  if (session.id !== expectedSessionId) fail(`session id must match directory name ${expectedSessionId}`);
  if (session.platform !== "ios-simulator") fail("session platform must be ios-simulator");
  if (!isSessionStatus(session.status)) fail("session status is not recognized");
  if (typeof session.createdAt !== "string" || Number.isNaN(Date.parse(session.createdAt))) {
    fail("session createdAt must be an ISO timestamp");
  }
  if (typeof session.updatedAt !== "string" || Number.isNaN(Date.parse(session.updatedAt))) {
    fail("session updatedAt must be an ISO timestamp");
  }
  if (!isRecord(session.simulator)) fail("session simulator must be an object");
  if (typeof session.artifactDir !== "string" || !session.artifactDir) {
    fail("session artifactDir must be a non-empty string");
  } else {
    const artifactDir = isAbsolute(session.artifactDir) ? resolve(session.artifactDir) : resolve(sessionDir, session.artifactDir);
    if (!isPathInsideOrEqual(sessionDir, artifactDir)) fail("session artifactDir escapes session directory");
  }

  return valid;
}

function expectedArtifactRoot(layout: SessionArtifacts, type: ArtifactRef["type"]): string {
  const dir = artifactTypeDirs[type];
  return dir === "." ? layout.sessionPath : join(layout.sessionPath, dir);
}

async function tryLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch {
    return undefined;
  }
}

function isArtifactType(value: unknown): value is ArtifactRef["type"] {
  return typeof value === "string" && value in artifactTypeDirs;
}

function isSessionStatus(value: unknown): value is Session["status"] {
  return typeof value === "string" && sessionStatuses.has(value as Session["status"]);
}

function isSafeSessionId(sessionId: string): boolean {
  return Boolean(sessionId) && basename(sessionId) === sessionId && !sessionId.includes("/") && !sessionId.includes("\\");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function isPathInsideOrEqual(root: string, candidate: string): boolean {
  const relativePath = relative(resolve(root), resolve(candidate));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolvePromise());
  });
  return hash.digest("hex");
}
