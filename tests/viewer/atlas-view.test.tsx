// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AtlasView } from "../../apps/viewer/src/atlas/AtlasView.js";
import { normalizeAtlasView, screenDisplayName, screenImageUrl } from "../../apps/viewer/src/atlas/atlasApi.js";
import { readViewerParams, writeViewerSearch } from "../../apps/viewer/src/viewerParams.js";

const DAEMON_URL = "http://127.0.0.1:4317";

const atlasView = {
  source: "cache",
  warnings: [],
  map: {
    generatedAt: "2026-07-05T12:00:00.000Z",
    hashThreshold: 10,
    sessions: [
      { sessionId: "sess_one", observationCount: 3 },
      { sessionId: "sess_two", observationCount: 2 }
    ],
    screens: [
      {
        id: "screen_aaaa",
        screenshotCount: 4,
        sessionIds: ["sess_one", "sess_two"],
        firstSeenAt: "2026-07-05T10:00:00.000Z",
        lastSeenAt: "2026-07-05T11:00:00.000Z",
        hashes: ["aaaaaaaaaaaaaaaa"],
        variants: [
          { sessionId: "sess_one", artifactId: "shot_1", createdAt: "2026-07-05T10:00:00.000Z" },
          { sessionId: "sess_two", artifactId: "shot_3", createdAt: "2026-07-05T10:30:00.000Z" }
        ]
      },
      {
        id: "confirmation",
        screenId: "confirmation",
        screenshotCount: 2,
        sessionIds: ["sess_one"],
        firstSeenAt: "2026-07-05T10:05:00.000Z",
        lastSeenAt: "2026-07-05T10:06:00.000Z",
        hashes: ["bbbbbbbbbbbbbbbb"],
        variants: [{ sessionId: "sess_one", artifactId: "shot_2", createdAt: "2026-07-05T10:05:00.000Z" }]
      }
    ],
    transitions: [
      { id: "__launch__->screen_aaaa#launch:app.demo", from: "__launch__", to: "screen_aaaa", actionSignature: "launch:app.demo", count: 2, sessionIds: ["sess_one", "sess_two"] },
      {
        id: "screen_aaaa->confirmation#tap:cart.continue",
        from: "screen_aaaa",
        to: "confirmation",
        actionSignature: "tap:cart.continue",
        count: 1,
        sessionIds: ["sess_one"],
        examples: [{ sessionId: "sess_one", actionId: "act_continue", at: "2026-07-05T10:05:30.000Z" }]
      }
    ]
  }
};

describe("viewer params view toggle", () => {
  it("round-trips the atlas view through the URL and defaults to session", () => {
    expect(readViewerParams("?daemonUrl=http%3A%2F%2F127.0.0.1%3A4317&sessionId=latest").view).toBeUndefined();
    expect(readViewerParams("?view=atlas").view).toBe("atlas");
    expect(readViewerParams("?view=bogus").view).toBeUndefined();

    const atlasSearch = writeViewerSearch({ daemonUrl: DAEMON_URL, sessionId: "latest", view: "atlas" });
    expect(atlasSearch).toContain("view=atlas");
    expect(readViewerParams(atlasSearch).view).toBe("atlas");
    expect(writeViewerSearch({ daemonUrl: DAEMON_URL, sessionId: "latest" })).not.toContain("view=");
  });

  it("round-trips deep-link action and artifact ids", () => {
    const search = writeViewerSearch({ daemonUrl: DAEMON_URL, sessionId: "sess_one", actionId: "act_9", artifactId: "shot_7" });
    expect(search).toContain("actionId=act_9");
    expect(search).toContain("artifactId=shot_7");

    const parsed = readViewerParams(search);
    expect(parsed.actionId).toBe("act_9");
    expect(parsed.artifactId).toBe("shot_7");

    expect(readViewerParams("?actionId=%20&artifactId=").actionId).toBeUndefined();
    expect(readViewerParams("?actionId=%20&artifactId=").artifactId).toBeUndefined();
    const plain = writeViewerSearch({ daemonUrl: DAEMON_URL, sessionId: "sess_one", actionId: "  ", artifactId: undefined });
    expect(plain).not.toContain("actionId=");
    expect(plain).not.toContain("artifactId=");
  });
});

describe("atlas api helpers", () => {
  it("builds screen image urls and display names", () => {
    expect(screenImageUrl(DAEMON_URL, "screen_aaaa")).toBe(`${DAEMON_URL}/v1/atlas/screens/screen_aaaa/image`);
    expect(screenImageUrl(DAEMON_URL, "screen_aaaa", 2)).toBe(`${DAEMON_URL}/v1/atlas/screens/screen_aaaa/image?variant=2`);
    expect(screenDisplayName(atlasView.map.screens[0] as never)).toBe("screen aaaa");
    expect(screenDisplayName(atlasView.map.screens[1] as never)).toBe("confirmation");
  });

  it("normalizes malformed map payloads defensively", () => {
    const normalized = normalizeAtlasView({ source: "cache", map: { generatedAt: "x" } } as never);
    expect(normalized.map.screens).toEqual([]);
    expect(normalized.map.transitions).toEqual([]);
    expect(normalized.warnings).toEqual([]);
  });
});

describe("AtlasView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, data: atlasView }), { status: 200 })));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders screen cards, opens details, and links back to sessions", async () => {
    const openedSessions: Array<{ sessionId: string; target?: { actionId?: string; artifactId?: string } }> = [];

    await act(async () => {
      root.render(
        <AtlasView
          params={{ daemonUrl: DAEMON_URL, sessionId: "latest", view: "atlas" }}
          onSwitchToSessions={() => undefined}
          onOpenSession={(sessionId, target) => openedSessions.push({ sessionId, target })}
        />
      );
    });

    const cards = container.querySelectorAll<HTMLButtonElement>("button.atlas-screen-card");
    expect(cards).toHaveLength(2);
    expect(container.textContent).toContain("2 screens · 2 transitions · 2 sessions");
    expect(cards[1].textContent).toContain("confirmation");

    await act(async () => {
      cards[1].click();
    });

    const detail = container.querySelector(".atlas-detail");
    expect(detail).not.toBeNull();
    expect(detail!.textContent).toContain("Arrives from");
    expect(detail!.textContent).toContain("tap:cart.continue");

    const sessionButton = detail!.querySelector<HTMLButtonElement>(".atlas-detail-sessions button");
    await act(async () => {
      sessionButton!.click();
    });
    expect(openedSessions).toEqual([{ sessionId: "sess_one", target: undefined }]);

    const exampleButton = detail!.querySelector<HTMLButtonElement>(".atlas-transition-example");
    expect(exampleButton).not.toBeNull();
    expect(exampleButton!.getAttribute("aria-label")).toBe("Open example of tap:cart.continue in session sess_one");
    await act(async () => {
      exampleButton!.click();
    });
    expect(openedSessions.at(-1)).toEqual({ sessionId: "sess_one", target: { actionId: "act_continue" } });
  });

  it("deep links screen variants into their source session and artifact", async () => {
    const openedSessions: Array<{ sessionId: string; target?: { actionId?: string; artifactId?: string } }> = [];

    await act(async () => {
      root.render(
        <AtlasView
          params={{ daemonUrl: DAEMON_URL, sessionId: "latest", view: "atlas" }}
          onSwitchToSessions={() => undefined}
          onOpenSession={(sessionId, target) => openedSessions.push({ sessionId, target })}
        />
      );
    });

    const cards = container.querySelectorAll<HTMLButtonElement>("button.atlas-screen-card");
    await act(async () => {
      cards[0].click();
    });

    const variantButtons = container.querySelectorAll<HTMLButtonElement>(".atlas-variant-link");
    expect(variantButtons).toHaveLength(2);
    expect(variantButtons[1].getAttribute("aria-label")).toBe("Open variant 2 in session sess_two");

    await act(async () => {
      variantButtons[1].click();
    });
    expect(openedSessions).toEqual([{ sessionId: "sess_two", target: { artifactId: "shot_3" } }]);
  });
});
