import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { tools } from "../../apps/mcp-server/src/index.js";

/**
 * The daemon is the capability surface; the CLI and the MCP server are the two
 * ways to reach it. A route that only one of them exposes is a capability an
 * operator or an agent silently cannot use, which is how `metrics` sat
 * unreachable from both while the viewer quietly used it.
 *
 * This pins the mapping. Adding a daemon route without a CLI command and an
 * MCP tool now fails here, and a deliberate omission has to be written down.
 */

const REPO_ROOT = new URL("../../", import.meta.url).pathname;

/** Daemon session routes and the surfaces that must reach each one. */
const SESSION_ROUTES: Array<{ route: string; cli: string; mcpTool: string }> = [
  { route: "summary", cli: '"summary"', mcpTool: "atlas.getSessionSummary" },
  { route: "artifacts", cli: '"artifacts"', mcpTool: "atlas.listArtifacts" },
  { route: "events", cli: '"events"', mcpTool: "atlas.listEvents" },
  { route: "metrics", cli: '"metrics"', mcpTool: "atlas.getSessionMetrics" },
  { route: "logs", cli: '"logs"', mcpTool: "atlas.getDeviceLogs" },
  { route: "state", cli: '"state"', mcpTool: "atlas.captureSessionState" },
  { route: "build", cli: '"build"', mcpTool: "atlas.build" },
  { route: "install", cli: '"install"', mcpTool: "atlas.install" },
  { route: "launch", cli: '"launch"', mcpTool: "atlas.launch" },
  { route: "location", cli: '"location"', mcpTool: "atlas.setLocation" },
  { route: "actions", cli: '"tap"', mcpTool: "atlas.performAction" },
  { route: "screenshot", cli: '"screenshot"', mcpTool: "atlas.takeScreenshot" },
  { route: "recording", cli: '"recording"', mcpTool: "atlas.startRecording" },
  { route: "end", cli: '"end"', mcpTool: "atlas.endSession" },
  { route: "map", cli: '"map"', mcpTool: "atlas.getMap" }
];

/**
 * Routes with no direct command, and why. Each one is reachable another way or
 * is an internal transport rather than a capability.
 */
const INTENTIONALLY_UNEXPOSED: Record<string, string> = {
  "latest-screenshot": "Served as image bytes; reached by path through atlas.getLatestScreenshotPath.",
  image: "Static artifact bytes for the viewer, not an operator capability.",
  screens: "Atlas screen images for the viewer; the data is in atlas.getMap.",
  health: "Reached by the top-level `health` command and atlas.health, not a session route.",
  history: "Reached by `session history` and atlas.listSessionHistory.",
  start: "Recording sub-route, covered by the `recording` entry.",
  stop: "Recording sub-route, covered by the `recording` entry.",
  rebuild: "Atlas map sub-route, reached by the rebuild flag on `map` and atlas.getMap."
};

describe("surface parity", () => {
  it("reaches every mapped daemon route from both the CLI and MCP", async () => {
    const cli = await readFile(`${REPO_ROOT}apps/cli/src/index.ts`, "utf8");
    const mcpToolNames = new Set(tools.map((tool) => tool.name));

    for (const entry of SESSION_ROUTES) {
      expect(cli.includes(entry.cli), `CLI has no command matching ${entry.cli} for /${entry.route}`).toBe(true);
      expect(mcpToolNames.has(entry.mcpTool), `MCP has no ${entry.mcpTool} for /${entry.route}`).toBe(true);
    }
  });

  it("accounts for every daemon session route", async () => {
    const server = await readFile(`${REPO_ROOT}apps/daemon/src/server.ts`, "utf8");
    const routes = new Set(
      [...server.matchAll(/parts\[[23]\] === "([a-z-]+)"/g)].map((match) => match[1]!)
    );

    const mapped = new Set(SESSION_ROUTES.map((entry) => entry.route));
    const unaccounted = [...routes].filter((route) => !mapped.has(route) && !(route in INTENTIONALLY_UNEXPOSED));

    // A new route must either gain both surfaces or be listed with a reason.
    expect(unaccounted, `Unaccounted daemon routes: ${unaccounted.join(", ")}`).toEqual([]);
  });

  it("gives every MCP tool a description an agent can act on", () => {
    for (const tool of tools) {
      expect(tool.name, `${tool.name} is not namespaced`).toMatch(/^atlas\.[a-zA-Z]+$/);
      // Catches empty or one-word descriptions without demanding padding of
      // the ones that are genuinely short and clear.
      expect((tool.description ?? "").length, `${tool.name} has no usable description`).toBeGreaterThanOrEqual(15);
      expect(tool.inputSchema, `${tool.name} has no input schema`).toBeDefined();
    }
  });

  it("exposes host readiness to agents, not only to the CLI", () => {
    // An agent that cannot check the toolchain reports a broken run as a
    // product failure instead of a missing simctl.
    expect(tools.some((tool) => tool.name === "atlas.doctor")).toBe(true);
  });
});
