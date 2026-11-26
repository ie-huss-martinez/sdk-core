import { type RefObject, useCallback, useEffect, useRef } from "react";

/**
 * Focus after an edit renders (ADR 0008): adding a choice focuses its field,
 * removing one focuses its neighbour. `focusAfter(key)` names the element
 * with `data-hm-focus-key`, whose first field or button takes focus once the
 * edit's render is in place.
 */
export function useFocusAfter<Root extends HTMLElement>(): {
  readonly ref: RefObject<Root | null>;
  readonly focusAfter: (key: string) => void;
} {
  const ref = useRef<Root | null>(null);
  const wanted = useRef<string | null>(null);
  // Runs after every render, and acts only when an edit asked for focus.
  useEffect(() => {
    const key = wanted.current;
    if (key === null) return;
    wanted.current = null;
    const target = ref.current?.querySelector(`[data-hm-focus-key="${CSS.escape(key)}"]`);
    target?.querySelector<HTMLElement>("input:not([type=radio]), textarea, button")?.focus();
  });
  const focusAfter = useCallback((key: string) => {
    wanted.current = key;
  }, []);
  return { ref, focusAfter };
}
