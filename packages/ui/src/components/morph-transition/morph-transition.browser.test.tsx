import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { Card } from "../card/Card.js";
import { Dialog } from "../dialog/Dialog.js";
import { startMorphTransition } from "./morph-transition.js";

let root: Root | undefined;
let morph: Promise<void> | undefined;

beforeEach(async () => {
  // The updates under test run inside the browser's view-transition
  // callback, which act() can't wrap; flushSync commits them instead.
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  await loadStyles();
});
afterEach(async () => {
  await morph;
  morph = undefined;
  root?.unmount();
  root = undefined;
  cleanUp();
  vi.restoreAllMocks();
  await commands.setReducedMotion(false);
});

/** A card that opens its dialog, and the dialog that shrinks back into it. */
function Host() {
  const card = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Card
        ref={card}
        title={
          <button
            type="button"
            onClick={() => {
              morph = startMorphTransition({ from: card, to: dialog, update: () => setOpen(true) });
            }}
          >
            Travel
          </button>
        }
      />
      <Dialog
        ref={dialog}
        open={open}
        title="Travel"
        onOpenChange={(next) => {
          morph = startMorphTransition({ from: dialog, to: card, update: () => setOpen(next) });
        }}
      >
        12 notes
      </Dialog>
    </>
  );
}

function render(): { card: HTMLElement; dialog: HTMLDialogElement } {
  const container = mount("");
  root = createRoot(container);
  flushSync(() => root?.render(<Host />));
  return {
    card: container.querySelector(".hm-card") as HTMLElement,
    dialog: container.querySelector("dialog") as HTMLDialogElement,
  };
}

const nameOf = (element: HTMLElement): string =>
  element.style.getPropertyValue("view-transition-name");

interface Snapshot {
  readonly morphing: boolean;
  readonly card: string;
  readonly dialog: string;
  readonly dialogOpen: boolean;
}

/**
 * Wraps the browser's startViewTransition to record what each snapshot
 * sees: the "before" one when it's called, the "after" one when its update
 * returns.
 */
function recordSnapshots(card: HTMLElement, dialog: HTMLDialogElement) {
  const snapshots: { before?: Snapshot; after?: Snapshot }[] = [];
  const take = (): Snapshot => ({
    morphing: document.documentElement.hasAttribute("data-hm-morph"),
    card: nameOf(card),
    dialog: nameOf(dialog),
    dialogOpen: dialog.open,
  });
  const original = document.startViewTransition.bind(document);
  const spy = vi
    .spyOn(document, "startViewTransition")
    .mockImplementation((update?: ViewTransitionUpdateCallback | StartViewTransitionOptions) => {
      const entry: { before?: Snapshot; after?: Snapshot } = { before: take() };
      snapshots.push(entry);
      const callback = typeof update === "function" ? update : update?.update;
      return original(async () => {
        await callback?.();
        entry.after = take();
      });
    });
  return { snapshots, spy };
}

describe("startMorphTransition", () => {
  it("moves the card's name to the open dialog, then back, and cleans up", async () => {
    const { card, dialog } = render();
    const { snapshots } = recordSnapshots(card, dialog);

    await userEvent.click(card.querySelector("button") as HTMLElement);
    await morph;
    expect(snapshots[0]?.before).toEqual({
      morphing: true,
      card: expect.stringMatching(/^hm-morph-\d+$/),
      dialog: "",
      dialogOpen: false,
    });
    // React ran Dialog's showModal() effect inside flushSync (ADR 0014).
    expect(snapshots[0]?.after).toEqual({
      morphing: true,
      card: "",
      dialog: snapshots[0]?.before?.card,
      dialogOpen: true,
    });
    expect(dialog.open).toBe(true);
    expect([nameOf(card), nameOf(dialog)]).toEqual(["", ""]);
    expect(document.documentElement.hasAttribute("data-hm-morph")).toBe(false);

    await userEvent.keyboard("{Escape}");
    await morph;
    expect(snapshots[1]?.before).toMatchObject({ card: "", dialogOpen: true });
    expect(snapshots[1]?.after).toEqual({
      morphing: true,
      card: snapshots[1]?.before?.dialog,
      dialog: "",
      dialogOpen: false,
    });
    expect([nameOf(card), nameOf(dialog)]).toEqual(["", ""]);
    // Closing the dialog returned focus to the card's action.
    expect(document.activeElement).toBe(card.querySelector("button"));
  });

  it("turns the dialog's own fade off while a morph runs", () => {
    const { dialog } = render();
    expect(getComputedStyle(dialog).transitionProperty).not.toBe("none");
    document.documentElement.setAttribute("data-hm-morph", "");
    try {
      expect(getComputedStyle(dialog).transitionProperty).toBe("none");
    } finally {
      document.documentElement.removeAttribute("data-hm-morph");
    }
  });

  it("just updates when the user prefers reduced motion", async () => {
    await commands.setReducedMotion(true);
    const { card, dialog } = render();
    const { spy } = recordSnapshots(card, dialog);
    await userEvent.click(card.querySelector("button") as HTMLElement);
    await morph;
    expect(spy).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
    expect(nameOf(card)).toBe("");
  });

  it("just updates without the View Transitions API", async () => {
    const { card, dialog } = render();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: undefined,
    });
    try {
      await userEvent.click(card.querySelector("button") as HTMLElement);
      await morph;
      expect(dialog.open).toBe(true);
      expect(document.documentElement.hasAttribute("data-hm-morph")).toBe(false);
    } finally {
      delete (document as { startViewTransition?: unknown }).startViewTransition;
    }
  });

  it("reports an error in the update, and still cleans up", async () => {
    const { card, dialog } = render();
    const from = { current: card };
    const to = { current: dialog };
    const failure = new Error("no");
    await expect(
      startMorphTransition({
        from,
        to,
        update: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(nameOf(card)).toBe("");
    expect(document.documentElement.hasAttribute("data-hm-morph")).toBe(false);
  });
});
