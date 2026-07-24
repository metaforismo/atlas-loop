// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCommandMenu } from "../../apps/viewer/src/components/WorkspaceCommandMenu.js";

describe("WorkspaceCommandMenu", () => {
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
  });

  it("opens from the platform shortcut, filters commands, and selects a destination", async () => {
    const onSelect = vi.fn();
    act(() => root.render(<WorkspaceCommandMenu onSelect={onSelect} />));

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })));
    const input = container.querySelector<HTMLInputElement>("input[placeholder^='Search apps']")!;
    expect(input).not.toBeNull();
    await setInput(input, "atlas");
    const command = [...container.querySelectorAll(".command-menu-results button")].find((button) => button.textContent?.includes("Open Atlas map"));
    expect(command).not.toBeUndefined();
    expect(container.textContent).not.toContain("Open workflow library");
    await act(async () => command?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));

    expect(onSelect).toHaveBeenCalledWith("atlas");
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("matches natural plural workspace queries", async () => {
    act(() => root.render(<WorkspaceCommandMenu onSelect={vi.fn()} />));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })));
    const input = container.querySelector<HTMLInputElement>("input[placeholder^='Search apps']")!;
    await setInput(input, "actions");
    expect(container.textContent).toContain("Run an action");
  });

  it("supports arrow-key discovery and Enter selection", async () => {
    const onSelect = vi.fn();
    act(() => root.render(<WorkspaceCommandMenu onSelect={onSelect} />));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })));

    const input = container.querySelector<HTMLInputElement>("input[role='combobox']")!;
    expect(input.getAttribute("aria-activedescendant")).toBe("workspace-command-overview");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(input.getAttribute("aria-activedescendant")).toBe("workspace-command-tests");
    expect(container.querySelector("#workspace-command-tests")?.getAttribute("aria-selected")).toBe("true");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(onSelect).toHaveBeenCalledWith("tests");
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  async function setInput(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
  }
});
