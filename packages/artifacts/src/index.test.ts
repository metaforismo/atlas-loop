import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Action, ArtifactRef, Session } from "@atlas-loop/protocol";
import {
  appendActionRecord,
  createSessionArtifacts,
  listPersistedSessions,
  readPersistedSession,
  writeManifest,
  writeSession,
  type SessionArtifacts
} from "./index.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("persisted session discovery", () => {
  it("discovers artifact-backed sessions and validates manifest artifacts", async () => {
    const root = await makeTempRoot();
    const layout = await writeSessionTree(root, "sess_persisted");
    const screenshotPath = join(layout.screenshotsDir, "first.png");
    await writeFile(screenshotPath, "png");
    const artifact = artifactRef(layout, "shot_1", "screenshot", screenshotPath);
    await writeManifest(layout, [artifact]);

    const records = await listPersistedSessions(root);
    const fetched = await readPersistedSession(root, "sess_persisted");

    expect(records).toHaveLength(1);
    expect(records[0].session).toMatchObject({ id: "sess_persisted", artifactDir: layout.sessionPath });
    expect(records[0].artifacts).toMatchObject([{
      id: "shot_1",
      path: screenshotPath,
      metadata: {
        sizeBytes: 3,
        mediaType: "image/png",
        latest: true,
        latestScreenshot: true
      }
    }]);
    expect(records[0].warnings).toEqual([]);
    expect(fetched?.session.id).toBe("sess_persisted");
    expect(fetched?.artifacts[0].metadata).toMatchObject({ sizeBytes: 3, mediaType: "image/png" });
  });

  it("recovers action result artifacts when the manifest is absent", async () => {
    const root = await makeTempRoot();
    const layout = await writeSessionTree(root, "sess_actions");
    const logPath = join(layout.logsDir, "install.log");
    await writeFile(logPath, "installed\n");
    const artifact = artifactRef(layout, "log_1", "log", logPath);
    const action: Action = {
      id: "act_1",
      sessionId: "sess_actions",
      kind: "install",
      appPath: "/tmp/Test.app",
      createdAt: "2026-07-04T00:00:00.500Z",
      sequence: 4
    };
    await appendActionRecord(layout, action, {
      actionId: "act_1",
      ok: true,
      startedAt: "2026-07-04T00:00:00.500Z",
      endedAt: "2026-07-04T00:00:00.600Z",
      artifacts: [artifact]
    });

    const fetched = await readPersistedSession(root, "sess_actions");

    expect(fetched?.artifacts).toMatchObject([{
      id: "log_1",
      type: "log",
      path: logPath,
      metadata: {
        sizeBytes: 10,
        mediaType: "text/plain",
        actionId: "act_1",
        actionSequence: 4,
        actionKind: "install"
      }
    }]);
  });

  it("marks only the newest recovered screenshot as the latest screenshot", async () => {
    const root = await makeTempRoot();
    const layout = await writeSessionTree(root, "sess_screenshots");
    const firstPath = join(layout.screenshotsDir, "first.png");
    const secondPath = join(layout.screenshotsDir, "second.png");
    await writeFile(firstPath, "first");
    await writeFile(secondPath, "second");
    await writeManifest(layout, [
      artifactRef(layout, "shot_1", "screenshot", firstPath, "2026-07-04T00:00:00.100Z"),
      artifactRef(layout, "shot_2", "screenshot", secondPath, "2026-07-04T00:00:00.200Z")
    ]);

    const fetched = await readPersistedSession(root, "sess_screenshots");

    expect(fetched?.artifacts.map((artifact) => artifact.metadata)).toMatchObject([
      { latest: false, latestScreenshot: false, sizeBytes: 5 },
      { latest: true, latestScreenshot: true, sizeBytes: 6 }
    ]);
  });

  it("skips malformed session records without dropping valid sessions", async () => {
    const root = await makeTempRoot();
    await writeSessionTree(root, "sess_valid");
    await mkdir(join(root, "bad-null"), { recursive: true });
    await writeFile(join(root, "bad-null", "session.json"), "null\n");
    await mkdir(join(root, "bad-mismatch"), { recursive: true });
    await writeFile(
      join(root, "bad-mismatch", "session.json"),
      JSON.stringify({ ...sessionRecord("wrong-id", join(root, "bad-mismatch")), id: "wrong-id" }, null, 2)
    );

    const records = await listPersistedSessions(root);

    expect(records.map((record) => record.session.id)).toEqual(["sess_valid"]);
    await expect(readPersistedSession(root, "bad-null")).resolves.toBeUndefined();
    await expect(readPersistedSession(root, "../sess_valid")).resolves.toBeUndefined();
  });

  it("drops missing artifact files and symlink escapes from persisted summaries", async () => {
    const root = await makeTempRoot();
    const layout = await writeSessionTree(root, "sess_escaped");
    const outsidePath = join(root, "outside.png");
    const linkedPath = join(layout.screenshotsDir, "linked.png");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, linkedPath);
    await writeManifest(layout, [
      artifactRef(layout, "shot_missing", "screenshot", join(layout.screenshotsDir, "missing.png")),
      artifactRef(layout, "shot_escape", "screenshot", linkedPath)
    ]);

    const fetched = await readPersistedSession(root, "sess_escaped");

    expect(fetched?.artifacts).toEqual([]);
    expect(fetched?.warnings.map((warning) => warning.message).join("\n")).toMatch(/missing or escapes/);
  });
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-artifacts-read-"));
  tempRoots.push(root);
  return root;
}

async function writeSessionTree(root: string, sessionId: string): Promise<SessionArtifacts> {
  const layout = await createSessionArtifacts(root, sessionId);
  await writeSession(layout, sessionRecord(sessionId, layout.sessionPath));
  return layout;
}

function sessionRecord(sessionId: string, artifactDir: string): Session {
  return {
    id: sessionId,
    schemaVersion: "atlas-loop.session.v1",
    platform: "ios-simulator",
    status: "ended",
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:01.000Z",
    simulator: { name: "iPhone 16" },
    artifactDir
  };
}

function artifactRef(
  layout: SessionArtifacts,
  id: string,
  type: ArtifactRef["type"],
  path: string,
  createdAt = "2026-07-04T00:00:00.600Z"
): ArtifactRef {
  return {
    id,
    sessionId: basename(layout.sessionPath),
    type,
    path,
    createdAt
  };
}
