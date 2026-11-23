import {
  act,
  createRef,
  type ReactNode,
  type RefObject,
  useImperativeHandle,
  useState,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stroke } from "../../../test/fixtures/notes.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import type { NotesItem } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import type { NotesPdfDocument } from "../../core/ports/notes-pdf.js";
import { createImageCache } from "../canvas/image-cache.js";
import { PageThumbnail } from "./PageThumbnail.js";
import type { PdfDocuments } from "./pdf-documents.js";

afterEach(cleanUp);

const IMAGES = createImageCache(
  async () => new Blob(),
  () => undefined,
);

const PLAIN: NotesPageInfo = { id: "p1", width: 59_500, height: 84_200, template: "blank" };
const ON_PDF: NotesPageInfo = {
  ...PLAIN,
  background: {
    pdf: { asset: `sha256:${"0".repeat(64)}`, mediaType: "application/pdf", size: 1 },
    pageIndex: 0,
  },
};

/** A thick stroke across the middle of the page: several pixels of a thumbnail. */
const ACROSS: NotesItem = { ...stroke("s", [10_000, 42_100], [50_000, 42_100]), size: 2_000 };

/** A PDF of one white page, which counts how often the page is drawn. */
function countingPdf(): PdfDocuments & { renders: number } {
  const documents = {
    renders: 0,
    async get() {
      const document: NotesPdfDocument = {
        pageCount: 1,
        pageSize: async () => ({ width: 595, height: 842 }),
        pageText: async () => "",
        async render(_pageIndex, canvas, options) {
          documents.renders += 1;
          const density = options.scale * (options.pixelRatio ?? 1);
          canvas.width = Math.round(595 * density);
          canvas.height = Math.round(842 * density);
          const context = canvas.getContext("2d");
          if (!context) return;
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
        },
        destroy: async () => undefined,
      };
      return document;
    },
    dispose: () => undefined,
  };
  return documents;
}

const NO_PDF: PdfDocuments = { get: async () => undefined, dispose: () => undefined };

interface Shown {
  readonly items: readonly NotesItem[];
  readonly imagesVersion: number;
}

/** A thumbnail at the top of a short scrolling list, as the sidebar's rows are. */
function Stage(props: {
  readonly info: NotesPageInfo;
  readonly documents: PdfDocuments;
  readonly show: RefObject<((shown: Shown) => void) | null>;
}): ReactNode {
  const [shown, setShown] = useState<Shown>({ items: [], imagesVersion: 0 });
  useImperativeHandle(props.show, () => setShown, []);
  return (
    <div data-scroller="" style={{ height: 300, overflow: "auto" }}>
      <PageThumbnail
        info={props.info}
        items={shown.items}
        images={IMAGES}
        imagesVersion={shown.imagesVersion}
        documents={props.documents}
        onVisible={() => undefined}
      />
      <div style={{ height: 3000 }} />
    </div>
  );
}

async function mountThumbnail(info: NotesPageInfo, documents: PdfDocuments) {
  const show = createRef<(shown: Shown) => void>();
  const container = await mount(<Stage info={info} documents={documents} show={show} />);
  const scroller = container.querySelector<HTMLElement>("[data-scroller]");
  const canvas = container.querySelector<HTMLCanvasElement>(".hm-notes-thumbnail-canvas");
  if (!scroller || !canvas) throw new Error("The thumbnail isn't on the page.");

  /** Scrolls the list, and waits until the browser has told whether the thumbnail shows. */
  const scrollTo = async (top: number, showing: boolean): Promise<void> => {
    scroller.scrollTop = top;
    // Inside act(), where the thumbnail's own observer may update it.
    await act(
      () =>
        new Promise<void>((resolve) => {
          // Made after the thumbnail's observer, so it hears after it.
          const observer = new IntersectionObserver((entries) => {
            if (entries.at(-1)?.isIntersecting !== showing) return;
            observer.disconnect();
            resolve();
          });
          observer.observe(canvas);
        }),
    );
  };

  /** Whether there's ink across the middle of the picture. */
  const inked = (): boolean => {
    const pixels =
      canvas
        .getContext("2d")
        ?.getImageData(canvas.width / 2 - 5, Math.round(canvas.height / 2) - 5, 10, 10).data ?? [];
    for (let index = 0; index < pixels.length; index += 4) {
      const dark = (pixels[index] ?? 255) + (pixels[index + 1] ?? 255) + (pixels[index + 2] ?? 255);
      if ((pixels[index + 3] ?? 0) > 0 && dark < 400) return true;
    }
    return false;
  };

  return {
    canvas,
    scrollTo,
    inked,
    show: (shown: Shown) => act(async () => show.current?.(shown)),
  };
}

describe("PageThumbnail", () => {
  it("paints while it's in view, keeps its picture out of view, and paints again when it comes back", async () => {
    const { canvas, scrollTo, inked, show } = await mountThumbnail(PLAIN, NO_PDF);
    // Painting sizes the canvas: until then it has a canvas's default width.
    await waitFor(() => expect(canvas.width).toBe(224));
    await show({ items: [ACROSS], imagesVersion: 0 });
    expect(inked()).toBe(true);

    await scrollTo(1_500, false);
    // The stroke is erased while the row is out of view: its picture isn't painted again.
    await show({ items: [], imagesVersion: 1 });
    expect(inked()).toBe(true);

    await scrollTo(0, true);
    await waitFor(() => expect(inked()).toBe(false));
  });

  it("lets its PDF page go out of view, and draws it again when it comes back", async () => {
    const documents = countingPdf();
    const { canvas, scrollTo, inked, show } = await mountThumbnail(ON_PDF, documents);
    await waitFor(() => expect(canvas.width).toBe(224));
    expect(documents.renders).toBe(1);

    await scrollTo(1_500, false);
    // A picture that finished loading repaints the rows in view, not this one.
    await show({ items: [ACROSS], imagesVersion: 1 });
    expect(documents.renders).toBe(1);
    expect(inked()).toBe(false);

    await scrollTo(0, true);
    await waitFor(() => expect(inked()).toBe(true));
    expect(documents.renders).toBe(2);
  });

  it("asks for the page's items once it's in view", async () => {
    const onVisible = vi.fn<() => void>();
    const container = await mount(
      <PageThumbnail
        info={PLAIN}
        items={undefined}
        images={IMAGES}
        imagesVersion={0}
        documents={NO_PDF}
        onVisible={onVisible}
      />,
    );
    await waitFor(() => expect(onVisible).toHaveBeenCalledTimes(1));
    expect(container.querySelector(".hm-notes-thumbnail-canvas")).toBeTruthy();
  });
});
