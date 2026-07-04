import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TraceEvent } from "@atlas-loop/protocol";

export async function appendTrace(tracePath: string, event: TraceEvent): Promise<void> {
  await mkdir(dirname(tracePath), { recursive: true });
  await appendFile(tracePath, `${JSON.stringify(event)}\n`, "utf8");
}

export function parseTraceLine(line: string): TraceEvent {
  return JSON.parse(line) as TraceEvent;
}
