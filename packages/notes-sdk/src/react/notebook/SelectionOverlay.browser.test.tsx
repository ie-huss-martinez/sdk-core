import { UiMessagesProvider } from "@hussmartinez/ui/react";
import {
  act,
  createRef,
  type ReactNode,
  type RefObject,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePdfEngine } from "../../../test/fixtures/fake-pdf.js";
import { stroke } from "../../../test/fixtures/notes.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import { createMemoryNotesStore } from "../../adapters/memory-store/memory-store.js";
import type { NotesItem, NotesLink } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { createImageCache } from "../canvas/image-cache.js";
import { useNotes } from "../context.js";
import { NotesProvider } from "../NotesProvider.js";
import { SelectionOverlay } from "./SelectionOverlay.js";

afterEach(cleanUp);

/** An A4 page, drawn at a pixel to a point: 100 units to a pixel. */
const INFO: NotesPageInfo = { id: "p1", width: 59_500, height: 84_200, template: "blank" };
const IMAGES = createImageCache(
  async () => new Blob(),
  () => undefined,
);

/** A link's area: an item whose bounds are exactly its rectangle, 100 by 200 pixels. */
const LINK: NotesLink = {
  id: "link",
  type: "link",
  x: 10_000,
  y: 10_000,
  width: 10_000,
  height: 20_000,
  page: "p2",
};

interface Controls {
  /** Clears the selection, as Escape does: the overlay goes away. */
  hide(): void;
  wet(): HTMLCanvasElement | null;
}

function Ui({ children }: { readonly children: ReactNode }): ReactNode {
  const { messages } = useNotes();
  return <UiMessagesProvider messages={messages}>{children}</UiMessagesProvider>;
}

/** A page with its wet canvas, and the selection's box over it. */
function Stage(props: {
  readonly items: readonly NotesItem[];
  readonly controls: RefObject<Controls | null>;
  readonly onDragStart: () => void;
  readonly onDragEnd: (items: readonly NotesItem[] | undefined) => void;
}): ReactNode {
  const [shown, setShown] = useState(true);
  const element = useRef<HTMLDivElement>(null);
  const wet = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(
    props.controls,
    () => ({ hide: () => setShown(false), wet: () => wet.current }),
    [],
  );
  return (
    <div ref={element} style={{ position: "relative", width: 595, height: 842 }}>
      <canvas
        ref={wet}
        width={595}
        height={842}
        style={{ position: "absolute", inset: 0, transformOrigin: "0 0" }}
      />
      {shown ? (
        <SelectionOverlay
          info={INFO}
          pixelsPerPoint={1}
          items={props.items}
          page={() =>
            element.current && wet.current
              ? { info: INFO, element: element.current, wet: wet.current, paint: () => undefined }
              : undefined
          }
          images={IMAGES}
          onDragStart={props.onDragStart}
          onDragEnd={props.onDragEnd}
          onRecolor={() => undefined}
          onDuplicate={() => undefined}
          onDelete={() => undefined}
        />
      ) : null}
    </div>
  );
}

async function mountSelection(items: readonly NotesItem[] = [LINK]) {
  const onDragStart = vi.fn<() => void>();
  const onDragEnd = vi.fn<(items: readonly NotesItem[] | undefined) => void>();
  const controls = createRef<Controls>();
  const container = await mount(
    <NotesProvider store={createMemoryNotesStore()} pdfEngine={createFakePdfEngine()}>
      <Ui>
        <Stage items={items} controls={controls} onDragStart={onDragStart} onDragEnd={onDragEnd} />
      </Ui>
    </NotesProvider>,
    "width: 800px; height: 900px;",
  );
  const find = (selector: string): HTMLElement => {
    const found = container.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`Nothing matches ${selector}`);
    return found;
  };
  const box = await waitFor(() => find(".hm-notes-selection-box"));
  const wet = controls.current?.wet();
  if (!wet) throw new Error("The page has no wet canvas.");
  return {
    container,
    box,
    wet,
    corner: (corner: string) => find(`.hm-notes-selection-handle[data-hm-corner="${corner}"]`),
    hide: () => act(async () => controls.current?.hide()),
    onDragStart,
    onDragEnd,
  };
}

/** Sends a pointer event to an element, at a distance in pixels from its middle. */
async function fire(
  target: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  pointerId: number,
  dx = 0,
  dy = 0,
): Promise<void> {
  const rect = target.getBoundingClientRect();
  await act(async () => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId,
        pointerType: "touch",
        isPrimary: true,
        button: type === "pointermove" ? -1 : 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: rect.left + rect.width / 2 + dx,
        clientY: rect.top + rect.height / 2 + dy,
      }),
    );
  });
}

/** Presses a key on an element, and tells whether the selection took it. */
async function press(target: Element, key: string, init: KeyboardEventInit = {}): Promise<boolean> {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/** Whether a canvas has anything drawn near a place, in its own pixels. */
function inked(canvas: HTMLCanvasElement, x: number, y: number): boolean {
  const pixels = canvas.getContext("2d")?.getImageData(x - 5, y - 5, 10, 10).data ?? [];
  return pixels.some((value, index) => index % 4 === 3 && value > 0);
}

describe("SelectionOverlay", () => {
  it("resizes the selection from the keyboard, by a tenth about its centre", async () => {
    const { box, onDragEnd } = await mountSelection();
    expect(box.getAttribute("aria-label")).toBe(
      "Move the selection with the arrow keys. Resize it with plus and minus.",
    );

    expect(await press(box, "+")).toBe(true);
    expect(onDragEnd).toHaveBeenLastCalledWith([
      { ...LINK, x: 9_500, y: 9_000, width: 11_000, height: 22_000 },
    ]);
    // The equals sign too: plus is on its key, where plus needs Shift.
    expect(await press(box, "=")).toBe(true);
    expect(onDragEnd).toHaveBeenLastCalledWith([
      { ...LINK, x: 9_500, y: 9_000, width: 11_000, height: 22_000 },
    ]);
    expect(await press(box, "-")).toBe(true);
    expect(onDragEnd).toHaveBeenLastCalledWith([
      { ...LINK, x: 10_500, y: 11_000, width: 9_000, height: 18_000 },
    ]);
    expect(onDragEnd).toHaveBeenCalledTimes(3);
  });

  it("leaves plus and minus with a modifier to the browser, which zooms with them", async () => {
    const { box, onDragEnd } = await mountSelection();
    expect(await press(box, "+", { ctrlKey: true })).toBe(false);
    expect(await press(box, "-", { metaKey: true })).toBe(false);
    expect(onDragEnd).not.toHaveBeenCalled();
    // The arrow keys still move it.
    expect(await press(box, "ArrowRight")).toBe(true);
    expect(onDragEnd).toHaveBeenLastCalledWith([{ ...LINK, x: 10_100 }]);
  });

  it("shrinks the selection when a corner is dragged straight along one edge", async () => {
    const { corner, onDragEnd } = await mountSelection();
    const handle = corner("se");
    await fire(handle, "pointerdown", 1);
    // Straight left by 50 pixels: a tenth of the diagonal's length, along it.
    await fire(handle, "pointermove", 1, -50, 0);
    await fire(handle, "pointerup", 1, -50, 0);
    expect(onDragEnd).toHaveBeenCalledExactlyOnceWith([{ ...LINK, width: 9_000, height: 18_000 }]);
  });

  it("keeps the drag with the pointer that began it when a second one lands", async () => {
    const { box, corner, onDragStart, onDragEnd } = await mountSelection();
    await fire(box, "pointerdown", 1);
    await fire(box, "pointermove", 1, 30, 0);
    // A second finger, on a corner: it neither resizes nor ends the first one's move.
    await fire(corner("se"), "pointerdown", 2);
    await fire(corner("se"), "pointerup", 2);
    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDragEnd).not.toHaveBeenCalled();

    await fire(box, "pointerup", 1, 30, 0);
    expect(onDragEnd).toHaveBeenCalledExactlyOnceWith([{ ...LINK, x: 13_000 }]);
  });

  it("drops a drag, and clears the wet canvas, when the selection goes away under it", async () => {
    // A stroke along y = 100 pixels, from 100 to 300 pixels across.
    const { box, wet, hide, onDragEnd } = await mountSelection([
      stroke("s", [10_000, 10_000], [30_000, 10_000]),
    ]);
    await fire(box, "pointerdown", 1);
    await fire(box, "pointermove", 1, 40, 20);
    // The stroke is on the wet canvas, which is shifted with the pointer.
    expect(inked(wet, 200, 100)).toBe(true);
    expect(wet.style.transform).toContain("translate(");

    await hide();
    expect(wet.style.transform).toBe("");
    expect(inked(wet, 200, 100)).toBe(false);
    // Nothing changed, and the page draws the items itself again.
    expect(onDragEnd).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});
