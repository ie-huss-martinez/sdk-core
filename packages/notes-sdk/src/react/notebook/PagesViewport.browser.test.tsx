import {
  act,
  createRef,
  type ReactNode,
  type RefObject,
  useImperativeHandle,
  useState,
  useSyncExternalStore,
} from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createFakePdfEngine } from "../../../test/fixtures/fake-pdf.js";
import { countingIds, notebook } from "../../../test/fixtures/notes.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import { createMemoryNotesStore } from "../../adapters/memory-store/memory-store.js";
import { NotesError } from "../../core/errors/notes-error.js";
import { type NotesSession, openNotesSession } from "../../core/session/notebook-session.js";
import { DEFAULT_INK_SETTINGS } from "../../features/tool-types.js";
import { createImageCache } from "../canvas/image-cache.js";
import { NotesProvider } from "../NotesProvider.js";
import { PagesViewport, type PagesViewportHandle } from "./PagesViewport.js";
import { createPdfDocuments } from "./pdf-documents.js";

afterEach(cleanUp);

// A frame as tall as the tallest view these tests use.
beforeAll(async () => {
  await page.viewport(900, 1300);
});

const IMAGES = createImageCache(
  async () => new Blob(),
  () => undefined,
);
const DOCUMENTS = createPdfDocuments(undefined, async () => new Blob());
const NEW_ID = countingIds("new");

interface Controls {
  /** Renders the view again, as any change in the notebook around it does. */
  rerender(): void;
}

/** The pages of a notebook, as the notebook view shows them. */
function Stage(props: {
  readonly session: NotesSession;
  readonly zoom: number;
  readonly handle: RefObject<PagesViewportHandle | null>;
  readonly controls: RefObject<Controls | null>;
  readonly current: string[];
  readonly errors: unknown[];
}): ReactNode {
  const { session } = props;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [, setRenders] = useState(0);
  useImperativeHandle(
    props.controls,
    () => ({ rerender: () => setRenders((count) => count + 1) }),
    [],
  );
  return (
    <PagesViewport
      ref={props.handle}
      session={session}
      snapshot={snapshot}
      settings={DEFAULT_INK_SETTINGS}
      zoom={props.zoom}
      onZoomChange={() => undefined}
      images={IMAGES}
      imagesVersion={0}
      documents={DOCUMENTS}
      label="Pages"
      pageLabel={(index, count) => `Page ${index} of ${count}`}
      newId={NEW_ID}
      audioAnchor={() => undefined}
      onSelectionChange={() => undefined}
      onEditText={() => undefined}
      onRequestLink={() => undefined}
      onFollowLink={() => undefined}
      onCurrentPageChange={(id) => props.current.push(id)}
      onError={(error) => {
        props.errors.push(error);
        // The notebook shows the error, which renders the pages again.
        setRenders((count) => count + 1);
      }}
      renderOverlay={() => null}
    />
  );
}

interface Options {
  readonly pages: number;
  readonly zoom?: number;
  /** The view's height, in CSS pixels. */
  readonly height?: number;
  /** The pages whose contents can't be read, for as long as they're listed. */
  readonly broken?: Set<string>;
}

async function mountPages({ pages, zoom = 1, height = 1200, broken = new Set() }: Options) {
  const store = createMemoryNotesStore();
  const ids = Array.from({ length: pages }, (_, index) => `p${index + 1}`);
  await store.writeNotebook(notebook("book", ids));
  const opened = await openNotesSession({ store, notebook: "book", saveDelay: 60_000 });
  /** Every read of a page's contents the view asked for. */
  const reads: string[] = [];
  const session: NotesSession = {
    ...opened,
    loadPage(id) {
      reads.push(id);
      return broken.has(id)
        ? Promise.reject(new NotesError("STORAGE_FAILED", "The page can't be read."))
        : opened.loadPage(id);
    },
  };
  const handle = createRef<PagesViewportHandle>();
  const controls = createRef<Controls>();
  const current: string[] = [];
  const errors: unknown[] = [];
  const container = await mount(
    <NotesProvider store={createMemoryNotesStore()} pdfEngine={createFakePdfEngine()}>
      <Stage
        session={session}
        zoom={zoom}
        handle={handle}
        controls={controls}
        current={current}
        errors={errors}
      />
    </NotesProvider>,
    `width: 800px; height: ${height}px; display: grid; grid-template-rows: minmax(0, 1fr);`,
  );
  const viewport = container.querySelector<HTMLElement>(".hm-notes-viewport");
  if (!viewport) throw new Error("The pages have no viewport.");
  const pageOf = (id: string) =>
    container.querySelector<HTMLElement>(`[data-hm-notes-page="${id}"]`);
  await waitFor(() => expect(pageOf("p1")?.getAttribute("aria-busy")).toBe("false"));
  return {
    container,
    viewport,
    pageOf,
    current,
    errors,
    readsOf: (id: string) => reads.filter((read) => read === id).length,
    /** The "Try again" control of a page that couldn't be read. */
    retryOf: (id: string) =>
      pageOf(id)?.querySelector<HTMLButtonElement>(".hm-notes-page-failure button"),
    scrollToPage: (id: string) => act(async () => handle.current?.scrollToPage(id)),
    rerender: () => act(async () => controls.current?.rerender()),
    close: () => opened.close({ discard: true }),
  };
}

describe("PagesViewport", () => {
  it("keeps the page a jump asked for as the current one, until the user scrolls", async () => {
    // At a quarter of the width, a page is shorter than a third of the view:
    // the page at the reader's line isn't the one brought to the top.
    const { viewport, pageOf, current, scrollToPage, close } = await mountPages({
      pages: 12,
      zoom: 0.25,
    });
    expect(pageOf("p12")).toBeNull();

    await scrollToPage("p5");
    // The jump's own scroll is measured: the pages below come into reach.
    await waitFor(() => expect(pageOf("p12")).toBeTruthy());
    expect(current.at(-1)).toBe("p5");

    // A scroll nobody made by hand, such as a layout settling, keeps it.
    const measured = current.length;
    await act(async () => {
      viewport.scrollTop += 4;
    });
    await waitFor(() => expect(current.length).toBeGreaterThan(measured));
    expect(current.at(-1)).toBe("p5");

    // The user's own scroll lets it go: the reader's line decides again.
    await act(async () => {
      viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 4 }));
      viewport.scrollTop += 4;
    });
    await waitFor(() => expect(current.at(-1)).toBe("p6"));
    await close();
  });

  it("lets a pinned page go once it's out of view, however the view moved", async () => {
    const { viewport, current, scrollToPage, close } = await mountPages({ pages: 12, zoom: 0.25 });
    await scrollToPage("p9");
    await waitFor(() => expect(current.at(-1)).toBe("p9"));

    // Back to the top, where the ninth page is far below the view.
    await act(async () => {
      viewport.scrollTop = 0;
    });
    await waitFor(() => expect(current.at(-1)).toBe("p2"));
    await close();
  });

  it("reads a page that failed once, says so on the page, and reads it again when asked", async () => {
    const broken = new Set(["p2"]);
    const { viewport, pageOf, errors, readsOf, retryOf, rerender, close } = await mountPages({
      pages: 2,
      broken,
    });
    const retry = await waitFor(() => {
      const found = retryOf("p2");
      if (!found) throw new Error("The page doesn't offer to try again.");
      return found;
    });
    expect(retry.textContent).toBe("Try again");
    expect(pageOf("p2")?.textContent).toContain("This page couldn't be opened.");
    // The page isn't loading any more, and the failure was reported once.
    expect(pageOf("p2")?.getAttribute("aria-busy")).toBe("false");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: "STORAGE_FAILED" });

    // Rendering again, as the error banner makes the notebook do, reads nothing again.
    await rerender();
    await rerender();
    expect(readsOf("p2")).toBe(1);
    expect(errors).toHaveLength(1);

    broken.clear();
    await act(async () => retry.click());
    await waitFor(() => expect(retryOf("p2")).toBeFalsy());
    await waitFor(() => expect(pageOf("p2")?.getAttribute("aria-busy")).toBe("false"));
    expect(readsOf("p2")).toBe(2);
    expect(errors).toHaveLength(1);
    // Focus didn't fall out of the notebook with the control.
    expect(document.activeElement).toBe(viewport);
    await close();
  });

  it("reads a failed page again when it leaves the view and comes back", async () => {
    const { viewport, pageOf, errors, readsOf, retryOf, close } = await mountPages({
      pages: 8,
      broken: new Set(["p2"]),
    });
    await waitFor(() => expect(retryOf("p2")).toBeTruthy());
    expect(readsOf("p2")).toBe(1);

    await act(async () => {
      viewport.scrollTop = 5_000;
    });
    await waitFor(() => expect(pageOf("p2")).toBeNull());
    await act(async () => {
      viewport.scrollTop = 0;
    });
    await waitFor(() => expect(readsOf("p2")).toBe(2));
    await waitFor(() => expect(retryOf("p2")).toBeTruthy());
    expect(errors).toHaveLength(2);
    await close();
  });

  it("mounts the pages a taller view shows, without a scroll", async () => {
    const { container, pageOf, close } = await mountPages({ pages: 4, height: 300 });
    expect(pageOf("p3")).toBeNull();

    await act(async () => {
      container.style.height = "1200px";
    });
    await waitFor(() => expect(pageOf("p3")).toBeTruthy());
    await close();
  });
});
