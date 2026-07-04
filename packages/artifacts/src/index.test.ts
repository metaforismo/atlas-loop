import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Action, ArtifactRef, Session } from "@atlas-loop/protocol";
import {
  appendActionRecord,
  createSessionArtifacts,
  exportSessionArtifacts,
  listPersistedSessions,
  readPersistedSession,
  recordTrace,
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

describe("session artifact export", () => {
  it("exports a session into a destination session directory with portable artifact paths", async () => {
    const root = await makeTempRoot();
    const destination = await makeTempRoot("atlas-artifacts-export-destination-");
    const layout = await writeSessionTree(root, "sess_export");
    const screenshotPath = join(layout.screenshotsDir, "first.png");
    const logPath = join(layout.logsDir, "daemon.log");
    const metadataPath = join(layout.metadataDir, "environment.json");
    const videoPath = join(layout.videoDir, "capture.mp4");
    const bundlePath = join(layout.buildDir, "Demo.app", "Info.plist");
    await mkdir(join(layout.buildDir, "Demo.app"), { recursive: true });
    await writeFile(screenshotPath, "png");
    await writeFile(logPath, "log\n");
    await writeFile(metadataPath, "{\"ok\":true}\n");
    await writeFile(videoPath, "video");
    await writeFile(bundlePath, "plist");
    const installAction: Action = {
      id: "act_1",
      sessionId: "sess_export",
      kind: "install",
      appPath: join(layout.buildDir, "Demo.app"),
      createdAt: "2026-07-04T00:00:00.500Z",
      sequence: 1
    };
    await recordTrace(layout, {
      type: "session.created",
      at: "2026-07-04T00:00:00.000Z",
      session: sessionRecord("sess_export", layout.sessionPath)
    });
    await recordTrace(layout, {
      type: "action.started",
      at: "2026-07-04T00:00:00.500Z",
      action: installAction
    });
    await recordTrace(layout, {
      type: "action.completed",
      at: "2026-07-04T00:00:00.600Z",
      result: {
        actionId: "act_1",
        ok: true,
        startedAt: "2026-07-04T00:00:00.500Z",
        endedAt: "2026-07-04T00:00:00.600Z",
        artifacts: [artifactRef(layout, "shot_1", "screenshot", screenshotPath)]
      }
    });
    await recordTrace(layout, {
      type: "artifact.created",
      at: "2026-07-04T00:00:00.600Z",
      artifact: artifactRef(layout, "shot_1", "screenshot", screenshotPath)
    });
    await writeManifest(layout, [
      artifactRef(layout, "shot_1", "screenshot", screenshotPath),
      artifactRef(layout, "log_1", "log", logPath)
    ]);
    await appendActionRecord(layout, installAction, {
      actionId: "act_1",
      ok: true,
      startedAt: "2026-07-04T00:00:00.500Z",
      endedAt: "2026-07-04T00:00:00.600Z",
      artifacts: [artifactRef(layout, "shot_1", "screenshot", screenshotPath)]
    });

    const exported = await exportSessionArtifacts(root, "sess_export", { destinationDir: destination });

    expect(exported.outputDir).toBe(join(destination, "sess_export"));
    await expect(stat(join(exported.outputDir, "session.json"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(join(exported.outputDir, "actions.jsonl"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(join(exported.outputDir, "trace.jsonl"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(stat(join(exported.outputDir, "manifest.json"))).resolves.toMatchObject({ size: expect.any(Number) });
    await expect(readFile(join(exported.outputDir, "screenshots", "first.png"), "utf8")).resolves.toBe("png");
    await expect(readFile(join(exported.outputDir, "logs", "daemon.log"), "utf8")).resolves.toBe("log\n");
    await expect(readFile(join(exported.outputDir, "metadata", "environment.json"), "utf8")).resolves.toBe("{\"ok\":true}\n");
    await expect(readFile(join(exported.outputDir, "video", "capture.mp4"), "utf8")).resolves.toBe("video");
    await expect(readFile(join(exported.outputDir, "build", "Demo.app", "Info.plist"), "utf8")).resolves.toBe("plist");

    const exportedSession = JSON.parse(await readFile(join(exported.outputDir, "session.json"), "utf8")) as Session;
    const exportedManifest = JSON.parse(await readFile(join(exported.outputDir, "manifest.json"), "utf8")) as { artifacts: ArtifactRef[] };
    const exportedActions = await readFile(join(exported.outputDir, "actions.jsonl"), "utf8");
    const exportedTrace = await readFile(join(exported.outputDir, "trace.jsonl"), "utf8");
    expect(exportedSession.artifactDir).toBe(".");
    expect(exportedManifest.artifacts.map((artifact) => artifact.path)).toEqual(["screenshots/first.png", "logs/daemon.log"]);
    expect(exportedActions).toContain("\"appPath\":\"build/Demo.app\"");
    expect(exportedActions).toContain("\"path\":\"screenshots/first.png\"");
    expect(exportedTrace).toContain("\"artifactDir\":\".\"");
    expect(exportedTrace).toContain("\"appPath\":\"build/Demo.app\"");
    expect(exportedTrace).toContain("\"path\":\"screenshots/first.png\"");
    expect(exportedTrace).not.toContain(layout.sessionPath);
    expect(exportedTrace).not.toContain(screenshotPath);
  });

  it("writes export metadata with counts, byte totals, and sha256 checksums", async () => {
    const root = await makeTempRoot();
    const outputDir = join(await makeTempRoot("atlas-artifacts-export-output-"), "bundle");
    const layout = await writeSessionTree(root, "sess_checksums");
    await writeFile(join(layout.logsDir, "export.log"), "exported\n");

    const exported = await exportSessionArtifacts(root, "sess_checksums", { outputDir });

    expect(exported.outputDir).toBe(outputDir);
    const metadata = JSON.parse(await readFile(join(outputDir, "export.json"), "utf8")) as {
      schemaVersion: string;
      sessionId: string;
      sourceSessionDir: string;
      exportedAt: string;
      fileCount: number;
      byteCount: number;
      files: Array<{ path: string; sizeBytes: number; sha256: string }>;
    };
    expect(metadata).toMatchObject({
      schemaVersion: "atlas-loop.export.v1",
      sessionId: "sess_checksums",
      sourceSessionDir: layout.sessionPath
    });
    expect(Date.parse(metadata.exportedAt)).not.toBeNaN();
    expect(metadata.fileCount).toBe(metadata.files.length);
    expect(metadata.byteCount).toBe(metadata.files.reduce((total, file) => total + file.sizeBytes, 0));
    expect(metadata.files.map((file) => file.path)).toEqual([...metadata.files.map((file) => file.path)].sort());
    expect(metadata.files.find((file) => file.path === "logs/export.log")).toMatchObject({
      sizeBytes: 9,
      sha256: createHash("sha256").update("exported\n").digest("hex")
    });
    expect(metadata.files.some((file) => file.path === "export.json")).toBe(false);
  });

  it("fails with a useful error when the session is missing", async () => {
    const root = await makeTempRoot();
    const destination = await makeTempRoot("atlas-artifacts-missing-export-");

    await expect(exportSessionArtifacts(root, "sess_missing", { destinationDir: destination })).rejects.toThrow(
      /session sess_missing was not found/
    );
  });

  it("rejects symlinks that escape the source session", async () => {
    const root = await makeTempRoot();
    const destination = await makeTempRoot("atlas-artifacts-escape-export-");
    const layout = await writeSessionTree(root, "sess_symlink_escape");
    const outsidePath = join(root, "outside.log");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, join(layout.logsDir, "outside.log"));

    await expect(exportSessionArtifacts(root, "sess_symlink_escape", { destinationDir: destination })).rejects.toThrow(
      /symlink.*escapes the source session/
    );
  });

  it("rejects output paths through symlinked parents before creating inside the artifact root", async () => {
    const root = await makeTempRoot();
    await writeSessionTree(root, "sess_symlink_parent");
    const outside = await makeTempRoot("atlas-artifacts-output-parent-");
    const symlinkedParent = join(outside, "artifact-root-link");
    await symlink(root, symlinkedParent);

    await expect(exportSessionArtifacts(root, "sess_symlink_parent", {
      outputDir: join(symlinkedParent, "unexpected-export")
    })).rejects.toThrow(/outside artifact root/);
    await expect(stat(join(root, "unexpected-export"))).rejects.toThrow();
  });
});

async function makeTempRoot(prefix = "atlas-artifacts-read-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
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
