import { createRef, type RefObject } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createFakePdfEngine } from "../../test/fixtures/fake-pdf.js";
import { draw, line } from "../../test/pen.js";
import { cleanUp, mount, waitFor } from "../../test/react.js";
import { createMemoryNotesStore } from "../adapters/memory-store/memory-store.js";
import { createOpfsNotesStore } from "../adapters/opfs-store/opfs-store.js";
import type { NotesItem, NotesStroke } from "../core/model/items.js";
import type { NotesStore } from "../core/ports/notes-store.js";
import type { NotesLibraryEvent } from "../core/session/library.js";
import { NotesEditor, type NotesEditorHandle, type NotesEditorProps } from "./NotesEditor.js";

afterEach(cleanUp);

// A frame tall enough to show a whole A4 page under the toolbar, so a test
// can write anywhere on it: input sent through the browser lands only on
// what's in view.
beforeAll(async () => {
  await page.viewport(900, 1500);
});

const PAGE = ".hm-notes-page";

interface Mounted {
  readonly container: HTMLElement;
  readonly handle: RefObject<NotesEditorHandle | null>;
  readonly store: NotesStore;
}

async function mountEditor(
  props: Partial<NotesEditorProps> = {},
  store: NotesStore = createMemoryNotesStore(),
): Promise<Mounted> {
  const handle = createRef<NotesEditorHandle>();
  const container = await mount(
    <NotesEditor ref={handle} store={store} pdfEngine={createFakePdfEngine()} {...props} />,
    "width: 800px; height: 1400px; display: grid; grid-template-rows: minmax(0, 1fr);",
  );
  await waitFor(() => expect(button(container, "New notebook")).toBeTruthy());
  return { container, handle, store };
}

const button = (container: HTMLElement, name: string): HTMLButtonElement | undefined =>
  [...container.ownerDocument.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      (candidate.getAttribute("aria-label") ?? candidate.textContent?.trim()) === name &&
      candidate.closest("dialog:not([open])") === null,
  );

async function press(container: HTMLElement, name: string): Promise<void> {
  const found = await waitFor(() => {
    const candidate = button(container, name);
    if (!candidate) throw new Error(`No button named ${name}`);
    return candidate;
  });
  await userEvent.click(found);
}

/** Creates a notebook from the library, which opens it, and waits for its first page. */
async function newNotebook({ container }: Mounted): Promise<void> {
  await press(container, "New notebook");
  await press(container, "Create");
  await waitFor(() => expect(container.querySelector(PAGE)).toBeTruthy(), { timeout: 5_000 });
}

/** Waits until the notebook says everything is saved. */
async function saved(container: HTMLElement): Promise<void> {
  await waitFor(
    () => expect(container.querySelector(".hm-notes-notebook-save")?.textContent).toBe("Saved"),
    { timeout: 5_000 },
  );
}

/** The items of the open notebook's first page, as the store holds them. */
async function storedItems({ handle, store }: Mounted): Promise<readonly NotesItem[]> {
  const [summary] = handle.current?.library.getSnapshot().index.notebooks ?? [];
  if (!summary) throw new Error("The library has no notebook.");
  const notebook = await store.readNotebook(summary.id);
  const first = notebook?.pages[0];
  if (!first) throw new Error("The notebook has no page.");
  return (await store.readPage(summary.id, first.id))?.items ?? [];
}

const strokes = (items: readonly NotesItem[]): NotesStroke[] =>
  items.filter((item): item is NotesStroke => item.type === "stroke");

/** The colour of the finished ink at a place on the first page, as `[r, g, b, a]`. */
function inkAt(container: HTMLElement, x: number, y: number): number[] {
  const canvas = container.querySelector<HTMLCanvasElement>(".hm-notes-page-ink");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) throw new Error("The page has no ink canvas.");
  return [
    ...context.getImageData(Math.round(x * canvas.width), Math.round(y * canvas.height), 1, 1).data,
  ];
}

describe("NotesEditor", () => {
  it("shows an empty library, and opens a new notebook ready to write", async () => {
    const views: string[] = [];
    const mounted = await mountEditor({ onViewChange: (view) => views.push(view.view) });
    const { container } = mounted;
    expect(container.textContent).toContain("No notebooks yet");
    await newNotebook(mounted);
    expect(container.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe(
      "Notebook tools",
    );
    expect(button(container, "Pen")?.getAttribute("aria-pressed")).toBe("true");
    expect(views.at(-1)).toBe("notebook");

    await press(container, "Back to the library");
    await waitFor(() => expect(button(container, "New notebook")).toBeTruthy());
    expect(views.at(-1)).toBe("library");
    expect(container.textContent).toContain("Untitled notebook");
  });

  it("writes with the pen, keeping its pressure, and saves the stroke", async () => {
    const mounted = await mountEditor();
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3], { pressure: 0.8 }));
    await saved(mounted.container);

    const [stroke, ...others] = strokes(await storedItems(mounted));
    expect(others).toEqual([]);
    expect(stroke).toMatchObject({ tool: "pen", color: "#1f2937" });
    // Triples of x, y and pressure, on the model's integer grid.
    const points = stroke?.points ?? [];
    expect(points.length % 3).toBe(0);
    expect(points.every(Number.isInteger)).toBe(true);
    expect(points[2]).toBeGreaterThan(700);
    expect(points[2]).toBeLessThan(900);
    // From a fifth to seven tenths of an A4 page's width, in units.
    expect(points[0]).toBeGreaterThan(59_500 * 0.18);
    expect(points.at(-3)).toBeLessThan(59_500 * 0.72);

    // The ink is on the page, and the paper beside it is still white.
    const [red, green, blue, alpha] = inkAt(mounted.container, 0.45, 0.3);
    expect(alpha).toBe(255);
    expect((red ?? 255) + (green ?? 255) + (blue ?? 255)).toBeLessThan(300);
    expect(inkAt(mounted.container, 0.45, 0.6).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("lets fingers move the page without writing, until asked to write", async () => {
    const mounted = await mountEditor();
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]), { pointerType: "touch" });
    await press(mounted.container, "Write with a finger");
    expect(await storedItems(mounted)).toEqual([]);

    await draw(PAGE, line([0.2, 0.5], [0.7, 0.5]), { pointerType: "touch" });
    await saved(mounted.container);
    expect(strokes(await storedItems(mounted))).toHaveLength(1);
  });

  it("undoes and redoes, from the toolbar and from the keyboard", async () => {
    const mounted = await mountEditor();
    const { container } = mounted;
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await draw(PAGE, line([0.2, 0.5], [0.7, 0.5]));
    await press(container, "Undo");
    await saved(container);
    expect(strokes(await storedItems(mounted))).toHaveLength(1);

    await press(container, "Redo");
    await saved(container);
    expect(strokes(await storedItems(mounted))).toHaveLength(2);

    // Focus is in the notebook after the click, where its shortcuts work.
    await userEvent.keyboard("{Control>}z{/Control}");
    await userEvent.keyboard("{Control>}z{/Control}");
    await saved(container);
    expect(await storedItems(mounted)).toEqual([]);
    expect(button(container, "Undo")?.getAttribute("aria-disabled")).toBe("true");
  });

  it("erases whole strokes, or only the part the eraser passes over", async () => {
    const mounted = await mountEditor();
    const { container } = mounted;
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.8, 0.3], { steps: 30 }));
    await press(container, "Eraser");

    // Across the middle of the line: two pieces remain.
    await draw(PAGE, line([0.5, 0.25], [0.5, 0.35]));
    await saved(container);
    const pieces = strokes(await storedItems(mounted));
    expect(pieces).toHaveLength(2);
    expect(
      Math.max(...(pieces[0]?.points.filter((_, index) => index % 3 === 0) ?? [])),
    ).toBeLessThan(59_500 * 0.5);

    // Erasing is one step: undo brings the whole line back.
    await press(container, "Undo");
    await saved(container);
    expect(strokes(await storedItems(mounted))).toHaveLength(1);

    await press(container, "Whole strokes");
    await draw(PAGE, line([0.5, 0.25], [0.5, 0.35]));
    await saved(container);
    expect(await storedItems(mounted)).toEqual([]);
  });

  it("erases with the pen's barrel button held, and writes again once it's let go", async () => {
    const mounted = await mountEditor();
    const { container } = mounted;
    await newNotebook(mounted);
    await press(container, "Eraser");
    await press(container, "Whole strokes");
    await press(container, "Pen");
    await draw(PAGE, line([0.2, 0.3], [0.8, 0.3]));
    await draw(PAGE, line([0.5, 0.25], [0.5, 0.35]), { barrel: true });
    await saved(container);
    expect(await storedItems(mounted)).toEqual([]);
    expect(button(container, "Pen")?.getAttribute("aria-pressed")).toBe("true");

    await draw(PAGE, line([0.2, 0.6], [0.8, 0.6]));
    await saved(container);
    expect(strokes(await storedItems(mounted))).toHaveLength(1);
  });

  it("selects with the lasso, and deletes the selection", async () => {
    const mounted = await mountEditor();
    const { container } = mounted;
    await newNotebook(mounted);
    await draw(PAGE, line([0.3, 0.3], [0.5, 0.3]));
    await draw(PAGE, line([0.3, 0.7], [0.5, 0.7]));
    await press(container, "Select");
    // A loop around the first stroke only.
    await draw(PAGE, [
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.2 },
      { x: 0.6, y: 0.4 },
      { x: 0.2, y: 0.4 },
      { x: 0.2, y: 0.2 },
    ]);
    await waitFor(() =>
      expect(container.querySelector(".hm-notes-selection")?.getAttribute("aria-label")).toBe(
        "Selection: 1 item",
      ),
    );
    await press(container, "Delete");
    await saved(container);
    const remaining = strokes(await storedItems(mounted));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.points[1]).toBeGreaterThan(84_200 * 0.6);
  });

  it("types a text box, and finds its words from the library", async () => {
    const mounted = await mountEditor();
    const { container } = mounted;
    await newNotebook(mounted);
    await press(container, "Text");
    await draw(PAGE, [{ x: 0.3, y: 0.3 }]);
    const field = await waitFor(() => {
      const found = container.querySelector<HTMLTextAreaElement>(".hm-notes-text-editor");
      if (!found) throw new Error("No text editor opened.");
      return found;
    });
    await userEvent.type(field, "Conservation of energy");
    await press(container, "Pen");
    await saved(container);
    expect(await storedItems(mounted)).toEqual([
      expect.objectContaining({ type: "text", text: "Conservation of energy" }),
    ]);

    await press(container, "Back to the library");
    const search = await waitFor(() => {
      const found = container.querySelector<HTMLInputElement>('input[type="search"]');
      if (!found) throw new Error("No search field.");
      return found;
    });
    await userEvent.type(search, "energy");
    await waitFor(() => expect(container.querySelector("mark")?.textContent).toBe("energy"), {
      timeout: 3_000,
    });
  });

  it("adds and deletes pages, and brings a deleted page back with its ink", async () => {
    const mounted = await mountEditor();
    const { container, handle, store } = mounted;
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await press(container, "Add a page");
    await waitFor(() =>
      expect(container.querySelector(".hm-notes-notebook-position")?.textContent).toBe(
        "Page 2 of 2",
      ),
    );
    await saved(container);
    const [summary] = handle.current?.library.getSnapshot().index.notebooks ?? [];
    expect(summary?.pageCount).toBe(2);

    await press(container, "Delete this page");
    await saved(container);
    expect((await store.readNotebook(summary?.id ?? ""))?.pages).toHaveLength(1);
    await press(container, "Undo");
    await saved(container);
    expect((await store.readNotebook(summary?.id ?? ""))?.pages).toHaveLength(2);
    expect(strokes(await storedItems(mounted))).toHaveLength(1);
  });

  it("never sends a title, text or a file's name in its events", async () => {
    const events: NotesLibraryEvent[] = [];
    const mounted = await mountEditor({ onEvent: (event) => events.push(event) });
    const { container } = mounted;
    await press(container, "New notebook");
    const name = await waitFor(() => {
      const found = container.ownerDocument.querySelector<HTMLInputElement>("dialog[open] input");
      if (!found) throw new Error("No name field.");
      return found;
    });
    await userEvent.type(name, "Diary of secrets");
    await press(container, "Create");
    await waitFor(() => expect(container.querySelector(PAGE)).toBeTruthy(), { timeout: 5_000 });
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await saved(container);
    await press(container, "Back to the library");
    await waitFor(() => expect(button(container, "New notebook")).toBeTruthy());

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["notebook_created", "notebook_opened", "command", "notebook_closed"]),
    );
    expect(JSON.stringify(events)).not.toContain("Diary");
  });
});

/**
 * Whether this browser gives the page its private file system. Playwright's
 * WebKit doesn't in its throwaway profiles, where opening it fails; Safari
 * itself does. The tests below take the path that matches, so neither is
 * skipped silently.
 */
const deviceStorage = await navigator.storage.getDirectory().then(
  () => true,
  () => false,
);

describe.runIf(!deviceStorage)("NotesEditor where the browser gives no storage", () => {
  it("says the notes can't be kept here, and offers to try again", async () => {
    const container = await mount(
      <NotesEditor store={createOpfsNotesStore({ name: "hm-notes-test-none" })} />,
    );
    await waitFor(() => expect(button(container, "Try again")).toBeTruthy(), { timeout: 5_000 });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This browser isn't letting the app keep notes on this device.",
    );
    expect(button(container, "New notebook")).toBeUndefined();
  });
});

describe.runIf(deviceStorage)("NotesEditor on the device's storage", () => {
  let names: string[] = [];
  const storeNamed = () => {
    const name = `hm-notes-test-${crypto.randomUUID().slice(0, 8)}`;
    names.push(name);
    return { name, store: createOpfsNotesStore({ name }) };
  };

  afterEach(async () => {
    const root = await navigator.storage.getDirectory();
    for (const name of names) {
      await root.removeEntry(name, { recursive: true }).catch(() => undefined);
      indexedDB.deleteDatabase(name);
    }
    names = [];
  });

  it("keeps what was written, and shows it again after the editor is opened anew", async () => {
    const { name, store } = storeNamed();
    const first = await mountEditor({}, store);
    await newNotebook(first);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3], { pressure: 0.9 }));
    await draw(PAGE, line([0.2, 0.5], [0.7, 0.5], { pressure: 0.3 }));
    await saved(first.container);
    const written = await storedItems(first);
    expect(strokes(written)).toHaveLength(2);
    // The page goes away, as on a reload: the notebook was already saved.
    await cleanUp();

    const second = await mountEditor({}, createOpfsNotesStore({ name }));
    const cover = await waitFor(() => {
      const found = second.container.querySelector<HTMLButtonElement>(".hm-notes-cover");
      if (!found) throw new Error("The notebook isn't in the library.");
      return found;
    });
    await userEvent.click(cover);
    await waitFor(() => expect(second.container.querySelector(PAGE)).toBeTruthy(), {
      timeout: 5_000,
    });
    expect(await storedItems(second)).toEqual(written);
    // And it's drawn: there's ink where the first stroke was.
    await waitFor(() => {
      const [red, green, blue] = inkAt(second.container, 0.45, 0.3);
      expect((red ?? 255) + (green ?? 255) + (blue ?? 255)).toBeLessThan(300);
    });
  });

  it("backs up a library, and restores it into an empty one from the backup file", async () => {
    const source = await mountEditor({}, storeNamed().store);
    await newNotebook(source);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await saved(source.container);
    const written = await storedItems(source);
    const library = source.handle.current?.library;
    if (!library) throw new Error("The editor has no library.");
    const backup = await library.backup();
    await cleanUp();

    const target = await mountEditor({}, storeNamed().store);
    expect(target.container.textContent).toContain("No notebooks yet");
    const input = target.container.querySelector<HTMLInputElement>('input[data-hm-input="backup"]');
    if (!input) throw new Error("No restore input.");
    await userEvent.upload(
      input,
      new File([backup], "notes-backup.zip", { type: "application/zip" }),
    );
    await waitFor(() => expect(target.container.textContent).toContain("Restored 1 notebook."), {
      timeout: 5_000,
    });
    expect(await storedItems(target)).toEqual(written);

    // The same backup again changes nothing: it never overwrites or duplicates.
    await userEvent.upload(
      input,
      new File([backup], "notes-backup.zip", { type: "application/zip" }),
    );
    await waitFor(
      () =>
        expect(target.container.textContent).toContain(
          "Every notebook in this backup is already here, unchanged.",
        ),
      { timeout: 5_000 },
    );
    expect(target.handle.current?.library.getSnapshot().index.notebooks).toHaveLength(1);
  });
});
