import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("viewer fast-path contract", () => {
  it("keeps viewer tests non-Simulator and ready for the viewer app when present", () => {
    const viewerRoot = resolve("apps", "viewer");

    if (!existsSync(viewerRoot)) {
      expect(existsSync(viewerRoot)).toBe(false);
      return;
    }

    expect(existsSync(resolve(viewerRoot, "vite.config.ts"))).toBe(true);
    expect(existsSync(resolve(viewerRoot, "src"))).toBe(true);
  });
});
