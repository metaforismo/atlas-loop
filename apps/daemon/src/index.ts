import { pathToFileURL } from "node:url";
import { startDaemonServer } from "./server.ts";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = parsePort(process.argv.slice(2));
  const daemon = await startDaemonServer({ port });
  console.error(`atlas-loop daemon listening on ${daemon.url}`);

  // Close spawned resources (notably xcuitest driver runner children) before
  // exiting, so a killed daemon does not leave orphaned xcodebuild processes.
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`atlas-loop daemon received ${signal}; shutting down`);
    void daemon.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

export function parsePort(args: string[]): number | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port") {
      const parsed = Number(args[index + 1]);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    if (arg.startsWith("--port=")) {
      const parsed = Number(arg.slice("--port=".length));
      return Number.isFinite(parsed) ? parsed : undefined;
    }
  }
  return undefined;
}
