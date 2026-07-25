import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureContainerSnapshot,
  containerPathArgs,
  createContainerRootResolver
} from "../../apps/daemon/src/containerSnapshot.js";
import { diffContainerSnapshots } from "../../packages/protocol/src/containerState.js";

const roots: string[] = [];

async function container(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-container-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, content);
  }
  return root;
}

function capture(root: string, overrides: Record<string, unknown> = {}) {
  return captureContainerSnapshot({
    udid: "UDID",
    bundleId: "app.atlasloop.CommerceDemo",
    resolveRoot: async () => root,
    now: () => new Date("2026-07-25T10:00:00.000Z"),
    ...overrides
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("asking the simulator for the container", () => {
  it("builds the documented simctl invocation", () => {
    expect(containerPathArgs("UDID", "app.atlasloop.CommerceDemo")).toEqual([
      "simctl",
      "get_app_container",
      "UDID",
      "app.atlasloop.CommerceDemo",
      "data"
    ]);
  });
});

describe("walking a container", () => {
  it("records every file with a path relative to the container", async () => {
    const root = await container({
      "Documents/cart.json": "{}",
      "Library/Preferences/app.plist": "prefs"
    });
    const snapshot = await capture(root);

    expect(snapshot.entries.map((entry) => entry.path)).toEqual([
      "Documents/cart.json",
      "Library/Preferences/app.plist"
    ]);
    expect(snapshot.root).toBe(root);
    expect(snapshot.capturedAt).toBe("2026-07-25T10:00:00.000Z");
  });

  it("hashes files, so a rewrite with identical content is not a change", async () => {
    const root = await container({ "Documents/cart.json": "{\"items\":1}" });
    const before = await capture(root);

    await writeFile(join(root, "Documents/cart.json"), "{\"items\":1}");
    const after = await capture(root);

    expect(before.entries[0]!.hash).toBeDefined();
    expect(diffContainerSnapshots(before, after).changes).toEqual([]);
  });

  it("sees a real edit through the hash", async () => {
    const root = await container({ "Documents/cart.json": "{\"items\":1}" });
    const before = await capture(root);

    await writeFile(join(root, "Documents/cart.json"), "{\"items\":2}");
    const diff = diffContainerSnapshots(before, await capture(root));

    expect(diff.changes).toHaveLength(1);
    expect(diff.changes[0]).toMatchObject({ kind: "modified", evidence: "hash" });
  });

  it("leaves volatile areas unwalked and says which", async () => {
    const root = await container({
      "Documents/cart.json": "{}",
      "Library/Caches/url/blob": "cached",
      "tmp/scratch": "scratch"
    });
    const snapshot = await capture(root);

    expect(snapshot.entries.map((entry) => entry.path)).toEqual(["Documents/cart.json"]);
    // Recorded rather than silent, so an empty caches result is not read as
    // "the caches did not change".
    expect(snapshot.skippedAreas).toEqual(["caches", "temporary"]);
  });

  it("walks a volatile area when asked to", async () => {
    const root = await container({ "Documents/cart.json": "{}", "tmp/scratch": "scratch" });
    const snapshot = await capture(root, { skipAreas: [] });

    expect(snapshot.entries.map((entry) => entry.path)).toEqual(["Documents/cart.json", "tmp/scratch"]);
    expect(snapshot.skippedAreas).toEqual([]);
  });

  it("marks a walk that hit its file cap", async () => {
    const root = await container({
      "Documents/a": "1",
      "Documents/b": "2",
      "Documents/c": "3"
    });
    const snapshot = await capture(root, { maxEntries: 2 });

    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.truncated).toBe(true);
  });

  it("records a file it will not hash rather than dropping it", async () => {
    // Past the hashing budget the file still exists and still matters; only the
    // confidence of the comparison drops.
    const root = await container({ "Documents/big.bin": "x".repeat(4096) });
    const snapshot = await capture(root, { maxHashedBytes: 0 });

    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]!.hash).toBeUndefined();
    expect(snapshot.truncated).toBe(false);
  });

  it("does not follow a symlink out of the container", async () => {
    const root = await container({ "Documents/cart.json": "{}" });
    const outside = await container({ "secret.txt": "not the app's" });
    await symlink(outside, join(root, "Documents/escape"));

    const snapshot = await capture(root);

    expect(snapshot.entries.map((entry) => entry.path)).toEqual(["Documents/cart.json"]);
  });

  it("sorts entries, so an unchanged container snapshots identically", async () => {
    const root = await container({ "Documents/z": "1", "Documents/a": "2", "Library/m": "3" });
    const first = await capture(root);
    const second = await capture(root);

    expect(first.entries.map((entry) => entry.path)).toEqual(["Documents/a", "Documents/z", "Library/m"]);
    expect(JSON.stringify(first.entries)).toBe(JSON.stringify(second.entries));
  });

  it("survives a directory it cannot read", async () => {
    const root = await container({ "Documents/cart.json": "{}" });
    const snapshot = await captureContainerSnapshot({
      udid: "UDID",
      bundleId: "app.atlasloop.CommerceDemo",
      resolveRoot: async () => join(root, "does-not-exist")
    });

    expect(snapshot.entries).toEqual([]);
    expect(snapshot.truncated).toBe(false);
  });
});

describe("resolving the container root", () => {
  it("asks once per app and reuses the answer", async () => {
    // The lookup costs seconds against a booted device while the walk costs a
    // tenth of that; asking per capture would dominate every action.
    let calls = 0;
    const resolve = createContainerRootResolver(async () => {
      calls += 1;
      return "/containers/demo";
    });

    expect(await Promise.all([resolve("A", "app"), resolve("A", "app"), resolve("A", "app")])).toEqual([
      "/containers/demo",
      "/containers/demo",
      "/containers/demo"
    ]);
    expect(calls).toBe(1);
  });

  it("keeps apps and devices apart", async () => {
    const seen: string[] = [];
    const resolve = createContainerRootResolver(async (udid, bundleId) => {
      seen.push(`${udid}|${bundleId}`);
      return `/containers/${udid}/${bundleId}`;
    });

    await resolve("A", "one");
    await resolve("A", "two");
    await resolve("B", "one");

    expect(seen).toEqual(["A|one", "A|two", "B|one"]);
  });

  it("forgets a failure so a later attempt can succeed", async () => {
    // The app may simply not be installed yet; caching the rejection would keep
    // the container unreachable for the rest of the session.
    let attempt = 0;
    const resolve = createContainerRootResolver(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("not installed");
      return "/containers/demo";
    });

    await expect(resolve("A", "app")).rejects.toThrow("not installed");
    await expect(resolve("A", "app")).resolves.toBe("/containers/demo");
  });
});
