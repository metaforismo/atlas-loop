import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
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

export async function createSessionArtifacts(artifactRoot: string, sessionId: string): Promise<SessionArtifacts> {
  const root = resolve(artifactRoot);
  const sessionPath = join(root, sessionId);
  const layout: SessionArtifacts = {
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
  await Promise.all([
    mkdir(layout.screenshotsDir, { recursive: true }),
    mkdir(layout.logsDir, { recursive: true }),
    mkdir(layout.metadataDir, { recursive: true }),
    mkdir(layout.videoDir, { recursive: true }),
    mkdir(layout.buildDir, { recursive: true })
  ]);
  return layout;
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

export async function writeLog(layout: SessionArtifacts, name: string, text: string): Promise<ArtifactRef> {
  const path = join(layout.logsDir, name);
  await appendFile(path, text, "utf8");
  return artifactFromPath(layout, "log", path);
}

export async function writeMetadata(layout: SessionArtifacts, name: string, data: unknown): Promise<ArtifactRef> {
  const path = join(layout.metadataDir, name);
  await writeJson(path, data);
  return artifactFromPath(layout, "metadata", path);
}

export async function copyScreenshot(layout: SessionArtifacts, sourcePath: string, name: string): Promise<ArtifactRef> {
  const path = join(layout.screenshotsDir, name.endsWith(".png") ? name : `${name}.png`);
  await copyFile(sourcePath, path);
  await copyFile(path, join(layout.screenshotsDir, "latest.png"));
  return artifactFromPath(layout, "screenshot", path);
}

export async function artifactFromPath(
  layout: SessionArtifacts,
  type: ArtifactRef["type"],
  path: string,
  metadata?: Record<string, unknown>
): Promise<ArtifactRef> {
  return {
    id: makeId(type),
    sessionId: basename(layout.sessionPath),
    type,
    path: resolve(path),
    createdAt: nowIso(),
    sha256: await sha256File(path),
    metadata
  };
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
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
