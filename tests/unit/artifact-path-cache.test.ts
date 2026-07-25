import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRealpathCache,
  getSessionArtifactLayout,
  resolveContainedArtifactPath
} from "../../packages/artifacts/src/index.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function session() {
  const root = await mkdtemp(join(tmpdir(), "atlas-paths-"));
  dirs.push(root);
  const layout = getSessionArtifactLayout(root, "sess_1");
  await mkdir(layout.screenshotsDir, { recursive: true });
  await mkdir(layout.logsDir, { recursive: true });
  return layout;
}

describe("resolving an artifact path", () => {
  it("accepts a file inside the type's own directory", async () => {
    const layout = await session();
    const shot = join(layout.screenshotsDir, "a.png");
    await writeFile(shot, "png");

    expect(await resolveContainedArtifactPath(layout, "screenshot", shot)).toBe(shot);
  });

  it("still refuses a file outside the session", async () => {
    // The cache must speed the check up, never soften it.
    const layout = await session();
    const outside = await mkdtemp(join(tmpdir(), "atlas-outside-"));
    dirs.push(outside);
    const stray = join(outside, "a.png");
    await writeFile(stray, "png");

    const cache = createRealpathCache();
    expect(await resolveContainedArtifactPath(layout, "screenshot", stray, cache)).toBeUndefined();
  });

  it("still refuses a symlink that escapes the session", async () => {
    const layout = await session();
    const outside = await mkdtemp(join(tmpdir(), "atlas-escape-"));
    dirs.push(outside);
    await writeFile(join(outside, "secret.png"), "png");
    const link = join(layout.screenshotsDir, "escape.png");
    await symlink(join(outside, "secret.png"), link);

    const cache = createRealpathCache();
    expect(await resolveContainedArtifactPath(layout, "screenshot", link, cache)).toBeUndefined();
  });

  it("still refuses a file in the wrong type's directory", async () => {
    const layout = await session();
    const log = join(layout.logsDir, "a.log");
    await writeFile(log, "log");

    const cache = createRealpathCache();
    expect(await resolveContainedArtifactPath(layout, "screenshot", log, cache)).toBeUndefined();
  });

  it("gives the same answers with a shared cache as without one", async () => {
    // A six hundred artifact listing resolved the session directory and the
    // type root once per artifact; the cache exists to stop that, so it has to
    // be indistinguishable from not having one.
    const layout = await session();
    const shot = join(layout.screenshotsDir, "a.png");
    const log = join(layout.logsDir, "a.log");
    await writeFile(shot, "png");
    await writeFile(log, "log");

    const cache = createRealpathCache();
    for (const [type, path] of [["screenshot", shot], ["log", log], ["screenshot", log], ["log", shot]] as const) {
      expect(await resolveContainedArtifactPath(layout, type, path, cache)).toBe(
        await resolveContainedArtifactPath(layout, type, path)
      );
    }
  });

  it("resolves a repeated path once", async () => {
    const layout = await session();
    const shot = join(layout.screenshotsDir, "a.png");
    await writeFile(shot, "png");

    const cache = createRealpathCache();
    await resolveContainedArtifactPath(layout, "screenshot", shot, cache);
    const afterFirst = cache.size;
    await resolveContainedArtifactPath(layout, "screenshot", shot, cache);

    expect(afterFirst).toBeGreaterThan(0);
    expect(cache.size).toBe(afterFirst);
  });
});
