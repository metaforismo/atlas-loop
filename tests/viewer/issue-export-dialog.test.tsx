// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssueExportDialog } from "../../apps/viewer/src/components/IssueExportDialog.js";
import type { Session, TraceEvent } from "../../apps/viewer/src/types.js";

const session: Session = {
  id: "sess_1",
  status: "running",
  simulator: { name: "iPhone 16 Pro", runtime: "iOS 18.5" },
  app: { bundleId: "app.atlasloop.CommerceDemo" }
};

const failingEvents: TraceEvent[] = [
  { type: "action.started", action: { id: "act_1", kind: "assertVisible" } },
  { type: "action.completed", result: { actionId: "act_1", ok: false, error: { code: "ACTION_TIMEOUT", message: "confirmation was not visible" } } }
];

describe("IssueExportDialog", () => {
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

  function render(overrides: Partial<Parameters<typeof IssueExportDialog>[0]> = {}) {
    const onClose = vi.fn();
    const onRepositoryChange = vi.fn();
    act(() =>
      root.render(
        <IssueExportDialog
          input={{ session, artifacts: [], events: failingEvents, evidenceUrl: "http://127.0.0.1:5173/?sessionId=sess_1" }}
          repository=""
          onRepositoryChange={onRepositoryChange}
          onClose={onClose}
          {...overrides}
        />
      )
    );
    return { onClose, onRepositoryChange };
  }

  it("shows the failing step and the run context that will be filed", () => {
    render();

    expect(container.querySelector("#issue-export-title")?.textContent).toContain("Create an issue");
    const failure = container.querySelector(".issue-export-failure")!;
    expect(failure.textContent).toContain("assertVisible");
    expect(failure.textContent).toContain("confirmation was not visible");

    const fields = container.querySelector(".issue-export-fields")!.textContent ?? "";
    expect(fields).toContain("iPhone 16 Pro");
    expect(fields).toContain("failed");
  });

  it("offers Linear without a repository and adds GitHub once one is set", () => {
    render();
    const linkText = () => [...container.querySelectorAll("a")].map((link) => link.textContent);

    expect(linkText().some((text) => text?.includes("Linear"))).toBe(true);
    expect(linkText().some((text) => text?.includes("GitHub"))).toBe(false);

    render({ repository: "metaforismo/atlas-loop" });
    const github = [...container.querySelectorAll("a")].find((link) => link.textContent?.includes("GitHub"))!;
    expect(github.getAttribute("href")).toContain("https://github.com/metaforismo/atlas-loop/issues/new");
  });

  it("rebuilds the deep link as notes are typed", async () => {
    render();
    const textarea = container.querySelector("textarea")!;
    const linearHref = () => [...container.querySelectorAll("a")].find((link) => link.textContent?.includes("Linear"))!.getAttribute("href")!;
    const before = linearHref();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "Repro attached");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(linearHref()).not.toBe(before);
    expect(decodeURIComponent(linearHref())).toContain("Repro attached");
  });

  it("closes on Escape and returns focus", async () => {
    const { onClose } = render();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalled();
  });

  it("states that nothing leaves the machine until a link is opened", () => {
    render();

    expect(container.querySelector(".issue-export-status")?.textContent).toContain("Nothing is sent anywhere");
  });
});
