/**
 * Rendering only as much of a list as anyone will read.
 *
 * The artifact list and the timeline both rendered every row a run produced. On
 * a session with six hundred artifacts that is 600 rows plus 1414 timeline
 * cards mounted at once — measured at 11,439 DOM nodes, a 22.6 second first
 * paint, and 1.2 to 3.5 seconds of lag per keystroke in the filter box. Typing
 * one character into a search field took longer than a second, which is not a
 * slow list, it is a broken one.
 *
 * Both lists already have filters. This makes filtering the path you take
 * rather than the path you could have taken, by rendering a readable page of
 * rows and offering the rest deliberately.
 */

export interface CappedList<T> {
  /** Rows to render now. */
  visible: T[];
  /** Everything that passed the caller's own filtering. */
  total: number;
  /** How many are held back. */
  hidden: number;
  /**
   * What the "show more" control should say, or undefined when nothing is held
   * back. Revealing happens in pages: unbounding a six hundred row list in one
   * click would move the freeze behind a button rather than remove it.
   */
  moreLabel?: string;
  /** The limit that reveals the next page. */
  nextLimit: number;
}

export interface CapListOptions {
  /** Rows rendered before anything is held back. */
  limit: number;
  /** Rows added each time the operator asks for more. Defaults to the limit. */
  page?: number;
  /** A remainder at or below this is offered in full rather than paged. */
  revealAllUpTo?: number;
  /** Singular noun for the control, e.g. `"artifact"`. */
  noun?: string;
}

function count(n: number, noun: string | undefined): string {
  if (!noun) return String(n);
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function capList<T>(items: readonly T[], options: CapListOptions): CappedList<T> {
  const limit = Math.max(0, options.limit);
  const page = Math.max(1, options.page ?? limit ?? 1);
  const revealAllUpTo = options.revealAllUpTo ?? page;
  const total = items.length;

  if (total <= limit) return { visible: [...items], total, hidden: 0, nextLimit: limit };

  const hidden = total - limit;
  return {
    visible: items.slice(0, limit),
    total,
    hidden,
    moreLabel:
      hidden <= revealAllUpTo
        ? `Show all ${count(total, options.noun)}`
        : `Show ${page} more of ${count(hidden, options.noun)}`,
    nextLimit: Math.min(total, limit + page)
  };
}
