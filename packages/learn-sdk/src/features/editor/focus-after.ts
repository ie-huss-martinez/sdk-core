import { type RefObject, useCallback, useEffect, useRef } from "react";

/** A field, then a list's row, then a button: a new order can be rearranged at once. */
const FOCUSABLE = "input:not([type=radio]), textarea, [role=gridcell][tabindex='0'], button";

/**
 * Focus after an edit renders (ADR 0008): adding a choice focuses its field,
 * removing one focuses its neighbour, and moving a word keeps focus on the
 * button that moved it. `focusAfter(key, control?)` names the element with
 * `data-hm-focus-key`; its control with that `data-hm-focus-control`, or else
 * its first field or button, takes focus once the edit's render is in place.
 */
export function useFocusAfter<Root extends HTMLElement>(): {
  readonly ref: RefObject<Root | null>;
  readonly focusAfter: (key: string, control?: string) => void;
} {
  const ref = useRef<Root | null>(null);
  const wanted = useRef<{ readonly key: string; readonly control?: string | undefined } | null>(
    null,
  );
  // Runs after every render, and acts only when an edit asked for focus.
  useEffect(() => {
    const focus = wanted.current;
    if (focus === null) return;
    wanted.current = null;
    const target = ref.current?.querySelector(`[data-hm-focus-key="${CSS.escape(focus.key)}"]`);
    const control = focus.control
      ? target?.querySelector<HTMLElement>(`[data-hm-focus-control="${CSS.escape(focus.control)}"]`)
      : target?.matches(FOCUSABLE)
        ? (target as HTMLElement)
        : target?.querySelector<HTMLElement>(FOCUSABLE);
    control?.focus();
  });
  const focusAfter = useCallback((key: string, control?: string) => {
    wanted.current = { key, control };
  }, []);
  return { ref, focusAfter };
}
