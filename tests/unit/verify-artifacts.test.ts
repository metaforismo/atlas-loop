import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
  await writeFile(join(sessionDir, "metadata", "summary.json"), "{\"ok\":true}\n");
  await writeFile(join(sessionDir, "logs", "evidence.md"), "# Atlas Loop Evidence Report\n");
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
            createdAt: "2026-07-04T00:00:00.600Z",
            sha256: sha256Text("png")
          },
          {
            id: "log_1",
            sessionId: "session_ok",
            type: "log",
            path: join(sessionDir, "logs", "daemon.log"),
            createdAt: "2026-07-04T00:00:00.600Z",
            sha256: sha256Text("booted\n")
          },
          {
            id: "metadata_1",
            sessionId: "session_ok",
            type: "metadata",
            path: join(sessionDir, "metadata", "env.json"),
            createdAt: "2026-07-04T00:00:00.600Z",
            sha256: sha256Text("{\"node\":\"test\"}\n"),
            metadata: {
              proofFiles: {
                summary: join(sessionDir, "metadata", "summary.json"),
                report: join(sessionDir, "logs", "evidence.md")
              }
            }
          }
        ]
      }
    })}\n`
  );
  await writeFile(
    join(sessionDir, "manifest.json"),
    JSON.stringify(
      {
        schemaVersion: "atlas-loop.manifest.v1",
        updatedAt: "2026-07-04T00:00:01.000Z",
        proofFiles: {
          summary: join(sessionDir, "metadata", "summary.json"),
          report: join(sessionDir, "logs", "evidence.md")
        },
        artifacts: [
          {
            id: "screenshot_1",
            sessionId: "session_ok",
            type: "screenshot",
            path: join(sessionDir, "screenshots", "first.png"),
            createdAt: "2026-07-04T00:00:00.600Z",
            sha256: sha256Text("png")
          }
        ]
      },
      null,
      2
    )
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

  it("accepts known trace events with contained payload artifacts", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    await writeValidTrace(sessionDir);

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(true);
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

  it("rejects corrupt session timestamps, status, and action result shape", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);

    const sessionJson = JSON.parse(await readFile(join(sessionDir, "session.json"), "utf8"));
    sessionJson.status = "stale";
    sessionJson.createdAt = "not-a-date";
    await writeFile(join(sessionDir, "session.json"), JSON.stringify(sessionJson, null, 2));
    await writeFile(
      join(sessionDir, "actions.jsonl"),
      `${JSON.stringify({
        action: {
          id: "act_bad",
          sessionId: "session_ok",
          kind: "screenshot",
          createdAt: "2026-07-04T00:00:00.500Z"
        },
        result: {
          actionId: "act_bad",
          ok: true,
          startedAt: "bad-start",
          endedAt: "2026-07-04T00:00:00.600Z",
          artifacts: []
        }
      })}\n`
    );

    const report = await validateArtifactTarget(sessionDir);
    const messages = report.issues.map((issue) => issue.message).join("\n");

    expect(report.ok).toBe(false);
    expect(messages).toContain("session status is not recognized");
    expect(messages).toContain("session createdAt must be an ISO timestamp");
    expect(messages).toContain("result.startedAt must be an ISO timestamp");
  });

  it("rejects loose date strings where an ISO UTC timestamp is required", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);

    const sessionJson = JSON.parse(await readFile(join(sessionDir, "session.json"), "utf8"));
    sessionJson.updatedAt = "2026-07-04";
    await writeFile(join(sessionDir, "session.json"), JSON.stringify(sessionJson, null, 2));

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message)).toContain("session updatedAt must be an ISO timestamp");
  });

  it("rejects falsy parsed JSON records instead of treating them as unreadable skips", async () => {
    const root = await makeTempRoot();
    const sessionDir = join(root, "session_null");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "session.json"), "null");

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message)).toContain("session.json must be an object");
  });

  it("rejects falsy manifest JSON after validating the session shape", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    await writeFile(join(sessionDir, "manifest.json"), "null");

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message)).toContain("manifest.json must be an object");
  });

  it("rejects malformed trace JSONL and unknown trace event types", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    await writeFile(
      join(sessionDir, "trace.jsonl"),
      [
        "{not-json",
        JSON.stringify(["not", "an", "event"]),
        JSON.stringify({ type: "future.event", at: "2026-07-04T00:00:00.000Z" }),
        JSON.stringify({ type: "session.statusChanged", at: "2026-07-04", sessionId: "session_ok", from: "created", to: "ended" })
      ].join("\n")
    );

    const report = await validateArtifactTarget(sessionDir);
    const messages = report.issues.map((issue) => issue.message).join("\n");

    expect(report.ok).toBe(false);
    expect(messages).toContain("invalid JSONL record");
    expect(messages).toContain("trace event must be an object");
    expect(messages).toContain("trace event type is not recognized");
    expect(messages).toContain("trace event at must be an ISO timestamp");
  });

  it("rejects trace error events without an error object", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    await writeFile(
      join(sessionDir, "trace.jsonl"),
      [
        JSON.stringify({ type: "error", at: "2026-07-04T00:00:00.000Z" }),
        JSON.stringify({ type: "error", at: "2026-07-04T00:00:01.000Z", error: "not-an-error-object" })
      ].join("\n")
    );

    const report = await validateArtifactTarget(sessionDir);
    const messages = report.issues.map((issue) => issue.message);

    expect(report.ok).toBe(false);
    expect(messages).toEqual([
      "trace error.error must be an object",
      "trace error.error must be an object"
    ]);
  });

  it("rejects trace events whose payloads do not match the session or escape artifact roots", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    const escapedPath = join(root, "outside.png");
    await writeFile(escapedPath, "outside");
    await writeFile(
      join(sessionDir, "trace.jsonl"),
      [
        JSON.stringify({
          type: "session.created",
          at: "2026-07-04T00:00:00.000Z",
          session: {
            id: "other_session",
            status: "stale",
            createdAt: "not-a-date",
            updatedAt: "2026-07-04"
          }
        }),
        JSON.stringify({
          type: "session.statusChanged",
          at: "2026-07-04T00:00:01.000Z",
          sessionId: "other_session",
          from: "created",
          to: "stale"
        }),
        JSON.stringify({
          type: "action.started",
          at: "2026-07-04T00:00:02.000Z",
          action: {
            id: "",
            sessionId: "other_session",
            kind: "unknown",
            createdAt: "not-a-date"
          }
        }),
        JSON.stringify({
          type: "action.completed",
          at: "2026-07-04T00:00:03.000Z",
          result: {
            actionId: "",
            ok: "yes",
            startedAt: "not-a-date",
            endedAt: "2026-07-04T00:00:03.000Z",
            artifacts: [
              {
                id: "trace_screenshot",
                sessionId: "session_ok",
                type: "screenshot",
                path: escapedPath,
                createdAt: "2026-07-04T00:00:03.000Z"
              }
            ]
          }
        }),
        JSON.stringify({
          type: "artifact.created",
          at: "2026-07-04T00:00:04.000Z",
          artifact: {
            id: "trace_metadata",
            sessionId: "session_ok",
            type: "metadata",
            path: join(sessionDir, "logs", "daemon.log"),
            createdAt: "2026-07-04T00:00:04.000Z"
          }
        }),
        JSON.stringify({
          type: "error",
          at: "2026-07-04T00:00:05.000Z",
          sessionId: "other_session",
          error: {
            message: ""
          }
        })
      ].join("\n")
    );

    const report = await validateArtifactTarget(sessionDir);
    const messages = report.issues.map((issue) => issue.message).join("\n");

    expect(report.ok).toBe(false);
    expect(messages).toContain("trace session.created session.id must match session id session_ok");
    expect(messages).toContain("trace session.created session.status is not recognized");
    expect(messages).toContain("trace session.created session.createdAt must be an ISO timestamp");
    expect(messages).toContain("trace session.statusChanged sessionId must match session id session_ok");
    expect(messages).toContain("trace session.statusChanged to status is not recognized");
    expect(messages).toContain("action.id must be a non-empty string");
    expect(messages).toContain("action.sessionId must match session id session_ok");
    expect(messages).toContain("action.kind is not a known Atlas Loop action kind");
    expect(messages).toContain("trace action.completed result.actionId must be a non-empty string");
    expect(messages).toContain("result.ok must be boolean");
    expect(messages).toMatch(/escapes session directory/);
    expect(messages).toMatch(/must be inside metadata\//);
    expect(messages).toContain("trace error sessionId must match session id session_ok");
    expect(messages).toContain("trace error.error.code should be a non-empty string");
    expect(messages).toContain("trace error.error.message should be a non-empty string");
  });

  it("rejects corrupt artifact hashes and missing referenced proof files", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);

    await writeFile(
      join(sessionDir, "manifest.json"),
      JSON.stringify(
        {
          schemaVersion: "atlas-loop.manifest.v1",
          updatedAt: "2026-07-04T00:00:01.000Z",
          artifacts: [
            {
              id: "screenshot_bad_hash",
              sessionId: "session_ok",
              type: "screenshot",
              path: join(sessionDir, "screenshots", "first.png"),
              createdAt: "2026-07-04T00:00:00.600Z",
              sha256: "0".repeat(64),
              metadata: {
                reportPath: join(sessionDir, "logs", "missing-report.md")
              }
            }
          ]
        },
        null,
        2
      )
    );

    const report = await validateArtifactTarget(sessionDir);
    const messages = report.issues.map((issue) => issue.message).join("\n");

    expect(report.ok).toBe(false);
    expect(messages).toContain("artifact.sha256 does not match file contents");
    expect(messages).toContain("artifact metadata reportPath does not exist");
  });

  it("accepts export metadata sidecars that match the copied bundle", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    const exportMetadata = await writeValidExportMetadata(sessionDir);
    await writeValidEvidenceExportMetadata(sessionDir, exportMetadata);

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it("rejects export metadata that misstates copied files", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    const metadataPath = join(sessionDir, "export.json");
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          schemaVersion: "atlas-loop.export.v0",
          sessionId: "other_session",
          sourceSessionDir: 42,
          exportedAt: "2026-07-04",
          fileCount: 99,
          byteCount: 1,
          files: [
            {
              path: "export.json",
              sizeBytes: 0,
              sha256: sha256Text("")
            },
            {
              path: "../outside.txt",
              sizeBytes: 10,
              sha256: "0".repeat(64)
            },
            {
              path: join(sessionDir, "screenshots", "first.png"),
              sizeBytes: 3,
              sha256: sha256Text("png")
            },
            {
              path: "screenshots/first.png",
              sizeBytes: 999,
              sha256: "0".repeat(64)
            },
            {
              path: "logs",
              sizeBytes: 0,
              sha256: "0".repeat(64)
            }
          ]
        },
        null,
        2
      )
    );

    const report = await validateArtifactTarget(sessionDir);
    const messages = report.issues.map((issue) => issue.message).join("\n");

    expect(report.ok).toBe(false);
    expect(messages).toContain("export.json schemaVersion must be atlas-loop.export.v1");
    expect(messages).toContain("export.json sessionId must match session id session_ok");
    expect(messages).toContain("export.json sourceSessionDir must be a non-empty string");
    expect(messages).toContain("export.json exportedAt must be an ISO timestamp");
    expect(messages).toContain("export.json fileCount must match files length");
    expect(messages).toContain("export.json byteCount must match the sum of file sizeBytes values");
    expect(messages).toContain("export.json must not list itself");
    expect(messages).toContain("export file path must be relative");
    expect(messages).toContain("export file path must stay inside the bundle directory");
    expect(messages).toContain("export file sizeBytes does not match file size");
    expect(messages).toContain("export file sha256 does not match file contents");
    expect(messages).toContain("export file must reference a regular file");
  });

  it("rejects evidence export sidecars that do not point at the local bundle metadata", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    await writeValidExportMetadata(sessionDir);
    await writeFile(
      join(sessionDir, "atlas-evidence-export.json"),
      JSON.stringify(
        {
          schemaVersion: "atlas-loop.evidence-export.v0",
          sessionId: "other_session",
          exportedAt: "bad-date",
          bundleDir: join(sessionDir, "other-bundle"),
          metadataPath: join(sessionDir, "other-metadata.json"),
          artifactExportMetadataPath: join(sessionDir, "other-export.json"),
          localOnly: false,
          uploaded: true
        },
        null,
        2
      )
    );

    const report = await validateArtifactTarget(sessionDir);
    const messages = report.issues.map((issue) => issue.message).join("\n");

    expect(report.ok).toBe(false);
    expect(messages).toContain("atlas-evidence-export.json schemaVersion must be atlas-loop.evidence-export.v1");
    expect(messages).toContain("atlas-evidence-export.json sessionId must match session id session_ok");
    expect(messages).toContain("atlas-evidence-export.json exportedAt must be an ISO timestamp");
    expect(messages).toContain("atlas-evidence-export.json localOnly must be true");
    expect(messages).toContain("atlas-evidence-export.json uploaded must be false");
    expect(messages).toContain("atlas-evidence-export.json bundleDir must reference the bundle directory");
    expect(messages).toContain("atlas-evidence-export.json metadataPath must reference atlas-evidence-export.json");
    expect(messages).toContain("atlas-evidence-export.json artifactExportMetadataPath must reference export.json");
  });

  it("rejects evidence export sidecars when export.json is missing", async () => {
    const root = await makeTempRoot();
    const sessionDir = await writeValidSession(root);
    await writeValidEvidenceExportMetadata(sessionDir, { fileCount: 0, byteCount: 0 });

    const report = await validateArtifactTarget(sessionDir);

    expect(report.ok).toBe(false);
    expect(report.issues.map((issue) => issue.message)).toContain(
      "atlas-evidence-export.json artifactExportMetadataPath must reference existing export.json"
    );
  });
});

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function writeValidTrace(sessionDir: string): Promise<void> {
  const session = JSON.parse(await readFile(join(sessionDir, "session.json"), "utf8"));
  const action = {
    id: "trace_act_1",
    sessionId: "session_ok",
    kind: "screenshot",
    createdAt: "2026-07-04T00:00:00.500Z",
    sequence: 1
  };
  const artifact = {
    id: "trace_screenshot_1",
    sessionId: "session_ok",
    type: "screenshot",
    path: join(sessionDir, "screenshots", "first.png"),
    createdAt: "2026-07-04T00:00:00.700Z",
    sha256: sha256Text("png")
  };
  const result = {
    actionId: action.id,
    ok: true,
    startedAt: "2026-07-04T00:00:00.500Z",
    endedAt: "2026-07-04T00:00:00.700Z",
    artifacts: [artifact]
  };
  await writeFile(
    join(sessionDir, "trace.jsonl"),
    [
      { type: "session.created", at: "2026-07-04T00:00:00.000Z", session },
      { type: "session.statusChanged", at: "2026-07-04T00:00:00.100Z", sessionId: "session_ok", from: "created", to: "running" },
      { type: "action.started", at: "2026-07-04T00:00:00.500Z", action },
      { type: "action.completed", at: "2026-07-04T00:00:00.700Z", result },
      { type: "artifact.created", at: "2026-07-04T00:00:00.700Z", artifact },
      {
        type: "error",
        at: "2026-07-04T00:00:00.800Z",
        sessionId: "session_ok",
        error: { code: "COMMAND_FAILED", message: "diagnostic trace event" }
      }
    ]
      .map((event) => JSON.stringify(event))
      .join("\n") + "\n\n"
  );
}

interface TestExportFile {
  path: string;
  sizeBytes: number;
  sha256: string;
}

interface TestExportMetadata {
  fileCount: number;
  byteCount: number;
}

async function writeValidExportMetadata(sessionDir: string): Promise<TestExportMetadata> {
  const files: TestExportFile[] = [];
  for (const relativePath of [
    "actions.jsonl",
    "logs/daemon.log",
    "logs/evidence.md",
    "manifest.json",
    "metadata/env.json",
    "metadata/summary.json",
    "screenshots/first.png",
    "session.json"
  ]) {
    files.push(await exportFileMetadata(sessionDir, relativePath));
  }
  const metadata = {
    schemaVersion: "atlas-loop.export.v1",
    sessionId: "session_ok",
    sourceSessionDir: resolve(sessionDir, "..", "source", "session_ok"),
    exportedAt: "2026-07-04T00:00:02.000Z",
    fileCount: files.length,
    byteCount: files.reduce((total, file) => total + file.sizeBytes, 0),
    files
  };
  await writeFile(join(sessionDir, "export.json"), JSON.stringify(metadata, null, 2));
  return metadata;
}

async function writeValidEvidenceExportMetadata(sessionDir: string, exportMetadata: TestExportMetadata): Promise<void> {
  await writeFile(
    join(sessionDir, "atlas-evidence-export.json"),
    JSON.stringify(
      {
        schemaVersion: "atlas-loop.evidence-export.v1",
        sessionId: "session_ok",
        requestedSessionId: "latest",
        exportedAt: "2026-07-04T00:00:02.000Z",
        bundleDir: sessionDir,
        metadataPath: join(sessionDir, "atlas-evidence-export.json"),
        artifactExportMetadataPath: join(sessionDir, "export.json"),
        sourceArtifactDir: resolve(sessionDir, "..", "source", "session_ok"),
        localOnly: true,
        uploaded: false,
        artifactTotal: 3,
        fileCount: exportMetadata.fileCount,
        byteCount: exportMetadata.byteCount,
        latestScreenshotPath: null,
        exportedLatestScreenshotPath: null,
        storage: { source: "disk", artifactBacked: true, warnings: [] }
      },
      null,
      2
    )
  );
}

async function exportFileMetadata(sessionDir: string, relativePath: string): Promise<TestExportFile> {
  const filePath = join(sessionDir, relativePath);
  return {
    path: relativePath,
    sizeBytes: (await stat(filePath)).size,
    sha256: createHash("sha256").update(await readFile(filePath)).digest("hex")
  };
}
