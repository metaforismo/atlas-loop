import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("MCP contract documentation", () => {
  it("documents the daemon-backed MCP tool surface without requiring a daemon process", async () => {
    const daemonApi = await readFile(resolve("docs", "daemon-api.md"), "utf8");

    for (const requiredText of [
      "tools/list",
      "tools/call",
      "atlas.createSession",
      "atlas.performAction",
      "atlas.getSession",
      "atlas.endSession"
    ]) {
      expect(daemonApi).toContain(requiredText);
    }
  });
});
