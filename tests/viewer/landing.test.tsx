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
    expect(container.querySelector("[role='group'][aria-label='Checkout running on an iPhone Simulator']")).not.toBeNull();
    expect(container.querySelector(".ios-device-island")).not.toBeNull();
    expect(container.querySelector("[role='tablist'][aria-label='Product preview modes']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Multi-gesture flow preview']")?.textContent).toContain("Two-finger tap");
    expect(container.querySelector("[aria-label='Observed app catalog preview']")?.textContent).toContain("Commerce Demo");
    const appLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=apps");
    expect(appLinks.some((link) => link.textContent?.includes("observed apps"))).toBe(true);
    expect(container.querySelector("[aria-label='Local session control plane preview']")?.textContent).toContain("XCUITest");
    const sessionLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=sessions");
    expect(sessionLinks.some((link) => link.textContent?.includes("session history"))).toBe(true);
    expect(container.querySelector("[aria-label='Readable local test compiler preview']")?.textContent).toContain("assertVisible");
    const testLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=tests");
    expect(testLinks.some((link) => link.textContent?.includes("local tests"))).toBe(true);
    expect(container.querySelector("[aria-label='Reusable local step module preview']")?.textContent).toContain("NO HIDDEN REF");
    const libraryLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=library");
    expect(libraryLinks.some((link) => link.textContent?.includes("module library"))).toBe(true);
    expect(container.textContent).toContain("Reuse steps without hiding them.");
    expect(container.querySelector("[aria-label='Reusable local workflow library preview']")?.textContent).toContain("Checkout recovery");
    const workflowLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=workflows");
    expect(workflowLinks.some((link) => link.textContent?.includes("workflow library"))).toBe(true);
    const atlasLink = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=overview&view=atlas");
    expect(atlasLink?.textContent).toContain("Atlas map");
    expect(container.querySelector("details.landing-mobile-menu")?.textContent).toContain("Evidence");
    expect(container.querySelector("details.landing-mobile-menu")?.textContent).toContain("Tests");
    expect(container.querySelector("details.landing-mobile-menu")?.textContent).toContain("Library");
    expect(container.querySelector(".landing-footer-links")?.textContent).toContain("Protocol");
    expect(container.querySelector("#quickstart")?.textContent).toContain("A useful first run in three steps");

    const gestureTab = [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((button) => button.textContent === "Native gestures")!;
    await act(async () => gestureTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(gestureTab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Pinch open");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Rotation 0.35 rad");
    expect(container.querySelector("[role='group'][aria-label='Gesture Lab running on an iPhone Simulator']")).not.toBeNull();

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
