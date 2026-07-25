// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SessionStatePanel } from "../../apps/viewer/src/components/SessionStatePanel.js";
import type { ViewerParams } from "../../apps/viewer/src/types.js";

const params: ViewerParams = { daemonUrl: "http://127.0.0.1:4317", sessionId: "sess_1" };

let container: HTMLDivElement;
let root: Root;

function change(path: string, kind: "added" | "removed" | "modified", overrides: Record<string, unknown> = {}) {
  return {
    path,
    kind,
    area: path.startsWith("Documents/") ? "documents" : "other",
    sizeDelta: kind === "removed" ? -10 : 10,
    evidence: "hash",
    ...overrides
  };
}

function captureView(captures: unknown[]) {
  return { ok: true, data: { bundleId: "app.atlasloop.CommerceDemo", captures } };
}

function capture(id: string, label: string, diff: unknown) {
  return {
    artifactId: id,
    label,
    snapshot: { capturedAt: "2026-07-25T10:00:00.000Z", entryCount: 3, skippedAreas: [], truncated: false },
    diff
  };
}

function diff(changes: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    before: { capturedAt: "2026-07-25T10:00:00.000Z", entryCount: 2 },
    after: { capturedAt: "2026-07-25T10:00:05.000Z", entryCount: 3 },
    changes,
    skippedAreas: [],
    truncated: false,
    ...overrides
  };
}

/**
 * Mounts fresh each time: the panel fetches from an effect keyed on the session,
 * so re-rendering the same root with a new payload would keep the first one.
 */
async function render(payload: unknown): Promise<void> {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" }
  })));
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(<SessionStatePanel params={params} sessionStatus="ended" />);
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

describe("the stored data panel", () => {
  it("stays out of the way when nothing was captured", async () => {
    await render(captureView([]));

    expect(container.querySelector(".session-state")).toBeNull();
  });

  it("says what changed since the previous capture", async () => {
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([change("Documents/orders.json", "added")]))
    ]));

    const text = container.textContent ?? "";
    expect(text).toContain("1 added");
    expect(container.querySelector(".session-state-path")?.textContent).toBe("Documents/orders.json");
  });

  it("shows the newest capture without being asked", async () => {
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([change("Documents/orders.json", "added")]))
    ]));

    expect(container.querySelector(".session-state-captures .selected")?.textContent).toContain("after");
  });

  it("does not present a first capture as an empty diff", async () => {
    // Nothing to compare against is not the same as nothing having changed.
    await render(captureView([capture("art_1", "start", null)]));

    expect(container.textContent).toContain("nothing to compare against");
    expect(container.textContent).not.toContain("Nothing changed on disk");
  });

  it("reports an untouched container as untouched", async () => {
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([]))
    ]));

    expect(container.textContent).toContain("Nothing changed on disk");
  });

  it("warns when part of the container was not walked", async () => {
    // Otherwise "nothing changed" would overstate what the capture looked at.
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([], { skippedAreas: ["caches", "temporary"] }))
    ]));

    const caveat = container.querySelector(".session-state-caveat")?.textContent ?? "";
    expect(caveat).toContain("Caches and Temporary were not walked");
  });

  it("warns when the capture hit its limit", async () => {
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([change("Documents/a", "added")], { truncated: true }))
    ]));

    expect(container.querySelector(".session-state-caveat")?.textContent).toContain("file limit");
  });

  it("marks a change it could only infer", async () => {
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([
        change("Documents/big.bin", "modified", { evidence: "timestamp" }),
        change("Documents/orders.json", "added")
      ]))
    ]));

    const evidence = container.querySelectorAll(".session-state-evidence");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.textContent).toBe("inferred");
  });

  it("switches to another capture when one is picked", async () => {
    await render(captureView([
      capture("art_1", "one", null),
      capture("art_2", "two", diff([change("Documents/orders.json", "added")]))
    ]));

    const first = container.querySelectorAll<HTMLButtonElement>(".session-state-captures button")[0]!;
    await act(async () => {
      first.click();
    });

    expect(container.textContent).toContain("nothing to compare against");
  });

  it("offers an area filter only when more than one area changed", async () => {
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([change("Documents/orders.json", "added")]))
    ]));
    expect(container.querySelector(".session-state-areas")).toBeNull();

    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([
        change("Documents/orders.json", "added"),
        change("Library/other.bin", "added")
      ]))
    ]));
    const filters = [...container.querySelectorAll(".session-state-areas button")].map((button) => button.textContent);
    expect(filters).toEqual(["All", "Documents", "Other"]);
  });

  it("narrows the list to the chosen area", async () => {
    await render(captureView([
      capture("art_1", "before", null),
      capture("art_2", "after", diff([
        change("Documents/orders.json", "added"),
        change("Library/other.bin", "added")
      ]))
    ]));

    const documents = [...container.querySelectorAll<HTMLButtonElement>(".session-state-areas button")]
      .find((button) => button.textContent === "Documents")!;
    await act(async () => {
      documents.click();
    });

    expect([...container.querySelectorAll(".session-state-path")].map((node) => node.textContent)).toEqual([
      "Documents/orders.json"
    ]);
  });

  it("survives a daemon that does not serve the route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await act(async () => {
      root.render(<SessionStatePanel params={params} sessionStatus="ended" />);
    });

    expect(container.querySelector(".session-state")).toBeNull();
  });
});
