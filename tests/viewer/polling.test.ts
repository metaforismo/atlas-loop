// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "../../apps/viewer/src/polling.js";

afterEach(() => vi.useRealTimers());

/** Resolves when the caller says so, so a slow cycle can be held open. */
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

describe("polling that waits for its own work", () => {
  it("never starts a run before the previous one finished", async () => {
    // setInterval fires on a clock: with a cycle slower than the interval the
    // calls stack, each making the next slower. This is that exact scenario.
    vi.useFakeTimers();
    let started = 0;
    const slow = deferred();
    const stop = startPolling(async () => {
      started += 1;
      await slow.promise;
    }, { everyMs: 100 });

    expect(started).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started, "a slow cycle must not be joined by nine more").toBe(1);

    slow.release();
    stop();
  });

  it("waits the full gap after the work, not from when it started", async () => {
    vi.useFakeTimers();
    const runs: number[] = [];
    const stop = startPolling(async () => {
      runs.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 40));
    }, { everyMs: 100 });

    await vi.advanceTimersByTimeAsync(300);
    stop();

    // Each cycle costs 40ms of work plus a 100ms gap, so runs land ~140ms apart.
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs[1]! - runs[0]!).toBeGreaterThanOrEqual(140);
  });

  it("keeps looping after the work throws", async () => {
    // A daemon that blinks out must not silently end the poll for the session.
    vi.useFakeTimers();
    let runs = 0;
    const stop = startPolling(async () => {
      runs += 1;
      throw new Error("daemon unreachable");
    }, { everyMs: 100 });

    await vi.advanceTimersByTimeAsync(350);
    stop();

    expect(runs).toBeGreaterThan(2);
  });

  it("skips a run without ending the loop, and resumes on its own", async () => {
    vi.useFakeTimers();
    let runs = 0;
    let allowed = false;
    const stop = startPolling(async () => {
      runs += 1;
    }, { everyMs: 100, shouldRun: () => allowed });

    await vi.advanceTimersByTimeAsync(500);
    expect(runs).toBe(0);

    allowed = true;
    await vi.advanceTimersByTimeAsync(200);
    stop();

    expect(runs).toBeGreaterThan(0);
  });

  it("stops for good once stopped, including mid-flight", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const held = deferred();
    const stop = startPolling(async () => {
      runs += 1;
      await held.promise;
    }, { everyMs: 100 });

    expect(runs).toBe(1);
    stop();
    held.release();
    await vi.advanceTimersByTimeAsync(1000);

    expect(runs).toBe(1);
  });
});
