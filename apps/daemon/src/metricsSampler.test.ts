import { describe, expect, it } from "vitest";
import { parseLaunchPid, parsePsSample } from "./metricsSampler.ts";

describe("metrics parsing", () => {
  it("parses simctl launch pids", () => {
    expect(parseLaunchPid("app.atlasloop.CommerceDemo: 12345\n")).toBe(12345);
    expect(parseLaunchPid("com.example.app: 7")).toBe(7);
    expect(parseLaunchPid("")).toBeUndefined();
    expect(parseLaunchPid("no pid here")).toBeUndefined();
    expect(parseLaunchPid("bundle: -3")).toBeUndefined();
  });

  it("parses ps cpu/rss output", () => {
    expect(parsePsSample(" 12.5  50000\n")).toEqual({ cpuPercent: 12.5, rssKilobytes: 50000 });
    expect(parsePsSample("0.0 1024")).toEqual({ cpuPercent: 0, rssKilobytes: 1024 });
    expect(parsePsSample("")).toBeUndefined();
    expect(parsePsSample("garbage output")).toBeUndefined();
  });
});
