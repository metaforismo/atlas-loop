import { pathToFileURL } from "node:url";
import { startDaemonServer } from "./server.ts";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = parsePort(process.argv.slice(2));
  const daemon = await startDaemonServer({ port });
  console.error(`atlas-loop daemon listening on ${daemon.url}`);
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
