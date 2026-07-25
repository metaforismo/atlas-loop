import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The viewer is bundled for a browser. A Node-only import reaching it passes
 * both `tsc --noEmit` and the whole vitest suite — the failure only appears
 * when a real browser evaluates the module — so the invariant is pinned here.
 *
 * This exists because `@atlas-loop/simulator` (which imports
 * `node:child_process` for `spawn`) was once imported from a viewer component
 * for its location presets. Everything was green; the viewer was blank.
 */

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
      return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [full] : [];
    })
  );
  return files.flat();
}

async function importedModules(file: string): Promise<string[]> {
  const source = await readFile(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1]!);
}

describe("browser safety", () => {
  it("keeps the protocol package free of Node built-ins", async () => {
    // Protocol is the shared vocabulary both the daemon and the browser use.
    const files = await sourceFiles(join(REPO_ROOT, "packages/protocol/src"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const nodeImports = (await importedModules(file)).filter((specifier) => specifier.startsWith("node:"));
      expect(nodeImports, `${file} imports ${nodeImports.join(", ")}`).toEqual([]);
    }
  });

  it("keeps Node-only workspace packages out of the viewer bundle", async () => {
    // Packages that shell out, touch the filesystem, or open sockets. Importing
    // any of them from the viewer breaks the page at runtime only.
    const nodeOnlyPackages = [
      "@atlas-loop/simulator",
      "@atlas-loop/artifacts",
      "@atlas-loop/config",
      "@atlas-loop/hid-client",
      "@atlas-loop/xcuitest-client",
      "@atlas-loop/daemon-client"
    ];

    const files = await sourceFiles(join(REPO_ROOT, "apps/viewer/src"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      for (const specifier of await importedModules(file)) {
        expect(specifier.startsWith("node:"), `${file} imports ${specifier}`).toBe(false);
        expect(nodeOnlyPackages, `${file} imports ${specifier}`).not.toContain(specifier);
      }
    }
  });
});
