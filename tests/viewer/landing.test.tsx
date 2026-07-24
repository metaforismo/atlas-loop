// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { LandingPage } from "../../apps/viewer/src/LandingPage.js";

describe("LandingPage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("presents a clear path into the local viewer and the source repository", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => root.render(<LandingPage />));

    expect(container.querySelector("h1")?.textContent).toContain("RUNTIME SOURCE");
    expect(container.querySelector("a[href='/?sessionId=latest']")?.textContent).toContain("Launch");
    expect(container.querySelector("a[href='https://github.com/metaforismo/atlas-loop']")).not.toBeNull();
    expect(container.querySelector("a[aria-label='Atlas Loop home']")?.getAttribute("href")).toBe("/");
    expect(container.querySelector("a[href='#main-content']")?.textContent).toBe("Skip to content");
    expect(container.querySelector("img[src='/atlas-loop-mark.png']")).not.toBeNull();
    expect(container.querySelector("[aria-label='Atlas Loop product preview']")?.textContent).toContain("Checkout still works");
    expect(container.querySelector("[aria-label='Multi-gesture flow preview']")?.textContent).toContain("Navigate back");
    const atlasLink = [...container.querySelectorAll("a")].find((link) => link.getAttribute("href") === "/?sessionId=latest&view=atlas");
    expect(atlasLink?.textContent).toContain("Atlas map");

    act(() => root.unmount());
  });
});
