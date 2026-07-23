// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenshotView } from "../../apps/viewer/src/components/ScreenshotView.js";

describe("ScreenshotView empty recovery", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("offers a direct recovery action for an unavailable screenshot", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const recover = vi.fn();

    act(() => {
      root.render(
        <ScreenshotView
          screenshot={{ status: "error", message: "Failed to fetch" }}
          emptyAction={{ label: "Connection settings", onSelect: recover }}
          onTapTarget={() => undefined}
        />
      );
    });

    const action = container.querySelector<HTMLButtonElement>(".screenshot-empty-action")!;
    expect(container.querySelector("[role='status']")?.textContent).toContain("Screenshot unavailable");
    expect(action.textContent).toBe("Connection settings");
    action.click();
    expect(recover).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });

  it("does not show recovery controls while loading", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ScreenshotView
          screenshot={{ status: "loading" }}
          emptyAction={{ label: "Connection settings", onSelect: () => undefined }}
          onTapTarget={() => undefined}
        />
      );
    });

    expect(container.querySelector(".screenshot-empty-action")).toBeNull();
    act(() => root.unmount());
  });
});
