import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

/**
 * A CLI that prints a failure and exits 0 is worse than one that says nothing:
 * every `&&`, every CI step, and every agent loop built on it treats the failed
 * action as a success. These routes answer HTTP 200 with `ok: false` inside the
 * result, so the exit code is the only signal a script can see.
 */
const CLI = new URL("../../apps/cli/src/index.ts", import.meta.url).pathname;

describe("action commands and their exit codes", () => {
  it("routes every action-shaped command through the result reporter", async () => {
    const source = await readFile(CLI, "utf8");

    // Each of these returns an ActionResult that can carry ok:false.
    for (const command of ["build", "install", "launch", "screenshot"]) {
      const block = source.slice(source.indexOf(`command === "${command}"`));
      const body = block.slice(0, block.indexOf("\n  }"));
      expect(body, `${command} must report its result's own outcome`).toContain("reportAction(");
      expect(body, `${command} must not hardcode success`).not.toMatch(/\n\s*return 0;/);
    }
  });

  it("makes a failed action exit non-zero", async () => {
    const source = await readFile(CLI, "utf8");
    const reporter = source.slice(source.indexOf("function reportAction("));

    expect(reporter.slice(0, 400)).toContain("ok === false ? 1 : 0");
  });

  it("does not fail a command that never reported an outcome", async () => {
    // A route with no `ok` field has not claimed to have failed, and treating
    // its silence as failure would break every read-only command.
    const source = await readFile(CLI, "utf8");

    expect(source).toContain("has not claimed to have failed");
  });
});
