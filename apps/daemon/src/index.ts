import { pathToFileURL } from "node:url";
import { startDaemonServer } from "./server.ts";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const portArg = process.argv.find((arg) => arg.startsWith("--port="));
  const port = portArg ? Number(portArg.slice("--port=".length)) : undefined;
  const daemon = await startDaemonServer({ port });
  console.error(`atlas-loop daemon listening on ${daemon.url}`);
}
