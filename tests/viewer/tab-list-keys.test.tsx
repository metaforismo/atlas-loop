// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PanelTabs } from "../../apps/viewer/src/components/PanelTabs.js";

let container: HTMLDivElement;
let root: Root;
let selected: string;

const TABS = ["one", "two", "three"] as const;

async function render(initial: string = "one"): Promise<void> {
  selected = initial;
  const rerender = async (): Promise<void> => {
    await act(async () => {
      root.render(
        <PanelTabs
          label="Section"
          selected={selected}
          onSelect={(id) => {
            selected = id;
            void rerender();
          }}
          tabs={TABS.map((id) => ({ id, label: id, body: <p>{id} body</p> }))}
        />
      );
    });
  };
  await rerender();
}

function tabs(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

async function press(key: string): Promise<void> {
  await act(async () => {
    container
      .querySelector('[role="tablist"]')!
      .dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
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
});

describe("moving between tabs from the keyboard", () => {
  it("is one tab stop, not one per tab", async () => {
    // A roving tabindex: reaching the panel below should not mean tabbing
    // through every tab heading first.
    await render();

    expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves with the arrow keys", async () => {
    await render();

    await press("ArrowRight");
    expect(selected).toBe("two");

    await press("ArrowLeft");
    expect(selected).toBe("one");
  });

  it("wraps at both ends, so either is reachable from either direction", async () => {
    await render("one");
    await press("ArrowLeft");
    expect(selected).toBe("three");

    await render("three");
    await press("ArrowRight");
    expect(selected).toBe("one");
  });

  it("jumps to the ends with Home and End", async () => {
    await render("two");

    await press("End");
    expect(selected).toBe("three");

    await press("Home");
    expect(selected).toBe("one");
  });

  it("moves focus with the selection, or the keyboard would leave it behind", async () => {
    await render();

    await press("ArrowRight");

    expect(document.activeElement).toBe(tabs()[1]);
  });

  it("leaves other keys to the browser", async () => {
    await render();

    await press("a");
    await press("Tab");

    expect(selected).toBe("one");
  });

  it("shows one panel at a time and keeps the rest mounted", async () => {
    await render();

    const panels = [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(panels).toHaveLength(3);
    expect(panels.filter((panel) => !panel.hidden).map((panel) => panel.textContent)).toEqual(["one body"]);
  });

  it("wires each tab to the panel it controls", async () => {
    await render();

    const [tab] = tabs();
    expect(tab!.getAttribute("aria-controls")).toBe("panel-tabpanel-one");
    expect(container.querySelector("#panel-tabpanel-one")?.getAttribute("aria-labelledby")).toBe(tab!.id);
    expect(tab!.getAttribute("aria-selected")).toBe("true");
  });
});
