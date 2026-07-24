// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../apps/viewer/src/App.js";
import type { ArtifactHealth, ArtifactRef, Session, SessionSummary } from "../../apps/viewer/src/types.js";

const DAEMON_URL = "http://127.0.0.1:4317";
const SESSION_ID = "sess_timeline";
const CREATED_AT = "2026-07-04T09:00:00.000Z";
const SCREENSHOT_TARGET_LABEL = "Select normalized tap target from screenshot; press Enter for center";
const handoffBundleCommand = (): string =>
  `atlas-loop session handoff --session '${SESSION_ID}' --bundle './atlas-loop-handoffs/${SESSION_ID}' --viewer-base-url '${window.location.origin}' --daemon-url '${DAEMON_URL}'`;
const handoffBundleVerifyCommand = (): string =>
  `atlas-loop handoff verify --bundle './atlas-loop-handoffs/${SESSION_ID}'`;
const handoffMcpVerifyToolCall = (): string =>
  `atlas.verifyHandoffBundle({"bundleDir":"./atlas-loop-handoffs/${SESSION_ID}"})`;

const screenshotArtifact: ArtifactRef = {
  id: "shot_checkout",
  sessionId: SESSION_ID,
  type: "screenshot",
  path: "screenshots/checkout.png",
  createdAt: "2026-07-04T09:00:03.000Z",
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  url: `${DAEMON_URL}/artifacts/shot_checkout`,
  metadata: { actionId: "act_checkout" }
};

const logArtifact: ArtifactRef = {
  id: "log_debug",
  sessionId: SESSION_ID,
  type: "log",
  path: "logs/debug.log",
  createdAt: "2026-07-04T09:00:05.000Z",
  metadata: { actionId: "act_debug" }
};

const artifacts = [screenshotArtifact, logArtifact];

const session: Session = {
  id: SESSION_ID,
  status: "running",
  createdAt: CREATED_AT,
  updatedAt: "2026-07-04T09:00:06.000Z",
  artifactDir: `/tmp/atlas-loop/${SESSION_ID}`,
  backend: "mock",
  simulator: { name: "iPhone 16", runtime: "iOS 18.5", booted: true },
  app: { bundleId: "dev.atlas.loop.demo" }
};

const summary: SessionSummary = {
  session,
  paths: {
    artifactDir: `/tmp/atlas-loop/${SESSION_ID}`,
    manifest: `/tmp/atlas-loop/${SESSION_ID}/session.json`,
    trace: `/tmp/atlas-loop/${SESSION_ID}/trace.jsonl`,
    screenshots: `/tmp/atlas-loop/${SESSION_ID}/screenshots`
  },
  artifacts: {
    total: artifacts.length,
    byType: { screenshot: 1, log: 1 },
    latestScreenshot: screenshotArtifact,
    latestScreenshotId: screenshotArtifact.id,
    latestScreenshotPath: screenshotArtifact.path,
    latestScreenshotCreatedAt: screenshotArtifact.createdAt
  },
  events: {
    total: 1,
    latestAction: {
      actionId: "act_checkout",
      ok: true,
      endedAt: "2026-07-04T09:00:04.000Z",
      artifactCount: 1,
      artifacts: [screenshotArtifact]
    }
  },
  storage: {
    source: "memory",
    artifactBacked: true,
    warnings: []
  }
};

const artifactHealth: ArtifactHealth = {
  ok: true,
  sessionId: SESSION_ID,
  source: "memory",
  artifactDir: `/tmp/atlas-loop/${SESSION_ID}`,
  report: {
    ok: true,
    target: `/tmp/atlas-loop/${SESSION_ID}`,
    sessionCount: 1,
    issues: []
  },
  summary: {
    sessionCount: 1,
    errorCount: 0,
    warningCount: 0,
    issueCount: 0
  }
};

class MockEventSource {
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string | URL) {
    this.url = url.toString();
    queueMicrotask(() => this.onopen?.(new Event("open")));
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback as (event: MessageEvent<string>) => void);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const callback = typeof listener === "function" ? listener : listener.handleEvent.bind(listener);
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((stored) => stored !== callback)
    );
  }

  close(): void {}
}

let restoreBrowserGlobals: Array<() => void> = [];

// Rendering + polling in jsdom is wall-clock sensitive; generous budgets keep
// these tests deterministic on loaded machines without changing what they assert.
describe("viewer app interactions", { timeout: 30_000 }, () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let clipboardWriteText: ReturnType<typeof vi.fn<(value: string) => Promise<void>>>;

  beforeEach(() => {
    restoreBrowserGlobals = [];
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clipboardWriteText = vi.fn(async () => undefined);
    window.history.replaceState(
      null,
      "",
      `/?daemonUrl=${encodeURIComponent(DAEMON_URL)}&sessionId=${SESSION_ID}`
    );

    replaceBrowserProperty(
      window,
      "requestAnimationFrame",
      (callback: FrameRequestCallback): number => window.setTimeout(() => callback(performance.now()), 0)
    );
    replaceBrowserProperty(window, "cancelAnimationFrame", (id: number): void => window.clearTimeout(id));
    replaceBrowserProperty(window.navigator, "clipboard", { writeText: clipboardWriteText });
    replaceBrowserProperty(window, "EventSource", MockEventSource as unknown as typeof EventSource);
    replaceBrowserProperty(globalThis, "EventSource", MockEventSource as unknown as typeof EventSource);
    vi.stubGlobal("fetch", vi.fn(fetchResponse));

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
    }
    root = undefined;
    container?.remove();
    container = undefined;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const restore of restoreBrowserGlobals.reverse()) restore();
    restoreBrowserGlobals = [];
    document.body.innerHTML = "";
  });

  it("selects timeline artifacts through active artifact filters and exposes copy controls", async () => {
    await act(async () => root?.render(<App />));

    await waitFor(() => getButtonByAriaLabel("Select artifact shot_checkout from timeline"), "timeline screenshot card");

    await click(getFilterButton("Artifact type filters", "log"));
    await setInputValue(getInputByPlaceholder("Search artifacts"), "debug");

    await waitFor(() => {
      const selected = getSelectedArtifactOption();
      expect(selected.textContent).toContain("debug.log");
      expect(queryArtifactOption("checkout.png")).toBeUndefined();
      return selected;
    }, "filtered log artifact selection");

    await click(getButtonByAriaLabel("Select artifact shot_checkout from timeline"));

    const details = await waitFor(() => {
      const selected = getSelectedArtifactOption();
      const panel = getByAriaLabel<HTMLElement>("Selected artifact details");
      expect(selected.textContent).toContain("checkout.png");
      expect(panel.textContent).toContain("screenshots/checkout.png");
      expect(panel.textContent).toContain("shot_checkout");
      return panel;
    }, "selected screenshot artifact details");

    expect(getFilterButton("Artifact type filters", "All").getAttribute("aria-pressed")).toBe("true");
    expect(getInputByPlaceholder("Search artifacts").value).toBe("");
    expect(getButtonByText(details, "Copy path")).toBeTruthy();
    expect(getButtonByText(details, "Copy ID")).toBeTruthy();

    await click(getButtonByText(details, "Copy ID"));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("shot_checkout");
      expect(details.textContent).toContain("Artifact ID copied.");
      return true;
    }, "copy id confirmation");
  });

  it("preselects a deep-linked artifact over the default first artifact", async () => {
    window.history.replaceState(
      null,
      "",
      `/?daemonUrl=${encodeURIComponent(DAEMON_URL)}&sessionId=${SESSION_ID}&artifactId=${logArtifact.id}`
    );

    await act(async () => root?.render(<App />));

    await waitFor(() => {
      const selected = getSelectedArtifactOption();
      expect(selected.textContent).toContain("debug.log");
      return selected;
    }, "deep-linked artifact selection");
  });

  it("renders compact evidence chips from session history rows", async () => {
    await act(async () => root?.render(<App />));

    const evidence = await waitFor(() => {
      const group = getByAriaLabel<HTMLElement>(`Evidence for ${SESSION_ID}`);
      expect(group.textContent).toContain("mem");
      expect(group.textContent).toContain("2");
      expect(group.textContent).toContain("pass");
      return group;
    }, "session history evidence chips");

    expect(getByAriaLabel<HTMLElement>("Evidence source memory").closest(".session-evidence-chips")).toBe(evidence);
    expect(getByAriaLabel<HTMLElement>("Artifact count 2").textContent).toContain("2");
    expect(getByAriaLabel<HTMLElement>("Event count 1").textContent).toContain("1");
    expect(getByAriaLabel<HTMLElement>("Warning count 0").textContent).toContain("0");
    expect(getByAriaLabel<HTMLElement>("Latest screenshot available").textContent).toContain("yes");
    expect(getByAriaLabel<HTMLElement>("Latest action passed").textContent).toContain("pass");
  });

  it("copies local agent handoff notes and next steps", async () => {
    await act(async () => root?.render(<App />));

    const handoff = await waitFor(() => {
      const panel = getByAriaLabel<HTMLElement>("Agent handoff");
      expect(panel.textContent).toContain("Ready for handoff");
      expect(getButtonByAriaLabel("Copy compact local handoff note")).toBeTruthy();
      expect(getButtonByAriaLabel("Copy all handoff next steps")).toBeTruthy();
      expect(getButtonByAriaLabel("Copy local handoff command snippets")).toBeTruthy();
      expect(getByRoleName("region", "Bundle output")).toBeTruthy();
      expect(getByRoleName("region", "Local handoff command preview")).toBeTruthy();
      return panel;
    }, "ready handoff copy controls");

    const bundleOutput = getByRoleName<HTMLElement>("region", "Bundle output");
    const bundlePaths = getByAriaLabel<HTMLElement>("Bundle output details");
    expect(bundleOutput.textContent).toContain("local-only");
    expect(bundleOutput.textContent).toContain("writes handoff.json");
    expect(bundleOutput.textContent).not.toContain("read-only");
    expect(bundlePaths.textContent).toContain(`./atlas-loop-handoffs/${SESSION_ID}`);
    expect(bundlePaths.textContent).toContain(`./atlas-loop-handoffs/${SESSION_ID}/manifest.json`);
    expect(bundlePaths.textContent).toContain("Verify");
    expect(bundlePaths.textContent).toContain(handoffBundleVerifyCommand());
    expect(bundlePaths.textContent).toContain("MCP tool");
    expect(bundlePaths.textContent).toContain(handoffMcpVerifyToolCall());

    const commandPreview = getByRoleName<HTMLElement>("region", "Local handoff command preview");
    const visibleCommandLines = getByRoleName<HTMLElement>("region", "Visible local handoff command lines");
    expect(commandPreview.textContent).toContain("8/14 lines");
    expect(commandPreview.textContent).toContain(handoffBundleCommand());
    expect(commandPreview.textContent).toContain(handoffBundleVerifyCommand());
    expect(commandPreview.textContent).toContain(handoffMcpVerifyToolCall());
    expect(commandPreview.textContent).toContain(`--viewer-base-url '${window.location.origin}'`);
    expect(commandPreview.textContent).toContain(
      `atlas-loop events export --session '${SESSION_ID}' --out './atlas-loop-events/${SESSION_ID}.json' --daemon-url '${DAEMON_URL}'`
    );
    expect(visibleCommandLines.textContent).toContain(handoffBundleCommand());
    expect(visibleCommandLines.textContent).toContain(handoffBundleVerifyCommand());
    expect(visibleCommandLines.textContent).toContain(handoffMcpVerifyToolCall());
    expect(commandPreview.textContent).toContain("+6 more lines: daemon checks");
    expect(commandPreview.textContent).not.toContain(`curl -fsS '${DAEMON_URL}/v1/sessions/${SESSION_ID}/summary'`);

    const overflowToggle = getButtonByAriaLabel("Show 6 overflow local handoff command lines");
    expect(overflowToggle.getAttribute("aria-expanded")).toBe("false");

    await click(overflowToggle);

    await waitFor(() => {
      expect(overflowToggle.getAttribute("aria-expanded")).toBe("true");
      expect(commandPreview.textContent).toContain(`curl -fsS '${DAEMON_URL}/v1/sessions/${SESSION_ID}/summary'`);
      expect(getByRoleName("region", "Expanded local handoff command lines")).toBeTruthy();
      return true;
    }, "expanded handoff command preview");

    await click(getButtonByAriaLabel("Copy compact local handoff note"));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining("Atlas Loop handoff"));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(`Session: ${SESSION_ID}`));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(`Bundle directory: ./atlas-loop-handoffs/${SESSION_ID}`));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(`Bundle manifest: ./atlas-loop-handoffs/${SESSION_ID}/manifest.json`));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(`Bundle verify: ${handoffBundleVerifyCommand()}`));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(`MCP verify: ${handoffMcpVerifyToolCall()}`));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining("Blockers/warnings:\n- none"));
      expect(handoff.textContent).toContain("Handoff note copied.");
      return true;
    }, "handoff note copied");

    await click(getButtonByAriaLabel("Copy all handoff next steps"));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenLastCalledWith(
        expect.stringContaining("1. Pass the daemon URL and resolved session id to the next agent.")
      );
      expect(clipboardWriteText).toHaveBeenLastCalledWith(
        expect.stringContaining(`Bundle verify command:\n${handoffBundleVerifyCommand()}`)
      );
      expect(clipboardWriteText).toHaveBeenLastCalledWith(
        expect.stringContaining(`MCP verify tool:\n${handoffMcpVerifyToolCall()}`)
      );
      expect(handoff.textContent).toContain("Next steps copied.");
      return true;
    }, "handoff next steps copied");

    await click(getButtonByAriaLabel("Copy local handoff command snippets"));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(handoffBundleCommand()));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(handoffBundleVerifyCommand()));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(expect.stringContaining(handoffMcpVerifyToolCall()));
      expect(clipboardWriteText).toHaveBeenLastCalledWith(
        expect.stringContaining(`atlas-loop events export --session '${SESSION_ID}' --out './atlas-loop-events/${SESSION_ID}.json' --daemon-url '${DAEMON_URL}'`)
      );
      expect(clipboardWriteText).toHaveBeenLastCalledWith(
        expect.stringContaining(`curl -fsS '${DAEMON_URL}/v1/sessions/${SESSION_ID}/summary'`)
      );
      expect(handoff.textContent).toContain("Command snippets copied.");
      return true;
    }, "handoff command snippets copied");
  });

  it("selects the screenshot center target from keyboard activation", async () => {
    await act(async () => root?.render(<App />));

    const targetButton = await waitFor(() => getButtonByAriaLabel(SCREENSHOT_TARGET_LABEL), "screenshot target button");
    const image = targetButton.querySelector("img");
    if (!image) throw new Error("Screenshot image was not found.");
    setImageMetrics(image, { left: 0, top: 0, width: 200, height: 400, naturalWidth: 200, naturalHeight: 400 });

    await setInputValue(getInputById("action-tap-x"), "0.25");
    await setInputValue(getInputById("action-tap-y"), "0.75");

    await keyDown(targetButton, "Enter");

    await waitFor(() => {
      expect(getInputById("action-tap-x").value).toBe("0.500");
      expect(getInputById("action-tap-y").value).toBe("0.500");
      expect(targetButton.textContent).toContain("x 0.500 y 0.500");
      return true;
    }, "keyboard-selected center target");
  });

  it("applies action presets to the primitive action fields", async () => {
    await act(async () => root?.render(<App />));

    const centerPreset = await waitFor(() => getButtonByAriaLabel("Set tap target to center: x 0.500, y 0.500"), "action preset controls");
    expect(centerPreset.getAttribute("aria-pressed")).toBe("true");

    await setInputValue(getInputById("action-tap-x"), "0.123");
    await setInputValue(getInputById("action-tap-y"), "0.456");
    await setInputValue(getInputById("action-wait-duration"), "333");

    const primaryPreset = getButtonByAriaLabel("Set tap target to bottom primary action: x 0.500, y 0.910");
    await click(primaryPreset);

    await waitFor(() => {
      expect(getInputById("action-tap-x").value).toBe("0.500");
      expect(getInputById("action-tap-y").value).toBe("0.910");
      expect(primaryPreset.getAttribute("aria-pressed")).toBe("true");
      return true;
    }, "primary tap preset applied");

    const waitPreset = getButtonByAriaLabel("Set wait duration to 1000 milliseconds");
    await click(waitPreset);

    await waitFor(() => {
      expect(getInputById("action-wait-duration").value).toBe("1000");
      expect(waitPreset.getAttribute("aria-pressed")).toBe("true");
      return true;
    }, "wait preset applied");
  });

  it("opens the operational overview and returns to live evidence", async () => {
    await act(async () => root?.render(<App />));
    await waitFor(() => {
      expect(getByAriaLabel<HTMLElement>(`Evidence for ${SESSION_ID}`)).toBeTruthy();
      return true;
    }, "session history before overview");

    const workspaceNavigation = getByAriaLabel<HTMLElement>("Workspace navigation");
    await click(getButtonByText(workspaceNavigation, "Overview"));

    const shell = document.querySelector("main.viewer-shell")!;
    expect(shell.classList.contains("workspace-overview-active")).toBe(true);
    expect(document.querySelector("#workspace-overview-title")?.textContent).toBe("Workspace overview");
    expect(document.querySelector(".overview-recent-sessions")?.textContent).toContain(SESSION_ID);
    expect(getButtonByText(workspaceNavigation, "Overview").getAttribute("aria-current")).toBe("page");
    expect(window.location.search).toContain("workspace=overview");

    const overview = document.querySelector<HTMLElement>(".workspace-overview")!;
    await click(getButtonByText(overview, "Open live evidence"));
    expect(shell.classList.contains("workspace-overview-active")).toBe(false);
    expect(getButtonByText(workspaceNavigation, "Live evidence").getAttribute("aria-current")).toBe("page");
    expect(window.location.search).not.toContain("workspace=");
  });

  it("restores the workspace surface from browser history state", async () => {
    window.history.replaceState(
      null,
      "",
      `/?daemonUrl=${encodeURIComponent(DAEMON_URL)}&sessionId=${SESSION_ID}&workspace=overview`
    );

    await act(async () => root?.render(<App />));
    await waitFor(() => {
      const shell = document.querySelector("main.viewer-shell")!;
      expect(shell.classList.contains("workspace-overview-active")).toBe(true);
      expect(document.querySelector(".viewer-breadcrumb")?.textContent).toContain("Overview");
      return true;
    }, "deep-linked overview");

    await act(async () => {
      window.history.replaceState(
        null,
        "",
        `/?daemonUrl=${encodeURIComponent(DAEMON_URL)}&sessionId=${SESSION_ID}`
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await waitFor(() => {
      const shell = document.querySelector("main.viewer-shell")!;
      expect(shell.classList.contains("workspace-overview-active")).toBe(false);
      expect(document.querySelector(".viewer-breadcrumb")?.textContent).toContain("Evidence");
      return true;
    }, "history-restored evidence workspace");
  });

  it("preserves an explicit Tests deep link when the first-run daemon is offline", async () => {
    window.history.replaceState(null, "", "/?sessionId=latest&workspace=tests");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));

    await act(async () => root?.render(<App />));

    await waitFor(() => {
      const shell = document.querySelector("main.viewer-shell")!;
      expect(shell.classList.contains("workspace-tests-active")).toBe(true);
      expect(document.querySelector("#test-workspace-title")?.textContent).toBe("Tests");
      expect(document.querySelector(".viewer-breadcrumb")?.textContent).toContain("Tests");
      expect(window.location.search).toContain("workspace=tests");
      return true;
    }, "offline Tests deep link");
  });

  it("deep-links the first-class workflow library and returns to evidence", async () => {
    await act(async () => root?.render(<App />));
    await waitFor(() => {
      expect(getByAriaLabel<HTMLElement>(`Evidence for ${SESSION_ID}`)).toBeTruthy();
      return true;
    }, "session history before workflows");

    const workspaceNavigation = getByAriaLabel<HTMLElement>("Workspace navigation");
    await click(getButtonByText(workspaceNavigation, "Workflows"));

    const shell = document.querySelector("main.viewer-shell")!;
    expect(shell.classList.contains("workspace-workflows-active")).toBe(true);
    expect(document.querySelector("#workflow-workspace-title")?.textContent).toBe("Reusable workflows");
    expect(getButtonByText(workspaceNavigation, "Workflows").getAttribute("aria-current")).toBe("page");
    expect(window.location.search).toContain("workspace=workflows");
    expect(document.querySelector(".viewer-breadcrumb")?.textContent).toContain("Workflows");

    const workflows = document.querySelector<HTMLElement>(".workflow-workspace")!;
    await click(getButtonByText(workflows, "Open live evidence"));
    expect(shell.classList.contains("workspace-workflows-active")).toBe(false);
    expect(window.location.search).not.toContain("workspace=");
  });

  it("deep-links local tests, opens the compiler, and returns to evidence", async () => {
    await act(async () => root?.render(<App />));
    await waitFor(() => {
      expect(getByAriaLabel<HTMLElement>(`Evidence for ${SESSION_ID}`)).toBeTruthy();
      return true;
    }, "session history before tests");

    const workspaceNavigation = getByAriaLabel<HTMLElement>("Workspace navigation");
    await click(getButtonByText(workspaceNavigation, "Tests"));

    const shell = document.querySelector("main.viewer-shell")!;
    expect(shell.classList.contains("workspace-tests-active")).toBe(true);
    expect(document.querySelector("#test-workspace-title")?.textContent).toBe("Tests");
    expect(getButtonByText(workspaceNavigation, "Tests").getAttribute("aria-current")).toBe("page");
    expect(window.location.search).toContain("workspace=tests");
    expect(document.querySelector(".viewer-breadcrumb")?.textContent).toContain("Tests");

    const tests = document.querySelector<HTMLElement>(".test-workspace")!;
    await click(getButtonByText(tests, "Create test"));
    expect(document.querySelector("[role='dialog']")?.textContent).toContain("Compiled preview");
    await click(getButtonByAriaLabel("Close test composer"));
    await click(getButtonByText(tests, "Open live evidence"));
    expect(shell.classList.contains("workspace-tests-active")).toBe(false);
    expect(window.location.search).not.toContain("workspace=");
  });

  it("opens the first-class session history and repeats a captured app", async () => {
    await act(async () => root?.render(<App />));
    await waitFor(() => {
      expect(getByAriaLabel<HTMLElement>(`Evidence for ${SESSION_ID}`)).toBeTruthy();
      return true;
    }, "session history before sessions workspace");

    const workspaceNavigation = getByAriaLabel<HTMLElement>("Workspace navigation");
    await click(getButtonByText(workspaceNavigation, "Sessions"));

    const shell = document.querySelector("main.viewer-shell")!;
    expect(shell.classList.contains("workspace-sessions-active")).toBe(true);
    expect(document.querySelector("#session-workspace-title")?.textContent).toBe("Sessions");
    expect(getButtonByText(workspaceNavigation, "Sessions").getAttribute("aria-current")).toBe("page");
    expect(window.location.search).toContain("workspace=sessions");
    expect(document.querySelector(".viewer-breadcrumb")?.textContent).toContain("Sessions");
    expect(document.querySelector(".session-history-table")?.textContent).toContain(SESSION_ID);

    const sessionWorkspace = document.querySelector<HTMLElement>(".session-workspace")!;
    await click(getButtonByText(sessionWorkspace, "Repeat with app"));
    expect(document.querySelector<HTMLInputElement>("input[placeholder='app.example.YourApp']")?.value).toBe("dev.atlas.loop.demo");
    expect(document.querySelector("[role='dialog'][aria-label='Start local Simulator session']")).not.toBeNull();
  });

  it("opens the observed app catalog and prefills a new run from history", async () => {
    await act(async () => root?.render(<App />));
    await waitFor(() => {
      expect(getByAriaLabel<HTMLElement>(`Evidence for ${SESSION_ID}`)).toBeTruthy();
      return true;
    }, "session history before apps");

    const workspaceNavigation = getByAriaLabel<HTMLElement>("Workspace navigation");
    await click(getButtonByText(workspaceNavigation, "Apps"));

    const shell = document.querySelector("main.viewer-shell")!;
    expect(shell.classList.contains("workspace-apps-active")).toBe(true);
    expect(document.querySelector("#observed-apps-title")?.textContent).toBe("Observed apps");
    expect(getButtonByText(workspaceNavigation, "Apps").getAttribute("aria-current")).toBe("page");
    expect(window.location.search).toContain("workspace=apps");
    expect(document.querySelector(".viewer-breadcrumb")?.textContent).toContain("Apps");

    const apps = document.querySelector<HTMLElement>(".observed-apps-workspace")!;
    await click(getButtonByText(apps, "Start new run"));
    expect(document.querySelector<HTMLInputElement>("input[placeholder='app.example.YourApp']")?.value).toBe("dev.atlas.loop.demo");
    expect(document.querySelector("[role='dialog'][aria-label='Start local Simulator session']")).not.toBeNull();
  });
});

async function fetchResponse(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
  const pathname = url.pathname;

  if (pathname === "/healthz") return new Response("", { status: 200 });
  if (pathname === "/v1/sessions/history") {
    expect(url.searchParams.get("limit")).toBeNull();
    return jsonResponse({
      schemaVersion: "atlas-loop.session-history.v1",
      generatedAt: "2026-07-05T10:00:00.000Z",
      total: 1,
      count: 1,
      limit: 30,
      sessions: [
        {
          sessionId: SESSION_ID,
          session,
          storage: { source: "memory", artifactBacked: true, warningCount: 0 },
          artifacts: {
            total: artifacts.length,
            byType: { screenshot: 1, log: 1 },
            latestScreenshotPath: screenshotArtifact.path,
            latestScreenshotId: screenshotArtifact.id,
            latestScreenshotCreatedAt: screenshotArtifact.createdAt
          },
          events: {
            total: 1,
            latestAction: { actionId: "act_checkout", ok: true, artifactCount: 1 }
          },
          canMutate: true,
          hasScreenshot: true,
          ready: true
        }
      ]
    });
  }
  if (pathname === "/v1/sessions") return jsonResponse({ sessions: [session] });
  if (pathname === `/v1/sessions/${SESSION_ID}`) return jsonResponse(session);
  if (pathname === `/v1/sessions/${SESSION_ID}/summary`) return jsonResponse(summary);
  if (pathname === `/v1/sessions/${SESSION_ID}/artifacts`) return jsonResponse({ artifacts });
  if (pathname === `/v1/sessions/${SESSION_ID}/artifacts/health`) return jsonResponse(artifactHealth);
  if (pathname === `/v1/sessions/${SESSION_ID}/events`) return jsonResponse({ events: [] });
  if (pathname === `/v1/sessions/${SESSION_ID}/latest-screenshot`) {
    return jsonResponse({
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      mediaType: "image/png",
      updatedAt: screenshotArtifact.createdAt
    });
  }

  throw new Error(`Unexpected viewer fetch: ${url.toString()}`);
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function replaceBrowserProperty(target: object, property: PropertyKey, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, property);
  Object.defineProperty(target, property, { configurable: true, value });
  restoreBrowserGlobals.push(() => {
    if (descriptor) {
      Object.defineProperty(target, property, descriptor);
      return;
    }

    Reflect.deleteProperty(target, property);
  });
}

async function waitFor<T>(callback: () => T, description: string): Promise<T> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < 10_000) {
    try {
      return callback();
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${description}`);
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function setInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  });
}

function getFilterButton(groupLabel: string, text: string): HTMLButtonElement {
  return getButtonByText(getByAriaLabel(groupLabel), text);
}

function getButtonByAriaLabel(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === label);
  if (!button) throw new Error(`Button with aria-label "${label}" was not found.`);
  return button;
}

function getByAriaLabel<T extends Element = Element>(label: string): T {
  const element = [...document.querySelectorAll("[aria-label]")].find((candidate) => candidate.getAttribute("aria-label") === label);
  if (!element) throw new Error(`Element with aria-label "${label}" was not found.`);
  return element as T;
}

function getByRoleName<T extends HTMLElement = HTMLElement>(role: string, name: string): T {
  const selector = role === "region" ? `[role="${role}"], section[aria-labelledby]` : `[role="${role}"]`;
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find((candidate) => accessibleName(candidate).includes(name));
  if (!element) throw new Error(`Element with role "${role}" and name "${name}" was not found.`);
  return element as T;
}

function accessibleName(element: Element): string {
  const label = element.getAttribute("aria-label");
  if (label) return label;
  const labelledBy = element.getAttribute("aria-labelledby");
  if (!labelledBy) return element.textContent ?? "";
  return labelledBy
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

function getButtonByText(rootElement: ParentNode, text: string): HTMLButtonElement {
  const button = [...rootElement.querySelectorAll("button")].find((element) => element.textContent?.includes(text));
  if (!button) throw new Error(`Button containing "${text}" was not found.`);
  return button;
}

function getInputByPlaceholder(placeholder: string): HTMLInputElement {
  const input = [...document.querySelectorAll("input")].find((element) => element.getAttribute("placeholder") === placeholder);
  if (!input) throw new Error(`Input with placeholder "${placeholder}" was not found.`);
  return input;
}

function getInputById(id: string): HTMLInputElement {
  const input = document.getElementById(id);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Input with id "${id}" was not found.`);
  return input;
}

function getSelectedArtifactOption(): HTMLElement {
  const selected = document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
  if (!selected) throw new Error("Selected artifact option was not found.");
  return selected;
}

function queryArtifactOption(text: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes(text));
}

async function keyDown(element: Element, key: string): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function setImageMetrics(
  image: HTMLImageElement,
  metrics: { left: number; top: number; width: number; height: number; naturalWidth: number; naturalHeight: number }
): void {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: metrics.naturalWidth },
    naturalHeight: { configurable: true, value: metrics.naturalHeight }
  });
  image.getBoundingClientRect = () => ({
    x: metrics.left,
    y: metrics.top,
    left: metrics.left,
    top: metrics.top,
    width: metrics.width,
    height: metrics.height,
    right: metrics.left + metrics.width,
    bottom: metrics.top + metrics.height,
    toJSON: () => ({})
  } as DOMRect);
}
