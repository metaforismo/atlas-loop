import { describe, expect, it } from "vitest";
import {
  buildEvidenceHtmlReport,
  collectEvidenceHtmlAssets,
  type EvidenceReportData
} from "./index.ts";
import type { ArtifactRef, TraceEvent } from "@atlas-loop/protocol";

function screenshot(id: string, createdAt: string, metadata: Record<string, unknown> = {}): ArtifactRef {
  return {
    id,
    sessionId: "sess_html",
    type: "screenshot",
    path: `/evidence/screenshots/${id}.png`,
    createdAt,
    metadata
  };
}

const artifacts: ArtifactRef[] = [
  screenshot("shot_old", "2026-07-05T10:00:00.000Z", { reason: "launch" }),
  screenshot("shot_new", "2026-07-05T10:01:00.000Z", { actionId: "act_tap", identifier: "cart.continue" }),
  {
    id: "video_1",
    sessionId: "sess_html",
    type: "video",
    path: "/evidence/video/run.mp4",
    createdAt: "2026-07-05T10:02:00.000Z",
    metadata: { videoStartedAt: "2026-07-05T10:00:00.000Z" }
  }
];

const events: TraceEvent[] = [
  { type: "action.started", at: "2026-07-05T10:00:30.000Z", action: { id: "act_tap", sessionId: "sess_html", kind: "tapElement", identifier: "cart.continue", createdAt: "2026-07-05T10:00:30.000Z" } as never },
  { type: "action.completed", at: "2026-07-05T10:00:31.000Z", result: { actionId: "act_tap", ok: true, startedAt: "2026-07-05T10:00:30.000Z", endedAt: "2026-07-05T10:00:31.000Z", artifacts: [artifacts[1]] } },
  { type: "action.started", at: "2026-07-05T10:00:40.000Z", action: { id: "act_fail", sessionId: "sess_html", kind: "assertVisible", identifier: "missing", createdAt: "2026-07-05T10:00:40.000Z" } as never },
  { type: "action.completed", at: "2026-07-05T10:00:41.000Z", result: { actionId: "act_fail", ok: false, startedAt: "2026-07-05T10:00:40.000Z", endedAt: "2026-07-05T10:00:41.000Z", artifacts: [] } }
];

const evidence: EvidenceReportData = {
  sessionId: "sess_html",
  requestedSessionId: "latest",
  artifactDir: "/evidence",
  latestScreenshotPath: artifacts[1].path,
  latestScreenshot: artifacts[1],
  viewerUrl: "http://127.0.0.1:5173?sessionId=sess_html",
  daemonUrl: "http://127.0.0.1:4317",
  viewerBaseUrl: "http://127.0.0.1:5173",
  sessionStatus: "ended",
  createdAt: "2026-07-05T09:59:00.000Z",
  updatedAt: "2026-07-05T10:03:00.000Z",
  artifactTotal: 3,
  artifactCounts: { screenshot: 2, video: 1 },
  eventTotal: 4,
  storage: { source: "disk", artifactBacked: true, warnings: [{ path: "/evidence/x", message: "legacy warning" }] }
};

async function assets(maxScreenshots = 20) {
  return collectEvidenceHtmlAssets({
    artifacts,
    events,
    metrics: [
      { at: "2026-07-05T10:00:00.000Z", cpuPercent: 10, rssBytes: 100 * 1024 * 1024 },
      { at: "2026-07-05T10:00:01.000Z", cpuPercent: 30, rssBytes: 130 * 1024 * 1024 }
    ],
    maxScreenshots,
    readFile: async (path) => Buffer.from(`png-bytes-of:${path}`),
    videoPathResolver: (path) => `video/${path.split("/").at(-1)}`
  });
}

describe("collectEvidenceHtmlAssets", () => {
  it("inlines screenshots newest-first with labels, joins actions, and references video relatively", async () => {
    const collected = await assets();

    expect(collected.screenshots.map((shot) => shot.name)).toEqual(["shot_new.png", "shot_old.png"]);
    expect(collected.screenshots[0].dataUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(collected.screenshots[0].label).toBe("cart.continue");
    expect(collected.truncatedScreenshots).toBe(0);
    expect(collected.videoRelativePath).toBe("video/run.mp4");
    expect(collected.actions).toEqual([
      expect.objectContaining({ actionId: "act_tap", kind: "tapElement", ok: true, artifactCount: 1, detail: "cart.continue" }),
      expect.objectContaining({ actionId: "act_fail", kind: "assertVisible", ok: false })
    ]);
  });

  it("caps inlined screenshots and reports the truncation", async () => {
    const collected = await assets(1);
    expect(collected.screenshots).toHaveLength(1);
    expect(collected.truncatedScreenshots).toBe(1);
  });

  it("omits unreadable screenshots instead of failing", async () => {
    const collected = await collectEvidenceHtmlAssets({
      artifacts,
      events: [],
      readFile: async (path) => {
        if (path.includes("shot_new")) throw new Error("gone");
        return Buffer.from("bytes");
      }
    });
    expect(collected.screenshots.map((shot) => shot.name)).toEqual(["shot_old.png"]);
  });
});

describe("buildEvidenceHtmlReport", () => {
  it("produces one self-contained dark HTML document", async () => {
    const html = buildEvidenceHtmlReport(evidence, await assets(), { generatedAt: "2026-07-05T12:00:00.000Z" });

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain("sess_html");
    expect(html).toContain("1 failed");
    expect(html).toContain("App metrics");
    expect(html).toContain('src="video/run.mp4"');
    expect(html).toContain("legacy warning");
    // Self-contained: no external asset references.
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href=/);
    expect(html).not.toContain("<script");
  });

  it("escapes HTML-sensitive evidence values", async () => {
    const hostile = { ...evidence, sessionId: 'sess<img src=x onerror="pwn">' };
    const html = buildEvidenceHtmlReport(hostile, await assets(), { generatedAt: "2026-07-05T12:00:00.000Z" });

    expect(html).not.toContain('<img src=x onerror="pwn">');
    expect(html).toContain("sess&lt;img src=x onerror=&quot;pwn&quot;&gt;");
  });
});
