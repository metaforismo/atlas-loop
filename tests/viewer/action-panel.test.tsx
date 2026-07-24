// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ActionPanel,
  DEFAULT_ACTION_FORM
} from "../../apps/viewer/src/components/ActionPanel.js";
import { GESTURE_SEQUENCE_PRESETS } from "../../apps/viewer/src/gestureSequences.js";
import { GESTURE_SEQUENCE_STORAGE_KEY } from "../../apps/viewer/src/gestureSequenceStorage.js";

describe("ActionPanel gesture sequences", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const values = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        get length() { return values.size; },
        clear: () => values.clear(),
        getItem: (key: string) => values.get(key) ?? null,
        key: (index: number) => [...values.keys()][index] ?? null,
        removeItem: (key: string) => { values.delete(key); },
        setItem: (key: string, value: string) => { values.set(key, value); }
      } satisfies Storage
    });
    window.localStorage.removeItem(GESTURE_SEQUENCE_STORAGE_KEY);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defines useful multi-step presets with edge navigation support", () => {
    expect(GESTURE_SEQUENCE_PRESETS.map((preset) => preset.id)).toEqual([
      "pull-refresh",
      "scroll-reveal",
      "back-settle",
      "carousel-scan"
    ]);
    expect(GESTURE_SEQUENCE_PRESETS.find((preset) => preset.id === "back-settle")?.steps[0]?.action).toEqual({
      kind: "edgeGesture",
      edge: "left",
      distance: "0.55",
      durationMs: "320"
    });
  });

  it("runs every sequence step in order and reports recorded evidence", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { actionId: "act_ok", ok: true, artifacts: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    await clickSequence("Run Pull to refresh");
    await waitForText("2 steps completed");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAction(fetchMock, 0)).toEqual({
      kind: "swipe",
      from: { x: 0.5, y: 0.24 },
      to: { x: 0.5, y: 0.78 },
      durationMs: 450
    });
    expect(requestAction(fetchMock, 1)).toEqual({ kind: "wait", durationMs: 800 });
    expect(container.textContent).toContain("Each action was saved to the evidence timeline");
  });

  it("stops a sequence after the first failed step", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(actionResponse("act_1", true))
      .mockResolvedValueOnce(actionResponse("act_2", false, "animation never settled"))
      .mockResolvedValueOnce(actionResponse("act_3", true));
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    await clickSequence("Run Carousel scan");
    await waitForText("Settle failed: animation never settled");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Carousel scan failed");
  });

  it("composes, edits, and runs a custom gesture flow", async () => {
    const fetchMock = vi.fn(async () => actionResponse("act_custom", true));
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    await clickButtonWithText("Compose a gesture sequence");
    expect(container.querySelectorAll(".sequence-step-list > li")).toHaveLength(3);
    await clickButtonByAriaLabel("Remove Second scroll");
    expect(container.querySelectorAll(".sequence-step-list > li")).toHaveLength(2);
    await clickButtonWithText("Run 2 steps");
    await waitForText("2 steps completed");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAction(fetchMock, 0)).toMatchObject({ kind: "swipe" });
    expect(requestAction(fetchMock, 1)).toEqual({ kind: "wait", durationMs: 250 });
  });

  it("saves, reloads, and removes a reusable gesture flow locally", async () => {
    renderPanel();

    await clickButtonWithText("Compose a gesture sequence");
    await clickButtonWithText("Save to flow library");
    expect(container.textContent).toContain("saved to this browser");
    expect(JSON.parse(window.localStorage.getItem(GESTURE_SEQUENCE_STORAGE_KEY) ?? "[]")).toHaveLength(1);
    expect(container.textContent).toContain("Update saved flow");

    await clickButtonWithText("Delete saved flow");
    expect(container.textContent).toContain("removed from this browser");
    expect(JSON.parse(window.localStorage.getItem(GESTURE_SEQUENCE_STORAGE_KEY) ?? "[]")).toEqual([]);
  });

  it("lets an operator stop a running sequence without sending later steps", async () => {
    const requestSignal: { current: AbortSignal | null } = { current: null };
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal.current = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal.current?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPanel();

    await clickSequence("Run Scroll and reveal");
    await waitForText("Stop sequence");
    await clickButtonWithText("Stop sequence");
    await waitForText("No further steps were sent to the daemon");

    expect(requestSignal.current?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  function renderPanel(): void {
    act(() => {
      root.render(
        <ActionPanel
          params={{ daemonUrl: "http://127.0.0.1:4317", sessionId: "sess_live" }}
          selectedSessionId="sess_live"
          mutationState={{ canSubmitActions: true, title: "Live memory session", detail: "Actions send to daemon.", tone: "good" }}
          form={DEFAULT_ACTION_FORM}
          onFieldChange={() => undefined}
        />
      );
    });
  }

  async function clickSequence(labelPrefix: string): Promise<void> {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.getAttribute("aria-label")?.startsWith(labelPrefix));
    if (!button) throw new Error(`Sequence button ${labelPrefix} not found`);
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  async function clickButtonWithText(value: string): Promise<void> {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(value));
    if (!button) throw new Error(`Button containing ${value} not found`);
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  async function clickButtonByAriaLabel(value: string): Promise<void> {
    const button = container.querySelector(`button[aria-label="${value}"]`);
    if (!button) throw new Error(`Button ${value} not found`);
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  async function waitForText(value: string): Promise<void> {
    for (let index = 0; index < 20; index += 1) {
      if (container.textContent?.includes(value)) return;
      await act(async () => Promise.resolve());
    }
    throw new Error(`Timed out waiting for ${value}`);
  }
});

function actionResponse(actionId: string, ok: boolean, message?: string): Response {
  return new Response(
    JSON.stringify({ ok: true, data: { actionId, ok, artifacts: [], ...(message ? { error: { message } } : {}) } }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function requestAction(fetchMock: ReturnType<typeof vi.fn>, index: number): unknown {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)).action;
}
