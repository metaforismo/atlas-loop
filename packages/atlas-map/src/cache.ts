import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { emptyHashCache, type AtlasHashCache } from "./derive.ts";

export async function loadHashCache(path: string): Promise<AtlasHashCache> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<AtlasHashCache>;
    if (parsed.schemaVersion !== "atlas-loop.atlas-hash-cache.v1" || typeof parsed.entries !== "object" || !parsed.entries) {
      return emptyHashCache();
    }
    const entries: Record<string, string> = {};
    for (const [sha256, hash] of Object.entries(parsed.entries)) {
      if (typeof hash === "string" && /^[0-9a-f]{16}$/i.test(hash)) entries[sha256] = hash;
    }
    return { schemaVersion: "atlas-loop.atlas-hash-cache.v1", entries };
  } catch {
    return emptyHashCache();
  }
}

export async function saveHashCache(path: string, cache: AtlasHashCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}
