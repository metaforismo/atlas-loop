// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EvidencePanels } from "../../apps/viewer/src/components/EvidencePanels.js";
import type { ViewerParams } from "../../apps/viewer/src/types.js";

const params: ViewerParams = { daemonUrl: "http://127.0.0.1:4317", sessionId: "sess_1" };

let container: HTMLDivElement;
let root: Root;

function exchange(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    startedAt: "2026-07-25T10:00:00.000Z",
    method: "GET",
    scheme: "https",
    host: "api.example.com",
    port: 443,
    path: "/v1/catalog",
    status: 200,
    requestBytes: 10,
    responseBytes: 20,
    durationMs: 30,
    ...overrides
  };
}

/** Routes each panel's fetch to its own fixture, keyed by the URL it asks for. */
function respondWith(routes: { metrics?: unknown; network?: unknown; state?: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const pick = url.includes("/network") ? routes.network : url.includes("/state") ? routes.state : routes.metrics;
    if (pick === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify({ ok: true, data: pick }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }));
}

async function render(): Promise<void> {
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(<EvidencePanels params={params} session={undefined} events={[]} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function tabs(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(".evidence-tabs button")];
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("the evidence tabs", () => {
  it("offers no tabs when the run recorded none of these streams", async () => {
    respondWith({});
    await render();

    expect(tabs()).toHaveLength(0);
    expect(container.querySelector(".evidence-panels")?.className).toContain("empty");
  });

  it("offers a tab only for a stream that recorded something", async () => {
    // A run that never captured network or container state should not be shown
    // two empty tabs implying it did.
    respondWith({
      metrics: { active: false, samples: [{ at: "2026-07-25T10:00:00.000Z", cpuPercent: 1, rssBytes: 100 }] }
    });
    await render();

    expect(tabs().map((tab) => tab.textContent)).toEqual(["Metrics1"]);
  });

  it("carries each stream's headline on its tab", async () => {
    respondWith({
      metrics: { active: false, samples: [{ at: "2026-07-25T10:00:00.000Z", cpuPercent: 1, rssBytes: 100 }] },
      network: {
        active: true,
        receiving: true,
        exchanges: [exchange("a"), exchange("b", { status: 503 })],
        alignment: { steps: [], unattributed: [] }
      }
    });
    await render();

    const network = tabs().find((tab) => tab.textContent?.startsWith("Network"))!;
    expect(network.querySelector(".evidence-count")?.textContent).toBe("2");
    // One of the two was refused, and that is worth seeing without opening it.
    expect(network.querySelector(".evidence-attention")?.textContent).toBe("1");
  });

  it("does not mark a stream that has nothing wrong", async () => {
    respondWith({
      network: {
        active: true,
        receiving: true,
        exchanges: [exchange("a")],
        alignment: { steps: [], unattributed: [] }
      }
    });
    await render();

    expect(container.querySelector(".evidence-attention")).toBeNull();
  });

  it("shows one stream at a time and switches on click", async () => {
    respondWith({
      metrics: { active: false, samples: [{ at: "2026-07-25T10:00:00.000Z", cpuPercent: 1, rssBytes: 100 }] },
      network: { active: true, receiving: true, exchanges: [exchange("a")], alignment: { steps: [], unattributed: [] } }
    });
    await render();

    const visible = () =>
      [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
        .filter((panel) => !panel.hidden)
        .map((panel) => panel.id);

    expect(visible()).toEqual(["evidence-body-metrics"]);

    await act(async () => {
      tabs().find((tab) => tab.textContent?.startsWith("Network"))!.click();
    });

    expect(visible()).toEqual(["evidence-body-network"]);
  });

  it("keeps the hidden streams mounted, so their polling and filters survive", async () => {
    // Unmounting on every tab switch would restart the daemon polling and throw
    // away whatever the operator had filtered to.
    respondWith({
      metrics: { active: false, samples: [{ at: "2026-07-25T10:00:00.000Z", cpuPercent: 1, rssBytes: 100 }] },
      network: { active: true, receiving: true, exchanges: [exchange("a")], alignment: { steps: [], unattributed: [] } }
    });
    await render();

    const hidden = container.querySelector<HTMLElement>("#evidence-body-network")!;
    expect(hidden.hidden).toBe(true);
    expect(hidden.querySelector(".network-panel")).not.toBeNull();
  });

  it("falls back to a stream that exists when the selected one has nothing", async () => {
    respondWith({
      network: { active: true, receiving: true, exchanges: [exchange("a")], alignment: { steps: [], unattributed: [] } }
    });
    await render();

    // Metrics is the default selection but recorded nothing, so Network shows.
    expect(tabs()[0]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs()[0]!.textContent).toContain("Network");
  });

  it("wires each tab to the panel it controls", async () => {
    respondWith({
      metrics: { active: false, samples: [{ at: "2026-07-25T10:00:00.000Z", cpuPercent: 1, rssBytes: 100 }] }
    });
    await render();

    const tab = tabs()[0]!;
    expect(tab.getAttribute("role")).toBe("tab");
    expect(tab.getAttribute("aria-controls")).toBe("evidence-body-metrics");
    expect(container.querySelector("#evidence-body-metrics")?.getAttribute("aria-labelledby")).toBe(tab.id);
  });
});
