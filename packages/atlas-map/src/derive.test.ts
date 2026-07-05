import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveAtlasMap, emptyHashCache } from "./index.ts";

const FIXTURE_PNG_DIR = resolve(import.meta.dirname, "..", "..", "..", "tests", "fixtures", "atlas", "png");
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface FixtureShot {
  artifactId: string;
  png: string;
  sha256: string;
  createdAt: string;
  screenId?: string;
}

interface FixtureAction {
  id: string;
  kind: string;
  sequence: number;
  ok: boolean;
  startedAt: string;
  fields?: Record<string, unknown>;
  shots?: FixtureShot[];
}

async function writeFixtureSession(root: string, sessionId: string, createdAt: string, actions: FixtureAction[]): Promise<void> {
  const sessionDir = join(root, sessionId);
  await mkdir(join(sessionDir, "screenshots"), { recursive: true });

  await writeFile(
    join(sessionDir, "session.json"),
    JSON.stringify({
      id: sessionId,
      schemaVersion: "atlas-loop.session.v1",
      platform: "ios-simulator",
      status: "ended",
      createdAt,
      updatedAt: createdAt,
      simulator: { name: "iPhone 17 Pro" },
      app: { bundleId: "app.demo" },
      artifactDir: sessionDir,
      backend: "local-daemon"
    }, null, 2)
  );

  const lines: string[] = [];
  for (const action of actions) {
    const artifacts = [];
    for (const shot of action.shots ?? []) {
      const fileName = `${shot.artifactId}.png`;
      await copyFile(join(FIXTURE_PNG_DIR, shot.png), join(sessionDir, "screenshots", fileName));
      artifacts.push({
        id: shot.artifactId,
        sessionId,
        type: "screenshot",
        path: join(sessionDir, "screenshots", fileName),
        createdAt: shot.createdAt,
        sha256: shot.sha256,
        metadata: {
          actionId: action.id,
          ...(shot.screenId ? { screenId: shot.screenId } : {})
        }
      });
    }
    lines.push(JSON.stringify({
      action: { id: action.id, sessionId, kind: action.kind, createdAt: action.startedAt, sequence: action.sequence, ...action.fields },
      result: { actionId: action.id, ok: action.ok, startedAt: action.startedAt, endedAt: action.startedAt, artifacts }
    }));
  }
  await writeFile(join(sessionDir, "actions.jsonl"), `${lines.join("\n")}\n`);
  await writeFile(join(sessionDir, "manifest.json"), JSON.stringify({ artifacts: [] }));
}

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-map-derive-"));
  tempRoots.push(root);

  await writeFixtureSession(root, "sess_fix_a", "2026-07-01T10:00:00.000Z", [
    { id: "act_a_launch", kind: "launch", sequence: 1, ok: true, startedAt: "2026-07-01T10:00:01.000Z", fields: { bundleId: "app.demo" } },
    {
      id: "act_a_shot", kind: "screenshot", sequence: 2, ok: true, startedAt: "2026-07-01T10:00:02.000Z",
      shots: [{ artifactId: "shot_a1", png: "screen-a.png", sha256: "sha-a", createdAt: "2026-07-01T10:00:02.100Z" }]
    },
    {
      id: "act_a_tap", kind: "tap", sequence: 3, ok: true, startedAt: "2026-07-01T10:00:03.000Z", fields: { x: 0.5, y: 0.25 },
      shots: [{ artifactId: "shot_a2", png: "screen-b.png", sha256: "sha-b", createdAt: "2026-07-01T10:00:03.100Z" }]
    },
    {
      id: "act_a_tap2", kind: "tap", sequence: 4, ok: true, startedAt: "2026-07-01T10:00:04.000Z", fields: { x: 0.5, y: 0.9 },
      shots: [{ artifactId: "shot_a3", png: "screen-b.png", sha256: "sha-b-copy", createdAt: "2026-07-01T10:00:04.100Z" }]
    },
    {
      id: "act_a_fail", kind: "tap", sequence: 5, ok: false, startedAt: "2026-07-01T10:00:05.000Z", fields: { x: 0.1, y: 0.1 },
      shots: [{ artifactId: "shot_a4", png: "screen-a.png", sha256: "sha-a-fail", createdAt: "2026-07-01T10:00:05.100Z" }]
    }
  ]);

  await writeFixtureSession(root, "sess_fix_b", "2026-07-02T10:00:00.000Z", [
    { id: "act_b_launch", kind: "launch", sequence: 1, ok: true, startedAt: "2026-07-02T10:00:01.000Z", fields: { bundleId: "app.demo" } },
    {
      id: "act_b_shot", kind: "screenshot", sequence: 2, ok: true, startedAt: "2026-07-02T10:00:02.000Z",
      shots: [{ artifactId: "shot_b1", png: "screen-a-variant.png", sha256: "sha-av", createdAt: "2026-07-02T10:00:02.100Z" }]
    },
    {
      id: "act_b_element", kind: "tapElement", sequence: 3, ok: true, startedAt: "2026-07-02T10:00:03.000Z", fields: { identifier: "cart.continue" },
      shots: [{ artifactId: "shot_b2", png: "screen-b.png", sha256: "sha-b", createdAt: "2026-07-02T10:00:03.100Z", screenId: "confirmation" }]
    }
  ]);

  return root;
}

const FIXED_NOW = () => "2026-07-05T12:00:00.000Z";

describe("deriveAtlasMap", () => {
  it("clusters screens across sessions, honors explicit screen ids, and derives labeled transitions", async () => {
    const root = await fixtureRoot();
    const { map, warnings } = await deriveAtlasMap({ artifactRoot: root, now: FIXED_NOW });

    expect(warnings).toEqual([]);
    expect(map.sessions).toEqual([
      expect.objectContaining({ sessionId: "sess_fix_a", bundleId: "app.demo", observationCount: 3 }),
      expect.objectContaining({ sessionId: "sess_fix_b", observationCount: 2 })
    ]);

    expect(map.screens).toHaveLength(2);
    const catalogScreen = map.screens.find((screen) => screen.id.startsWith("screen_"));
    const confirmation = map.screens.find((screen) => screen.id === "confirmation");
    expect(catalogScreen).toBeDefined();
    expect(confirmation).toBeDefined();

    // The hash cluster holds screen-a plus its variant from the other session.
    expect(catalogScreen!.sessionIds).toEqual(["sess_fix_a", "sess_fix_b"]);
    expect(catalogScreen!.screenshotCount).toBe(2);
    expect(catalogScreen!.representative.artifactId).toBe("shot_a1");

    // screen-b shots from BOTH sessions merged under the explicit screen id.
    expect(confirmation!.screenId).toBe("confirmation");
    expect(confirmation!.screenshotCount).toBe(3);
    expect(confirmation!.sessionIds).toEqual(["sess_fix_a", "sess_fix_b"]);

    const byId = new Map(map.transitions.map((transition) => [transition.id, transition]));
    const launchEdge = byId.get(`__launch__->${catalogScreen!.id}#launch:app.demo`);
    expect(launchEdge).toMatchObject({ count: 2, sessionIds: ["sess_fix_a", "sess_fix_b"], actionKinds: ["launch"] });
    expect(byId.get(`${catalogScreen!.id}->confirmation#tap@0.50,0.25`)).toMatchObject({ count: 1 });
    expect(byId.get(`confirmation->confirmation#tap@0.50,0.90`)).toMatchObject({ count: 1 });
    expect(byId.get(`${catalogScreen!.id}->confirmation#tap:cart.continue`)).toMatchObject({ count: 1 });
    expect(map.transitions).toHaveLength(4);

    // Failed actions contribute no observations or edges.
    expect(map.screens.flatMap((screen) => screen.variants.map((variant) => variant.artifactId))).not.toContain("shot_a4");
  });

  it("is deterministic: identical inputs produce byte-identical maps", async () => {
    const root = await fixtureRoot();
    const first = await deriveAtlasMap({ artifactRoot: root, now: FIXED_NOW });
    const second = await deriveAtlasMap({ artifactRoot: root, now: FIXED_NOW });

    expect(JSON.stringify(second.map)).toBe(JSON.stringify(first.map));
  });

  it("reuses the sha256-keyed hash cache instead of re-decoding screenshots", async () => {
    const root = await fixtureRoot();
    let reads = 0;
    const countingRead = async (path: string) => {
      reads += 1;
      const { readFile } = await import("node:fs/promises");
      return readFile(path);
    };

    const first = await deriveAtlasMap({ artifactRoot: root, now: FIXED_NOW, readPngFile: countingRead });
    const firstReads = reads;
    expect(firstReads).toBeGreaterThan(0);

    const second = await deriveAtlasMap({
      artifactRoot: root,
      now: FIXED_NOW,
      readPngFile: countingRead,
      hashCache: first.hashCache
    });

    expect(reads).toBe(firstReads);
    expect(JSON.stringify(second.map)).toBe(JSON.stringify(first.map));
  });

  it("scopes derivation to requested sessions and warns about unknown ids", async () => {
    const root = await fixtureRoot();
    const { map, warnings } = await deriveAtlasMap({
      artifactRoot: root,
      sessionIds: ["sess_fix_a", "sess_missing"],
      now: FIXED_NOW
    });

    expect(map.sessions.map((session) => session.sessionId)).toEqual(["sess_fix_a"]);
    expect(warnings).toEqual([expect.objectContaining({ sessionId: "sess_missing" })]);
  });

  it("skips unreadable screenshots with a warning instead of failing the map", async () => {
    const root = await fixtureRoot();
    await rm(join(root, "sess_fix_a", "screenshots", "shot_a1.png"));

    const { map, warnings } = await deriveAtlasMap({ artifactRoot: root, now: FIXED_NOW });

    expect(warnings).toEqual([expect.objectContaining({ sessionId: "sess_fix_a", message: expect.stringContaining("could not hash") })]);
    // shot_a1 is gone; the remaining screen-a observation is the variant.
    const hashScreen = map.screens.find((screen) => screen.id.startsWith("screen_"));
    expect(hashScreen!.representative.artifactId).toBe("shot_b1");
  });

  it("starts from an empty cache helper", () => {
    expect(emptyHashCache()).toEqual({ schemaVersion: "atlas-loop.atlas-hash-cache.v1", entries: {} });
  });
});
