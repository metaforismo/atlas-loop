import { describe, expect, it } from "vitest";
import {
  LOCATION_PRESETS,
  formatCoordinate,
  formatDeviceLocation,
  locationClearArgs,
  locationSetArgs,
  parseDeviceLocation
} from "../../packages/protocol/src/index.js";
import { createSimulator, type RunCommand, type SimulatorCommandResult } from "../../packages/simulator/src/index.js";

function commandResult(overrides: Partial<SimulatorCommandResult> = {}): SimulatorCommandResult {
  return { command: "xcrun", args: [], exitCode: 0, stdout: "", stderr: "", durationMs: 1, ...overrides };
}

function recordingSimulator(exitCode = 0) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const runCommand: RunCommand = async (command, args) => {
    calls.push({ command, args });
    return commandResult({ command, args, exitCode, stderr: exitCode === 0 ? "" : "device not found" });
  };
  return { simulator: createSimulator({ runCommand }), calls };
}

describe("device location", () => {
  describe("coordinate formatting", () => {
    it("never emits exponent notation for a tiny coordinate", () => {
      // `(1e-7).toString()` is "1e-7", which simctl rejects.
      expect(formatCoordinate(1e-7)).toBe("0.000000");
      expect(formatCoordinate(1.5e-7)).toBe("0.000000");
      expect(formatCoordinate(-1e-7)).toBe("-0.000000");
    });

    it("never emits exponent notation anywhere in the valid range", () => {
      // `toFixed` only reaches exponent notation at 1e21, far outside a
      // coordinate — but the invariant is worth pinning across the real range
      // rather than at one sampled value.
      for (let degrees = -180; degrees <= 180; degrees += 0.5) {
        expect(formatCoordinate(degrees)).not.toMatch(/e/i);
      }
      expect(formatCoordinate(-179.999999)).toBe("-179.999999");
    });

    it("is only reachable with a validated coordinate", () => {
      // The one input that would format with an exponent cannot get past
      // validation, which is what keeps the formatter this simple.
      expect(parseDeviceLocation(1e21, 0).errors).toEqual(["Latitude must be between -90 and 90."]);
    });

    it("always uses a dot separator regardless of host locale", () => {
      // `toFixed` is locale-independent; `toLocaleString` is not.
      expect(formatCoordinate(52.520008)).toBe("52.520008");
      expect(formatCoordinate(13.404954)).toBe("13.404954");
      expect(formatCoordinate(52.520008)).not.toContain(",");
    });

    it("normalises negative zero", () => {
      expect(formatCoordinate(-0)).toBe("0.000000");
      expect(formatCoordinate(0)).toBe("0.000000");
    });

    it("keeps six decimal places so the pair is unambiguous", () => {
      expect(formatDeviceLocation({ latitude: -33.86882, longitude: 151.20929 })).toBe("-33.868820,151.209290");
    });
  });

  describe("validation", () => {
    it("accepts a valid pair from numbers or strings", () => {
      expect(parseDeviceLocation(37.774929, -122.419418)).toEqual({
        location: { latitude: 37.774929, longitude: -122.419418 },
        errors: []
      });
      expect(parseDeviceLocation("51.507351", "-0.127758").location).toEqual({
        latitude: 51.507351,
        longitude: -0.127758
      });
    });

    it("accepts the exact range boundaries", () => {
      expect(parseDeviceLocation(90, 180).errors).toEqual([]);
      expect(parseDeviceLocation(-90, -180).errors).toEqual([]);
      expect(parseDeviceLocation(0, 0).errors).toEqual([]);
    });

    it("rejects coordinates outside the range", () => {
      expect(parseDeviceLocation(90.1, 0).errors).toEqual(["Latitude must be between -90 and 90."]);
      expect(parseDeviceLocation(0, -180.1).errors).toEqual(["Longitude must be between -180 and 180."]);
    });

    it("rejects values that are not finite numbers", () => {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "abc", "", "  ", null, undefined, {}]) {
        expect(parseDeviceLocation(bad, 0).errors).toHaveLength(1);
      }
    });

    it("reports both axes together instead of failing on the first", () => {
      const result = parseDeviceLocation(1000, "nope");

      expect(result.location).toBeUndefined();
      expect(result.errors).toHaveLength(2);
    });

    it("does not treat a blank string as zero", () => {
      // `Number("")` is 0, which would silently place the device off Africa.
      expect(parseDeviceLocation("", "").location).toBeUndefined();
    });
  });

  describe("simctl arguments", () => {
    it("builds the set argv simctl expects", () => {
      expect(locationSetArgs("ABC-123", { latitude: 35.689487, longitude: 139.691711 })).toEqual([
        "simctl",
        "location",
        "ABC-123",
        "set",
        "35.689487,139.691711"
      ]);
    });

    it("builds the clear argv", () => {
      expect(locationClearArgs("ABC-123")).toEqual(["simctl", "location", "ABC-123", "clear"]);
    });

    it("passes a single comma-joined value rather than two arguments", () => {
      const args = locationSetArgs("booted", { latitude: 1, longitude: 2 });

      expect(args).toHaveLength(5);
      expect(args[4]).toBe("1.000000,2.000000");
    });
  });

  describe("simulator methods", () => {
    it("runs the set command against the booted device by default", async () => {
      const { simulator, calls } = recordingSimulator();

      await simulator.setLocation({ latitude: 51.507351, longitude: -0.127758 });

      expect(calls).toHaveLength(1);
      expect(calls[0]!.command).toBe("xcrun");
      expect(calls[0]!.args).toEqual(["simctl", "location", "booted", "set", "51.507351,-0.127758"]);
    });

    it("targets an explicit simulator when one is given", async () => {
      const { simulator, calls } = recordingSimulator();

      await simulator.setLocation({ simulator: { udid: "UDID-9" }, latitude: 0, longitude: 0 });

      expect(calls[0]!.args[2]).toBe("UDID-9");
    });

    it("runs the clear command", async () => {
      const { simulator, calls } = recordingSimulator();

      await simulator.clearLocation();

      expect(calls[0]!.args).toEqual(["simctl", "location", "booted", "clear"]);
    });

    it("raises a simulator error when the command fails", async () => {
      const { simulator } = recordingSimulator(1);

      await expect(simulator.setLocation({ latitude: 0, longitude: 0 })).rejects.toMatchObject({
        code: "COMMAND_FAILED"
      });
    });
  });

  describe("presets", () => {
    it("only ships coordinates that pass validation", () => {
      for (const preset of LOCATION_PRESETS) {
        expect(parseDeviceLocation(preset.latitude, preset.longitude).errors).toEqual([]);
      }
    });

    it("uses unique ids", () => {
      expect(new Set(LOCATION_PRESETS.map((preset) => preset.id)).size).toBe(LOCATION_PRESETS.length);
    });

    it("covers both hemispheres and the equator", () => {
      expect(LOCATION_PRESETS.some((preset) => preset.latitude > 0)).toBe(true);
      expect(LOCATION_PRESETS.some((preset) => preset.latitude < 0)).toBe(true);
      expect(LOCATION_PRESETS.some((preset) => Math.abs(preset.latitude) < 1)).toBe(true);
      expect(LOCATION_PRESETS.some((preset) => preset.longitude < 0)).toBe(true);
      expect(LOCATION_PRESETS.some((preset) => preset.longitude > 0)).toBe(true);
    });
  });
});
