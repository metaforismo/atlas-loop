import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { HidClient } from "./index.ts";

class FakeChild extends EventEmitter {
  stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.writes.push(String(chunk));
      callback();
    }
  });
  stdout = new PassThrough();
  stderr = new PassThrough();
  writes: string[] = [];
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit("exit", 0, null);
    return true;
  }
}

describe("HidClient", () => {
  it("sends NDJSON requests with ids and resolves matching responses", async () => {
    const child = new FakeChild();
    const client = new HidClient({
      helperPath: "/tmp/helper",
      spawnHelper: () => child as never,
      defaultTimeoutMs: 500
    });

    const pending = client.tap({ udid: "booted", x: 0.25, y: 0.75 });
    const request = JSON.parse(child.writes[0]);
    child.stdout.write(`${JSON.stringify({ id: request.id, type: request.type, ok: true, data: { tapped: true } })}\n`);

    await expect(pending).resolves.toEqual({ tapped: true });
    expect(request.type).toBe("tap");
    expect(request.data).toEqual({ udid: "booted", x: 0.25, y: 0.75 });
  });

  it("maps swipe points to the native helper protocol", async () => {
    const child = new FakeChild();
    const client = new HidClient({
      helperPath: "/tmp/helper",
      spawnHelper: () => child as never,
      defaultTimeoutMs: 500
    });

    const pending = client.swipe({
      udid: "booted",
      from: { x: 0.5, y: 0.9 },
      to: { x: 0.5, y: 0.2 },
      durationMs: 300
    });
    const request = JSON.parse(child.writes[0]);
    child.stdout.write(`${JSON.stringify({ id: request.id, type: request.type, ok: true, data: { swiped: true } })}\n`);

    await expect(pending).resolves.toEqual({ swiped: true });
    expect(request.type).toBe("swipe");
    expect(request.data).toEqual({
      udid: "booted",
      startX: 0.5,
      startY: 0.9,
      endX: 0.5,
      endY: 0.2,
      durationMs: 300
    });
  });

  it("can attach to Simulator before actions", async () => {
    const child = new FakeChild();
    const client = new HidClient({
      helperPath: "/tmp/helper",
      spawnHelper: () => child as never,
      defaultTimeoutMs: 500
    });

    const pending = client.attach({ windowTitleContains: "iPhone 16" });
    const request = JSON.parse(child.writes[0]);
    child.stdout.write(`${JSON.stringify({ id: request.id, type: request.type, ok: true, data: { attached: true } })}\n`);

    await expect(pending).resolves.toEqual({ attached: true });
    expect(request.type).toBe("attach");
    expect(request.data).toEqual({ appName: "Simulator", windowTitleContains: "iPhone 16" });
  });

  it("rejects timed out requests with captured stderr", async () => {
    const child = new FakeChild();
    const client = new HidClient({
      helperPath: "/tmp/helper",
      spawnHelper: () => child as never,
      defaultTimeoutMs: 5
    });

    child.stderr.write("helper warning\n");
    await expect(client.typeText({ udid: "booted", text: "hello" })).rejects.toMatchObject({
      code: "ACTION_TIMEOUT",
      details: { stderr: "helper warning\n" }
    });
  });
});
