import { useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

/**
 * Keyboard behaviour for a `role="tablist"`.
 *
 * A tablist is required to move between its tabs with the arrow keys, and a
 * click handler alone does not give you that: without it the only way to reach
 * a later tab from the keyboard is to tab through every control inside the open
 * one first. Paired with a roving tabindex, the whole strip is one tab stop and
 * the arrows move within it.
 *
 * This lives apart from any one tab component because the two tab strips in the
 * viewer render different markup, and the keyboard contract is the part that
 * must not drift between them.
 */
export interface TabListKeys {
  ref: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  /** 0 for the open tab, -1 for the rest. */
  tabIndex: (id: string) => 0 | -1;
}

export function useTabListKeys<Id extends string>(
  ids: readonly Id[],
  selected: Id,
  onSelect: (id: Id) => void
): TabListKeys {
  const ref = useRef<HTMLDivElement | null>(null);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const current = ids.indexOf(selected);
    if (current < 0) return;

    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: ids.length - 1
    };
    const target = moves[event.key];
    if (target === undefined) return;

    event.preventDefault();
    // Wrapping keeps both ends reachable from either direction.
    const index = (target + ids.length) % ids.length;
    const next = ids[index];
    if (next === undefined) return;
    onSelect(next);
    // Found by position rather than by selector: the tab ids are the caller's
    // to choose, and building a selector out of them needs escaping that is
    // not available everywhere.
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  };

  return { ref, onKeyDown, tabIndex: (id) => (id === selected ? 0 : -1) };
}
