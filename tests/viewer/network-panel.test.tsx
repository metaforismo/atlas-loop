// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NetworkPanel } from "../../apps/viewer/src/components/NetworkPanel.js";
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
    requestBytes: 100,
    responseBytes: 2048,
    durationMs: 180,
    ...overrides
  };
}

function view(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      active: false,
      receiving: true,
      truncated: false,
      exchanges: [],
      alignment: { steps: [], unattributed: [] },
      ...overrides
    }
  };
}

/** Mounts fresh: the panel fetches from an effect keyed on the session. */
async function render(payload: unknown, props: Record<string, unknown> = {}): Promise<void> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  })));
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(<NetworkPanel params={params} sessionStatus="ended" {...props} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
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

describe("the network panel", () => {
  it("stays out of the way when there is no capture at all", async () => {
    await render(view());

    expect(container.querySelector(".network-panel")).toBeNull();
  });

  it("appears to explain a running capture that nothing has reached", async () => {
    // Silence here means the traffic is not routed to the proxy, which is a
    // very different claim from "the app made no requests".
    await render(view({ active: true, receiving: false, proxyUrl: "http://127.0.0.1:8899" }));

    const caveat = container.querySelector(".network-caveat")?.textContent ?? "";
    expect(caveat).toContain("nothing has reached it yet");
    expect(caveat).toContain("not evidence the app stayed quiet");
    expect(container.querySelector(".network-caveat code")?.textContent).toBe("http://127.0.0.1:8899");
  });

  it("does not warn once traffic is arriving", async () => {
    await render(view({ active: true, receiving: true, exchanges: [exchange("a")] }));

    expect(container.querySelector(".network-caveat")).toBeNull();
  });

  it("lists a request with what came back and how long it took", async () => {
    await render(view({ exchanges: [exchange("a", { method: "POST", path: "/v1/orders", durationMs: 2400 })] }));

    const row = container.querySelector(".network-rows li");
    expect(row?.querySelector(".network-method")?.textContent).toBe("POST");
    expect(row?.querySelector(".network-target")?.textContent).toBe("api.example.com/v1/orders");
    expect(row?.querySelector(".network-status")?.textContent).toBe("200");
    expect(row?.querySelector(".network-timing")?.textContent).toBe("2.4s");
  });

  it("separates a refused request from one that never arrived", async () => {
    await render(view({
      exchanges: [
        exchange("ok"),
        exchange("refused", { status: 500 }),
        exchange("lost", { status: undefined, error: "socket hang up" })
      ]
    }));

    const rows = [...container.querySelectorAll(".network-rows li")];
    expect(rows.map((row) => row.className)).toEqual(["tone-good", "tone-bad", "tone-bad"]);
    expect(rows[2]!.querySelector(".network-status")?.textContent).toBe("failed");
  });

  it("labels a tunnel it could not read inside", async () => {
    await render(view({
      exchanges: [exchange("t", { tunnelled: true, status: undefined, path: "", method: "CONNECT" })]
    }));

    const row = container.querySelector(".network-rows li");
    expect(row?.querySelector(".network-status")?.textContent).toBe("tunnel");
    expect(row?.querySelector(".network-target")?.textContent).toBe("api.example.com:443");
  });

  it("says a request carried a credential without storing it", async () => {
    await render(view({ exchanges: [exchange("a", { redactedHeaders: ["authorization"] })] }));

    const badge = container.querySelector(".network-redacted");
    expect(badge?.textContent).toBe("redacted");
    expect(badge?.getAttribute("title")).toContain("authorization");
    expect(container.innerHTML).not.toContain("Bearer");
  });

  it("narrows to problems on request", async () => {
    await render(view({
      exchanges: [exchange("ok"), exchange("bad", { status: 503, path: "/v1/orders" })]
    }));

    const problems = [...container.querySelectorAll<HTMLButtonElement>(".network-kinds button")]
      .find((button) => button.textContent === "Problems")!;
    await act(async () => {
      problems.click();
    });

    expect([...container.querySelectorAll(".network-target")].map((node) => node.textContent)).toEqual([
      "api.example.com/v1/orders"
    ]);
  });

  it("scopes to the selected step by default, and can be widened", async () => {
    const payload = view({
      exchanges: [exchange("a"), exchange("b", { path: "/v1/orders" })],
      alignment: { steps: [{ actionId: "act_1", exchanges: [exchange("b", { path: "/v1/orders" })] }], unattributed: [] }
    });
    await render(payload, { selectedActionId: "act_1" });

    expect(container.querySelectorAll(".network-rows li")).toHaveLength(1);

    const checkbox = container.querySelector<HTMLInputElement>(".network-scope input")!;
    await act(async () => {
      checkbox.click();
    });

    expect(container.querySelectorAll(".network-rows li")).toHaveLength(2);
  });

  it("offers no step scope when the selected step made no requests", async () => {
    await render(view({ exchanges: [exchange("a")] }), { selectedActionId: "act_none" });

    // The checkbox is still offered, showing zero of the run's requests, rather
    // than silently widening to everything and implying the step did it.
    expect(container.querySelector(".network-scope")?.textContent).toContain("0 of 1 request");
  });

  it("names the slowest request when there is more than one", async () => {
    await render(view({
      exchanges: [exchange("a", { durationMs: 120 }), exchange("b", { path: "/v1/slow", durationMs: 3200 })]
    }));

    const footnote = container.querySelector(".network-footnote")?.textContent ?? "";
    expect(footnote).toContain("api.example.com/v1/slow");
    expect(footnote).toContain("3.2s");
  });

  it("says so when a filter matches nothing", async () => {
    await render(view({ exchanges: [exchange("a")] }));

    const search = container.querySelector<HTMLInputElement>(".search-field input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "nothing-matches-this");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelector(".network-empty")?.textContent).toBe("No requests match.");
  });

  it("survives a daemon that does not serve the route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await act(async () => {
      root.render(<NetworkPanel params={params} sessionStatus="ended" />);
    });

    expect(container.querySelector(".network-panel")).toBeNull();
  });
});
