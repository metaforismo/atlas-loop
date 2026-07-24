// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StartSessionPopover } from "../../apps/viewer/src/components/StartSessionPopover.js";
import type { LocalLaunchProfile } from "../../apps/viewer/src/localLaunchProfiles.js";
import type { Session } from "../../apps/viewer/src/types.js";

describe("StartSessionPopover", () => {
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
    vi.unstubAllGlobals();
  });

  it("creates a real daemon session and hands its id back to the workspace", async () => {
    const onStarted = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/launch")) {
        expect(JSON.parse(String(init?.body))).toEqual({ bundleId: "app.atlasloop.CommerceDemo" });
        return new Response(JSON.stringify({ ok: true, data: { actionId: "act_launch", ok: true, artifacts: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, data: { id: "sess_started", status: "created" } }), {
          status: 201,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: true, data: { id: "sess_started", status: "running" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render({ onStarted });

    await click("Start session");
    const device = container.querySelector<HTMLInputElement>("input[placeholder='Auto-select booted Simulator']")!;
    await act(async () => {
      device.value = "iPhone 16 Pro";
      device.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Start local session");
    await waitFor(() => onStarted.mock.calls.length === 1);

    expect(onStarted).toHaveBeenCalledWith(expect.objectContaining({ id: "sess_started" }));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("keeps the launcher inspectable while preventing creation when the daemon is offline", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render({ disabled: true });

    await click("Start session");
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Daemon offline"));
    expect(submit?.hasAttribute("disabled")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts an in-flight session request when the launcher closes", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render();

    await click("Start session");
    await click("Start local session");
    await waitFor(() => fetchMock.mock.calls.length === 1);
    const close = container.querySelector<HTMLButtonElement>("button[aria-label='Close session launcher']")!;
    await act(async () => close.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

    expect(requestSignal?.aborted).toBe(true);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("opens from an external workspace quick action", async () => {
    render({ openRequest: 0 });
    render({ openRequest: 1 });

    expect(container.querySelector("[role='dialog'][aria-label='Start local Simulator session']")).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector("input[placeholder='Auto-select booted Simulator']"));
  });

  it("prefills a previously observed bundle without starting a session", async () => {
    render({ openRequest: 0 });
    render({ openRequest: 1, requestedBundleId: " dev.lantern.payments " });

    expect(container.querySelector<HTMLInputElement>("input[placeholder='app.example.YourApp']")?.value).toBe("dev.lantern.payments");
    expect(container.querySelector("[role='dialog']")).not.toBeNull();
  });

  it("prefills a launch profile and sends its exact arguments and environment once", async () => {
    const launchBodies: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/launch")) {
        launchBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true, data: { actionId: "act_launch", ok: true, artifacts: [] } }), { status: 200 });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, data: { id: "sess_profile", status: "created" } }), { status: 201 });
      }
      return new Response(JSON.stringify({ ok: true, data: { id: "sess_profile", status: "running" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const requestedLaunchProfile: LocalLaunchProfile = {
      id: "gesture-lab",
      label: "Gesture Lab",
      detail: "Native canvas",
      bundleId: "app.atlasloop.CommerceDemo",
      arguments: ["--uitesting"],
      environment: { ATLAS_LOOP_DEMO_ROUTE: "gesture-lab" }
    };

    render({ openRequest: 1, requestedLaunchProfile });
    expect(container.textContent).toContain("LAUNCH PROFILE");
    expect(container.textContent).toContain("1 arguments · 1 environment");
    await click("Start local session");
    await waitFor(() => launchBodies.length === 1);

    expect(launchBodies).toEqual([{
      bundleId: "app.atlasloop.CommerceDemo",
      arguments: ["--uitesting"],
      environment: { ATLAS_LOOP_DEMO_ROUTE: "gesture-lab" }
    }]);
  });

  function render(overrides: { disabled?: boolean; onStarted?: (session: Session) => void; openRequest?: number; requestedBundleId?: string; requestedLaunchProfile?: LocalLaunchProfile } = {}): void {
    act(() => root.render(
      <StartSessionPopover
        daemonUrl="http://127.0.0.1:4317"
        disabled={overrides.disabled ?? false}
        disabledReason="Start the daemon first."
        onStarted={overrides.onStarted ?? vi.fn()}
        openRequest={overrides.openRequest}
        requestedBundleId={overrides.requestedBundleId}
        requestedLaunchProfile={overrides.requestedLaunchProfile}
      />
    ));
  }

  async function click(text: string): Promise<void> {
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
    if (!button) throw new Error(`Button ${text} not found`);
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  }

  async function waitFor(predicate: () => boolean): Promise<void> {
    for (let index = 0; index < 20; index += 1) {
      if (predicate()) return;
      await act(async () => Promise.resolve());
    }
    throw new Error("Timed out waiting for session creation");
  }
});
