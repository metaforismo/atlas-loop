// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveMonitor } from "../../apps/viewer/src/components/LiveMonitor.js";
import type { Session, SessionHistoryItem } from "../../apps/viewer/src/types.js";

const selectedSession: Session = {
  id: "sess_monitor",
  status: "running",
  updatedAt: "2026-07-24T09:10:11.000Z",
  simulator: { name: "iPhone 16 Pro", runtime: "iOS 18.5" },
  app: { bundleId: "dev.atlas.monitor" },
  inputBackend: "xcuitest"
};

const historySession: SessionHistoryItem = {
  ...selectedSession,
  ready: true,
  artifacts: { total: 12 },
  events: { total: 8 }
};

describe("LiveMonitor", () => {
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
    document.body.style.overflow = "";
    vi.restoreAllMocks();
  });

  it("opens a focused global monitor and restores focus when Escape closes it", async () => {
    const staleDiskSession: SessionHistoryItem = {
      ...historySession,
      id: "sess_stale_disk",
      canMutate: false,
      storage: { source: "disk" }
    };
    render({ sessions: [historySession, staleDiskSession], sessionListStatus: "ready" });
    const trigger = button("Live monitor");
    trigger.focus();
    await click(trigger);

    expect(container.querySelector("[role='dialog'][aria-labelledby='live-monitor-title']")).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Close live monitor");
    expect(container.textContent).toContain("iPhone 16 Pro");
    expect(container.textContent).toContain("12 artifacts");
    expect(container.querySelector("[role='tab']")?.textContent).toContain("Devices 1");
    expect(container.textContent).not.toContain("sess_stale_disk");

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(container.querySelector("[role='dialog']")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(trigger);
  });

  it("shows workflow progress and routes users back to the real workflow workspace", async () => {
    const onOpenWorkflows = vi.fn();
    render({
      sessions: [historySession],
      sessionListStatus: "ready",
      workflowActivity: { status: "running", workflowLabel: "Pinch zoom audit", step: 3, total: 4, stepLabel: "Capture checkpoint" },
      onOpenWorkflows
    });
    await click(button("Live monitor"));
    await click(button("Workflows"));

    expect(container.textContent).toContain("Pinch zoom audit");
    expect(container.textContent).toContain("Step 3 of 4 · Capture checkpoint");
    expect(container.querySelector<HTMLElement>(".live-monitor-workflow-progress span")?.style.transform).toBe("scaleX(0.75)");
    expect(container.textContent).toContain("iPhone 16 Pro");
  });

  it("distinguishes loading, unavailable, and offline empty states", async () => {
    render({ sessions: [], sessionListStatus: "loading", selectedSession: undefined });
    await click(button("Live monitor"));
    expect(container.querySelector("[aria-label='Loading live devices'][aria-busy='true']")).not.toBeNull();

    await act(async () => root.render(<MonitorFixture sessions={[]} sessionListStatus="error" sessionListError="Session index refused the request." selectedSession={undefined} />));
    expect(container.textContent).toContain("Device activity unavailable");
    expect(container.textContent).toContain("Session index refused the request");

    await act(async () => root.render(<MonitorFixture health="offline" sessions={[]} sessionListStatus="ready" selectedSession={undefined} />));
    expect(container.textContent).toContain("Daemon offline");
    expect(container.textContent).toContain("No cached active devices");
    expect(container.textContent).toContain("Open runtime settings");
  });

  function render(overrides: Partial<Parameters<typeof LiveMonitor>[0]> = {}): void {
    act(() => root.render(<MonitorFixture {...overrides} />));
  }

  function button(text: string): HTMLButtonElement {
    const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(text));
    if (!match) throw new Error(`Button ${text} not found`);
    return match;
  }

  async function click(element: HTMLButtonElement): Promise<void> {
    await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  }
});

function MonitorFixture(overrides: Partial<Parameters<typeof LiveMonitor>[0]>) {
  return (
    <LiveMonitor
      health="online"
      sessions={[historySession]}
      sessionListStatus="ready"
      selectedSessionId={selectedSession.id}
      selectedSession={selectedSession}
      artifactCount={12}
      eventCount={8}
      workflowActivity={{ status: "idle" }}
      onOpenSession={vi.fn()}
      onOpenEvidence={vi.fn()}
      onOpenWorkflows={vi.fn()}
      onStartSession={vi.fn()}
      onOpenRuntime={vi.fn()}
      {...overrides}
    />
  );
}
