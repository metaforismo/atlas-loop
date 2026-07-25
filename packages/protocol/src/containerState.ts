/**
 * What an action changed on disk.
 *
 * A screenshot shows what the app drew; it does not show that the tap actually
 * wrote the order to disk, or that logging out actually cleared the token. The
 * app's data container is where that evidence lives, so Atlas Loop snapshots it
 * around actions and reports the difference.
 *
 * Everything here is pure and browser-safe: the daemon produces snapshots, and
 * the viewer, the CLI, and the MCP server all read them through this module.
 */

export const CONTAINER_SNAPSHOT_SCHEMA = "atlas-loop.container-snapshot.v1";

/**
 * Where in the container a file sits. Areas carry different weight as
 * evidence: a write under Documents is the app persisting something, while a
 * write under Caches may be the system deciding to cache a URL.
 */
export type ContainerArea = "documents" | "preferences" | "database" | "caches" | "temporary" | "other";

export interface ContainerEntry {
  /** Path relative to the container root, using forward slashes. */
  path: string;
  size: number;
  /** ISO timestamp of the file's last modification. */
  modifiedAt: string;
  /**
   * Content hash, present only for files small enough to read. Without it a
   * change can only be inferred from size and modification time.
   */
  hash?: string;
}

export interface ContainerSnapshot {
  schemaVersion: typeof CONTAINER_SNAPSHOT_SCHEMA;
  capturedAt: string;
  bundleId: string;
  /** Absolute container path the snapshot was taken from. */
  root: string;
  entries: ContainerEntry[];
  /** Areas deliberately not walked, so an empty result is not read as "nothing changed". */
  skippedAreas: ContainerArea[];
  /** True when the walk hit its file or byte cap before finishing. */
  truncated: boolean;
}

export type ContainerChangeKind = "added" | "removed" | "modified";

export interface ContainerChange {
  path: string;
  kind: ContainerChangeKind;
  area: ContainerArea;
  sizeBefore?: number;
  sizeAfter?: number;
  /** Bytes gained or lost. Zero for a same-size rewrite. */
  sizeDelta: number;
  /**
   * How a modification was established, and only set for one. A hash
   * comparison is proof; size or modification time is inference, and a rewrite
   * with identical content can look like a change to it. An added or removed
   * file has nothing to infer — the path is there or it is not.
   */
  evidence?: "hash" | "size" | "timestamp";
}

export interface ContainerStateDiff {
  before: { capturedAt: string; entryCount: number };
  after: { capturedAt: string; entryCount: number };
  changes: ContainerChange[];
  /** Areas neither snapshot walked, carried through so the reader knows. */
  skippedAreas: ContainerArea[];
  /** True when either snapshot was cut short, so absence is not evidence. */
  truncated: boolean;
}

/** Directories whose churn is the system's, not the app's. */
const VOLATILE_AREAS: ContainerArea[] = ["caches", "temporary"];

/**
 * Classifies a container-relative path.
 *
 * SQLite keeps `-wal` and `-shm` sidecars beside its database, and those move
 * on every write. Grouping them with the database keeps one logical store from
 * reading as three separate changes.
 */
export function containerArea(path: string): ContainerArea {
  const normalised = path.replace(/^\/+/, "");
  if (/^Documents\//i.test(normalised)) return "documents";
  if (/^Library\/Preferences\//i.test(normalised)) return "preferences";
  if (/^Library\/Caches\//i.test(normalised)) return "caches";
  if (/^tmp\//i.test(normalised)) return "temporary";
  if (/\.(sqlite|sqlite3|db|realm)(-wal|-shm|\.lock)?$/i.test(normalised)) return "database";
  return "other";
}

/** The areas a snapshot skips by default, and which the diff reports as unwalked. */
export function defaultSkippedAreas(): ContainerArea[] {
  return [...VOLATILE_AREAS];
}

function byPath(entries: readonly ContainerEntry[]): Map<string, ContainerEntry> {
  const map = new Map<string, ContainerEntry>();
  for (const entry of entries) map.set(entry.path, entry);
  return map;
}

/**
 * Whether a file changed, and how confidently.
 *
 * Hashes settle it when both sides have one. Falling back to modification time
 * alone would report a rewrite with identical content as a change, which is why
 * the answer carries its own evidence level rather than pretending to be proof.
 */
function compareEntry(before: ContainerEntry, after: ContainerEntry): ContainerChange["evidence"] | undefined {
  if (before.hash !== undefined && after.hash !== undefined) {
    return before.hash === after.hash ? undefined : "hash";
  }
  if (before.size !== after.size) return "size";
  if (before.modifiedAt !== after.modifiedAt) return "timestamp";
  return undefined;
}

/**
 * What changed between two snapshots of the same container.
 *
 * Changes are ordered by how much they say: additions and removals first, then
 * modifications, and within each, the areas an app writes to deliberately
 * before the ones the system churns on its own.
 */
export function diffContainerSnapshots(
  before: ContainerSnapshot,
  after: ContainerSnapshot
): ContainerStateDiff {
  const beforeEntries = byPath(before.entries);
  const afterEntries = byPath(after.entries);
  const changes: ContainerChange[] = [];

  for (const [path, entry] of afterEntries) {
    const previous = beforeEntries.get(path);
    if (!previous) {
      changes.push({
        path,
        kind: "added",
        area: containerArea(path),
        sizeAfter: entry.size,
        sizeDelta: entry.size
      });
      continue;
    }
    const evidence = compareEntry(previous, entry);
    if (!evidence) continue;
    changes.push({
      path,
      kind: "modified",
      area: containerArea(path),
      sizeBefore: previous.size,
      sizeAfter: entry.size,
      sizeDelta: entry.size - previous.size,
      evidence
    });
  }

  for (const [path, entry] of beforeEntries) {
    if (afterEntries.has(path)) continue;
    changes.push({
      path,
      kind: "removed",
      area: containerArea(path),
      sizeBefore: entry.size,
      sizeDelta: -entry.size
    });
  }

  return {
    before: { capturedAt: before.capturedAt, entryCount: before.entries.length },
    after: { capturedAt: after.capturedAt, entryCount: after.entries.length },
    changes: changes.sort(compareChanges),
    skippedAreas: mergeSkipped(before.skippedAreas, after.skippedAreas),
    truncated: before.truncated || after.truncated
  };
}

const KIND_ORDER: Record<ContainerChangeKind, number> = { added: 0, removed: 1, modified: 2 };
const AREA_ORDER: Record<ContainerArea, number> = {
  documents: 0,
  database: 1,
  preferences: 2,
  other: 3,
  caches: 4,
  temporary: 5
};

function compareChanges(left: ContainerChange, right: ContainerChange): number {
  if (KIND_ORDER[left.kind] !== KIND_ORDER[right.kind]) return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  if (AREA_ORDER[left.area] !== AREA_ORDER[right.area]) return AREA_ORDER[left.area] - AREA_ORDER[right.area];
  return left.path.localeCompare(right.path);
}

/** Union of the areas neither snapshot walked, in a stable order. */
function mergeSkipped(left: readonly ContainerArea[], right: readonly ContainerArea[]): ContainerArea[] {
  const merged = new Set([...left, ...right]);
  return (Object.keys(AREA_ORDER) as ContainerArea[]).filter((area) => merged.has(area));
}

export interface ContainerDiffSummary {
  added: number;
  removed: number;
  modified: number;
  /** Net bytes across every change. */
  sizeDelta: number;
  /** Areas that actually changed, most meaningful first. */
  areas: ContainerArea[];
  /** True when nothing changed and nothing was left unwalked or cut short. */
  clean: boolean;
}

export function summariseContainerDiff(diff: ContainerStateDiff): ContainerDiffSummary {
  const counts = { added: 0, removed: 0, modified: 0 };
  let sizeDelta = 0;
  const areas = new Set<ContainerArea>();

  for (const change of diff.changes) {
    counts[change.kind] += 1;
    sizeDelta += change.sizeDelta;
    areas.add(change.area);
  }

  return {
    ...counts,
    sizeDelta,
    areas: (Object.keys(AREA_ORDER) as ContainerArea[]).filter((area) => areas.has(area)),
    // Skipped areas and truncation both mean absence of change is not evidence
    // of no change, so neither can report a clean container.
    clean: diff.changes.length === 0 && diff.skippedAreas.length === 0 && !diff.truncated
  };
}

/** Keeps only the changes an operator asked to see. */
export function filterContainerChanges(
  changes: readonly ContainerChange[],
  filter: { areas?: readonly ContainerArea[]; kinds?: readonly ContainerChangeKind[]; search?: string }
): ContainerChange[] {
  const search = filter.search?.trim().toLowerCase();
  return changes.filter((change) => {
    if (filter.areas?.length && !filter.areas.includes(change.area)) return false;
    if (filter.kinds?.length && !filter.kinds.includes(change.kind)) return false;
    if (search && !change.path.toLowerCase().includes(search)) return false;
    return true;
  });
}

/** `+1.2 KB` / `-340 B` — a delta reads better signed. */
export function formatSizeDelta(bytes: number): string {
  if (!Number.isFinite(bytes)) return "--";
  if (bytes === 0) return "same size";
  const sign = bytes > 0 ? "+" : "-";
  const magnitude = Math.abs(bytes);
  if (magnitude < 1024) return `${sign}${magnitude} B`;
  if (magnitude < 1024 * 1024) return `${sign}${(magnitude / 1024).toFixed(1)} KB`;
  return `${sign}${(magnitude / (1024 * 1024)).toFixed(1)} MB`;
}

/** Human label for an area, for panels and CLI output. */
export function containerAreaLabel(area: ContainerArea): string {
  const labels: Record<ContainerArea, string> = {
    documents: "Documents",
    preferences: "Preferences",
    database: "Databases",
    caches: "Caches",
    temporary: "Temporary",
    other: "Other"
  };
  return labels[area];
}
