import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  CONTAINER_SNAPSHOT_SCHEMA,
  containerArea,
  defaultSkippedAreas,
  type ContainerArea,
  type ContainerEntry,
  type ContainerSnapshot
} from "@atlas-loop/protocol";

/**
 * Snapshotting an app's data container.
 *
 * `simctl get_app_container <udid> <bundle> data` names the directory the app
 * writes to. Walking it before and after an action turns "the screen changed"
 * into "the app persisted this", which is the difference between a screenshot
 * and evidence.
 */

/** Files at or under this size are hashed, so a rewrite is not mistaken for an edit. */
const HASH_SIZE_LIMIT = 256 * 1024;
/** Caps so a container with a large cache cannot stall a run. */
const DEFAULT_MAX_ENTRIES = 4000;
const DEFAULT_MAX_HASHED_BYTES = 32 * 1024 * 1024;

export interface CaptureContainerOptions {
  udid: string;
  bundleId: string;
  /** Areas to leave unwalked. Defaults to the volatile ones. */
  skipAreas?: ContainerArea[];
  maxEntries?: number;
  maxHashedBytes?: number;
  /** Injected in tests; runs `xcrun simctl` in production. */
  resolveRoot?: (udid: string, bundleId: string) => Promise<string>;
  now?: () => Date;
}

export function containerPathArgs(udid: string, bundleId: string): string[] {
  return ["simctl", "get_app_container", udid, bundleId, "data"];
}

/**
 * Walks a container into a snapshot.
 *
 * The walk is bounded twice over: by file count, and by how many bytes it is
 * willing to hash. Hitting either marks the snapshot truncated rather than
 * silently returning a partial picture that would read as "nothing else
 * changed".
 */
export async function captureContainerSnapshot(options: CaptureContainerOptions): Promise<ContainerSnapshot> {
  const skippedAreas = options.skipAreas ?? defaultSkippedAreas();
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxHashedBytes = options.maxHashedBytes ?? DEFAULT_MAX_HASHED_BYTES;
  const resolveRoot = options.resolveRoot ?? resolveContainerRoot;
  const now = options.now ?? (() => new Date());

  const root = await resolveRoot(options.udid, options.bundleId);
  const entries: ContainerEntry[] = [];
  let hashedBytes = 0;
  let truncated = false;

  const walk = async (directory: string): Promise<void> => {
    if (truncated) return;
    let children;
    try {
      children = await readdir(directory, { withFileTypes: true });
    } catch {
      // A directory the walker cannot read is left out rather than aborting the
      // snapshot; the rest of the container is still worth reporting.
      return;
    }

    for (const child of children) {
      if (truncated) return;
      const full = join(directory, child.name);
      const relativePath = toPosix(relative(root, full));
      // Symlinks are not followed: a link out of the container would take the
      // walk somewhere the app does not own.
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        if (skippedAreas.includes(containerArea(`${relativePath}/`))) continue;
        await walk(full);
        continue;
      }
      if (!child.isFile()) continue;
      if (skippedAreas.includes(containerArea(relativePath))) continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }

      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }

      const entry: ContainerEntry = {
        path: relativePath,
        size: info.size,
        modifiedAt: new Date(info.mtimeMs).toISOString()
      };

      if (info.size <= HASH_SIZE_LIMIT && hashedBytes + info.size <= maxHashedBytes) {
        const hash = await hashFile(full);
        if (hash) {
          entry.hash = hash;
          hashedBytes += info.size;
        }
      }

      entries.push(entry);
    }
  };

  await walk(root);

  return {
    schemaVersion: CONTAINER_SNAPSHOT_SCHEMA,
    capturedAt: now().toISOString(),
    bundleId: options.bundleId,
    root,
    // Sorted so two snapshots of an unchanged container are byte-identical.
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
    skippedAreas,
    truncated
  };
}

async function hashFile(path: string): Promise<string | undefined> {
  try {
    return createHash("sha256").update(await readFile(path)).digest("hex").slice(0, 32);
  } catch {
    return undefined;
  }
}

/** Windows-style separators would break the shared path classification. */
function toPosix(path: string): string {
  return sep === "/" ? path : path.split(sep).join("/");
}

/**
 * A resolver that asks the simulator once per app and remembers the answer.
 *
 * `simctl get_app_container` costs about three seconds per call against a
 * booted device, while walking the container costs a tenth of that. Snapshotting
 * around every action would spend almost all of its time re-asking a question
 * whose answer does not change while the app stays installed.
 */
export function createContainerRootResolver(
  resolve: (udid: string, bundleId: string) => Promise<string> = resolveContainerRoot
): (udid: string, bundleId: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return (udid, bundleId) => {
    const key = `${udid}|${bundleId}`;
    let pending = cache.get(key);
    if (!pending) {
      // A rejected lookup is forgotten, so a later attempt can succeed once the
      // app is installed rather than replaying the first failure forever.
      pending = resolve(udid, bundleId).catch((error: unknown) => {
        cache.delete(key);
        throw error;
      });
      cache.set(key, pending);
    }
    return pending;
  };
}

/**
 * Asks the simulator where the app's data lives.
 *
 * Resolved lazily so the module stays importable without a simulator, and so
 * tests can substitute the lookup.
 */
async function resolveContainerRoot(udid: string, bundleId: string): Promise<string> {
  const { runProcessCommand } = await import("@atlas-loop/simulator");
  const result = await runProcessCommand("xcrun", containerPathArgs(udid, bundleId), { timeoutMs: 20_000 });
  const path = result.stdout.trim();
  if (result.exitCode !== 0 || !path) {
    throw new Error(`no data container for ${bundleId} on ${udid}: ${result.stderr.trim() || "not installed"}`);
  }
  return path;
}
