// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowWorkspace } from "../../apps/viewer/src/components/WorkflowWorkspace.js";
import { GESTURE_SEQUENCE_STORAGE_KEY } from "../../apps/viewer/src/gestureSequenceStorage.js";
import type { Session } from "../../apps/viewer/src/types.js";

const session: Session = {
  id: "sess_workflow",
  status: "running",
  app: { bundleId: "dev.atlas.workflow" }
};

describe("WorkflowWorkspace", () => {
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

  it("separates browser-saved flows, templates, and native multi-touch workflows", async () => {
    storageValues.set(GESTURE_SEQUENCE_STORAGE_KEY, JSON.stringify([{
      id: "saved-checkout",
      label: "Checkout recovery",
      detail: "Saved regression flow",
      steps: [{ label: "Tap buy", action: { kind: "tap", x: "0.5", y: "0.8" } }]
    }]));
    render();

    expect(container.querySelector("h1")?.textContent).toBe("Reusable workflows");
    expect(metric("Available")).toContain("8");
    expect(metric("Saved locally")).toContain("1");
    expect(container.textContent).toContain("Checkout recovery");

    await click("Multi-touch");
    expect(container.querySelectorAll(".workflow-table > button")).toHaveLength(2);
    expect(container.textContent).toContain("Pinch zoom audit");
    expect(container.textContent).toContain("Rotation audit");

    const search = container.querySelector<HTMLInputElement>("input[aria-label='Search workflows']")!;
    await setInput(search, "missing flow");
    expect(container.textContent).toContain("No workflows match");
    await click("Clear filters");
    expect(search.value).toBe("");
  });

  it("duplicates templates locally and confirms destructive deletion", async () => {
    render();
    await selectWorkflow("Back and settle");
    await click("Save a copy");

    expect(metric("Saved locally")).toContain("1");
    expect(container.textContent).toContain("Back and settle copy saved in this browser");
    expect(JSON.parse(storageValues.get(GESTURE_SEQUENCE_STORAGE_KEY) ?? "[]")).toHaveLength(1);

    await click("Delete");
    expect(container.textContent).toContain("Remove “Back and settle copy”");
    await click("Keep");
    expect(JSON.parse(storageValues.get(GESTURE_SEQUENCE_STORAGE_KEY) ?? "[]")).toHaveLength(1);

    await click("Delete");
    await click("Remove");
    expect(metric("Saved locally")).toContain("0");
    expect(JSON.parse(storageValues.get(GESTURE_SEQUENCE_STORAGE_KEY) ?? "[]")).toHaveLength(0);
  });

  it("runs a selected workflow in order and records completion", async () => {
    const onRunActivityChange = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { actionId: "act_flow", ok: true, artifacts: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    render({ onRunActivityChange });

    await selectWorkflow("Pinch zoom audit");
    expect(container.textContent).toContain("XCUITest required");
    await click("Run 4 steps");
    await waitForText("4 steps completed and written to the evidence timeline");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestBody(fetchMock, 0)).toEqual({ action: { kind: "pinch", scale: 1.8, velocity: 1 } });
    expect(requestBody(fetchMock, 3)).toEqual({ reason: "pinch zoom audit" });
    expect(onRunActivityChange).toHaveBeenCalledWith(expect.objectContaining({ status: "running", workflowLabel: "Pinch zoom audit" }));
    expect(onRunActivityChange).toHaveBeenLastCalledWith(expect.objectContaining({ status: "success", workflowLabel: "Pinch zoom audit" }));
  });

  it("keeps run actions disabled when the selected session cannot mutate", () => {
    render({
      mutationState: { canSubmitActions: false, title: "Session ended", detail: "Choose a mutable run.", tone: "warn" }
    });
    expect(button("Run 2 steps").disabled).toBe(true);
    expect(container.textContent).toContain("Choose a mutable run");
  });

  it("keeps cancellation available when filters or selection change during a run", async () => {
    const requestSignal: { current: AbortSignal | null } = { current: null };
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal.current = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal.current?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render();

    await click("Run 2 steps");
    await waitForText("Stop active run");
    await selectWorkflow("Carousel scan");
    expect(container.textContent).toContain("Another workflow: Step 1 of 2");
    await click("Stop active run");

    expect(requestSignal.current?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("No further actions were sent to the daemon");
  });

  function render(overrides: Partial<Parameters<typeof WorkflowWorkspace>[0]> = {}): void {
    act(() => root.render(
      <WorkflowWorkspace
        params={{ daemonUrl: "http://127.0.0.1:4317", sessionId: session.id }}
        selectedSessionId={session.id}
        session={session}
        mutationState={{ canSubmitActions: true, title: "Actions ready", detail: "The selected run accepts actions.", tone: "good" }}
        onOpenActions={vi.fn()}
        onOpenEvidence={vi.fn()}
        {...overrides}
      />
    ));
  }

  function metric(label: string): string {
    const element = [...container.querySelectorAll(".workflow-metric")].find((candidate) => candidate.textContent?.includes(label));
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

  async function selectWorkflow(label: string): Promise<void> {
    const match = [...container.querySelectorAll<HTMLButtonElement>(".workflow-table > button")].find((candidate) => candidate.textContent?.includes(label));
    if (!match) throw new Error(`Workflow ${label} not found`);
    await act(async () => match.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  }

  async function setInput(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
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

function requestBody(mock: ReturnType<typeof vi.fn>, index: number): unknown {
  const init = mock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}
