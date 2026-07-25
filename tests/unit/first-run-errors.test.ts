import { describe, expect, it } from "vitest";
import { simulatorErrorFromCommand } from "../../packages/simulator/src/index.js";

function failure(stderr: string) {
  return {
    command: "xcrun",
    args: ["simctl", "io", "iPhone 16", "screenshot", "/tmp/x.png"],
    stdout: "",
    stderr,
    exitCode: 148,
    signal: null,
    durationMs: 694
  };
}

describe("explaining a simctl failure", () => {
  it("names the missing Simulator and how to see what exists", () => {
    // The documented first command names "iPhone 16". On a Mac without one,
    // simctl says `Invalid device: iPhone 16` — true, and no help at all.
    const error = simulatorErrorFromCommand("COMMAND_FAILED", failure("Invalid device: iPhone 16\n"));

    expect(error.message).toContain('no Simulator named "iPhone 16"');
    expect(error.message).toContain("xcrun simctl list devices available");
  });

  it("keeps the raw output, which is what a bug report needs", () => {
    const error = simulatorErrorFromCommand("COMMAND_FAILED", failure("Invalid device: iPhone 16\n"));

    expect(error.details).toMatchObject({ exitCode: 148, stderr: "Invalid device: iPhone 16\n" });
  });

  it("explains a Simulator that will not boot", () => {
    const error = simulatorErrorFromCommand("COMMAND_FAILED", failure("Unable to boot device in current state: Booted"));

    expect(error.message).toContain("would not boot");
  });

  it("falls back to the command line for a failure it cannot explain", () => {
    // Inventing an explanation for an unrecognised failure would be worse than
    // showing what actually ran.
    const error = simulatorErrorFromCommand("COMMAND_FAILED", failure("some unfamiliar failure"));

    expect(error.message).toBe("xcrun simctl io iPhone 16 screenshot /tmp/x.png failed with exit code 148");
  });
});
