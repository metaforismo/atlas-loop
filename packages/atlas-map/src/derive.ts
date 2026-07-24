import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  ATLAS_LAUNCH_NODE_ID,
  nowIso,
  type Action,
  type ActionKind,
  type ActionResult,
  type ArtifactRef,
  type AtlasMap,
  type AtlasMapSessionRef,
  type AtlasScreen,
  type AtlasScreenShot,
  type AtlasTransition
} from "@atlas-loop/protocol";
import { listPersistedSessions, readPersistedSession, type PersistedSessionRecord } from "@atlas-loop/artifacts";
import { dhashFromPng, hammingDistance } from "./hash.ts";

export const DEFAULT_HASH_THRESHOLD = 10;
const VARIANTS_PER_SCREEN = 8;
const EXAMPLES_PER_TRANSITION = 5;

/** Actions that plausibly cause a screen change and label transitions. */
const INTERACTIVE_KINDS = new Set<ActionKind>([
  "tap",
  "typeText",
  "swipe",
  "edgeGesture",
  "longPress",
  "pinch",
  "rotate",
  "twoFingerTap",
  "tapElement",
  "launch"
]);

export interface AtlasHashCache {
  schemaVersion: "atlas-loop.atlas-hash-cache.v1";
  entries: Record<string, string>;
}

export function emptyHashCache(): AtlasHashCache {
  return { schemaVersion: "atlas-loop.atlas-hash-cache.v1", entries: {} };
}

export interface AtlasMapWarning {
  sessionId?: string;
  path?: string;
  message: string;
}

export interface DeriveAtlasMapOptions {
  artifactRoot: string;
  sessionIds?: string[];
  threshold?: number;
  hashCache?: AtlasHashCache;
  readPngFile?: (path: string) => Promise<Buffer>;
  now?: () => string;
}

export interface AtlasMapDerivation {
  map: AtlasMap;
  warnings: AtlasMapWarning[];
  /** Updated cache including any newly hashed screenshots. */
  hashCache: AtlasHashCache;
}

interface Observation {
  sessionId: string;
  actionId: string;
  artifactId: string;
  path: string;
  sha256?: string;
  createdAt: string;
  screenId?: string;
  hash?: string;
  screenKey?: string;
}

interface ScreenCluster {
  id: string;
  screenId?: string;
  hashes: string[];
  members: Observation[];
}

interface ActionRecordLine {
  action: Action;
  result: ActionResult;
}

export async function deriveAtlasMap(options: DeriveAtlasMapOptions): Promise<AtlasMapDerivation> {
  const threshold = options.threshold ?? DEFAULT_HASH_THRESHOLD;
  const readPng = options.readPngFile ?? readFile;
  const warnings: AtlasMapWarning[] = [];
  const hashCache: AtlasHashCache = {
    schemaVersion: "atlas-loop.atlas-hash-cache.v1",
    entries: { ...(options.hashCache?.entries ?? {}) }
  };

  const records = await loadSessionRecords(options, warnings);
  const sessionActionLines = new Map<string, ActionRecordLine[]>();
  const sessionObservations = new Map<string, Observation[]>();

  for (const record of records) {
    const sessionId = record.session.id;
    const lines = await readActionLines(record, warnings);
    sessionActionLines.set(sessionId, lines);
    sessionObservations.set(sessionId, observationsFromLines(sessionId, record, lines));
  }

  const allObservations = [...sessionObservations.values()].flat();
  await hashObservations(allObservations, hashCache, readPng, warnings);

  const hashedObservations = allObservations.filter((observation) => observation.hash || observation.screenId);
  const clusters = clusterObservations(hashedObservations, threshold);

  const screenKeyByObservation = new Map<Observation, string>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      member.screenKey = cluster.id;
      screenKeyByObservation.set(member, cluster.id);
    }
  }

  const transitions = new Map<string, AtlasTransition>();
  for (const record of records) {
    const sessionId = record.session.id;
    deriveSessionTransitions(
      sessionId,
      sessionActionLines.get(sessionId) ?? [],
      sessionObservations.get(sessionId) ?? [],
      transitions
    );
  }

  const map: AtlasMap = {
    schemaVersion: "atlas-loop.atlas-map.v1",
    generatedAt: (options.now ?? nowIso)(),
    artifactRoot: options.artifactRoot,
    hashThreshold: threshold,
    sessions: sessionRefs(records, sessionObservations),
    screens: screensFromClusters(clusters),
    transitions: sortedTransitions(transitions)
  };

  return { map, warnings, hashCache };
}

async function loadSessionRecords(
  options: DeriveAtlasMapOptions,
  warnings: AtlasMapWarning[]
): Promise<PersistedSessionRecord[]> {
  if (!options.sessionIds || options.sessionIds.length === 0) {
    return listPersistedSessions(options.artifactRoot);
  }

  const records: PersistedSessionRecord[] = [];
  for (const sessionId of options.sessionIds) {
    const record = await readPersistedSession(options.artifactRoot, sessionId);
    if (record) records.push(record);
    else warnings.push({ sessionId, message: `session ${sessionId} was not found under ${options.artifactRoot}` });
  }
  return records;
}

async function readActionLines(record: PersistedSessionRecord, warnings: AtlasMapWarning[]): Promise<ActionRecordLine[]> {
  let text: string;
  try {
    text = await readFile(record.layout.actionsPath, "utf8");
  } catch {
    return [];
  }

  const lines: ActionRecordLine[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Partial<ActionRecordLine>;
      if (parsed.action?.id && parsed.action.kind && parsed.result) {
        lines.push(parsed as ActionRecordLine);
      }
    } catch {
      warnings.push({
        sessionId: record.session.id,
        path: `${record.layout.actionsPath}:${index + 1}`,
        message: "skipped malformed action record"
      });
    }
  }
  lines.sort((left, right) => (left.action.sequence ?? 0) - (right.action.sequence ?? 0));
  return lines;
}

function observationsFromLines(sessionId: string, record: PersistedSessionRecord, lines: ActionRecordLine[]): Observation[] {
  const observations: Observation[] = [];
  for (const line of lines) {
    if (!line.result.ok) continue;
    for (const artifact of line.result.artifacts ?? []) {
      if (artifact.type !== "screenshot") continue;
      observations.push({
        sessionId,
        actionId: line.action.id,
        artifactId: artifact.id,
        path: resolveArtifactPath(record, artifact),
        sha256: artifact.sha256,
        createdAt: artifact.createdAt,
        screenId: explicitScreenId(artifact)
      });
    }
  }
  return observations;
}

function resolveArtifactPath(record: PersistedSessionRecord, artifact: ArtifactRef): string {
  return isAbsolute(artifact.path) ? artifact.path : join(record.layout.sessionPath, artifact.path);
}

function explicitScreenId(artifact: ArtifactRef): string | undefined {
  const value = artifact.metadata?.screenId;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function hashObservations(
  observations: Observation[],
  cache: AtlasHashCache,
  readPng: (path: string) => Promise<Buffer>,
  warnings: AtlasMapWarning[]
): Promise<void> {
  for (const observation of observations) {
    if (observation.sha256 && cache.entries[observation.sha256]) {
      observation.hash = cache.entries[observation.sha256];
      continue;
    }
    try {
      const data = await readPng(observation.path);
      observation.hash = dhashFromPng(data);
      if (observation.sha256) cache.entries[observation.sha256] = observation.hash;
    } catch (error) {
      warnings.push({
        sessionId: observation.sessionId,
        path: observation.path,
        message: `could not hash screenshot: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }
}

function clusterObservations(observations: Observation[], threshold: number): ScreenCluster[] {
  const sorted = [...observations].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || (left.sha256 ?? "").localeCompare(right.sha256 ?? "")
  );

  const named = new Map<string, ScreenCluster>();
  const hashClusters: ScreenCluster[] = [];

  // Pass 1: explicit screen ids own their observations and hashes.
  for (const observation of sorted) {
    if (!observation.screenId) continue;
    let cluster = named.get(observation.screenId);
    if (!cluster) {
      cluster = { id: observation.screenId, screenId: observation.screenId, hashes: [], members: [] };
      named.set(observation.screenId, cluster);
    }
    cluster.members.push(observation);
    if (observation.hash && !cluster.hashes.includes(observation.hash)) cluster.hashes.push(observation.hash);
  }

  // Pass 2: hash-only observations join a named screen when close enough,
  // otherwise greedily cluster among themselves.
  for (const observation of sorted) {
    if (observation.screenId || !observation.hash) continue;

    const namedMatch = [...named.values()].find((cluster) =>
      cluster.hashes.some((hash) => hammingDistance(hash, observation.hash!) <= threshold)
    );
    if (namedMatch) {
      namedMatch.members.push(observation);
      if (!namedMatch.hashes.includes(observation.hash)) namedMatch.hashes.push(observation.hash);
      continue;
    }

    const hashMatch = hashClusters.find((cluster) => hammingDistance(cluster.hashes[0], observation.hash!) <= threshold);
    if (hashMatch) {
      hashMatch.members.push(observation);
      if (!hashMatch.hashes.includes(observation.hash)) hashMatch.hashes.push(observation.hash);
      continue;
    }

    hashClusters.push({ id: `screen_${observation.hash}`, hashes: [observation.hash], members: [observation] });
  }

  return [...named.values(), ...hashClusters].filter((cluster) => cluster.members.length > 0);
}

function deriveSessionTransitions(
  sessionId: string,
  lines: ActionRecordLine[],
  observations: Observation[],
  transitions: Map<string, AtlasTransition>
): void {
  const observationsByActionId = new Map<string, Observation[]>();
  for (const observation of observations) {
    if (!observation.screenKey) continue;
    const list = observationsByActionId.get(observation.actionId) ?? [];
    list.push(observation);
    observationsByActionId.set(observation.actionId, list);
  }

  let currentScreen = ATLAS_LAUNCH_NODE_ID;
  let pending: ActionRecordLine[] = [];

  for (const line of lines) {
    if (!line.result.ok) {
      // Failed actions never cause transitions and clear nothing: the app is
      // assumed to remain where it was.
      continue;
    }
    if (INTERACTIVE_KINDS.has(line.action.kind)) {
      pending.push(line);
    }

    const actionObservations = observationsByActionId.get(line.action.id) ?? [];
    for (const observation of actionObservations) {
      const nextScreen = observation.screenKey!;
      if (pending.length > 0) {
        const cause = pending.at(-1)!;
        recordTransition(transitions, {
          sessionId,
          from: currentScreen,
          to: nextScreen,
          cause
        });
      }
      currentScreen = nextScreen;
      pending = [];
    }
  }
}

function recordTransition(
  transitions: Map<string, AtlasTransition>,
  input: { sessionId: string; from: string; to: string; cause: ActionRecordLine }
): void {
  const signature = actionSignature(input.cause.action);
  const id = `${input.from}->${input.to}#${signature}`;
  let transition = transitions.get(id);
  if (!transition) {
    transition = {
      id,
      from: input.from,
      to: input.to,
      actionSignature: signature,
      actionKinds: [],
      count: 0,
      sessionIds: [],
      examples: []
    };
    transitions.set(id, transition);
  }

  transition.count += 1;
  if (!transition.actionKinds.includes(input.cause.action.kind)) transition.actionKinds.push(input.cause.action.kind);
  if (!transition.sessionIds.includes(input.sessionId)) transition.sessionIds.push(input.sessionId);
  if (transition.examples.length < EXAMPLES_PER_TRANSITION) {
    transition.examples.push({
      sessionId: input.sessionId,
      actionId: input.cause.action.id,
      at: input.cause.result.startedAt
    });
  }
}

export function actionSignature(action: Action): string {
  switch (action.kind) {
    case "tap":
      return `tap@${action.x.toFixed(2)},${action.y.toFixed(2)}`;
    case "tapElement":
      return `tap:${action.identifier}`;
    case "typeText":
      return "typeText";
    case "swipe": {
      const dx = action.to.x - action.from.x;
      const dy = action.to.y - action.from.y;
      const direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "down" : "up";
      return `swipe:${direction}`;
    }
    case "edgeGesture":
      return `edge:${action.edge}`;
    case "longPress":
      return `longPress@${action.x.toFixed(2)},${action.y.toFixed(2)}`;
    case "pinch":
      return `pinch:${action.scale > 1 ? "open" : "close"}${action.identifier ? `:${action.identifier}` : ""}`;
    case "rotate":
      return `rotate:${action.rotation > 0 ? "clockwise" : "counterclockwise"}${action.identifier ? `:${action.identifier}` : ""}`;
    case "twoFingerTap":
      return `twoFingerTap${action.identifier ? `:${action.identifier}` : ""}`;
    case "launch":
      return `launch:${action.bundleId}`;
    default:
      return action.kind;
  }
}

function sessionRefs(
  records: PersistedSessionRecord[],
  observations: Map<string, Observation[]>
): AtlasMapSessionRef[] {
  return records
    .map((record) => ({
      sessionId: record.session.id,
      bundleId: record.session.app?.bundleId,
      createdAt: record.session.createdAt,
      observationCount: (observations.get(record.session.id) ?? []).filter((observation) => observation.screenKey).length
    }))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.sessionId.localeCompare(right.sessionId));
}

function screensFromClusters(clusters: ScreenCluster[]): AtlasScreen[] {
  const screens = clusters.map((cluster) => {
    const members = [...cluster.members].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const representative = shotFromObservation(members[0]);
    const variants: AtlasScreenShot[] = [];
    const seen = new Set<string>();
    for (const member of members) {
      const key = member.sha256 ?? member.artifactId;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(shotFromObservation(member));
      if (variants.length >= VARIANTS_PER_SCREEN) break;
    }

    return {
      id: cluster.id,
      screenId: cluster.screenId,
      hashes: [...cluster.hashes].sort(),
      representative,
      variants,
      screenshotCount: members.length,
      sessionIds: [...new Set(members.map((member) => member.sessionId))].sort(),
      firstSeenAt: members[0].createdAt,
      lastSeenAt: members.at(-1)!.createdAt
    } satisfies AtlasScreen;
  });

  return screens.sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt) || left.id.localeCompare(right.id));
}

function shotFromObservation(observation: Observation): AtlasScreenShot {
  return {
    sessionId: observation.sessionId,
    artifactId: observation.artifactId,
    path: observation.path,
    sha256: observation.sha256,
    createdAt: observation.createdAt
  };
}

function sortedTransitions(transitions: Map<string, AtlasTransition>): AtlasTransition[] {
  return [...transitions.values()]
    .map((transition) => ({ ...transition, sessionIds: [...transition.sessionIds].sort() }))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id));
}
