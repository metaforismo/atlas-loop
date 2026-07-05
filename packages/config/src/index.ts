import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface DriverPortRange {
  start: number;
  end: number;
}

export interface AtlasLoopConfig {
  daemonUrl: string;
  daemonPort: number;
  artifactRoot: string;
  hidHelperPath: string;
  driverRunnerProjectPath: string;
  driverRunnerDerivedData: string;
  driverPortRange: DriverPortRange;
  /** Capture a screenshot after every successful input action (default true). */
  autoScreenshot: boolean;
}

export function defaultConfig(cwd = process.cwd()): AtlasLoopConfig {
  return {
    daemonUrl: process.env.ATLAS_LOOP_DAEMON_URL ?? "http://127.0.0.1:4317",
    daemonPort: Number(process.env.ATLAS_LOOP_DAEMON_PORT ?? 4317),
    artifactRoot: resolve(cwd, "artifacts", "sessions"),
    hidHelperPath: resolve(cwd, "native", "ios-hid-helper", ".build", "debug", "ios-hid-helper"),
    driverRunnerProjectPath: resolve(cwd, "native", "ios-driver-runner", "AtlasDriverRunner.xcodeproj"),
    driverRunnerDerivedData: resolve(cwd, "artifacts", "build", "driver-runner", "DerivedData"),
    driverPortRange: { start: 4700, end: 4799 },
    autoScreenshot: true
  };
}

export async function loadConfig(cwd = process.cwd()): Promise<AtlasLoopConfig> {
  const base = defaultConfig(cwd);
  const configPath = join(cwd, "atlas-loop.config.json");
  if (!existsSync(configPath)) return base;
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as Partial<AtlasLoopConfig>;
  return { ...base, ...parsed };
}
