// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceOverview } from "../../apps/viewer/src/components/WorkspaceOverview.js";
import type { ArtifactHealth, ArtifactRef, Session, SessionHistoryItem } from "../../apps/viewer/src/types.js";

const currentSession: Session = {
  id: "sess_current",
  status: "running",
  updatedAt: "2026-07-24T08:14:00.000Z",
  app: { bundleId: "app.atlasloop.CommerceDemo" }
};

const sessions: SessionHistoryItem[] = [
  {
    ...currentSession,
    ready: true,
    hasScreenshot: true,
    artifacts: { total: 8 },
    events: { total: 4, latestAction: { actionId: "act_pass", ok: true } }
  },
  {
    id: "sess_failed",
    status: "failed",
    updatedAt: "2026-07-24T07:03:00.000Z",
    app: { bundleId: "dev.lantern.payments" },
    artifacts: { total: 3 },
    events: { total: 2, latestAction: { actionId: "act_fail", ok: false } }
  }
];

const artifacts: ArtifactRef[] = [
  { id: "shot_1", type: "screenshot", path: "screenshots/one.png" },
  { id: "trace_1", type: "trace", path: "trace.jsonl" }
];

const cleanHealth: ArtifactHealth = {
  ok: true,
  summary: { sessionCount: 1, errorCount: 0, warningCount: 0, issueCount: 0 }
};

describe("WorkspaceOverview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("derives honest runtime metrics and routes quick actions", async () => {
    const onOpen = vi.fn();
    const onSelectSession = vi.fn();
    render({ onOpen, onSelectSession });

    expect(container.querySelector("h1")?.textContent).toBe("Workspace overview");
    expect(metric("Local sessions")).toContain("2");
    expect(metric("Active now")).toContain("1");
    expect(metric("Evidence items")).toContain("11");
    expect(metric("Needs attention")).toContain("1");
    expect(container.textContent).toContain("4/4 ready");
    expect(container.textContent).toContain("Review the observed flow");

    await click("Open Atlas map");
    expect(onOpen).toHaveBeenCalledWith("atlas");

    const inspectButtons = [...container.querySelectorAll("button")].filter((button) => button.textContent === "Inspect");
    await act(async () => inspectButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectSession).toHaveBeenCalledWith("sess_failed");
  });

  it("provides a purposeful first-run state and starts a session", async () => {
    const onStartSession = vi.fn();
    render({ sessions: [], session: undefined, artifacts: [], onStartSession });

    expect(container.textContent).toContain("No sessions yet");
    expect(container.textContent).toContain("Create the first observable run");
    await click("Start first session");
    expect(onStartSession).toHaveBeenCalledTimes(1);
  });

  function render(overrides: Partial<Parameters<typeof WorkspaceOverview>[0]> = {}): void {
    act(() => root.render(
      <WorkspaceOverview
        health="online"
        session={currentSession}
        sessions={sessions}
        sessionListStatus="ready"
        artifacts={artifacts}
        eventCount={6}
        screenshotStatus="ready"
        artifactHealth={cleanHealth}
        artifactHealthStatus="ready"
        onStartSession={vi.fn()}
        onOpen={vi.fn()}
        onSelectSession={vi.fn()}
        {...overrides}
      />
    ));
  }

  function metric(label: string): string {
    const element = [...container.querySelectorAll(".overview-metric")].find((candidate) => candidate.textContent?.includes(label));
    if (!element) throw new Error(`Metric ${label} not found`);
    return element.textContent ?? "";
  }

  async function click(text: string): Promise<void> {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
    if (!button) throw new Error(`Button ${text} not found`);
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  }
});
