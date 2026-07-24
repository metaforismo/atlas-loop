// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestWorkspace } from "../../apps/viewer/src/components/TestWorkspace.js";
import { LOCAL_TEST_RUN_STORAGE_KEY, LOCAL_TEST_STORAGE_KEY } from "../../apps/viewer/src/localTestStorage.js";
import type { Session } from "../../apps/viewer/src/types.js";

const session: Session = {
  id: "sess_tests",
  status: "running",
  app: { bundleId: "app.atlasloop.CommerceDemo" }
};

describe("TestWorkspace", () => {
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
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("separates source and result filters while exposing multi-touch requirements", async () => {
    render();

    expect(container.querySelector("h1")?.textContent).toBe("Tests");
    expect(metric("Total tests")).toContain("3");
    expect(metric("Not run")).toContain("3");

    await click("Multi-touch");
    expect(container.querySelectorAll(".test-catalog [role='option']")).toHaveLength(1);
    expect(container.textContent).toContain("Gesture Lab multi-touch");
    expect(container.textContent).toContain("XCUITest required");

    const search = container.querySelector<HTMLInputElement>("input[aria-label='Search local tests']")!;
    await setControl(search, "missing regression");
    expect(container.textContent).toContain("No tests match");
    await click("Clear filters");
    expect(search.value).toBe("");
  });

  it("validates, compiles, saves, and deletes a readable local definition", async () => {
    render();
    await click("Create test");

    expect(container.querySelector("[role='dialog']")?.textContent).toContain("Create test");
    expect(document.body.style.overflow).toBe("hidden");
    expect(button("Save local test").disabled).toBe(true);

    const name = container.querySelector<HTMLInputElement>("input[placeholder='Checkout stays recoverable']")!;
    const script = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Plain-language test steps']")!;
    await setControl(name, "Search returns results");
    await setControl(script, "Teleport home");
    expect(container.textContent).toContain("LINE 1");
    expect(container.textContent).toContain("Unsupported command");
    expect(button("Save local test").disabled).toBe(true);

    await setControl(script, `Tap "search.submit"\nVerify "results" is visible`);
    expect(container.textContent).toContain("2 actions ready");
    await click("Save local test");

    expect(document.body.style.overflow).toBe("");
    expect(metric("Total tests")).toContain("4");
    expect(container.textContent).toContain("Search returns results saved in this browser");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect(container.querySelector(".test-step-preview")?.textContent).toContain("assertVisible");

    await click("Delete");
    expect(container.textContent).toContain("keep its evidence untouched");
    await click("Keep");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_STORAGE_KEY) ?? "[]")).toHaveLength(1);
    await click("Delete");
    await click("Remove");
    expect(metric("Total tests")).toContain("3");
  });

  it("opens from the Library with prefilled readable source and can compose another module", async () => {
    const onComposerSeedHandled = vi.fn();
    render({
      composerSeed: {
        name: "Checkout handoff test",
        detail: "Keep the handoff reusable and visible.",
        tags: ["checkout", "smoke"],
        script: "Tap \"cart.continue\"\nCapture \"handoff\""
      },
      onComposerSeedHandled
    });

    expect(container.querySelector("[role='dialog']")?.textContent).toContain("Create test");
    expect(container.querySelector<HTMLInputElement>("input[placeholder='Checkout stays recoverable']")?.value).toBe("Checkout handoff test");
    expect(container.querySelector<HTMLTextAreaElement>("textarea[placeholder^='What this flow']")?.value).toBe("Keep the handoff reusable and visible.");
    expect(container.querySelector<HTMLInputElement>("input[placeholder='smoke, checkout']")?.value).toBe("checkout, smoke");
    const script = container.querySelector<HTMLTextAreaElement>("textarea[aria-label='Plain-language test steps']")!;
    expect(script.value).toContain("Tap \"cart.continue\"");
    expect(onComposerSeedHandled).toHaveBeenCalledTimes(1);

    const moduleSelect = container.querySelector<HTMLSelectElement>("select[aria-label='Select a local step module']")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(moduleSelect, "starter:settle-and-capture");
      moduleSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Insert readable steps");
    expect(script.value).toContain("# Module: Settle and capture");
    expect(script.value).toContain("Wait 500ms");
    expect(script.value).not.toContain("moduleRef");
  });

  it("blocks the wrong app, offers a matching session, and runs the right app into evidence", async () => {
    const onStartSession = vi.fn();
    render({ session: { ...session, app: { bundleId: "dev.other.app" } }, onStartSession });

    expect(container.textContent).toContain("Selected app does not match");
    expect(button("Run 3 steps").disabled).toBe(true);
    await click("Start matching app");
    expect(onStartSession).toHaveBeenCalledWith("app.atlasloop.CommerceDemo");

    await act(async () => root.render(workspace({ onStartSession })));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { actionId: "act_test", ok: true, artifacts: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    await click("Run 3 steps");
    await waitForText("3 steps passed");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(metric("Passing")).toContain("1");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_RUN_STORAGE_KEY) ?? "[]")[0]).toEqual(expect.objectContaining({
      testKey: "template:checkout-confirmation",
      status: "passed",
      sessionId: "sess_tests"
    }));
  });

  it("keeps cancellation reachable and stops sending later actions", async () => {
    const requestSignal: { current?: AbortSignal } = {};
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal.current = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal.current?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    }));
    render();

    await click("Run 3 steps");
    await waitForText("Stop active test");
    await click("Stop active test");

    expect(requestSignal.current?.aborted).toBe(true);
    expect(container.textContent).toContain("No further actions were sent to the daemon");
    expect(JSON.parse(storageValues.get(LOCAL_TEST_RUN_STORAGE_KEY) ?? "[]")[0]).toEqual(expect.objectContaining({ status: "cancelled" }));
  });

  function workspace(overrides: Partial<Parameters<typeof TestWorkspace>[0]> = {}) {
    return (
      <TestWorkspace
        params={{ daemonUrl: "http://127.0.0.1:4317", sessionId: session.id }}
        selectedSessionId={session.id}
        session={session}
        mutationState={{ canSubmitActions: true, title: "Actions ready", detail: "The selected run accepts actions.", tone: "good" }}
        onOpenEvidence={vi.fn()}
        onStartSession={vi.fn()}
        {...overrides}
      />
    );
  }

  function render(overrides: Partial<Parameters<typeof TestWorkspace>[0]> = {}): void {
    act(() => root.render(workspace(overrides)));
  }

  function metric(label: string): string {
    const element = [...container.querySelectorAll(".test-workspace-metric")].find((candidate) => candidate.textContent?.includes(label));
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

  async function waitForText(text: string): Promise<void> {
    for (let index = 0; index < 30; index += 1) {
      if (container.textContent?.includes(text)) return;
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    }
    throw new Error(`Timed out waiting for ${text}`);
  }
});
