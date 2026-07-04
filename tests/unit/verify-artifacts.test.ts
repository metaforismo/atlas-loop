import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateArtifactTarget } from "../../scripts/verify-artifacts.ts";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "atlas-artifacts-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function writeValidSession(root: string): Promise<string> {
  const sessionDir = join(root, "session_ok");
  await mkdir(join(sessionDir, "screenshots"), { recursive: true });
  await mkdir(join(sessionDir, "logs"), { recursive: true });
  await mkdir(join(sessionDir, "metadata"), { recursive: true });
  await writeFile(join(sessionDir, "screenshots", "first.png"), "png");
  await writeFile(join(sessionDir, "logs", "daemon.log"), "booted\n");
  await writeFile(join(sessionDir, "metadata", "env.json"), "{\"node\":\"test\"}\n");
  await writeFile(
    join(sessionDir, "session.json"),
    JSON.stringify(
      {
        id: "session_ok",
        schemaVersion: "atlas-loop.session.v1",
        platform: "ios-simulator",
        status: "ended",
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:01.000Z",
        simulator: { name: "iPhone 16" },
        artifactDir: sessionDir
      },
      null,
      2
    )
  );
  await writeFile(
    join(sessionDir, "actions.jsonl"),
    `${JSON.stringify({
      action: {
        id: "act_1",
        sessionId: "session_ok",
        kind: "screenshot",
        createdAt: "2026-07-04T00:00:00.500Z"
      },
      result: {
        actionId: "act_1",
        ok: true,
        startedAt: "2026-07-04T00:00:00.500Z",
        endedAt: "2026-07-04T00:00:00.600Z",
        artifacts: [
          {
            id: "screenshot_1",
            sessionId: "session_ok",
            type: "screenshot",
            path: join(sessionDir, "screenshots", "first.png"),
            createdAt: "2026-07-04T00:00:00.600Z"
          },
          {
            id: "log_1",
            sessionId: "session_ok",
            type: "log",
            path: join(sessionDir, "logs", "daemon.log"),
            createdAt: "2026-07-04T00:00:00.600Z"
          },
          {
            id: "metadata_1",
            sessionId: "session_ok",
            type: "metadata",
            path: join(sessionDir, "metadata", "env.json"),
            createdAt: "2026-07-04T00:00:00.600Z"
          }
        ]
      }
    })}\n`
  );
  return sessionDir;
}

async function writeMinimalPersistedSession(root: string): Promise<string> {
  const sessionDir = join(root, "session_legacy");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session.json"),
    JSON.stringify(
      {
        id: "session_legacy",
        schemaVersion: "atlas-loop.session.v1",
        platform: "ios-simulator",
        status: "ended",
        createdAt: "2026-07-04T00:00:00.000Z",
        updatedAt: "2026-07-04T00:00:01.000Z",
        simulator: { name: "iPhone 16" },
        artifactDir: "."
      },
      null,
      2
    )
  );
  return sessionDir;
}

describe("artifact validator", () => {
  it("accepts a complete session tree with contained artifacts", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(true);
    expect(report.sessionCount).toBe(1);
    expect(report.issues).toEqual([]);
  });

  it("keeps legacy or minimal persisted sessions warning-only when metadata is incomplete", async () => {
    const root = await makeTempRoot();
    await writeMinimalPersistedSession(root);

    const report = await validateArtifactTarget(root);

    expect(report.ok).toBe(true);
    expect(report.sessionCount).toBe(1);
    expect(report.issues.every((issue) => issue.severity === "warning")).toBe(true);
    expect(report.issues.map((issue) => issue.message).join("\n")).toContain("warning-only for legacy or minimal persisted sessions");
    expect(report.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("screenshots"),
        expect.stringContaining("logs"),
        expect.stringContaining("metadata"),
        expect.stringContaining("actions.jsonl")
      ])
    );
  });

  it("rejects session metadata and action artifacts that escape the session directory", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    const escapedPath = join(root, "outside.png");
    await writeFile(escapedPath, "outside");

    const sessionJson = JSON.parse(await readFile(join(sessionDir, "session.json"), "utf8"));
    sessionJson.artifactDir = resolve(root, "..");
    await writeFile(join(sessionDir, "session.json"), JSON.stringify(sessionJson, null, 2));
    await writeFile(
      join(sessionDir, "actions.jsonl"),
      `${JSON.stringify({
        action: {
          id: "act_2",
          sessionId: "session_ok",
          kind: "screenshot",
          createdAt: "2026-07-04T00:00:00.500Z"
        },
        result: {
          actionId: "act_2",
          ok: true,
          startedAt: "2026-07-04T00:00:00.500Z",
          endedAt: "2026-07-04T00:00:00.600Z",
          artifacts: [
            {
              id: "screenshot_2",
              sessionId: "session_ok",
              type: "screenshot",
              path: escapedPath,
              createdAt: "2026-07-04T00:00:00.600Z"
            }
          ]
        }
      })}\n`
    );

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message).join("\n")).toMatch(/escapes session directory/);
  });

  it("rejects manifest artifacts stored outside the required type directory", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    await writeFile(
      join(sessionDir, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: "atlas-loop.manifest.v1",
          artifacts: [
            {
              id: "screenshot_in_logs",
              sessionId: "session_ok",
              type: "screenshot",
              path: join(sessionDir, "logs", "daemon.log"),
              createdAt: "2026-07-04T00:00:00.600Z"
            }
          ]
        },
        null,
        2
      )
    );

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message).join("\n")).toMatch(/must be inside screenshots\//);
  });

  it("rejects artifact directory entries whose realpath escapes the session", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    const outsideFile = join(root, "outside.png");
    const linkedPath = join(sessionDir, "screenshots", "linked-outside.png");
    await writeFile(outsideFile, "outside");
    await symlink(outsideFile, linkedPath);

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message).join("\n")).toMatch(/realpath escapes session directory/);
  });
});
