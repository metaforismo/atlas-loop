// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionDetailPanel } from "../../apps/viewer/src/components/ActionDetailPanel.js";
import type { ArtifactRef, TraceEvent } from "../../apps/viewer/src/types.js";
import { buildActionEvidencePairs } from "../../apps/viewer/src/viewerPresentation.js";

function screenshot(id: string, createdAt: string, metadata: Record<string, unknown> = {}): ArtifactRef {
  return {
    id,
    sessionId: "sess_pairs",
    type: "screenshot",
    path: `screenshots/${id}.png`,
    createdAt,
    url: `http://127.0.0.1:4317/v1/sessions/sess_pairs/artifacts/${id}/content`,
    metadata
  };
}

const launchScreenshot = screenshot("shot_launch", "2026-07-05T10:00:00.000Z", { reason: "post-launch" });
const afterTap = screenshot("shot_after_tap", "2026-07-05T10:00:11.000Z", { actionId: "act_tap", role: "after", tapX: 0.4, tapY: 0.6 });
const afterElement = screenshot("shot_after_element", "2026-07-05T10:00:21.000Z", { actionId: "act_element", role: "after" });

const events: TraceEvent[] = [
  { type: "action.started", at: "2026-07-05T10:00:10.000Z", action: { id: "act_tap", kind: "tap", x: 0.4, y: 0.6 } },
  { type: "action.completed", at: "2026-07-05T10:00:11.000Z", result: { actionId: "act_tap", ok: true } },
  { type: "action.started", at: "2026-07-05T10:00:20.000Z", action: { id: "act_element", kind: "tapElement", identifier: "cart.continue" } },
  { type: "action.completed", at: "2026-07-05T10:00:21.000Z", result: { actionId: "act_element", ok: false } },
  { type: "action.started", at: "2026-07-05T10:00:25.000Z", action: { id: "act_shot", kind: "screenshot" } }
];

describe("buildActionEvidencePairs", () => {
  it("pairs after-shots by action linkage and derives before from the previous after", () => {
    const pairs = buildActionEvidencePairs(events, [launchScreenshot, afterTap, afterElement]);

    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({
      actionId: "act_tap",
      ok: true,
      before: { id: "shot_launch" },
      after: { id: "shot_after_tap" },
      tap: { x: 0.4, y: 0.6 }
    });
    expect(pairs[1]).toMatchObject({
      actionId: "act_element",
      ok: false,
      before: { id: "shot_after_tap" },
      after: { id: "shot_after_element" },
      label: "tap cart.continue"
    });
  });

  it("leaves before undefined for the first action with no earlier screenshot", () => {
    const pairs = buildActionEvidencePairs(events, [afterTap, afterElement]);

    expect(pairs[0].before).toBeUndefined();
    expect(pairs[0].after?.id).toBe("shot_after_tap");
  });

  it("excludes non-input actions", () => {
    const pairs = buildActionEvidencePairs(events, [afterTap]);
    expect(pairs.map((pair) => pair.actionId)).toEqual(["act_tap", "act_element"]);
  });
});

describe("ActionDetailPanel", () => {
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

  it("renders before/after shots with a tap marker and navigates between actions", () => {
    const pairs = buildActionEvidencePairs(events, [launchScreenshot, afterTap, afterElement]);
    const selections: string[] = [];

    act(() => {
      root.render(
        <ActionDetailPanel pairs={pairs} selectedActionId="act_tap" onSelect={(actionId) => selections.push(actionId)} />
      );
    });

    const images = container.querySelectorAll<HTMLImageElement>(".action-evidence-frame img");
    expect(images).toHaveLength(2);
    expect(images[0].src).toContain("shot_launch");
    expect(images[1].src).toContain("shot_after_tap");

    const marker = container.querySelector<HTMLSpanElement>(".action-evidence-marker");
    expect(marker).not.toBeNull();
    expect(marker!.style.left).toBe("40%");
    expect(marker!.style.top).toBe("60%");

    const nextButton = container.querySelector<HTMLButtonElement>("button[aria-label='Next action']");
    act(() => {
      nextButton!.click();
    });
    expect(selections).toEqual(["act_element"]);
  });

  it("defaults to the latest action and renders empty slots gracefully", () => {
    const pairs = buildActionEvidencePairs(events, [afterTap]);

    act(() => {
      root.render(<ActionDetailPanel pairs={pairs} onSelect={() => undefined} />);
    });

    expect(container.textContent).toContain("2/2");
    expect(container.textContent).toContain("No screenshot");
  });

  it("falls back to the latest action when a stale deep link is not present", () => {
    const pairs = buildActionEvidencePairs(events, [launchScreenshot, afterTap, afterElement]);

    act(() => {
      root.render(<ActionDetailPanel pairs={pairs} selectedActionId="act_from_another_session" onSelect={() => undefined} />);
    });

    expect(container.textContent).toContain("2/2");
    expect(container.textContent).toContain("tap cart.continue");
  });
});
