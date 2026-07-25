import { describe, expect, it } from "vitest";
import {
  CONTAINER_SNAPSHOT_SCHEMA,
  containerArea,
  defaultSkippedAreas,
  diffContainerSnapshots,
  filterContainerChanges,
  formatSizeDelta,
  summariseContainerDiff,
  type ContainerEntry,
  type ContainerSnapshot
} from "../../packages/protocol/src/containerState.js";

function snapshot(
  capturedAt: string,
  entries: ContainerEntry[],
  overrides: Partial<ContainerSnapshot> = {}
): ContainerSnapshot {
  return {
    schemaVersion: CONTAINER_SNAPSHOT_SCHEMA,
    capturedAt,
    bundleId: "app.atlasloop.CommerceDemo",
    root: "/devices/x/data",
    entries,
    skippedAreas: defaultSkippedAreas(),
    truncated: false,
    ...overrides
  };
}

function entry(path: string, size: number, modifiedAt: string, hash?: string): ContainerEntry {
  return hash === undefined ? { path, size, modifiedAt } : { path, size, modifiedAt, hash };
}

describe("classifying container paths", () => {
  it("separates what the app writes from what the system churns", () => {
    expect(containerArea("Documents/orders.json")).toBe("documents");
    expect(containerArea("Library/Preferences/app.atlasloop.CommerceDemo.plist")).toBe("preferences");
    expect(containerArea("Library/Caches/com.apple.URLCache/blob")).toBe("caches");
    expect(containerArea("tmp/upload-1")).toBe("temporary");
    expect(containerArea("Library/Application Support/anything.txt")).toBe("other");
  });

  it("keeps a SQLite store and its sidecars together", () => {
    // Otherwise one logical write reads as three unrelated changes.
    expect(containerArea("Library/store.sqlite")).toBe("database");
    expect(containerArea("Library/store.sqlite-wal")).toBe("database");
    expect(containerArea("Library/store.sqlite-shm")).toBe("database");
    expect(containerArea("Library/local.realm")).toBe("database");
  });

  it("reads a path the same however it arrives", () => {
    expect(containerArea("/Documents/orders.json")).toBe("documents");
    expect(containerArea("documents/orders.json")).toBe("documents");
  });
});

describe("diffing two snapshots", () => {
  const before = snapshot("2026-07-25T10:00:00.000Z", [
    entry("Documents/cart.json", 120, "2026-07-25T09:59:00.000Z", "h-cart-1"),
    entry("Documents/session.token", 44, "2026-07-25T09:59:00.000Z", "h-token"),
    entry("Library/Preferences/app.plist", 900, "2026-07-25T09:59:00.000Z", "h-prefs")
  ]);

  it("reports what an action wrote, cleared, and left alone", () => {
    const after = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/cart.json", 260, "2026-07-25T10:00:04.000Z", "h-cart-2"),
      entry("Documents/orders.json", 512, "2026-07-25T10:00:04.000Z", "h-order"),
      entry("Library/Preferences/app.plist", 900, "2026-07-25T09:59:00.000Z", "h-prefs")
    ]);
    const diff = diffContainerSnapshots(before, after);

    expect(diff.changes.map((change) => [change.kind, change.path])).toEqual([
      ["added", "Documents/orders.json"],
      ["removed", "Documents/session.token"],
      ["modified", "Documents/cart.json"]
    ]);
    // The untouched preferences file is absent, not listed as unchanged.
    expect(diff.changes.some((change) => change.path.includes("app.plist"))).toBe(false);
  });

  it("does not call a rewrite with identical content a change", () => {
    // Saving without editing rewrites the file and moves its timestamp. A
    // timestamp-only comparison would report a change the user never made.
    const after = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/cart.json", 120, "2026-07-25T10:00:04.000Z", "h-cart-1"),
      entry("Documents/session.token", 44, "2026-07-25T09:59:00.000Z", "h-token"),
      entry("Library/Preferences/app.plist", 900, "2026-07-25T09:59:00.000Z", "h-prefs")
    ]);

    expect(diffContainerSnapshots(before, after).changes).toEqual([]);
  });

  it("says how a change was established when there is no hash", () => {
    const unhashedBefore = snapshot("2026-07-25T10:00:00.000Z", [
      entry("Documents/big.bin", 5_000_000, "2026-07-25T09:59:00.000Z"),
      entry("Documents/same-size.bin", 10, "2026-07-25T09:59:00.000Z")
    ]);
    const unhashedAfter = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/big.bin", 6_000_000, "2026-07-25T10:00:04.000Z"),
      entry("Documents/same-size.bin", 10, "2026-07-25T10:00:04.000Z")
    ]);
    const diff = diffContainerSnapshots(unhashedBefore, unhashedAfter);

    expect(diff.changes.map((change) => [change.path, change.evidence])).toEqual([
      ["Documents/big.bin", "size"],
      ["Documents/same-size.bin", "timestamp"]
    ]);
  });

  it("prefers a hash over size when both disagree", () => {
    // A file can change size and content at once; the hash is the proof, and
    // reporting "size" would understate what is known.
    const after = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/cart.json", 999, "2026-07-25T10:00:04.000Z", "h-cart-2"),
      entry("Documents/session.token", 44, "2026-07-25T09:59:00.000Z", "h-token"),
      entry("Library/Preferences/app.plist", 900, "2026-07-25T09:59:00.000Z", "h-prefs")
    ]);

    expect(diffContainerSnapshots(before, after).changes[0]!.evidence).toBe("hash");
  });

  it("trusts a matching hash even when the size record disagrees", () => {
    // Size is recorded metadata and the hash is the content; if they conflict,
    // the content wins rather than inventing a change.
    const after = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/cart.json", 121, "2026-07-25T10:00:04.000Z", "h-cart-1"),
      entry("Documents/session.token", 44, "2026-07-25T09:59:00.000Z", "h-token"),
      entry("Library/Preferences/app.plist", 900, "2026-07-25T09:59:00.000Z", "h-prefs")
    ]);

    expect(diffContainerSnapshots(before, after).changes).toEqual([]);
  });

  it("orders changes so deliberate writes come before system churn", () => {
    const noisyBefore = snapshot("2026-07-25T10:00:00.000Z", [], { skippedAreas: [] });
    const noisyAfter = snapshot("2026-07-25T10:00:05.000Z", [
      entry("tmp/scratch", 4, "2026-07-25T10:00:04.000Z", "a"),
      entry("Library/Caches/url/blob", 8, "2026-07-25T10:00:04.000Z", "b"),
      entry("Documents/orders.json", 512, "2026-07-25T10:00:04.000Z", "c"),
      entry("Library/store.sqlite", 64, "2026-07-25T10:00:04.000Z", "d")
    ], { skippedAreas: [] });

    expect(diffContainerSnapshots(noisyBefore, noisyAfter).changes.map((change) => change.area)).toEqual([
      "documents",
      "database",
      "caches",
      "temporary"
    ]);
  });

  it("does not claim to have inferred an added or removed file", () => {
    // Evidence describes how a modification was established. A path is there or
    // it is not, so labelling either as inferred would overstate the doubt.
    const after = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/orders.json", 512, "2026-07-25T10:00:04.000Z", "h-order")
    ]);
    const diff = diffContainerSnapshots(before, after);

    expect(diff.changes.map((change) => [change.kind, change.evidence])).toEqual([
      ["added", undefined],
      ["removed", undefined],
      ["removed", undefined],
      ["removed", undefined]
    ]);
  });

  it("reports byte deltas in both directions", () => {
    const after = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/cart.json", 20, "2026-07-25T10:00:04.000Z", "h-cart-2"),
      entry("Library/Preferences/app.plist", 900, "2026-07-25T09:59:00.000Z", "h-prefs")
    ]);
    const changes = diffContainerSnapshots(before, after).changes;

    expect(changes.find((change) => change.path.endsWith("session.token"))!.sizeDelta).toBe(-44);
    expect(changes.find((change) => change.path.endsWith("cart.json"))!.sizeDelta).toBe(-100);
  });
});

describe("summarising a diff", () => {
  const before = snapshot("2026-07-25T10:00:00.000Z", [
    entry("Documents/cart.json", 120, "2026-07-25T09:59:00.000Z", "h1")
  ], { skippedAreas: [] });

  it("counts each kind and the net bytes", () => {
    const after = snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/cart.json", 200, "2026-07-25T10:00:04.000Z", "h2"),
      entry("Documents/orders.json", 512, "2026-07-25T10:00:04.000Z", "h3")
    ], { skippedAreas: [] });
    const summary = summariseContainerDiff(diffContainerSnapshots(before, after));

    expect(summary).toMatchObject({ added: 1, removed: 0, modified: 1, sizeDelta: 592, clean: false });
    expect(summary.areas).toEqual(["documents"]);
  });

  it("calls an untouched container clean", () => {
    expect(summariseContainerDiff(diffContainerSnapshots(before, before)).clean).toBe(true);
  });

  it("refuses to call a partial capture clean", () => {
    // Absence of change is only evidence when everything was actually looked
    // at. A skipped area or a truncated walk means it was not.
    const skipped = snapshot("2026-07-25T10:00:00.000Z", before.entries, { skippedAreas: ["caches"] });
    expect(summariseContainerDiff(diffContainerSnapshots(skipped, skipped)).clean).toBe(false);

    const cut = snapshot("2026-07-25T10:00:00.000Z", before.entries, { skippedAreas: [], truncated: true });
    expect(summariseContainerDiff(diffContainerSnapshots(cut, cut)).clean).toBe(false);
  });

  it("carries truncation and skipped areas through the diff", () => {
    const cut = snapshot("2026-07-25T10:00:05.000Z", before.entries, {
      skippedAreas: ["temporary"],
      truncated: true
    });
    const diff = diffContainerSnapshots(before, cut);

    expect(diff.truncated).toBe(true);
    expect(diff.skippedAreas).toEqual(["temporary"]);
  });
});

describe("filtering changes", () => {
  const changes = diffContainerSnapshots(
    snapshot("2026-07-25T10:00:00.000Z", [], { skippedAreas: [] }),
    snapshot("2026-07-25T10:00:05.000Z", [
      entry("Documents/orders.json", 10, "2026-07-25T10:00:04.000Z", "a"),
      entry("tmp/scratch", 10, "2026-07-25T10:00:04.000Z", "b")
    ], { skippedAreas: [] })
  ).changes;

  it("narrows to an area, a kind, or a path", () => {
    expect(filterContainerChanges(changes, { areas: ["documents"] }).map((c) => c.path)).toEqual([
      "Documents/orders.json"
    ]);
    expect(filterContainerChanges(changes, { kinds: ["removed"] })).toEqual([]);
    expect(filterContainerChanges(changes, { search: "ORDERS" }).map((c) => c.path)).toEqual([
      "Documents/orders.json"
    ]);
  });

  it("returns everything when nothing is asked for", () => {
    expect(filterContainerChanges(changes, {})).toHaveLength(2);
    expect(filterContainerChanges(changes, { areas: [], kinds: [], search: "  " })).toHaveLength(2);
  });
});

describe("formatting a delta", () => {
  it("reads as a signed change", () => {
    expect(formatSizeDelta(512)).toBe("+512 B");
    expect(formatSizeDelta(-2048)).toBe("-2.0 KB");
    expect(formatSizeDelta(3 * 1024 * 1024)).toBe("+3.0 MB");
  });

  it("distinguishes no size change from no change at all", () => {
    // A same-size rewrite is still a change; the delta just cannot show it.
    expect(formatSizeDelta(0)).toBe("same size");
    expect(formatSizeDelta(Number.NaN)).toBe("--");
  });
});
