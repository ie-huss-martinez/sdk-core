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

// A frame tall enough to show a whole A4 page under the top bar, so a test
// can write anywhere on it: input sent through the browser lands only on
// what's in view. It's wide enough for ui's frame to lay out as on a
// desktop (sdk-core ADR 0067), with the properties beside the pages.
beforeAll(async () => {
  await page.viewport(1100, 1500);
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
    // In Expert mode, every tool is listed in the frame's tools (docs/adr/0008).
    <NotesEditor
      ref={handle}
      store={store}
      pdfEngine={createFakePdfEngine()}
      defaultPreferences={{ mode: "expert" }}
      {...props}
    />,
    "width: 1000px; height: 1400px; display: grid; grid-template-rows: minmax(0, 1fr);",
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

/**
 * The darkest colour of the finished ink within two pixels of a place on the
 * first page, as `[r, g, b, a]`. A line may fall a pixel to either side of
 * where it was aimed, and a single pixel on its anti-aliased edge is a light
 * grey: the darkest one nearby is the line's own colour, whatever the
 * rasteriser did with its edges.
 */
function darkestInkNear(container: HTMLElement, x: number, y: number): number[] {
  const canvas = container.querySelector<HTMLCanvasElement>(".hm-notes-page-ink");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) throw new Error("The page has no ink canvas.");
  const { data } = context.getImageData(
    Math.round(x * canvas.width) - 2,
    Math.round(y * canvas.height) - 2,
    5,
    5,
  );
  const sum = (index: number) =>
    (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0);
  let darkest = 0;
  for (let index = 4; index < data.length; index += 4) {
    if (sum(index) < sum(darkest)) darkest = index;
  }
  return [...data.subarray(darkest, darkest + 4)];
}

describe("NotesEditor", () => {
  it("shows an empty library, and opens a new notebook ready to write", async () => {
    const views: string[] = [];
    const mounted = await mountEditor({ onViewChange: (view) => views.push(view.view) });
    const { container } = mounted;
    expect(container.textContent).toContain("No notebooks yet");
    await newNotebook(mounted);
    // The tools, in ui's frame's tools panel (docs/adr/0008).
    expect(
      container.querySelector('nav [role="toolbar"][aria-label="Notebook tools"]'),
    ).toBeTruthy();
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
    const [red, green, blue, alpha] = darkestInkNear(mounted.container, 0.45, 0.3);
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

describe("NotesEditor closed through its handle", () => {
  /** A recorder whose sessions count what was asked of them. */
  function fakeRecorder() {
    const calls = { starts: 0, stops: 0, cancels: 0 };
    let admit: () => void = () => undefined;
    let gate: Promise<void> | undefined;
    return {
      calls,
      /** Makes the next microphone wait until `admit()`. */
      hold() {
        gate = new Promise<void>((resolve) => {
          admit = resolve;
        });
      },
      admit: () => admit(),
      recorder: {
        supported: true,
        start: async () => {
          calls.starts += 1;
          await gate;
          return {
            startedAt: Date.now(),
            elapsed: () => 0,
            stop: async () => {
              calls.stops += 1;
              return { audio: new Blob(["sound"], { type: "audio/webm" }), duration: 1_000 };
            },
            cancel: () => {
              calls.cancels += 1;
            },
          };
        },
      },
    };
  }

  const notebookOf = async ({ handle, store }: Mounted) => {
    const [summary] = handle.current?.library.getSnapshot().index.notebooks ?? [];
    return store.readNotebook(summary?.id ?? "");
  };

  it("commits the text being typed before it closes the notebook", async () => {
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
    await userEvent.type(field, "Still being typed");
    // The box still has the focus: nothing has committed the draft yet.
    await mounted.handle.current?.close();
    await waitFor(() => expect(button(container, "New notebook")).toBeTruthy());
    expect(await storedItems(mounted)).toEqual([
      expect.objectContaining({ type: "text", text: "Still being typed" }),
    ]);
  });

  it("closes the notebook that just opened when a host asks from its own notification", async () => {
    let closing: Promise<void> | undefined;
    const reach: { handle?: RefObject<NotesEditorHandle | null> } = {};
    const mounted = await mountEditor({
      onViewChange: (view) => {
        // Before the notebook's view is on the screen.
        if (view.view === "notebook") closing ??= reach.handle?.current?.close();
      },
    });
    reach.handle = mounted.handle;
    await press(mounted.container, "New notebook");
    await press(mounted.container, "Create");
    await waitFor(() => expect(closing).toBeDefined());
    await closing;
    await waitFor(() => expect(button(mounted.container, "New notebook")).toBeTruthy());
    expect(mounted.container.querySelector(PAGE)).toBeNull();
    // Given back, not left open behind the library.
    const [summary] = mounted.handle.current?.library.getSnapshot().index.notebooks ?? [];
    expect(await mounted.store.lockNotebook(summary?.id ?? "")).toBeTypeOf("function");
  });

  it("stops and stores a recording before it closes the notebook", async () => {
    const { recorder, calls } = fakeRecorder();
    const mounted = await mountEditor({ recorder });
    await newNotebook(mounted);
    await press(mounted.container, "Record sound");
    await waitFor(() => expect(button(mounted.container, "Stop recording")).toBeTruthy());
    await mounted.handle.current?.close();
    await waitFor(() => expect(button(mounted.container, "New notebook")).toBeTruthy());
    expect(calls.stops).toBe(1);
    expect((await notebookOf(mounted))?.recordings).toHaveLength(1);
  });

  it("stays open, and says why, when the recording can't be stored", async () => {
    const store = createMemoryNotesStore();
    store.writeAsset = async () => {
      throw new Error("The disk is full.");
    };
    const { recorder } = fakeRecorder();
    const mounted = await mountEditor({ recorder }, store);
    await newNotebook(mounted);
    await press(mounted.container, "Record sound");
    await waitFor(() => expect(button(mounted.container, "Stop recording")).toBeTruthy());
    await expect(mounted.handle.current?.close()).rejects.toMatchObject({ code: "UNKNOWN" });
    // Still in the notebook, with the sound kept for another try.
    await waitFor(() => expect(button(mounted.container, "Save the recording")).toBeTruthy());
    expect(mounted.container.querySelector(PAGE)).toBeTruthy();
  });

  it("asks for one microphone, however often Record is pressed while the browser asks", async () => {
    const fake = fakeRecorder();
    fake.hold();
    const mounted = await mountEditor({ recorder: fake.recorder });
    await newNotebook(mounted);
    await press(mounted.container, "Record sound");
    await press(mounted.container, "Record sound");
    fake.admit();
    await waitFor(() => expect(button(mounted.container, "Stop recording")).toBeTruthy());
    expect(fake.calls.starts).toBe(1);
    await press(mounted.container, "Stop recording");
    await waitFor(async () => expect((await notebookOf(mounted))?.recordings).toHaveLength(1));
  });

  it("gives back a microphone that arrives after the notebook began to close", async () => {
    const fake = fakeRecorder();
    fake.hold();
    const mounted = await mountEditor({ recorder: fake.recorder });
    await newNotebook(mounted);
    await press(mounted.container, "Record sound");
    await mounted.handle.current?.close();
    fake.admit();
    await waitFor(() => expect(fake.calls.cancels).toBe(1));
    expect((await notebookOf(mounted))?.recordings).toEqual([]);
  });

  it("lets the microphone go when the editor is removed while it records", async () => {
    const { recorder, calls } = fakeRecorder();
    const mounted = await mountEditor({ recorder });
    await newNotebook(mounted);
    await press(mounted.container, "Record sound");
    await waitFor(() => expect(button(mounted.container, "Stop recording")).toBeTruthy());
    await cleanUp();
    expect(calls.cancels).toBe(1);
  });
});

describe("NotesEditor when the storage fails", () => {
  /** A store whose page writes fail while `failing` is set. */
  function unreliable() {
    const store = createMemoryNotesStore();
    const disk = { failing: true };
    const writePage = store.writePage.bind(store);
    store.writePage = async (notebook, written) => {
      if (disk.failing) throw new Error("The disk is full.");
      await writePage(notebook, written);
    };
    return { store, disk };
  }

  const saveText = (container: HTMLElement) =>
    container.querySelector(".hm-notes-notebook-save")?.textContent;

  it("keeps the notebook open when it can't be saved, and leaves once it can", async () => {
    const { store, disk } = unreliable();
    const mounted = await mountEditor({}, store);
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await waitFor(() => expect(saveText(mounted.container)).toBe("Not saved"), { timeout: 5_000 });

    await press(mounted.container, "Back to the library");
    // Still in the notebook, with the stroke and the reason.
    await waitFor(() => expect(button(mounted.container, "Close without saving")).toBeTruthy());
    expect(mounted.container.querySelector(PAGE)).toBeTruthy();
    expect(button(mounted.container, "New notebook")).toBeUndefined();

    disk.failing = false;
    await press(mounted.container, "Back to the library");
    await waitFor(() => expect(button(mounted.container, "New notebook")).toBeTruthy());
    expect(strokes(await storedItems(mounted))).toHaveLength(1);
  });

  it("closes without the changes only after asking", async () => {
    const { store } = unreliable();
    const mounted = await mountEditor({}, store);
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await waitFor(() => expect(saveText(mounted.container)).toBe("Not saved"), { timeout: 5_000 });

    await press(mounted.container, "Close without saving");
    const dialog = await waitFor(() => {
      const open = document.querySelector<HTMLElement>("dialog[open]");
      if (!open) throw new Error("No dialog is open.");
      return open;
    });
    expect(dialog.textContent).toContain("will be lost");
    const confirm = [...dialog.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Close without saving",
    );
    if (!confirm) throw new Error("The dialog has no confirming button.");
    await userEvent.click(confirm);
    await waitFor(() => expect(button(mounted.container, "New notebook")).toBeTruthy());
    expect(await storedItems(mounted)).toEqual([]);
    // Given back: it can be opened again.
    const [summary] = mounted.handle.current?.library.getSnapshot().index.notebooks ?? [];
    expect(await store.lockNotebook(summary?.id ?? "")).toBeTypeOf("function");
  });

  it("keeps a recording that couldn't be stored, and stores it when asked again", async () => {
    const store = createMemoryNotesStore();
    const writeAsset = store.writeAsset.bind(store);
    let failing = true;
    store.writeAsset = async (notebook, asset, data) => {
      if (failing) throw new Error("The disk is full.");
      await writeAsset(notebook, asset, data);
    };
    let stops = 0;
    const mounted = await mountEditor(
      {
        recorder: {
          supported: true,
          start: async () => ({
            startedAt: Date.now(),
            elapsed: () => 0,
            stop: async () => {
              stops += 1;
              return { audio: new Blob(["sound"], { type: "audio/webm" }), duration: 1_000 };
            },
            cancel: () => undefined,
          }),
        },
      },
      store,
    );
    await newNotebook(mounted);
    await press(mounted.container, "Record sound");
    await press(mounted.container, "Stop recording");
    await waitFor(() =>
      expect(mounted.container.textContent).toContain("The recording isn't saved yet."),
    );

    // Leaving would lose it, so the notebook stays.
    await press(mounted.container, "Back to the library");
    await waitFor(() => expect(mounted.container.querySelector(PAGE)).toBeTruthy());
    expect(button(mounted.container, "New notebook")).toBeUndefined();

    failing = false;
    await press(mounted.container, "Save the recording");
    await saved(mounted.container);
    const [summary] = mounted.handle.current?.library.getSnapshot().index.notebooks ?? [];
    const notebook = await store.readNotebook(summary?.id ?? "");
    expect(notebook?.recordings).toHaveLength(1);
    // The recorder was stopped once: the sound it gave was kept for the second try.
    expect(stops).toBe(1);
  });

  it("keeps a stroke written before its page's contents were read", async () => {
    const store = createMemoryNotesStore();
    const readPage = store.readPage.bind(store);
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.readPage = async (notebook, page) => {
      await slow;
      return readPage(notebook, page);
    };
    const mounted = await mountEditor({}, store);
    await newNotebook(mounted);
    // The page is on the screen, and the storage hasn't answered yet.
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    await draw(PAGE, line([0.2, 0.5], [0.7, 0.5]));
    // Nothing is refused: no error is shown.
    expect(mounted.container.querySelector(".hm-notes-alert")).toBeNull();
    release();
    await waitFor(async () => expect(strokes(await storedItems(mounted))).toHaveLength(2), {
      timeout: 5_000,
    });
    // In the order they were written.
    const [first, second] = strokes(await storedItems(mounted));
    expect(first?.points[1]).toBeLessThan(second?.points[1] ?? 0);
  });

  it("saves and gives back the open notebook when the editor goes away", async () => {
    const mounted = await mountEditor();
    await newNotebook(mounted);
    await draw(PAGE, line([0.2, 0.3], [0.7, 0.3]));
    const [summary] = mounted.handle.current?.library.getSnapshot().index.notebooks ?? [];
    const id = summary?.id ?? "";
    // Before the save's own timer: the unmount is what stores the stroke.
    await cleanUp();
    await waitFor(async () => expect(await mounted.store.lockNotebook(id)).toBeTypeOf("function"));
    const notebook = await mounted.store.readNotebook(id);
    const page = await mounted.store.readPage(id, notebook?.pages[0]?.id ?? "");
    expect(strokes(page?.items ?? [])).toHaveLength(1);
  });

  it("removes a folder from its own button, and does nothing for an unchanged name", async () => {
    const mounted = await mountEditor();
    const { container } = mounted;
    await press(container, "New folder");
    await userEvent.keyboard("School");
    await press(container, "Create");
    await press(container, "Rename or remove the folder School");
    // The name as it is changes nothing, and removes nothing.
    await press(container, "Rename");
    await waitFor(() => expect(document.querySelector("dialog[open]")).toBeNull());
    expect(mounted.handle.current?.library.getSnapshot().index.folders).toHaveLength(1);

    await press(container, "Rename or remove the folder School");
    await press(container, "Remove the folder");
    // It asks first.
    const dialog = await waitFor(() => {
      const open = document.querySelector<HTMLElement>("dialog[open]");
      if (!open?.textContent?.includes("Remove this folder?")) throw new Error("Not asked yet.");
      return open;
    });
    const confirm = [...dialog.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === "Remove the folder",
    );
    if (!confirm) throw new Error("The dialog has no confirming button.");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(mounted.handle.current?.library.getSnapshot().index.folders).toEqual([]),
    );
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
      const [red, green, blue] = darkestInkNear(second.container, 0.45, 0.3);
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
