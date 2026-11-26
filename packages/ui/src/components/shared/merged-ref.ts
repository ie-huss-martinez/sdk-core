import { type ForwardedRef, type RefObject, useCallback, useRef } from "react";

/** Gives a ref the node, whichever kind of ref the host passed. */
function assignRef<T>(ref: ForwardedRef<T>, node: T | null): void {
  if (typeof ref === "function") {
    ref(node);
  } else if (ref) {
    ref.current = node;
  }
}

/**
 * A component's own ref to its element, merged with the ref its host
 * forwarded: attach the callback to the element, and read the element from
 * the returned ref in effects and handlers. Both refs are set when React
 * attaches or detaches the element, never while rendering.
 */
export function useMergedRef<T>(
  forwarded: ForwardedRef<T>,
): readonly [RefObject<T | null>, (node: T | null) => void] {
  const local = useRef<T | null>(null);
  const setRef = useCallback(
    (node: T | null) => {
      local.current = node;
      assignRef(forwarded, node);
    },
    [forwarded],
  );
  return [local, setRef];
}

/**
 * A callback ref that gives an element to the component, through `own`, and
 * to the ref its host forwarded, for React 18 and 19 alike.
 *
 * - **React 19** calls the cleanup this returns when the element detaches,
 *   instead of calling the ref with `null`. The cleanup runs the cleanup the
 *   host's callback ref returned, if it did, and otherwise gives the host's
 *   ref `null`, as React would have.
 * - **React 18** ignores the cleanup and calls the ref with `null`, which
 *   reaches both.
 *
 * Either way, `own` gets `null` on every detach.
 */
export function forwardingRef<T>(
  forwarded: ForwardedRef<T>,
  own: (node: T | null) => void,
): (node: T | null) => (() => void) | undefined {
  return (node) => {
    own(node);
    if (node === null) {
      assignRef(forwarded, null);
      return undefined;
    }
    let hostCleanup: unknown;
    if (typeof forwarded === "function") {
      hostCleanup = (forwarded as (node: T | null) => unknown)(node);
    } else if (forwarded) {
      forwarded.current = node;
    }
    return () => {
      own(null);
      if (typeof hostCleanup === "function") {
        hostCleanup();
      } else {
        assignRef(forwarded, null);
      }
    };
  };
}
