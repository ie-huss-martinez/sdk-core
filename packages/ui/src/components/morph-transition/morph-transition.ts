import type { RefObject } from "react";
import { flushSync } from "react-dom";

/**
 * Options of {@link startMorphTransition}.
 *
 * @public
 */
export interface MorphTransitionOptions {
  /** The element on screen now, such as a card. */
  readonly from: RefObject<HTMLElement | null>;
  /**
   * The element that takes its place, such as the card's dialog. It's read
   * after `update`, so it can be one that `update` shows.
   */
  readonly to: RefObject<HTMLElement | null>;
  /**
   * Changes your state so `to` shows, such as `() => setOpen(true)`. It runs
   * once, synchronously.
   */
  readonly update: () => void;
}

/** The attribute on `<html>` while a morph runs; morph-transition.css reads it. */
const RUNNING = "data-hm-morph";

/** Names this module has given out; each morph's is unique. */
let morphs = 0;
/** Morphs still running; the attribute goes when the last one ends. */
let running = 0;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function setName(element: HTMLElement, name: string): void {
  element.style.setProperty("view-transition-name", name);
}

/** Takes the name off, unless something else has replaced it since. */
function clearName(element: HTMLElement | null, name: string): void {
  if (element?.style.getPropertyValue("view-transition-name") === name) {
    element.style.removeProperty("view-transition-name");
  }
}

/**
 * Runs `update` and animates `from`'s box into `to`'s, such as a card
 * growing into the dialog it opens, with the browser's view transitions
 * (ADR 0014). Call it again with the two swapped to shrink back.
 *
 * - **Without motion:** with no View Transitions API, no `from` element, or
 *   when the user prefers reduced motion, it runs `update` directly and
 *   resolves.
 * - **CSP:** the elements get a `view-transition-name` through the CSSOM
 *   only while the transition runs, never in markup.
 * - **Dialog:** its own fade and rise are off while a morph runs, so only
 *   the morph plays.
 *
 * Call it from an event handler, not while rendering. The promise resolves
 * when the animation has finished, and rejects if `update` throws.
 *
 * @example
 * ```tsx
 * const card = useRef<HTMLElement>(null);
 * const dialog = useRef<HTMLDialogElement>(null);
 * const [open, setOpen] = useState(false);
 *
 * <Card ref={card} title={<button onClick={() =>
 *   startMorphTransition({ from: card, to: dialog, update: () => setOpen(true) })
 * }>{lesson.title}</button>} />
 * <Dialog ref={dialog} open={open} title={lesson.title} onOpenChange={(next) =>
 *   startMorphTransition({ from: dialog, to: card, update: () => setOpen(next) })
 * }>…</Dialog>
 * ```
 *
 * @public
 */
export function startMorphTransition({ from, to, update }: MorphTransitionOptions): Promise<void> {
  const source = from.current;
  if (
    source === null ||
    typeof document.startViewTransition !== "function" ||
    prefersReducedMotion()
  ) {
    update();
    return Promise.resolve();
  }

  morphs += 1;
  const name = `hm-morph-${morphs}`;
  const root = document.documentElement;
  let target: HTMLElement | null = null;

  running += 1;
  root.setAttribute(RUNNING, "");
  // The "before" snapshot is taken with the name on `from`. In the update,
  // the name moves to `to`, so no two elements hold it at once, which would
  // skip the transition.
  setName(source, name);
  const transition = document.startViewTransition(() => {
    clearName(source, name);
    // React runs the effects of a flushSync render before it returns, so a
    // Dialog has called showModal() by the "after" snapshot (ADR 0014).
    flushSync(update);
    target = to.current;
    if (target !== null && target !== source) {
      setName(target, name);
    }
  });
  // `ready` rejects when the transition is skipped, such as by another one
  // starting; `finished` still settles, and reports what matters.
  // An error in `update` rejects all three; the returned promise reports it.
  transition.ready.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
  return transition.finished.finally(() => {
    clearName(source, name);
    clearName(target, name);
    running -= 1;
    if (running === 0) {
      root.removeAttribute(RUNNING);
    }
  });
}
