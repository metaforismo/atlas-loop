// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceLogsPanel } from "../../apps/viewer/src/components/DeviceLogsPanel.js";
import type { DeviceLogEntry } from "../../packages/protocol/src/index.js";

const PARAMS = { daemonUrl: "http://127.0.0.1:4317", sessionId: "sess_logs" };

function entry(at: string, overrides: Partial<DeviceLogEntry> = {}): DeviceLogEntry {
  return { schemaVersion: "atlas-loop.device-log.v1", at, level: "default", message: "line", ...overrides };
}

const inStep = entry("2026-07-25T10:00:02.000Z", { level: "error", message: "failed inside the step" });
const outside = entry("2026-07-25T10:00:30.000Z", { level: "info", message: "logged between steps" });

function respond(body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true, data: body }), {
    status: 200,
    headers: { "content-type": "application/json" }
  }));
}

describe("DeviceLogsPanel", () => {
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

  async function render(body: unknown, selectedActionId?: string) {
    vi.stubGlobal("fetch", respond(body));
    await act(async () => {
      root.render(<DeviceLogsPanel params={PARAMS} sessionStatus="ended" selectedActionId={selectedActionId} />);
    });
    await act(async () => { await Promise.resolve(); });
  }

  const captured = {
    active: false,
    truncated: false,
    entries: [inStep, outside],
    alignment: { steps: [{ actionId: "act_1", entries: [inStep] }], unattributed: [outside] }
  };

  it("renders nothing when a run captured no logs", async () => {
    await render({ active: false, truncated: false, entries: [], alignment: { steps: [], unattributed: [] } });

    expect(container.querySelector(".device-logs")).toBeNull();
  });

  it("scopes to the selected step by default", async () => {
    // The point of the panel: the lines from the step that failed, not all lines.
    await render(captured, "act_1");

    expect(container.textContent).toContain("failed inside the step");
    expect(container.textContent).not.toContain("logged between steps");
    expect(container.querySelector(".device-logs-scope")?.textContent).toContain("1 of 2 lines");
  });

  it("shows the whole capture when the step scope is turned off", async () => {
    await render(captured, "act_1");
    const toggle = container.querySelector<HTMLInputElement>(".device-logs-scope input")!;

    // React tracks checkbox state internally, so assigning `.checked` and
    // firing `change` is ignored; a real click is what it listens for.
    await act(async () => toggle.click());

    expect(container.textContent).toContain("logged between steps");
  });

  it("offers no step scope when no step is selected", async () => {
    await render(captured);

    expect(container.querySelector(".device-logs-scope")).toBeNull();
    expect(container.textContent).toContain("logged between steps");
  });

  it("filters by level", async () => {
    await render(captured);
    const errors = [...container.querySelectorAll("button")].find((button) => button.textContent === "Errors")!;

    await act(async () => errors.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("failed inside the step");
    expect(container.textContent).not.toContain("logged between steps");
  });

  it("says when a capture was cut short rather than implying it is complete", async () => {
    await render({ ...captured, truncated: true });

    expect(container.querySelector(".device-logs-truncated")?.textContent).toContain("partial");
  });

  it("survives a daemon with no logs route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await act(async () => {
      root.render(<DeviceLogsPanel params={PARAMS} sessionStatus="ended" />);
    });

    expect(container.querySelector(".device-logs")).toBeNull();
  });
});
