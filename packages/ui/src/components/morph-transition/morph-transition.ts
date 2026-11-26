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

/** Gives an element the morph's name, and returns what puts its own back. */
function setName(element: HTMLElement, name: string): () => void {
  const { style } = element;
  const previous = style.getPropertyValue("view-transition-name");
  const priority = style.getPropertyPriority("view-transition-name");
  style.setProperty("view-transition-name", name);
  // Only while the name is still the morph's: a later change stays.
  return () => {
    if (style.getPropertyValue("view-transition-name") !== name) {
      return;
    }
    if (previous === "") {
      style.removeProperty("view-transition-name");
    } else {
      style.setProperty("view-transition-name", previous, priority);
    }
  };
}

/**
 * Runs `update` and animates `from`'s box into `to`'s, such as a card
 * growing into the dialog it opens, with the browser's view transitions
 * (ADR 0014). Call it again with the two swapped to shrink back.
 *
 * - **Without motion:** with no View Transitions API, no `from` element, or
 *   when the user prefers reduced motion, it runs `update` directly.
 * - **Names:** an element's own `view-transition-name` is put back
 *   afterwards.
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
    try {
      update();
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve();
  }

  morphs += 1;
  const name = `hm-morph-${morphs}`;
  const root = document.documentElement;
  let restoreTarget = (): void => undefined;

  running += 1;
  root.setAttribute(RUNNING, "");
  // The "before" snapshot is taken with the name on `from`. In the update,
  // the name moves to `to`, so no two elements hold it at once, which would
  // skip the transition.
  const restoreSource = setName(source, name);
  const transition = document.startViewTransition(() => {
    restoreSource();
    // React runs the effects of a flushSync render before it returns, so a
    // Dialog has called showModal() by the "after" snapshot (ADR 0014).
    flushSync(update);
    const target = to.current;
    if (target !== null && target !== source) {
      restoreTarget = setName(target, name);
    }
  });
  // `ready` rejects when the transition is skipped, such as by another one
  // starting; `finished` still settles, and reports what matters.
  // An error in `update` rejects all three; the returned promise reports it.
  transition.ready.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
  return transition.finished.finally(() => {
    restoreSource();
    restoreTarget();
    running -= 1;
    if (running === 0) {
      root.removeAttribute(RUNNING);
    }
  });
}
