// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ImageLightbox } from "../../apps/viewer/src/components/ImageLightbox.js";
import {
  containerPointToContent,
  IDENTITY_TRANSFORM,
  MAX_LIGHTBOX_SCALE,
  panBy,
  zoomAt
} from "../../apps/viewer/src/imageTransform.js";

describe("image transform math", () => {
  it("keeps the anchor point stationary while zooming", () => {
    const anchor = { x: 120, y: 200 };
    const before = containerPointToContent(IDENTITY_TRANSFORM, anchor.x, anchor.y);

    const zoomedIn = zoomAt(IDENTITY_TRANSFORM, anchor.x, anchor.y, 2);
    const after = containerPointToContent(zoomedIn, anchor.x, anchor.y);

    expect(zoomedIn.scale).toBe(2);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);

    // Repeated zooms keep the invariant through accumulated transforms.
    const zoomedTwice = zoomAt(zoomedIn, anchor.x, anchor.y, 1.5);
    const afterTwice = containerPointToContent(zoomedTwice, anchor.x, anchor.y);
    expect(afterTwice.x).toBeCloseTo(before.x, 6);
    expect(afterTwice.y).toBeCloseTo(before.y, 6);
  });

  it("clamps zoom to the configured range and no-ops at the bounds", () => {
    const maxed = zoomAt(IDENTITY_TRANSFORM, 0, 0, 100);
    expect(maxed.scale).toBe(MAX_LIGHTBOX_SCALE);

    const stillMaxed = zoomAt(maxed, 50, 50, 2);
    expect(stillMaxed).toBe(maxed);

    const floored = zoomAt(IDENTITY_TRANSFORM, 10, 10, 0.01);
    expect(floored).toBe(IDENTITY_TRANSFORM);
  });

  it("pans additively and no-ops on zero deltas", () => {
    const panned = panBy(panBy(IDENTITY_TRANSFORM, 10, -5), 2, 3);
    expect(panned).toMatchObject({ x: 12, y: -2, scale: 1 });
    expect(panBy(panned, 0, 0)).toBe(panned);
  });
});

describe("ImageLightbox", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
  });

  it("renders the image, closes on Escape and on backdrop click", () => {
    let closed = 0;

    act(() => {
      root!.render(<ImageLightbox src="data:image/png;base64,Zg==" alt="shot" caption="screenshots/x.png" onClose={() => (closed += 1)} />);
    });

    const img = container.querySelector<HTMLImageElement>(".lightbox-frame img");
    expect(img).not.toBeNull();
    expect(container.textContent).toContain("screenshots/x.png");
    expect(container.textContent).toContain("100%");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(closed).toBe(1);

    act(() => {
      container.querySelector<HTMLDivElement>(".lightbox-backdrop")!.click();
    });
    expect(closed).toBe(2);

    // Clicks inside the panel do not close.
    act(() => {
      container.querySelector<HTMLDivElement>(".lightbox-panel")!.click();
    });
    expect(closed).toBe(2);
  });

  it("moves focus into the dialog, traps Tab, locks scroll, and restores focus", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open image";
    document.body.prepend(trigger);
    trigger.focus();

    act(() => {
      root!.render(<ImageLightbox src="data:image/png;base64,Zg==" alt="shot" onClose={() => undefined} />);
    });

    const reset = container.querySelector<HTMLButtonElement>(".lightbox-toolbar button:first-of-type")!;
    const close = container.querySelector<HTMLButtonElement>("[aria-label='Close zoomed view']")!;
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    });
    expect(document.activeElement).toBe(reset);

    act(() => root!.unmount());
    root = undefined;
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
    trigger.remove();
  });
});
