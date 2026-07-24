// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveObservedApps, filterAndSortObservedApps } from "../../apps/viewer/src/appCatalog.js";
import {
  loadPinnedObservedAppIds,
  PINNED_OBSERVED_APPS_STORAGE_KEY,
  savePinnedObservedAppIds
} from "../../apps/viewer/src/appCatalogStorage.js";
import { ObservedAppsWorkspace } from "../../apps/viewer/src/components/ObservedAppsWorkspace.js";
import type { SessionHistoryItem } from "../../apps/viewer/src/types.js";

const sessions: SessionHistoryItem[] = [
  {
    id: "sess_commerce_latest",
    status: "running",
    updatedAt: "2026-07-24T09:00:00.000Z",
    app: { bundleId: "app.atlasloop.CommerceDemo" },
    simulator: { name: "iPhone 16 Pro" },
    artifacts: { total: 7 },
    events: { total: 4, latestAction: { ok: true } }
  },
  {
    id: "sess_commerce_old",
    status: "ended",
    updatedAt: "2026-07-24T08:00:00.000Z",
    app: { bundleId: "app.atlasloop.CommerceDemo" },
    simulator: { name: "iPhone 15" },
    artifacts: { total: 3 }
  },
  {
    id: "sess_lantern",
    status: "failed",
    updatedAt: "2026-07-24T07:00:00.000Z",
    app: { bundleId: "dev.lantern.payments" },
    artifacts: { total: 2 },
    events: { total: 2, latestAction: { ok: false, error: { message: "Checkout stayed disabled" } } }
  },
  {
    id: "sess_scheme",
    status: "ended",
    updatedAt: "2026-07-24T06:00:00.000Z",
    app: { scheme: "GestureLab" },
    artifacts: { total: 1 }
  },
  {
    id: "sess_unknown",
    status: "ended",
    updatedAt: "2026-07-24T05:00:00.000Z",
    app: { appPath: "/DerivedData/Build/Products/Debug-iphonesimulator/CommerceDemo.app" },
    artifacts: { total: 2 }
  },
  {
    id: "sess_unidentified",
    status: "ended",
    updatedAt: "2026-07-24T04:00:00.000Z",
    artifacts: { total: 99 }
  }
];

describe("observed app catalog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let storageValues: Map<string, string>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    storageValues = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() { return storageValues.size; },
        clear: () => storageValues.clear(),
        getItem: (key: string) => storageValues.get(key) ?? null,
        key: (index: number) => [...storageValues.keys()][index] ?? null,
        removeItem: (key: string) => { storageValues.delete(key); },
        setItem: (key: string, value: string) => { storageValues.set(key, value); }
      } satisfies Storage
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("groups real session identity and derives honest app health", () => {
    const apps = deriveObservedApps(sessions, new Set(["path:/DerivedData/Build/Products/Debug-iphonesimulator/CommerceDemo.app"]));

    expect(apps).toHaveLength(3);
    expect(apps[0]).toMatchObject({
      id: "bundle:app.atlasloop.CommerceDemo",
      name: "Commerce Demo",
      runCount: 3,
      artifactCount: 12,
      activeRunCount: 1,
      attentionRunCount: 0,
      pinned: true
    });
    expect(apps[0]?.pinIds).toEqual(expect.arrayContaining([
      "bundle:app.atlasloop.CommerceDemo",
      "path:/DerivedData/Build/Products/Debug-iphonesimulator/CommerceDemo.app"
    ]));
    expect(apps[0]?.simulators).toEqual(["iPhone 16 Pro", "iPhone 15"]);
    expect(apps.find((app) => app.bundleId === "dev.lantern.payments")?.attentionRunCount).toBe(1);
    expect(filterAndSortObservedApps(apps, "iPhone 15", "all", "recent")).toHaveLength(1);
    expect(filterAndSortObservedApps(apps, "", "attention", "recent").map((app) => app.name)).toEqual(["Payments"]);
    expect(filterAndSortObservedApps(apps, "", "pinned", "recent").map((app) => app.name)).toEqual(["Commerce Demo"]);
  });

  it("sanitizes corrupt local pins and caps persisted app identities", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); }
    };
    memory.set(PINNED_OBSERVED_APPS_STORAGE_KEY, "{broken");
    expect(loadPinnedObservedAppIds(storage)).toEqual([]);

    memory.set(PINNED_OBSERVED_APPS_STORAGE_KEY, JSON.stringify([" app:a ", "", 4, "app:a", "app:b"]));
    expect(loadPinnedObservedAppIds(storage)).toEqual(["app:a", "app:b"]);

    const saved = savePinnedObservedAppIds(Array.from({ length: 60 }, (_, index) => `app:${index}`), storage);
    expect(saved).toHaveLength(50);
    expect(JSON.parse(memory.get(PINNED_OBSERVED_APPS_STORAGE_KEY)!)).toEqual(saved);
  });

  it("searches, scopes, pins, opens evidence, and prefills the next run", async () => {
    const onOpenSession = vi.fn();
    const onStartSession = vi.fn();
    render({ onOpenSession, onStartSession });
    await flush();

    expect(container.querySelector("h1")?.textContent).toBe("Observed apps");
    expect(metric("Observed apps")).toContain("3");
    expect(metric("Evidence items")).toContain("15");
    expect(container.querySelector(".apps-detail")?.textContent).toContain("Commerce Demo");

    await click("Needs attention");
    expect(container.querySelector(".apps-result-bar")?.textContent).toContain("1 of 3 apps");
    expect(container.querySelector(".apps-list")?.textContent).toContain("Payments");
    expect(container.querySelector(".apps-list")?.textContent).not.toContain("Commerce Demo");

    await click("Clear filters");
    const search = container.querySelector<HTMLInputElement>("input[aria-label='Search observed apps']")!;
    await input(search, "Gesture");
    expect(container.querySelector(".apps-list")?.textContent).toContain("Gesture Lab");
    await click("Clear filters");

    const pin = container.querySelector<HTMLButtonElement>("button[aria-label='Pin Commerce Demo']")!;
    await act(async () => pin.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(window.localStorage.getItem(PINNED_OBSERVED_APPS_STORAGE_KEY)).toContain("bundle:app.atlasloop.CommerceDemo");
    expect(container.textContent).toContain("App pinned in this browser");

    await click("Start new run");
    expect(onStartSession).toHaveBeenCalledWith("app.atlasloop.CommerceDemo");
    await click("Open latest evidence");
    expect(onOpenSession).toHaveBeenCalledWith("sess_commerce_latest");
  });

  it("distinguishes loading, empty, no-match, and error states", async () => {
    render({ sessions: [], status: "loading" });
    expect(container.querySelector(".apps-loading")).not.toBeNull();

    render({ sessions: [], status: "ready" });
    expect(container.textContent).toContain("No observed apps yet");

    render({ sessions, status: "ready" });
    const search = container.querySelector<HTMLInputElement>("input[aria-label='Search observed apps']")!;
    await input(search, "definitely missing");
    expect(container.textContent).toContain("No apps match these filters");

    render({ sessions: [], status: "error", error: "History file is unreadable" });
    expect(container.textContent).toContain("History file is unreadable");
  });

  it("keeps history usable when the browser blocks pin persistence", async () => {
    render();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => { throw new DOMException("Blocked", "SecurityError"); }
      }
    });

    const pin = container.querySelector<HTMLButtonElement>("button[aria-label='Pin Commerce Demo']")!;
    await act(async () => pin.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("This browser blocked local pins");
    expect(container.textContent).toContain("Commerce Demo");
  });

  function render(overrides: Partial<Parameters<typeof ObservedAppsWorkspace>[0]> = {}): void {
    act(() => root.render(
      <ObservedAppsWorkspace
        sessions={sessions}
        status="ready"
        onOpenSession={vi.fn()}
        onStartSession={vi.fn()}
        {...overrides}
      />
    ));
  }

  function metric(label: string): string {
    const candidate = [...container.querySelectorAll(".apps-metric")].find((node) => node.textContent?.includes(label));
    return candidate?.textContent ?? "";
  }

  async function click(text: string): Promise<void> {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === text);
    if (!button) throw new Error(`Button ${text} not found`);
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    await flush();
  }

  async function input(field: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    await flush();
  }

  async function flush(): Promise<void> {
    await act(async () => Promise.resolve());
  }
});
