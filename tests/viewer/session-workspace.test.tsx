// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionWorkspace } from "../../apps/viewer/src/components/SessionWorkspace.js";
import {
  filterAndSortSessionHistory,
  formatSessionDuration,
  sessionActivityWindow,
  sessionInputBackend
} from "../../apps/viewer/src/sessionCatalog.js";
import type { SessionHistoryItem } from "../../apps/viewer/src/types.js";

const sessions: SessionHistoryItem[] = [
  {
    id: "sess_live",
    status: "running",
    createdAt: "2026-07-24T08:00:00.000Z",
    updatedAt: "2026-07-24T08:01:42.000Z",
    inputBackend: "xcuitest",
    platform: "ios-simulator",
    app: { bundleId: "app.atlasloop.CommerceDemo" },
    simulator: { name: "iPhone 16 Pro" },
    storage: { source: "memory" },
    artifacts: { total: 14 },
    events: { total: 8 },
    hasScreenshot: true
  },
  {
    id: "sess_failed",
    status: "failed",
    createdAt: "2026-07-23T09:00:00.000Z",
    updatedAt: "2026-07-23T09:00:12.000Z",
    inputBackend: "cgevent",
    app: { bundleId: "dev.lantern.payments" },
    simulator: { name: "iPhone SE" },
    storage: { source: "disk", warningCount: 1 },
    artifacts: { total: 3 },
    events: { total: 2, latestError: { message: "Checkout button stayed disabled" } }
  },
  {
    id: "sess_nested",
    session: {
      id: "sess_nested",
      status: "ended",
      createdAt: "2026-07-22T10:00:00.000Z",
      updatedAt: "2026-07-22T10:04:00.000Z",
      inputBackend: "xcuitest",
      app: { bundleId: "app.atlasloop.GestureLab" }
    },
    artifacts: { total: 9 },
    events: { total: 4 },
    hasScreenshot: true
  },
  {
    id: "sess_unrecorded",
    status: "ended",
    updatedAt: "2026-07-21T11:00:00.000Z",
    artifacts: { total: 0 },
    events: { total: 0 }
  }
];

describe("session catalog", () => {
  it("normalizes nested evidence, searches failures, and sorts without inventing a backend", () => {
    expect(sessionInputBackend(sessions[2]!)).toBe("xcuitest");
    expect(sessionInputBackend(sessions[3]!)).toBe("unknown");
    expect(filterAndSortSessionHistory(sessions, "checkout disabled", "all", "all", "recent").map((item) => item.id)).toEqual(["sess_failed"]);
    expect(filterAndSortSessionHistory(sessions, "", "attention", "all", "recent").map((item) => item.id)).toEqual(["sess_failed"]);
    expect(filterAndSortSessionHistory(sessions, "", "all", "xcuitest", "evidence").map((item) => item.id)).toEqual(["sess_live", "sess_nested"]);
  });

  it("handles duration and bounded activity windows", () => {
    expect(formatSessionDuration(102_000)).toBe("1m 42s");
    expect(formatSessionDuration(undefined)).toBe("--");
    expect(sessionActivityWindow(sessions, Date.parse("2026-07-24T12:00:00.000Z"))).toEqual({ today: 1, sevenDays: 4 });
  });
});

describe("SessionWorkspace", () => {
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

  it("triages real input paths and opens or repeats the selected run", async () => {
    const onOpenSession = vi.fn();
    const onStartSession = vi.fn();
    render({ onOpenSession, onStartSession });

    expect(metric("Local sessions")).toContain("4");
    expect(metric("Live now")).toContain("1");
    expect(metric("Evidence items")).toContain("26");
    expect(metric("Needs attention")).toContain("1");
    expect(container.querySelector(".session-live-strip")?.textContent).toContain("CommerceDemo");

    await changeSelect("Filter sessions by input backend", "cgevent");
    expect(container.querySelector(".session-workspace-result-bar")?.textContent).toContain("1 of 4 sessions");
    expect(container.querySelector(".session-history-table")?.textContent).toContain("lantern.payments");

    await click("Needs attention");
    expect(container.querySelector(".session-workspace-detail")?.textContent).toContain("Checkout button stayed disabled");
    await click("Open evidence");
    expect(onOpenSession).toHaveBeenCalledWith("sess_failed");

    await click("Clear filters");
    await clickRow("sess_live");
    await click("Repeat with app");
    expect(onStartSession).toHaveBeenCalledWith("app.atlasloop.CommerceDemo");
  });

  it("keeps loading, error, first-run, and no-match states actionable", async () => {
    const onOpenRuntimeSettings = vi.fn();
    render({ status: "loading", sessions: [] });
    expect(container.querySelector("[aria-label='Loading session history']")).not.toBeNull();

    render({ status: "error", sessions: [], error: "History endpoint unavailable", onOpenRuntimeSettings });
    expect(container.textContent).toContain("History endpoint unavailable");
    await click("Open runtime settings");
    expect(onOpenRuntimeSettings).toHaveBeenCalledTimes(1);

    render({ status: "ready", sessions });
    const search = container.querySelector<HTMLInputElement>("input[aria-label='Search all sessions']")!;
    await setInput(search, "never-present");
    expect(container.textContent).toContain("No sessions match these filters");
    await click("Clear filters");
    expect(search.value).toBe("");
  });

  it("pages long local histories", async () => {
    const longHistory = Array.from({ length: 14 }, (_, index): SessionHistoryItem => ({
      id: `sess_${index}`,
      status: "ended",
      updatedAt: `2026-07-23T${String(index).padStart(2, "0")}:00:00.000Z`
    }));
    render({ sessions: longHistory });
    expect(container.querySelectorAll(".session-history-table [role='rowgroup'] > button")).toHaveLength(12);
    await click("Show 2 more");
    expect(container.querySelectorAll(".session-history-table [role='rowgroup'] > button")).toHaveLength(14);
  });

  function render(overrides: Partial<Parameters<typeof SessionWorkspace>[0]> = {}): void {
    act(() => root.render(
      <SessionWorkspace
        sessions={sessions}
        status="ready"
        health="online"
        onOpenSession={vi.fn()}
        onStartSession={vi.fn()}
        onOpenAtlas={vi.fn()}
        onOpenRuntimeSettings={vi.fn()}
        {...overrides}
      />
    ));
  }

  function metric(label: string): string {
    const target = [...container.querySelectorAll(".session-workspace-metric")].find((element) => element.textContent?.includes(label));
    if (!target) throw new Error(`Metric ${label} not found`);
    return target.textContent ?? "";
  }

  async function click(text: string): Promise<void> {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(text));
    if (!button) throw new Error(`Button ${text} not found`);
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  }

  async function clickRow(id: string): Promise<void> {
    const button = [...container.querySelectorAll<HTMLButtonElement>(".session-history-table [role='rowgroup'] > button")].find((candidate) => candidate.textContent?.includes(id));
    if (!button) throw new Error(`Session row ${id} not found`);
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  }

  async function changeSelect(label: string, value: string): Promise<void> {
    const select = container.querySelector<HTMLSelectElement>(`select[aria-label='${label}']`)!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      setter?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
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
