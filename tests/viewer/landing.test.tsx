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
    expect(container.querySelector(".ios-device-button-camera-control")).not.toBeNull();
    expect(container.querySelectorAll(".ios-device-button")).toHaveLength(5);
    expect(container.querySelectorAll(".ios-device-antenna")).toHaveLength(4);
    expect(container.querySelector(".ios-device")?.getAttribute("data-device")).toBe("iphone-16-pro");
    expect(container.querySelector(".preview-status-bar")?.textContent).toContain("9:41");
    expect(container.querySelector("[role='tablist'][aria-label='Product preview modes']")).not.toBeNull();
    // Three parts, each with one lead visual; supporting capabilities keep
    // their claim and link but give up the full-width visual.
    expect(container.querySelectorAll(".landing-chapter")).toHaveLength(3);
    expect(container.querySelectorAll(".landing-feature-visual")).toHaveLength(3);
    expect(container.querySelectorAll(".landing-theme-support")).toHaveLength(3);
    expect([...container.querySelectorAll(".landing-chapter")].map((chapter) => chapter.id)).toEqual([
      "runtime",
      "tests",
      "evidence"
    ]);

    expect(container.querySelector("[aria-label='Readable local test compiler preview']")?.textContent).toContain("assertVisible");
    const testLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=tests");
    expect(testLinks.some((link) => link.textContent?.includes("local tests"))).toBe(true);

    // Demoted capabilities keep their claim and their deep link.
    const supportText = [...container.querySelectorAll(".landing-theme-support")].map((node) => node.textContent).join(" ");
    expect(supportText).toContain("Test motion, not just destinations");
    expect(supportText).toContain("Put the device somewhere");
    expect(supportText).toContain("Reuse the steps and the startup state");
    expect(supportText).toContain("File the issue from the failure");
    const libraryLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=library");
    expect(libraryLinks.some((link) => link.textContent?.includes("local library"))).toBe(true);
    const appLinks = [...container.querySelectorAll("a")].filter((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=apps");
    expect(appLinks.some((link) => link.textContent?.includes("observed apps"))).toBe(true);

    // Every in-page nav link must resolve to a section that exists.
    const anchors = [...container.querySelectorAll("a")]
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("#"));
    expect(anchors.length).toBeGreaterThan(0);
    for (const href of anchors) {
      expect(container.querySelector(href), `${href} has no target`).not.toBeNull();
    }

    const atlasLink = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/?sessionId=latest&workspace=overview&view=atlas");
    expect(atlasLink?.textContent).toContain("Atlas map");
    expect(container.querySelector("details.landing-mobile-menu")?.textContent).toContain("Prove");
    expect(container.querySelector(".landing-footer-links")?.textContent).toContain("Protocol");
    expect(container.querySelector("#quickstart")?.textContent).toContain("A useful first run in three steps");

    const gestureTab = [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((button) => button.textContent === "Native gestures")!;
    await act(async () => gestureTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(gestureTab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Pinch open");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Rotation 0.35 rad");
    expect(container.querySelector("[role='group'][aria-label='Gesture Lab running on an iPhone Simulator']")).not.toBeNull();

    const monitorTab = [...container.querySelectorAll<HTMLButtonElement>("[role='tab']")].find((button) => button.textContent === "Live monitor")!;
    await act(async () => monitorTab.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(monitorTab.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Every run stays in sight");
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Checkout regression");
    expect(container.querySelector("[role='group'][aria-label='Runtime Watch running on an iPhone Simulator']")).not.toBeNull();

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
