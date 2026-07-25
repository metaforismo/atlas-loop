/**
 * Polling that waits for its own work.
 *
 * `setInterval` fires on a clock, not on completion. When a cycle takes longer
 * than the interval — which a session with hundreds of artifacts easily does,
 * because each cycle fetches, sets state, and re-renders a heavy tree — the
 * calls stack. Each new one makes the next slower, and the page spends its time
 * re-fetching data it already has.
 *
 * Measured on a six hundred artifact session: one page load fired 24 requests
 * each at /artifacts, /summary, and /sessions/:id, where the same load on a
 * small session fired five. Waiting for the work and *then* scheduling the next
 * run cannot do that, whatever the payload grows to.
 */
export interface PollOptions {
  /** Gap between the end of one run and the start of the next. */
  everyMs: number;
  /** Skips a run without stopping the loop, e.g. while the tab is hidden. */
  shouldRun?: () => boolean;
}

/** Starts the loop and returns a function that stops it. */
export function startPolling(work: () => Promise<void>, options: PollOptions): () => void {
  let stopped = false;
  let timer: number | undefined;

  const schedule = (): void => {
    if (stopped) return;
    timer = window.setTimeout(run, options.everyMs);
  };

  const run = async (): Promise<void> => {
    if (stopped) return;
    if (options.shouldRun && !options.shouldRun()) {
      // A skipped run still keeps the loop alive, so the poll resumes on its
      // own when whatever it was waiting for comes back.
      schedule();
      return;
    }
    try {
      await work();
    } catch {
      // A poll's job is to keep polling. The work owns its own error
      // reporting — every caller here already catches and surfaces its own
      // failure — and letting the rejection escape an unawaited loop would
      // raise an unhandled rejection on every failed cycle instead.
    } finally {
      schedule();
    }
  };

  void run();

  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
