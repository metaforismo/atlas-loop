// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryWorkspace } from "../../apps/viewer/src/components/LibraryWorkspace.js";
import { LOCAL_LAUNCH_PROFILE_STORAGE_KEY } from "../../apps/viewer/src/localLaunchProfileStorage.js";
import { LOCAL_TEST_MODULE_STORAGE_KEY } from "../../apps/viewer/src/localTestModuleStorage.js";

describe("LibraryWorkspace", () => {
  let container: HTMLDivElement;
  let root: Root;
  let storageValues: Map<string, string>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
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
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.style.overflow = "";
    container.remove();
    vi.restoreAllMocks();
  });

  it("filters visible starters and explains native multi-touch requirements", async () => {
    render();

    expect(container.querySelector("h1")?.textContent).toBe("Library");
    expect(metric("Total modules")).toContain("3");
    expect(metric("Saved locally")).toContain("0");
    expect(metric("Reusable steps")).toContain("11");
    expect(metric("Multi-touch")).toContain("1");
    expect(container.textContent).toContain("no hidden remote references");

    await click("Multi-touch");
    expect(container.querySelectorAll(".library-catalog [role='option']")).toHaveLength(1);
    expect(container.textContent).toContain("Native canvas stress");
    expect(container.textContent).toContain("XCUITest required");

    const search = container.querySelector<HTMLInputElement>("input[aria-label='Search local modules']")!;
    await setControl(search, "missing reusable block");
    expect(container.textContent).toContain("No modules match");
    await click("Clear filters");
    expect(search.value).toBe("");
  });

  it("validates, saves, duplicates, and narrowly deletes browser-local modules", async () => {
    render();
    const newModuleButton = button("New module");
    newModuleButton.focus();
    await act(async () => newModuleButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

    expect(container.querySelector("[role='dialog']")?.textContent).toContain("Create module");
    expect(document.body.style.overflow).toBe("hidden");
    expect(button("Save module").disabled).toBe(true);

    const name = container.querySelector<HTMLInputElement>("input[placeholder='Checkout handoff']")!;
    const script = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Readable module steps']")!;
    await setControl(name, "Search checkpoint");
    await setControl(script, "Teleport home");
    expect(container.textContent).toContain("Unsupported command");
    expect(button("Save module").disabled).toBe(true);

    await setControl(script, "Tap \"search.submit\"\nCapture \"results\"");
    expect(container.textContent).toContain("2 actions ready");
    await click("Save module");

    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(newModuleButton);
    expect(metric("Total modules")).toContain("4");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_MODULE_STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect(container.textContent).toContain("Search checkpoint saved in this browser");

    await click("Duplicate");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_MODULE_STORAGE_KEY) ?? "[]")).toHaveLength(2);
    expect(container.textContent).toContain("Search checkpoint copy saved in this browser");

    await click("Delete");
    expect(container.textContent).toContain("Existing tests keep their inserted commands");
    await click("Keep");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_MODULE_STORAGE_KEY) ?? "[]")).toHaveLength(2);
    await click("Delete");
    await click("Remove");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_MODULE_STORAGE_KEY) ?? "[]")).toHaveLength(1);
  });

  it("hands a selected module to the Tests composer as readable source", async () => {
    const onCreateTest = vi.fn();
    render(onCreateTest);

    await click("Create test from module");
    expect(onCreateTest).toHaveBeenCalledWith({
      name: "Checkout handoff test",
      detail: "Move from the cart through shipping and payment, then preserve the confirmed state.",
      tags: ["commerce", "checkout"],
      script: expect.stringContaining("Tap \"cart.continue\"")
    });
  });

  it("switches to launch profiles, blocks stored secrets, and hands valid startup state to the launcher", async () => {
    const onStartWithProfile = vi.fn();
    render(vi.fn(), onStartWithProfile);

    await click("Launch profiles");
    expect(container.textContent).toContain("Profiles make startup deterministic");
    expect(metric("Total profiles")).toContain("3");
    expect(container.textContent).toContain("Gesture Lab");

    await click("Gesture Lab");
    await click("Start with profile");
    expect(onStartWithProfile).toHaveBeenCalledWith(expect.objectContaining({
      bundleId: "app.atlasloop.CommerceDemo",
      environment: { ATLAS_LOOP_DEMO_ROUTE: "gesture-lab" }
    }));

    await click("New launch profile");
    const name = container.querySelector<HTMLInputElement>("input[placeholder='Gesture Lab ready']")!;
    const environment = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Launch environment']")!;
    await setControl(name, "Authenticated checkout");
    await setControl(environment, "API_TOKEN=do-not-store");
    expect(container.textContent).toContain("Pass secrets through your shell");
    expect(button("Save profile").disabled).toBe(true);

    await setControl(environment, "ATLAS_LOOP_DEMO_ROUTE=shipping");
    await click("Save profile");
    expect(JSON.parse(storageValues.get(LOCAL_LAUNCH_PROFILE_STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect(metric("Total profiles")).toContain("4");
    expect(container.textContent).toContain("Authenticated checkout saved in this browser");
  });

  function render(onCreateTest = vi.fn(), onStartWithProfile = vi.fn()): void {
    act(() => root.render(<LibraryWorkspace onCreateTest={onCreateTest} onStartWithProfile={onStartWithProfile} />));
  }

  function metric(label: string): string {
    const element = [...container.querySelectorAll(".library-metric")].find((candidate) => candidate.textContent?.includes(label));
    if (!element) throw new Error(`Metric ${label} not found`);
    return element.textContent ?? "";
  }

  function button(text: string): HTMLButtonElement {
    const match = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(text));
    if (!match) throw new Error(`Button ${text} not found`);
    return match;
  }

  async function click(text: string): Promise<void> {
    await act(async () => button(text).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  }

  async function setControl(control: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
    await act(async () => {
      const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }
});
