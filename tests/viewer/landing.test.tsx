// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "../../apps/viewer/src/LandingPage.js";

describe("LandingPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("presents a clear path into the local viewer and an interactive product preview", async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(<LandingPage />));

    expect(container.querySelector("h1")?.textContent).toContain("RUNTIME SOURCE");
    const overviewLink = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=overview");
    expect(overviewLink?.textContent).toContain("Launch");
    expect(container.querySelector("a[href='https://github.com/metaforismo/atlas-loop']")).not.toBeNull();
    expect(container.querySelector("a[aria-label='Atlas Loop home']")?.getAttribute("href")).toBe("/");
    expect(container.querySelector("a[href='#main-content']")?.textContent).toBe("Skip to content");
    expect(container.querySelector("img[src='/atlas-loop-mark.png']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Checkout still works");
    expect(container.querySelector("[role='tablist'][aria-label='Product preview modes']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Multi-gesture flow preview']")?.textContent).toContain("Navigate back");
    const atlasLink = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=overview&view=atlas");
    expect(atlasLink?.textContent).toContain("Atlas map");
    expect(container.querySelector("details.landing-mobile-menu")?.textContent).toContain("Evidence");
    expect(container.querySelector(".landing-footer-links")?.textContent).toContain("Protocol");
    expect(container.querySelector("#quickstart")?.textContent).toContain("A useful first run in three steps");

    const gestureTab = [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((button) => button.textContent === "Native gestures")!;
    await act(async () => gestureTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(gestureTab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Pinch open");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Rotation 0.35 rad");

    const clipboardWrite = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: clipboardWrite } });
    const quickstartSection = container.querySelector<HTMLElement>("#quickstart")!;
    const startTab = [...quickstartSection.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((button) => button.textContent?.includes("Start"))!;
    await act(async () => startTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    const copyButton = [...quickstartSection.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Copy commands")!;
    await act(async () => copyButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(clipboardWrite).toHaveBeenCalledWith(expect.stringContaining("npm run daemon -- --port 4317"));
    expect(container.querySelector("#quickstart-command-panel")?.textContent).toContain("Commands copied to clipboard");

    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: undefined });
    const observeTab = [...quickstartSection.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((button) => button.textContent?.includes("Observe"))!;
    await act(async () => observeTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    const unavailableCopyButton = [...quickstartSection.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Copy commands")!;
    await act(async () => unavailableCopyButton.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(container.querySelector("#quickstart-command-panel")?.textContent).toContain("Clipboard blocked");

    act(() => root.unmount());
    Reflect.deleteProperty(window.navigator, "clipboard");
  });
});
