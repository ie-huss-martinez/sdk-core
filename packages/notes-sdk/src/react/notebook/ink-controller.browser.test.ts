import { afterEach, describe, expect, it } from "vitest";
import { countingIds, notebook, stroke } from "../../../test/fixtures/notes.js";
import { createMemoryNotesStore } from "../../adapters/memory-store/memory-store.js";
import type { NotesItem, NotesStroke } from "../../core/model/items.js";
import { type NotesSession, openNotesSession } from "../../core/session/notebook-session.js";
import { DEFAULT_INK_SETTINGS, type NotesInkSettings } from "../../features/tool-types.js";
import { attachInk } from "./ink-controller.js";

/** Page units to a CSS pixel: the A4 page of the fixtures is drawn 238 pixels wide. */
const UNITS = 250;

interface Stage {
  readonly session: NotesSession;
  readonly viewport: HTMLElement;
  readonly content: HTMLElement;
  /** The first page's element, at the viewport's top-left corner. */
  readonly page: HTMLElement;
  readonly followed: string[];
  /** The factors of the zooms shown while pinching, and of those made real. */
  readonly previews: number[];
  readonly commits: number[];
  readonly errors: unknown[];
  items(): readonly NotesItem[];
}

let cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups = [];
});

/**
 * The ink engine on a bare viewport with one page on screen, and a session
 * of two pages: what the engine does with pointers, without React.
 */
async function stage(
  settings: Partial<NotesInkSettings> = {},
  items: readonly NotesItem[] = [],
): Promise<Stage> {
  const store = createMemoryNotesStore();
  await store.writeNotebook(notebook("book", ["p1", "p2"]));
  await store.writePage("book", { id: "p1", items });
  const session = await openNotesSession({ store, notebook: "book", saveDelay: 60_000 });
  await session.loadPage("p1");
  const [info] = session.getSnapshot().notebook.pages;
  if (!info) throw new Error("The notebook has no page.");

  const viewport = document.createElement("div");
  viewport.style.cssText =
    "position: fixed; left: 0; top: 0; width: 400px; height: 400px; overflow: auto; touch-action: none;";
  const content = document.createElement("div");
  content.style.cssText = "position: relative; width: 300px; height: 1200px;";
  const page = document.createElement("section");
  page.setAttribute("data-hm-notes-page", info.id);
  page.style.cssText = `position: absolute; left: 0; top: 0; width: ${info.width / UNITS}px; height: ${
    info.height / UNITS
  }px;`;
  const wet = document.createElement("canvas");
  wet.width = info.width / UNITS;
  wet.height = Math.round(info.height / UNITS);
  page.append(wet);
  content.append(page);
  viewport.append(content);
  document.body.append(viewport);

  const followed: string[] = [];
  const previews: number[] = [];
  const commits: number[] = [];
  const errors: unknown[] = [];
  const detach = attachInk({
    viewport,
    session,
    page: (id) =>
      id === info.id ? { info, element: page, wet, paint: () => undefined } : undefined,
    settings: () => ({ ...DEFAULT_INK_SETTINGS, ...settings }),
    newId: countingIds("new"),
    audioAnchor: () => undefined,
    textHeight: () => 1_000,
    setSelection: () => undefined,
    editText: () => undefined,
    requestLink: () => undefined,
    followLink: (target) => followed.push(target),
    previewZoom(factor) {
      previews.push(factor);
      content.style.transform = `scale(${factor})`;
    },
    commitZoom(factor) {
      commits.push(factor);
      content.style.transform = "";
    },
    onError: (error) => errors.push(error),
  });
  cleanups.push(
    detach,
    () => viewport.remove(),
    () => session.close({ discard: true }),
  );
  return {
    session,
    viewport,
    content,
    page,
    followed,
    previews,
    commits,
    errors,
    items: () => session.getSnapshot().pages.get(info.id)?.items ?? [],
  };
}

/** Sends one pointer event to an element, at a place in CSS pixels from the viewport's corner. */
function fire(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
  init: PointerEventInit,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      isPrimary: true,
      clientX: x,
      clientY: y,
      width: 1,
      height: 1,
      pressure: type === "pointerup" ? 0 : 0.5,
      ...init,
    }),
  );
}

/** The pen in contact: 1. With its barrel button held too: 3. */
const PEN = { pointerType: "pen", pointerId: 11 } as const;

const strokes = (items: readonly NotesItem[]): NotesStroke[] =>
  items.filter((item): item is NotesStroke => item.type === "stroke");

/** The least and the greatest x of a stroke's points, in units. */
function span(item: NotesStroke | undefined): [number, number] {
  const xs = (item?.points ?? []).filter((_, index) => index % 3 === 0);
  return [Math.min(...xs), Math.max(...xs)];
}

/** A vertical pen stroke at x = 30,000 units: 120 pixels from the page's left. */
const upright = (id: string) => stroke(id, [30_000, 20_000], [30_000, 40_000]);

describe("the hand tool", () => {
  it("follows the link under a tap, where the pointer is, and still pans", async () => {
    const link: NotesItem = {
      id: "link",
      type: "link",
      x: 10_000,
      y: 10_000,
      width: 20_000,
      height: 20_000,
      page: "p2",
    };
    const { page, viewport, followed } = await stage({ tool: "hand" }, [link]);
    const mouse = { pointerType: "mouse", pointerId: 1, button: 0 };

    // The link is from 40 to 120 pixels each way: a tap inside it, far from the page's corner.
    fire(page, "pointerdown", 80, 80, { ...mouse, buttons: 1 });
    fire(page, "pointerup", 80, 80, { ...mouse, buttons: 0 });
    expect(followed).toEqual(["p2"]);

    // A tap beside the link follows nothing.
    fire(page, "pointerdown", 200, 200, { ...mouse, buttons: 1 });
    fire(page, "pointerup", 200, 200, { ...mouse, buttons: 0 });
    expect(followed).toEqual(["p2"]);

    // A drag over the link moves the page, and isn't a tap.
    fire(page, "pointerdown", 80, 80, { ...mouse, buttons: 1 });
    fire(page, "pointermove", 80, 50, { ...mouse, button: -1, buttons: 1, movementY: -30 });
    fire(page, "pointerup", 80, 50, { ...mouse, buttons: 0 });
    expect(viewport.scrollTop).toBe(30);
    expect(followed).toEqual(["p2"]);
  });
});

describe("a pen that lands during a pinch", () => {
  it("drops the pinch's preview, and doesn't zoom", async () => {
    const { page, content, previews, commits } = await stage();
    const first = { pointerType: "touch", pointerId: 21, buttons: 1 };
    const second = { pointerType: "touch", pointerId: 22, buttons: 1 };
    fire(page, "pointerdown", 60, 100, first);
    fire(page, "pointerdown", 160, 100, second);
    fire(page, "pointermove", 200, 100, second);
    expect(previews).toEqual([1.4]);
    expect(content.style.transform).toBe("scale(1.4)");

    // The fingers were the palm: the view is back at its own scale before the pen writes.
    fire(page, "pointerdown", 100, 200, { ...PEN, button: 0, buttons: 1 });
    expect(content.style.transform).toBe("");
    expect(commits).toEqual([1]);

    fire(page, "pointerup", 100, 200, { ...PEN, button: 0, buttons: 0 });
    fire(page, "pointerup", 200, 100, { ...second, buttons: 0 });
    fire(page, "pointerup", 60, 100, { ...first, buttons: 0 });
    expect(commits).toEqual([1]);
  });
});

describe("the pen's barrel button, pressed and let go while the pen is down", () => {
  it("ends the ink there, erases while it's held, and writes again from where it's let go", async () => {
    const { page, items, errors } = await stage({ eraserMode: "stroke" }, [upright("s")]);
    const ink = { ...PEN, button: -1, buttons: 1 };
    const erasing = { ...PEN, button: -1, buttons: 3 };
    fire(page, "pointerdown", 20, 120, { ...PEN, button: 0, buttons: 1 });
    fire(page, "pointermove", 40, 120, ink);
    fire(page, "pointermove", 60, 120, ink);
    // The button goes down: from here to where it's let go, the pen crosses the stroke.
    fire(page, "pointermove", 80, 120, erasing);
    fire(page, "pointermove", 140, 120, erasing);
    fire(page, "pointermove", 160, 120, ink);
    fire(page, "pointermove", 200, 120, ink);
    fire(page, "pointerup", 200, 120, { ...PEN, button: 0, buttons: 0 });

    expect(errors).toEqual([]);
    const [before, after, ...others] = strokes(items());
    expect(others).toEqual([]);
    // The stroke that was there is erased, and there's ink on each side of where the button was held.
    expect(items().some((item) => item.id === "s")).toBe(false);
    expect(span(before)).toEqual([20 * UNITS, 60 * UNITS]);
    expect(span(after)).toEqual([160 * UNITS, 200 * UNITS]);
  });

  it("stops erasing when the button is let go, though the pen stays down", async () => {
    const { page, items } = await stage({ eraserMode: "stroke" }, [
      upright("near"),
      stroke("far", [45_000, 20_000], [45_000, 40_000]),
    ]);
    fire(page, "pointerdown", 100, 120, { ...PEN, button: 2, buttons: 3 });
    fire(page, "pointermove", 140, 120, { ...PEN, button: -1, buttons: 3 });
    // Let go between the two strokes: the second is written across, not erased.
    fire(page, "pointermove", 150, 120, { ...PEN, button: -1, buttons: 1 });
    fire(page, "pointermove", 200, 120, { ...PEN, button: -1, buttons: 1 });
    fire(page, "pointerup", 200, 120, { ...PEN, button: 0, buttons: 0 });

    expect(items().map((item) => item.id)).toEqual(["far", "new-1"]);
    expect(span(strokes(items())[1])).toEqual([150 * UNITS, 200 * UNITS]);
  });
});

describe("a finger on one of the view's own controls", () => {
  /** A control over the page, as the text editor and the selection's box are. */
  function control(page: HTMLElement): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("data-hm-notes-control", "");
    element.style.cssText =
      "position: absolute; left: 20px; top: 100px; width: 80px; height: 60px;";
    page.append(element);
    return element;
  }
  const finger = { pointerType: "touch", pointerId: 31, buttons: 1 };

  it("doesn't move the page, as a finger beside it does", async () => {
    const { page, viewport } = await stage();
    const box = control(page);
    fire(box, "pointerdown", 40, 140, finger);
    fire(box, "pointermove", 40, 110, finger);
    expect(viewport.scrollTop).toBe(0);
    fire(box, "pointerup", 40, 110, { ...finger, buttons: 0 });

    fire(page, "pointerdown", 150, 140, finger);
    fire(page, "pointermove", 150, 110, finger);
    expect(viewport.scrollTop).toBe(30);
    fire(page, "pointerup", 150, 110, { ...finger, buttons: 0 });
  });

  it("doesn't write, where a finger writes", async () => {
    const { page, items } = await stage({ fingerDraws: true });
    const box = control(page);
    fire(box, "pointerdown", 40, 140, finger);
    fire(box, "pointermove", 70, 140, finger);
    fire(box, "pointerup", 70, 140, { ...finger, buttons: 0 });
    expect(items()).toEqual([]);

    fire(page, "pointerdown", 150, 140, finger);
    fire(page, "pointermove", 200, 140, finger);
    fire(page, "pointerup", 200, 140, { ...finger, buttons: 0 });
    expect(strokes(items())).toHaveLength(1);
  });
});

describe("the eraser, while an undo or a redo changes the page under it", () => {
  /** Erases across the upright stroke with the barrel button held, and stops before lifting. */
  function eraseAcross(page: HTMLElement): () => void {
    fire(page, "pointerdown", 100, 120, { ...PEN, button: 2, buttons: 3 });
    fire(page, "pointermove", 140, 120, { ...PEN, button: -1, buttons: 3 });
    return () => fire(page, "pointerup", 140, 120, { ...PEN, button: 2, buttons: 0 });
  }
  const far = stroke("far", [45_000, 60_000], [50_000, 60_000]);

  it("removes only what it erased, not an item a redo put back meanwhile", async () => {
    const { page, session, items, errors } = await stage({ eraserMode: "stroke" }, [upright("s")]);
    session.execute({ type: "notes.addItems", page: "p1", items: [far] });
    session.undo();

    const lift = eraseAcross(page);
    session.redo();
    expect(items().map((item) => item.id)).toEqual(["s", "far"]);
    lift();

    expect(errors).toEqual([]);
    expect(items().map((item) => item.id)).toEqual(["far"]);
    // One step: undo brings back the stroke it erased, and nothing else changes.
    session.undo();
    expect(items().map((item) => item.id)).toEqual(["s", "far"]);
  });

  it("puts the pieces of a stroke where it was, under what a redo added", async () => {
    const { page, session, items } = await stage({ eraserMode: "precise" }, [upright("s")]);
    session.execute({ type: "notes.addItems", page: "p1", items: [far] });
    session.undo();

    const lift = eraseAcross(page);
    session.redo();
    lift();

    // The stroke's two ends, above and below the eraser's path, then the item the redo added.
    expect(items().map((item) => item.id)).toEqual(["new-1", "new-2", "far"]);
  });

  it("changes nothing when an undo took away the stroke it erased", async () => {
    const { page, session, items, errors } = await stage({ eraserMode: "stroke" });
    session.execute({ type: "notes.addItems", page: "p1", items: [upright("s")] });

    const lift = eraseAcross(page);
    session.undo();
    lift();

    expect(errors).toEqual([]);
    expect(items()).toEqual([]);
    expect(session.getSnapshot().canUndo).toBe(false);
  });
});
