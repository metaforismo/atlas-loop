// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FlowRunPanel } from "../../apps/viewer/src/components/FlowRunPanel.js";
import type { TraceEvent } from "../../apps/viewer/src/types.js";
import { buildFlowRunSummary } from "../../apps/viewer/src/viewerPresentation.js";

const events: TraceEvent[] = [
  { type: "action.started", at: "2026-07-18T09:00:00.000Z", action: { id: "act_pass", kind: "tap" } },
  { type: "action.completed", at: "2026-07-18T09:00:01.000Z", result: { actionId: "act_pass", ok: true } },
  { type: "action.started", at: "2026-07-18T09:00:02.000Z", action: { id: "act_fail", kind: "assertVisible" } },
  { type: "action.completed", at: "2026-07-18T09:00:03.000Z", result: { actionId: "act_fail", ok: false } },
  { type: "action.started", at: "2026-07-18T09:00:04.000Z", action: { id: "act_running", kind: "swipe" } }
];

describe("buildFlowRunSummary", () => {
  it("reports mixed outcomes without double counting action events", () => {
    const summary = buildFlowRunSummary(events, "running");

    expect(summary).toMatchObject({
      verdict: "failed",
      total: 3,
      completed: 2,
      passed: 1,
      failed: 1,
      running: 1,
      progress: 2 / 3
    });
  });

  it("distinguishes a completed passing flow from an empty ended session", () => {
    expect(buildFlowRunSummary(events.slice(0, 2), "running")).toMatchObject({
      verdict: "passed",
      title: "Observed flow passed"
    });
    expect(buildFlowRunSummary([], "ended")).toMatchObject({
      verdict: "waiting",
      title: "No actions recorded",
      tone: "warn"
    });
  });

  it("does not invent a failed action when only the session failed", () => {
    expect(buildFlowRunSummary([], "failed")).toMatchObject({
      verdict: "failed",
      title: "Session failed",
      failed: 0,
      detail: "The session ended before an action failure was recorded."
    });
  });
});

describe("FlowRunPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a concise accessible verdict and progress", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const summary = buildFlowRunSummary(events, "running");

    act(() => root.render(<FlowRunPanel summary={summary} />));

    expect(container.querySelector("[aria-label='Flow verdict']")?.textContent).toContain("Flow needs attention");
    expect(container.querySelector("[aria-label='2 of 3 actions completed']")).not.toBeNull();
    expect(container.textContent).toContain("Passed1");
    expect(container.textContent).toContain("Failed1");

    act(() => root.unmount());
  });
});
