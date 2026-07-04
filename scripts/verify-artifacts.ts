#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, opendir, readFile, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Action, ArtifactRef, Session } from "@atlas-loop/protocol";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  path: string;
  message: string;
}

export interface ValidationReport {
  target: string;
  sessionCount: number;
  ok: boolean;
  issues: ValidationIssue[];
}

const requiredSessionDirs = ["screenshots", "logs", "metadata"] as const;
const actionKinds = new Set(["tap", "typeText", "swipe", "edgeGesture", "screenshot", "install", "launch", "wait"]);
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
const artifactTypeDirs: Partial<Record<ArtifactRef["type"], string>> = {
  screenshot: "screenshots",
  log: "logs",
  metadata: "metadata",
  video: "video",
  trace: ".",
  action: ".",
  "app-bundle": "build"
};
const sha256Pattern = /^[a-f0-9]{64}$/i;
const isoUtcPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const proofPathKeys = ["summaryPath", "reportPath", "proofPath", "evidenceReportPath"] as const;
const proofFileKeys = ["summary", "report", "proof", "evidenceReport"] as const;

export async function validateArtifactTarget(target: string): Promise<ValidationReport> {
  const resolvedTarget = resolve(target);
  const issues: ValidationIssue[] = [];

  if (!(await exists(resolvedTarget))) {
    issues.push(error(resolvedTarget, "target does not exist"));
    return report(resolvedTarget, 0, issues);
  }

  const sessionDirs = await discoverSessionDirs(resolvedTarget, issues);
  for (const sessionDir of sessionDirs) {
    await validateSessionDir(sessionDir, issues);
  }

  return report(resolvedTarget, sessionDirs.length, issues);
}

async function discoverSessionDirs(target: string, issues: ValidationIssue[]): Promise<string[]> {
  const targetStat = await stat(target);
  if (targetStat.isFile()) {
    if (basename(target) !== "session.json") {
      issues.push(error(target, "file target must be a session.json file"));
      return [];
    }
    return [resolve(target, "..")];
  }

  if (await exists(join(target, "session.json"))) {
    return [target];
  }

  const sessionDirs: string[] = [];
  const dir = await opendir(target);
  for await (const entry of dir) {
    if (!entry.isDirectory()) continue;
    const child = join(target, entry.name);
    if (await exists(join(child, "session.json"))) {
      sessionDirs.push(child);
    }
  }

  if (sessionDirs.length === 0) {
    issues.push(warning(target, "no session.json files found under target; nothing to validate"));
  }

  return sessionDirs.sort();
}

async function validateSessionDir(sessionDir: string, issues: ValidationIssue[]): Promise<void> {
  const sessionPath = join(sessionDir, "session.json");
  const session = await readJsonFile<unknown>(sessionPath, issues);
  if (session === undefined) return;

  if (!isRecord(session)) {
    issues.push(error(sessionPath, "session.json must be an object"));
    return;
  }

  if (session.schemaVersion !== "atlas-loop.session.v1") {
    issues.push(error(sessionPath, "session.json schemaVersion must be atlas-loop.session.v1"));
  }
  const sessionId = typeof session.id === "string" && session.id ? session.id : basename(sessionDir);
  if (!session.id || typeof session.id !== "string") {
    issues.push(error(sessionPath, "session.json id must be a non-empty string"));
  } else if (session.id !== basename(sessionDir)) {
    issues.push(error(sessionPath, `session id ${session.id} must match directory name ${basename(sessionDir)}`));
  }
  if (session.platform !== "ios-simulator") {
    issues.push(error(sessionPath, "session platform must be ios-simulator"));
  }
  if (!isSessionStatus(session.status)) {
    issues.push(error(sessionPath, "session status is not recognized"));
  }
  if (!isIsoTimestamp(session.createdAt)) {
    issues.push(error(sessionPath, "session createdAt must be an ISO timestamp"));
  }
  if (!isIsoTimestamp(session.updatedAt)) {
    issues.push(error(sessionPath, "session updatedAt must be an ISO timestamp"));
  }
  if (!isRecord(session.simulator)) {
    issues.push(error(sessionPath, "session simulator must be an object"));
  }
  if (typeof session.artifactDir === "string" && session.artifactDir) {
    await validateContainedPath(sessionDir, session.artifactDir, "session.artifactDir", issues, { mustExist: true });
  } else {
    issues.push(error(sessionPath, "session artifactDir must be a non-empty string"));
  }
  await validateProofFileRefs(sessionPath, session, sessionDir, "session", issues);

  for (const dirName of requiredSessionDirs) {
    const dirPath = join(sessionDir, dirName);
    if (!(await exists(dirPath))) {
      issues.push(warning(dirPath, `${dirName}/ directory is missing; warning-only for legacy or minimal persisted sessions, but evidence is incomplete`));
      continue;
    }
    await validateDirectoryTreeContained(sessionDir, dirPath, issues);
  }

  await validateActions(sessionDir, sessionId, issues);
  await validateManifest(sessionDir, sessionId, issues);
}

async function validateActions(sessionDir: string, sessionId: string, issues: ValidationIssue[]): Promise<void> {
  const actionsPath = join(sessionDir, "actions.jsonl");
  if (!(await exists(actionsPath))) {
    issues.push(warning(actionsPath, "actions.jsonl is missing; warning-only for legacy or minimal persisted sessions, with no action records to validate"));
    return;
  }

  const lines = (await readFile(actionsPath, "utf8")).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    const linePath = `${actionsPath}:${index + 1}`;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (parseError) {
      issues.push(error(linePath, `invalid JSONL record: ${(parseError as Error).message}`));
      continue;
    }

    if (!isRecord(record)) {
      issues.push(error(linePath, "action record must be an object"));
      continue;
    }

    const action = record.action as Partial<Action> | undefined;
    if (!isRecord(action)) {
      issues.push(error(linePath, "action record requires an action object"));
      continue;
    }
    validateActionRecord(linePath, action, sessionId, issues);

    if (record.result !== undefined) {
      if (!isRecord(record.result)) {
        issues.push(error(linePath, "result must be an object when present"));
      } else {
        await validateActionResult(linePath, record.result, action.id, sessionId, sessionDir, issues);
      }
    }
  }
}

function validateActionRecord(path: string, action: Partial<Action>, sessionId: string, issues: ValidationIssue[]): void {
  if (typeof action.id !== "string" || !action.id) {
    issues.push(error(path, "action.id must be a non-empty string"));
  }
  if (action.sessionId !== sessionId) {
    issues.push(error(path, `action.sessionId must match session id ${sessionId}`));
  }
  if (typeof action.kind !== "string" || !actionKinds.has(action.kind)) {
    issues.push(error(path, "action.kind is not a known Atlas Loop action kind"));
  }
  if (typeof action.createdAt !== "string" || Number.isNaN(Date.parse(action.createdAt))) {
    issues.push(error(path, "action.createdAt must be an ISO timestamp"));
  }
  if (action.sequence !== undefined && (!Number.isInteger(action.sequence) || action.sequence < 0)) {
    issues.push(error(path, "action.sequence must be a non-negative integer when present"));
  }
}

async function validateActionResult(
  path: string,
  result: Record<string, unknown>,
  actionId: unknown,
  sessionId: string,
  sessionDir: string,
  issues: ValidationIssue[]
): Promise<void> {
  if (result.actionId !== actionId) {
    issues.push(error(path, "result.actionId must match action.id"));
  }
  if (typeof result.ok !== "boolean") {
    issues.push(error(path, "result.ok must be boolean"));
  }
  if (!isIsoTimestamp(result.startedAt)) {
    issues.push(error(path, "result.startedAt must be an ISO timestamp"));
  }
  if (!isIsoTimestamp(result.endedAt)) {
    issues.push(error(path, "result.endedAt must be an ISO timestamp"));
  }
  if (isIsoTimestamp(result.startedAt) && isIsoTimestamp(result.endedAt) && Date.parse(result.endedAt) < Date.parse(result.startedAt)) {
    issues.push(error(path, "result.endedAt must not be earlier than result.startedAt"));
  }
  if (result.error !== undefined) {
    validateErrorObject(path, result.error, "result.error", issues);
  }
  if (!Array.isArray(result.artifacts)) {
    issues.push(error(path, "result.artifacts must be an array"));
    return;
  }

  for (const [artifactIndex, artifact] of result.artifacts.entries()) {
    await validateArtifactRef(`${path}#artifact[${artifactIndex}]`, artifact, sessionId, sessionDir, issues);
  }
}

async function validateManifest(sessionDir: string, sessionId: string, issues: ValidationIssue[]): Promise<void> {
  const manifestPath = join(sessionDir, "manifest.json");
  if (!(await exists(manifestPath))) return;

  const manifest = await readJsonFile<Record<string, unknown>>(manifestPath, issues);
  if (manifest === undefined) return;
  if (!isRecord(manifest)) {
    issues.push(error(manifestPath, "manifest.json must be an object"));
    return;
  }
  if (manifest.schemaVersion !== "atlas-loop.manifest.v1") {
    issues.push(error(manifestPath, "manifest schemaVersion must be atlas-loop.manifest.v1"));
  }
  if (manifest.createdAt !== undefined && !isIsoTimestamp(manifest.createdAt)) {
    issues.push(error(manifestPath, "manifest createdAt must be an ISO timestamp when present"));
  }
  if (manifest.updatedAt !== undefined && !isIsoTimestamp(manifest.updatedAt)) {
    issues.push(error(manifestPath, "manifest updatedAt must be an ISO timestamp when present"));
  }
  await validateProofFileRefs(manifestPath, manifest, sessionDir, "manifest", issues);
  if (!Array.isArray(manifest.artifacts)) {
    issues.push(error(manifestPath, "manifest artifacts must be an array when manifest.json is present"));
    return;
  }

  for (const [artifactIndex, artifact] of manifest.artifacts.entries()) {
    await validateArtifactRef(`${manifestPath}#artifact[${artifactIndex}]`, artifact, sessionId, sessionDir, issues);
  }
}

async function validateArtifactRef(
  path: string,
  artifact: unknown,
  sessionId: string,
  sessionDir: string,
  issues: ValidationIssue[]
): Promise<void> {
  if (!isRecord(artifact)) {
    issues.push(error(path, "artifact must be an object"));
    return;
  }
  if (typeof artifact.id !== "string" || !artifact.id) {
    issues.push(error(path, "artifact.id must be a non-empty string"));
  }
  if (artifact.sessionId !== sessionId) {
    issues.push(error(path, `artifact.sessionId must match session id ${sessionId}`));
  }
  if (typeof artifact.type !== "string" || !(artifact.type in artifactTypeDirs)) {
    issues.push(error(path, "artifact.type is not a known Atlas Loop artifact type"));
    return;
  }
  if (typeof artifact.path !== "string" || !artifact.path) {
    issues.push(error(path, "artifact.path must be a non-empty string"));
    return;
  }
  if (!isIsoTimestamp(artifact.createdAt)) {
    issues.push(error(path, "artifact.createdAt must be an ISO timestamp"));
  }
  if (artifact.metadata !== undefined) {
    if (!isRecord(artifact.metadata)) {
      issues.push(error(path, "artifact.metadata must be an object when present"));
    } else {
      await validateProofFileRefs(path, artifact.metadata, sessionDir, "artifact metadata", issues);
    }
  }

  const expectedDir = artifactTypeDirs[artifact.type as ArtifactRef["type"]];
  const requiredRoot = expectedDir && expectedDir !== "." ? join(sessionDir, expectedDir) : sessionDir;
  const pathIsValid = await validateContainedPath(sessionDir, artifact.path, `artifact ${artifact.id} path`, issues, {
    requiredRoot,
    mustExist: true
  });
  if (pathIsValid && artifact.sha256 !== undefined) {
    await validateSha256(path, artifact.sha256, resolveCandidatePath(sessionDir, artifact.path), issues);
  }
}

async function validateContainedPath(
  sessionDir: string,
  candidatePath: string,
  label: string,
  issues: ValidationIssue[],
  options: { requiredRoot?: string; mustExist?: boolean } = {}
): Promise<boolean> {
  const absoluteSessionDir = resolve(sessionDir);
  const absoluteRequiredRoot = resolve(options.requiredRoot ?? sessionDir);
  const absoluteCandidate = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(sessionDir, candidatePath);

  if (!isPathInsideOrEqual(absoluteSessionDir, absoluteCandidate)) {
    issues.push(error(candidatePath, `${label} escapes session directory`));
    return false;
  }
  if (!isPathInsideOrEqual(absoluteRequiredRoot, absoluteCandidate)) {
    issues.push(error(candidatePath, `${label} must be inside ${relative(absoluteSessionDir, absoluteRequiredRoot) || "."}/`));
    return false;
  }

  if (options.mustExist && !(await exists(absoluteCandidate))) {
    issues.push(error(candidatePath, `${label} does not exist`));
    return false;
  }

  if (await exists(absoluteCandidate)) {
    return validateRealPathContained(absoluteSessionDir, absoluteRequiredRoot, absoluteCandidate, label, issues);
  }
  return true;
}

async function validateDirectoryTreeContained(sessionDir: string, dirPath: string, issues: ValidationIssue[]): Promise<void> {
  await validateContainedPath(sessionDir, dirPath, `${basename(dirPath)} directory`, issues, { requiredRoot: dirPath, mustExist: true });

  const dir = await opendir(dirPath);
  for await (const entry of dir) {
    const child = join(dirPath, entry.name);
    await validateContainedPath(sessionDir, child, `${basename(dirPath)} entry`, issues, { requiredRoot: dirPath, mustExist: true });
    if (entry.isDirectory()) {
      await validateDirectoryTreeContained(sessionDir, child, issues);
    }
  }
}

async function validateRealPathContained(
  sessionDir: string,
  requiredRoot: string,
  candidatePath: string,
  label: string,
  issues: ValidationIssue[]
): Promise<boolean> {
  const [realSessionDir, realRequiredRoot, realCandidate] = await Promise.all([
    realpath(sessionDir),
    realpath(requiredRoot),
    realpath(candidatePath)
  ]);

  let valid = true;
  if (!isPathInsideOrEqual(realSessionDir, realCandidate)) {
    issues.push(error(candidatePath, `${label} realpath escapes session directory`));
    valid = false;
  }
  if (!isPathInsideOrEqual(realRequiredRoot, realCandidate)) {
    issues.push(error(candidatePath, `${label} realpath is outside expected artifact directory`));
    valid = false;
  }
  return valid;
}

async function validateProofFileRefs(
  sourcePath: string,
  container: Record<string, unknown>,
  sessionDir: string,
  label: string,
  issues: ValidationIssue[]
): Promise<void> {
  for (const key of proofPathKeys) {
    if (container[key] !== undefined) {
      await validateProofFileRef(sourcePath, container[key], sessionDir, `${label} ${key}`, issues);
    }
  }

  if (container.proofFiles === undefined) return;
  if (!isRecord(container.proofFiles)) {
    issues.push(error(sourcePath, `${label}.proofFiles must be an object when present`));
    return;
  }

  for (const key of proofFileKeys) {
    if (container.proofFiles[key] !== undefined) {
      await validateProofFileRef(sourcePath, container.proofFiles[key], sessionDir, `${label} proofFiles.${key}`, issues);
    }
  }
}

async function validateProofFileRef(
  sourcePath: string,
  value: unknown,
  sessionDir: string,
  label: string,
  issues: ValidationIssue[]
): Promise<void> {
  if (typeof value !== "string" || !value) {
    issues.push(error(sourcePath, `${label} must be a non-empty string when present`));
    return;
  }
  const pathIsValid = await validateContainedPath(sessionDir, value, label, issues, { mustExist: true });
  if (!pathIsValid) return;

  try {
    const proofStat = await stat(resolveCandidatePath(sessionDir, value));
    if (!proofStat.isFile()) {
      issues.push(error(value, `${label} must reference a regular file`));
    }
  } catch (statError) {
    issues.push(error(value, `${label} could not be statted: ${(statError as Error).message}`));
  }
}

async function validateSha256(path: string, expected: unknown, filePath: string, issues: ValidationIssue[]): Promise<void> {
  if (typeof expected !== "string" || !sha256Pattern.test(expected)) {
    issues.push(error(path, "artifact.sha256 must be a 64-character hex SHA-256 string when present"));
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      issues.push(error(path, "artifact.sha256 can only be verified for regular files"));
      return;
    }

    const actual = createHash("sha256").update(await readFile(filePath)).digest("hex");
    if (actual !== expected.toLowerCase()) {
      issues.push(error(path, "artifact.sha256 does not match file contents"));
    }
  } catch (hashError) {
    issues.push(error(path, `artifact.sha256 could not be verified: ${(hashError as Error).message}`));
  }
}

async function readJsonFile<T>(path: string, issues: ValidationIssue[]): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (readError) {
    issues.push(error(path, `could not read JSON: ${(readError as Error).message}`));
    return undefined;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function validateErrorObject(path: string, value: unknown, label: string, issues: ValidationIssue[]): void {
  if (!isRecord(value)) {
    issues.push(warning(path, `${label} should be an object when present`));
    return;
  }
  if (typeof value.code !== "string" || !value.code) {
    issues.push(warning(path, `${label}.code should be a non-empty string`));
  }
  if (typeof value.message !== "string" || !value.message) {
    issues.push(warning(path, `${label}.message should be a non-empty string`));
  }
}

function isSessionStatus(value: unknown): value is Session["status"] {
  return typeof value === "string" && sessionStatuses.has(value as Session["status"]);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && isoUtcPattern.test(value) && !Number.isNaN(Date.parse(value));
}

function resolveCandidatePath(sessionDir: string, candidatePath: string): string {
  return isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(sessionDir, candidatePath);
}

function isPathInsideOrEqual(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function error(path: string, message: string): ValidationIssue {
  return { severity: "error", path, message };
}

function warning(path: string, message: string): ValidationIssue {
  return { severity: "warning", path, message };
}

function report(target: string, sessionCount: number, issues: ValidationIssue[]): ValidationReport {
  return {
    target,
    sessionCount,
    issues,
    ok: !issues.some((issue) => issue.severity === "error")
  };
}

function printReport(validationReport: ValidationReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(validationReport, null, 2));
    return;
  }

  console.log(`[verify-artifacts] target=${validationReport.target}`);
  console.log(`[verify-artifacts] sessions=${validationReport.sessionCount}`);
  if (validationReport.issues.length === 0) {
    console.log("[verify-artifacts] ok");
    return;
  }

  for (const issue of validationReport.issues) {
    console.log(`[verify-artifacts] ${issue.severity.toUpperCase()} ${issue.path}: ${issue.message}`);
  }
  if (validationReport.ok && validationReport.issues.length === 0) {
    console.log("[verify-artifacts] ok");
  } else if (validationReport.ok) {
    console.log("[verify-artifacts] ok with warnings; persisted evidence is readable, but warning paths may be incomplete");
  } else {
    console.log("[verify-artifacts] failed; fix ERROR entries before treating this evidence as valid");
  }
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/verify-artifacts.ts [--json] [target]

Validates Atlas Loop session artifact directories. If target is omitted, the
default is artifacts/sessions. A directory containing session.json is treated as
one session; otherwise direct child directories with session.json are checked.
Missing default artifacts/sessions is treated as a fast-path skip.`);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return 0;
  }

  const json = args.includes("--json");
  const positional = args.filter((arg) => arg !== "--json");
  const explicitTarget = positional[0];
  const target = explicitTarget ?? resolve("artifacts", "sessions");

  if (!explicitTarget && !(await exists(target))) {
    console.log(`[verify-artifacts] ${target} does not exist; skipping artifact validation`);
    return 0;
  }

  const validationReport = await validateArtifactTarget(target);
  printReport(validationReport, json);
  return validationReport.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((mainError) => {
      console.error(`[verify-artifacts] ERROR ${(mainError as Error).message}`);
      process.exitCode = 1;
    });
}
