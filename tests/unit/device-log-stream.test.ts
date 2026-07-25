import { EventEmitter } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { logStreamArgs, startDeviceLogStream } from "../../apps/daemon/src/deviceLogStream.js";

class FakeChild extends EventEmitter {
  stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  stderr = new EventEmitter();
  signals: string[] = [];
  kill(signal: string): boolean {
    this.signals.push(signal);
    return true;
  }
}

function ndjson(at: string, message: string, messageType = "Default"): string {
  return JSON.stringify({
    timestamp: at,
    messageType,
    eventMessage: message,
    processImagePath: "/CommerceDemo.app/CommerceDemo",
    processID: 42
  });
}

async function harness(overrides: Partial<Parameters<typeof startDeviceLogStream>[0]> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "atlas-loop-logs-"));
  const logPath = join(dir, "device.ndjson");
  const child = new FakeChild();
  const handle = startDeviceLogStream({
    udid: "UDID-1",
    logPath,
    processName: "CommerceDemo",
    maxEntries: 100,
    maxBytes: 1_000_000,
    spawnProcess: (() => child) as never,
    ...overrides
  });
  return { handle, child, logPath };
}

describe("device log stream arguments", () => {
  it("streams ndjson filtered to one process", () => {
    expect(logStreamArgs("UDID-1", "CommerceDemo")).toEqual([
      "simctl",
      "spawn",
      "UDID-1",
      "log",
      "stream",
      "--style",
      "ndjson",
      "--level",
      "default",
      "--predicate",
      'process == "CommerceDemo"'
    ]);
  });

  it("captures the whole system only when no process is given", () => {
    expect(logStreamArgs("UDID-1")).not.toContain("--predicate");
  });

  it("escapes a quote in the process name instead of breaking the predicate", () => {
    // The predicate is one argv entry and never goes through a shell, but an
    // unescaped quote would still corrupt the expression itself.
    expect(logStreamArgs("UDID-1", 'Odd"Name').at(-1)).toBe('process == "Odd\\"Name"');
  });
});

describe("device log stream capture", () => {
  it("writes parsed entries as NDJSON", async () => {
    const { handle, child, logPath } = await harness();

    child.stdout.emit("data", `${ndjson("2026-07-25 10:00:00.000000+0000", "first")}\n`);
    child.stdout.emit("data", `${ndjson("2026-07-25 10:00:01.000000+0000", "second", "Error")}\n`);
    await handle.stop();

    const lines = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ at: "2026-07-25T10:00:00.000Z", message: "first", level: "default" });
    expect(lines[1]).toMatchObject({ message: "second", level: "error", process: "CommerceDemo" });
    expect(handle.entryCount()).toBe(2);
  });

  it("reassembles an entry split across chunks", async () => {
    const { handle, child, logPath } = await harness();
    const line = ndjson("2026-07-25 10:00:00.000000+0000", "split across chunks");

    child.stdout.emit("data", line.slice(0, 30));
    child.stdout.emit("data", `${line.slice(30)}\n`);
    await handle.stop();

    expect(JSON.parse((await readFile(logPath, "utf8")).trim())).toMatchObject({ message: "split across chunks" });
  });

  it("flushes a trailing entry that never received its newline", async () => {
    const { handle, child, logPath } = await harness();

    child.stdout.emit("data", ndjson("2026-07-25 10:00:00.000000+0000", "no trailing newline"));
    await handle.stop();

    expect((await readFile(logPath, "utf8")).trim()).toContain("no trailing newline");
  });

  it("counts the banner and other unusable lines instead of writing them", async () => {
    const { handle, child, logPath } = await harness();

    child.stdout.emit("data", 'Filtering the log data using "process == \\"CommerceDemo\\""\n');
    child.stdout.emit("data", `${ndjson("2026-07-25 10:00:00.000000+0000", "real")}\n`);
    await handle.stop();

    expect(handle.skippedCount()).toBe(1);
    expect(handle.entryCount()).toBe(1);
    expect((await readFile(logPath, "utf8")).trim().split("\n")).toHaveLength(1);
  });

  it("stops at the entry cap and says it truncated", async () => {
    const { handle, child } = await harness({ maxEntries: 2 });

    for (let index = 0; index < 10; index += 1) {
      child.stdout.emit("data", `${ndjson("2026-07-25 10:00:00.000000+0000", `line ${index}`)}\n`);
    }
    await handle.stop();

    expect(handle.entryCount()).toBe(2);
    expect(handle.truncated()).toBe(true);
    expect(child.signals).toContain("SIGTERM");
  });

  it("stops at the byte cap", async () => {
    const { handle, child } = await harness({ maxBytes: 200 });

    for (let index = 0; index < 20; index += 1) {
      child.stdout.emit("data", `${ndjson("2026-07-25 10:00:00.000000+0000", `padded message ${index}`)}\n`);
    }
    await handle.stop();

    expect(handle.truncated()).toBe(true);
    expect(handle.entryCount()).toBeLessThan(20);
  });

  it("does not report truncation for a capture that stayed inside its caps", async () => {
    const { handle, child } = await harness();

    child.stdout.emit("data", `${ndjson("2026-07-25 10:00:00.000000+0000", "only one")}\n`);
    await handle.stop();

    expect(handle.truncated()).toBe(false);
  });

  it("reports a spawn failure instead of failing silently", async () => {
    const errors: Error[] = [];
    const { child, handle } = await harness({ onError: (error) => errors.push(error) });

    child.emit("error", new Error("xcrun missing"));
    child.stdout.emit("data", `${ndjson("2026-07-25 10:00:00.000000+0000", "after failure")}\n`);
    await handle.stop();

    expect(errors.map((error) => error.message)).toEqual(["xcrun missing"]);
    expect(handle.entryCount()).toBe(0);
  });

  it("is safe to stop twice", async () => {
    const { handle } = await harness();

    await handle.stop();
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
