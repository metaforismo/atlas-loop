import { describe, expect, it } from "vitest";
import { createSimulator, simulatorErrorFromCommand } from "./index.ts";

describe("simulator command wrapper", () => {
  it("builds xcodebuild arguments for workspace builds", async () => {
    const calls: string[] = [];
    const simulator = createSimulator({
      runCommand: async (command, args) => {
        calls.push([command, ...args].join(" "));
        return { command, args, exitCode: 0, stdout: "ok", stderr: "", durationMs: 1 };
      }
    });

    await simulator.build({
      workspacePath: "App.xcworkspace",
      scheme: "App",
      configuration: "Debug",
      derivedDataPath: ".derived"
    });

    expect(calls[0]).toContain("xcodebuild");
    expect(calls[0]).toContain("-workspace App.xcworkspace");
    expect(calls[0]).toContain("-scheme App");
    expect(calls[0]).toContain("-destination generic/platform=iOS Simulator");
  });

  it("maps failed simulator commands to structured Atlas errors", () => {
    const error = simulatorErrorFromCommand("INSTALL_FAILED", {
      command: "xcrun",
      args: ["simctl", "install", "booted", "App.app"],
      exitCode: 1,
      stdout: "",
      stderr: "No devices are booted",
      durationMs: 4
    });

    expect(error.code).toBe("INSTALL_FAILED");
    expect(error.message).toContain("xcrun simctl install booted App.app failed");
    expect(error.details?.stderr).toBe("No devices are booted");
  });
});
