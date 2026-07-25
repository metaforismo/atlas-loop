// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceLocationPanel } from "../../apps/viewer/src/components/DeviceLocationPanel.js";
import { LOCATION_PRESETS } from "../../packages/protocol/src/index.js";

import type { ActionMutationState } from "../../apps/viewer/src/components/ActionPanel.js";

const params = { daemonUrl: "http://127.0.0.1:4317", sessionId: "latest" };
const ready: ActionMutationState = { canSubmitActions: true, title: "Ready", detail: "Ready", tone: "good" };
const blocked: ActionMutationState = { canSubmitActions: false, title: "Ended", detail: "ended sessions are evidence only.", tone: "warn" };

describe("DeviceLocationPanel", () => {
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(mutationState = ready) {
    act(() => root.render(<DeviceLocationPanel params={params} selectedSessionId="sess_1" mutationState={mutationState} />));
  }

  /** Typed as `fetch` so call arguments keep their shape in assertions. */
  function stubFetch(body: unknown, status = 200) {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function requestBody(mock: ReturnType<typeof stubFetch>, index = 0): unknown {
    return JSON.parse(String(mock.mock.calls[index]?.[1]?.body));
  }

  function type(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector)!;
    return act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("offers every preset", () => {
    render();

    expect(container.querySelectorAll("option")).toHaveLength(LOCATION_PRESETS.length);
    expect(container.querySelector("option")?.textContent).toContain(LOCATION_PRESETS[0]!.label);
  });

  it("posts the preset id alongside the coordinate", async () => {
    const fetchMock = stubFetch({ ok: true, data: { actionId: "act_1", ok: true } });
    render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".device-location-actions button")!.click();
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/sessions/sess_1/location");
    expect(requestBody(fetchMock)).toEqual({
      location: { latitude: LOCATION_PRESETS[0]!.latitude, longitude: LOCATION_PRESETS[0]!.longitude },
      presetId: LOCATION_PRESETS[0]!.id
    });
  });

  it("clears the override by sending no location rather than 0,0", async () => {
    const fetchMock = stubFetch({ ok: true, data: { actionId: "act_1", ok: true } });
    render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".device-location-clear")!.click();
    });

    expect(requestBody(fetchMock)).toEqual({});
  });

  it("reports both bad axes together and blocks the request", async () => {
    // Typed so the unused-call assertion still knows the argument shape.
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    render();

    await type(".device-location-coords label:nth-child(1) input", "91");
    await type(".device-location-coords label:nth-child(2) input", "999");

    const errors = [...container.querySelectorAll(".device-location-errors li")].map((item) => item.textContent);
    expect(errors).toHaveLength(2);
    expect(container.querySelector<HTMLButtonElement>(".device-location-actions button")!.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches to the typed coordinate and disables the preset", async () => {
    const fetchMock = stubFetch({ ok: true, data: { actionId: "act_1", ok: true } });
    render();

    await type(".device-location-coords label:nth-child(1) input", "35.689487");
    await type(".device-location-coords label:nth-child(2) input", "139.691711");
    expect(container.querySelector<HTMLSelectElement>("select")!.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".device-location-actions button")!.click();
    });

    // A typed coordinate carries no preset id: it is not that named place.
    expect(requestBody(fetchMock)).toEqual({
      location: { latitude: 35.689487, longitude: 139.691711 }
    });
  });

  it("explains itself instead of offering a control that cannot run", () => {
    render(blocked);

    expect(container.querySelector<HTMLButtonElement>(".device-location-actions button")!.disabled).toBe(true);
    expect(container.querySelector(".device-location-status")?.textContent).toContain("evidence only");
  });

  it("surfaces a daemon rejection rather than reporting success", async () => {
    stubFetch({ ok: false, error: { code: "INVALID_REQUEST", message: "Latitude must be between -90 and 90." } }, 400);
    render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".device-location-actions button")!.click();
    });

    const status = container.querySelector(".device-location-status")!;
    expect(status.className).toContain("failed");
    expect(status.textContent).toContain("Latitude must be between");
  });
});
