#!/usr/bin/env tsx
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createSimulator } from "@atlas-loop/simulator";
import { loadConfig } from "@atlas-loop/config";
import { DaemonClient } from "@atlas-loop/daemon-client";
import { startDaemonServer } from "../../daemon/src/server.ts";
import type { ActionInput } from "@atlas-loop/protocol";

type Args = string[];

async function main(args: Args): Promise<number> {
  const [command, subcommand, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }

  if (command === "doctor") return doctor();

  if (command === "daemon" && subcommand === "start") {
    const flags = parseFlags(rest);
    const port = numberFlag(flags, "port") ?? (await loadConfig()).daemonPort;
    const started = await startDaemonServer({ port });
    console.log(JSON.stringify({ ok: true, url: started.url }, null, 2));
    await new Promise(() => undefined);
    return 0;
  }

  const flags = parseFlags([subcommand, ...rest].filter(Boolean));
  const client = new DaemonClient({ baseUrl: stringFlag(flags, "daemon-url") });

  if (command === "session") {
    if (subcommand === "start" || subcommand === "create") {
      const session = await client.createSession({
        simulator: {
          name: stringFlag(flags, "simulator"),
          udid: stringFlag(flags, "udid")
        },
        viewer: booleanFlag(flags, "viewer")
      });
      printJson(session);
      return 0;
    }
    if (subcommand === "stop" || subcommand === "end") {
      printJson(await client.endSession(requireFlag(flags, "session")));
      return 0;
    }
  }

  if (command === "build") {
    printJson(await client.build(requireFlag(flags, "session"), {
      workspacePath: stringFlag(flags, "workspace"),
      projectPath: stringFlag(flags, "project"),
      scheme: requireFlag(flags, "scheme"),
      configuration: stringFlag(flags, "configuration") as "Debug" | "Release" | undefined,
      derivedDataPath: stringFlag(flags, "derived-data")
    }));
    return 0;
  }

  if (command === "install") {
    printJson(await client.install(requireFlag(flags, "session"), { appPath: requireFlag(flags, "app") }));
    return 0;
  }

  if (command === "launch") {
    printJson(await client.launch(requireFlag(flags, "session"), {
      bundleId: requireFlag(flags, "bundle-id"),
      arguments: csvFlag(flags, "args")
    }));
    return 0;
  }

  if (command === "tap") {
    return action(client, flags, { kind: "tap", x: numberFlagRequired(flags, "x"), y: numberFlagRequired(flags, "y") });
  }

  if (command === "type") {
    return action(client, flags, { kind: "typeText", text: requireFlag(flags, "text") });
  }

  if (command === "swipe") {
    return action(client, flags, {
      kind: "swipe",
      from: parsePoint(requireFlag(flags, "from")),
      to: parsePoint(requireFlag(flags, "to")),
      durationMs: numberFlag(flags, "duration-ms") ?? 350
    });
  }

  if (command === "edge") {
    return action(client, flags, {
      kind: "edgeGesture",
      edge: requireFlag(flags, "edge") as ActionInput & string,
      distance: numberFlag(flags, "distance") ?? 0.75,
      durationMs: numberFlag(flags, "duration-ms") ?? 350
    } as ActionInput);
  }

  if (command === "screenshot") {
    printJson(await client.screenshot(requireFlag(flags, "session"), stringFlag(flags, "reason")));
    return 0;
  }

  if (command === "artifacts" && subcommand === "list") {
    printJson(await client.listArtifacts(requireFlag(flags, "session")));
    return 0;
  }

  if (command === "viewer" && subcommand === "open") {
    const sessionId = requireFlag(flags, "session");
    const daemonUrl = stringFlag(flags, "daemon-url") ?? (await loadConfig()).daemonUrl;
    const url = `http://127.0.0.1:5173?daemonUrl=${encodeURIComponent(daemonUrl)}&sessionId=${encodeURIComponent(sessionId)}`;
    console.log(url);
    if (booleanFlag(flags, "launch")) spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return 0;
  }

  throw new Error(`Unknown command: ${args.join(" ")}`);
}

async function action(client: DaemonClient, flags: Map<string, string | boolean>, actionInput: ActionInput): Promise<number> {
  printJson(await client.performAction(requireFlag(flags, "session"), actionInput));
  return 0;
}

async function doctor(): Promise<number> {
  const config = await loadConfig();
  const simulator = createSimulator();
  const checks = await simulator.doctor();
  const helperExists = existsSync(config.hidHelperPath);
  printJson({
    ok: checks.ok,
    checks: [
      ...checks.checks,
      {
        name: "ios-hid-helper",
        ok: helperExists,
        message: helperExists ? config.hidHelperPath : `missing helper at ${config.hidHelperPath}`
      }
    ]
  });
  return checks.ok ? 0 : 1;
}

function parseFlags(args: Args): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(key, true);
      continue;
    }
    flags.set(key, next);
    index += 1;
  }
  positional.forEach((value, index) => flags.set(`_${index}`, value));
  return flags;
}

function stringFlag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function requireFlag(flags: Map<string, string | boolean>, name: string): string {
  const value = stringFlag(flags, name);
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

function booleanFlag(flags: Map<string, string | boolean>, name: string): boolean {
  return flags.get(name) === true || flags.get(name) === "true";
}

function numberFlag(flags: Map<string, string | boolean>, name: string): number | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function numberFlagRequired(flags: Map<string, string | boolean>, name: string): number {
  const value = numberFlag(flags, name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

function csvFlag(flags: Map<string, string | boolean>, name: string): string[] | undefined {
  const value = stringFlag(flags, name);
  return value ? value.split(",").filter(Boolean) : undefined;
}

function parsePoint(value: string): { x: number; y: number } {
  const [x, y] = value.split(",").map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Invalid point ${value}; expected x,y`);
  return { x, y };
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`Atlas Loop CLI

Usage:
  atlas-loop doctor
  atlas-loop daemon start --port 4317
  atlas-loop session start --simulator "iPhone 16" [--viewer]
  atlas-loop session stop --session <id>
  atlas-loop build --session <id> --project <path> --scheme <scheme>
  atlas-loop install --session <id> --app <path.app>
  atlas-loop launch --session <id> --bundle-id <bundle>
  atlas-loop tap --session <id> --x 0.5 --y 0.5
  atlas-loop type --session <id> --text "Ada Lovelace"
  atlas-loop swipe --session <id> --from 0.5,0.8 --to 0.5,0.2 --duration-ms 350
  atlas-loop screenshot --session <id> [--reason label]
  atlas-loop viewer open --session <id> [--launch]
`);
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`[atlas-loop] ${(error as Error).message}`);
  process.exitCode = 1;
});
