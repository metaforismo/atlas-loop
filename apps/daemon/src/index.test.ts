import { describe, expect, it } from "vitest";
import { parsePort } from "./index.ts";

describe("daemon entrypoint", () => {
  it("parses split and equals port flags", () => {
    expect(parsePort(["--port", "4318"])).toBe(4318);
    expect(parsePort(["--port=4319"])).toBe(4319);
    expect(parsePort(["--port", "nope"])).toBeUndefined();
  });
});
