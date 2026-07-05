// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtifactDetails } from "../../apps/viewer/src/components/ArtifactBrowser.js";
import type { ArtifactRef } from "../../apps/viewer/src/types.js";

const screenshotArtifact: ArtifactRef = {
  id: "shot_preview",
  sessionId: "sess_preview",
  type: "screenshot",
  path: "screenshots/preview.png",
  createdAt: "2026-07-05T09:00:00.000Z",
  url: "http://127.0.0.1:4317/v1/sessions/sess_preview/artifacts/shot_preview/content",
  metadata: { actionId: "act_preview" }
};

const logArtifact: ArtifactRef = {
  id: "log_preview",
  sessionId: "sess_preview",
  type: "log",
  path: "logs/preview.log",
  createdAt: "2026-07-05T09:00:01.000Z",
  url: "http://127.0.0.1:4317/v1/sessions/sess_preview/artifacts/log_preview/content"
};

describe("artifact details preview", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders an inline image preview for screenshot artifacts with a daemon url", () => {
    act(() => {
      root.render(<ArtifactDetails artifact={screenshotArtifact} />);
    });

    const image = container.querySelector<HTMLImageElement>("img.artifact-preview-image");
    expect(image).not.toBeNull();
    expect(image?.src).toBe(screenshotArtifact.url);

    const openLink = container.querySelector<HTMLAnchorElement>("a.artifact-detail-action");
    expect(openLink?.href).toBe(screenshotArtifact.url);
  });

  it("does not render an image preview for non-screenshot artifacts", () => {
    act(() => {
      root.render(<ArtifactDetails artifact={logArtifact} />);
    });

    expect(container.querySelector("img.artifact-preview-image")).toBeNull();
  });

  it("does not render an image preview when the artifact has no url", () => {
    act(() => {
      root.render(<ArtifactDetails artifact={{ ...screenshotArtifact, url: undefined }} />);
    });

    expect(container.querySelector("img.artifact-preview-image")).toBeNull();
    expect(container.textContent).toContain("Path only");
  });
});
