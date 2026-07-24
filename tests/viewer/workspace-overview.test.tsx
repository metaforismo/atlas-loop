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
    events: { total: 2, latestAction: { actionId: "act_fail", ok: false, error: { message: "Checkout button stayed disabled" } } }
  },
  {
    id: "sess_complete",
    status: "ended",
    updatedAt: "2026-07-24T06:01:00.000Z",
    simulator: { name: "iPhone 16 Pro" },
    artifacts: { total: 1 },
    events: { total: 3, latestAction: { actionId: "act_done", ok: true } }
  },
  {
    id: "sess_blocked",
    status: "ended",
    updatedAt: "2026-07-24T05:02:00.000Z",
    app: { bundleId: "dev.atlas.blocked" },
    artifacts: { total: 1 },
    blockingReasons: ["No displayable screenshot was captured"]
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
    expect(metric("Local sessions")).toContain("4");
    expect(metric("Active now")).toContain("1");
    expect(metric("Evidence items")).toContain("13");
    expect(metric("Needs attention")).toContain("2");
    expect(container.textContent).toContain("4/4 ready");
    expect(container.textContent).toContain("Review the observed flow");

    await click("Open Atlas map");
    expect(onOpen).toHaveBeenCalledWith("atlas");
    await click("Browse observed apps");
    expect(onOpen).toHaveBeenCalledWith("apps");
    await click("Browse sessions");
    expect(onOpen).toHaveBeenCalledWith("sessions");
    await click("Author a local test");
    expect(onOpen).toHaveBeenCalledWith("tests");

    const inspectButtons = [...container.querySelectorAll("button")].filter((button) => button.textContent === "Inspect");
    await act(async () => inspectButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectSession).toHaveBeenCalledWith("sess_failed");
  });

  it("turns failed runs into a searchable triage queue", async () => {
    render();

    const attentionQueue = container.querySelector<HTMLElement>(".overview-attention-queue")!;
    expect(attentionQueue.textContent).toContain("Runs that need a closer look");
    expect(attentionQueue.textContent).toContain("Checkout button stayed disabled");
    expect(attentionQueue.textContent).toContain("No displayable screenshot was captured");

    await click("Needs attention");
    expect(container.querySelector(".overview-session-result-bar")?.textContent).toContain("2 of 4 sessions");
    expect(container.querySelector(".overview-session-table")?.textContent).toContain("sess_failed");
    expect(container.querySelector(".overview-session-table")?.textContent).not.toContain("sess_current");

    const search = container.querySelector<HTMLInputElement>("input[aria-label='Search session history']")!;
    await setInput(search, "missing flow");
    expect(container.textContent).toContain("No sessions match");

    await click("Clear filters");
    expect(search.value).toBe("");
    expect(container.querySelector(".overview-session-result-bar")?.textContent).toContain("4 of 4 sessions");
  });

  it("pages a large local history instead of rendering every run at once", async () => {
    const largeHistory = Array.from({ length: 12 }, (_, index): SessionHistoryItem => ({
      id: `sess_${String(index).padStart(2, "0")}`,
      status: "ended",
      updatedAt: `2026-07-23T${String(index).padStart(2, "0")}:00:00.000Z`,
      artifacts: { total: index }
    }));
    render({ sessions: largeHistory });

    expect(container.querySelectorAll(".overview-session-table-row")).toHaveLength(8);
    await click("Show 4 more");
    expect(container.querySelectorAll(".overview-session-table-row")).toHaveLength(12);
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

  async function setInput(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }
});
