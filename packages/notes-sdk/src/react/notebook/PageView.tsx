import { VisuallyHidden } from "@hussmartinez/ui/react";
import { memo, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import type { NotesItem } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type { ImageCache } from "../canvas/image-cache.js";
import { beginPage, paintItems, paintPaper } from "../canvas/paint.js";
import type { InkPage } from "./ink-controller.js";
import type { PdfDocuments } from "./pdf-documents.js";

/** The most pixels one page's canvas holds. Beyond it, the canvas is drawn at a lower density. */
const MAX_CANVAS_PIXELS = 12_000_000;

/** A canvas's pixel density for a page of a given size in CSS pixels. */
export function canvasDensity(width: number, height: number): number {
  const device = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  return Math.max(
    0.5,
    Math.min(device, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height))),
  );
}

export interface PageViewProps {
  readonly info: NotesPageInfo;
  /** The page's items, or `undefined` while they load. */
  readonly items: readonly NotesItem[] | undefined;
  /** The page's accessible name, such as "Page 3 of 12". */
  readonly label: string;
  /** CSS pixels per PDF point. */
  readonly pixelsPerPoint: number;
  readonly images: ImageCache;
  /** Changes when a picture finishes loading, so the page repaints. */
  readonly imagesVersion: number;
  readonly documents: PdfDocuments;
  /** Whether an item is drawn faint: ink a playing recording hasn't reached. */
  readonly dim?: ((item: NotesItem) => boolean) | undefined;
  /** Items left out of the finished ink while something else draws them. */
  readonly skip?: ReadonlySet<string> | undefined;
  /** Gives the ink engine this page, and takes it back on unmount. */
  readonly register: (id: string, page: InkPage | undefined) => void;
  /** The selection's box, the text editor and other controls over the page. */
  readonly children?: ReactNode;
}

/**
 * One page on screen: the PDF page under it, if any, the finished ink, and
 * the wet canvas the ink engine draws on while the pen is down
 * (docs/adr/0002). The canvases are hidden from assistive technology; the
 * page's typed text is repeated as real text.
 */
export const PageView = /* @__PURE__ */ memo(function PageView(props: PageViewProps): ReactNode {
  const { info, items, label, pixelsPerPoint, images, imagesVersion, documents, dim, skip } = props;
  const { register } = props;
  const element = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const wet = useRef<HTMLCanvasElement>(null);
  const background = useRef<HTMLCanvasElement>(null);
  /** What the ink engine asked to show in place of the session's items. */
  const override = useRef<readonly NotesItem[] | undefined>(undefined);
  const latest = useRef({ items, images, dim, skip, info });

  const width = (info.width / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
  const height = (info.height / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
  const density = canvasDensity(width, height);
  const pixelWidth = Math.max(1, Math.round(width * density));
  const pixelHeight = Math.max(1, Math.round(height * density));

  // Sized and painted before the browser paints, so a zoom never shows a blank page.
  useLayoutEffect(() => {
    latest.current = { items, images, dim, skip, info };
    const canvas = ink.current;
    if (!canvas) return;
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const overlay = wet.current;
    if (overlay && (overlay.width !== pixelWidth || overlay.height !== pixelHeight)) {
      overlay.width = pixelWidth;
      overlay.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    beginPage(context, info);
    paintPaper(context, info);
    paintItems(context, override.current ?? items ?? [], { images, dim, skip });
    // imagesVersion isn't read, but a picture that finished loading must repaint the page.
    void imagesVersion;
  }, [items, images, imagesVersion, dim, skip, info, pixelWidth, pixelHeight]);

  useEffect(() => {
    const page = element.current;
    const overlay = wet.current;
    if (!page || !overlay) return;
    register(info.id, {
      info,
      element: page,
      wet: overlay,
      paint(next) {
        override.current = next;
        const context = ink.current?.getContext("2d");
        if (!context) return;
        const current = latest.current;
        beginPage(context, current.info);
        paintPaper(context, current.info);
        paintItems(context, next ?? current.items ?? [], {
          images: current.images,
          dim: current.dim,
          skip: current.skip,
        });
      },
    });
    return () => register(info.id, undefined);
  }, [info, register]);

  // The PDF page under the ink, drawn again when the zoom settles.
  const pdf = info.background;
  useEffect(() => {
    const canvas = background.current;
    if (!pdf || !canvas) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void documents
        .get(pdf.pdf)
        .then(async (document) => {
          if (!document || abort.signal.aborted || pdf.pageIndex >= document.pageCount) return;
          // Drawn off screen, then copied, so the page never shows a half-drawn PDF.
          const scratch = window.document.createElement("canvas");
          await document.render(pdf.pageIndex, scratch, {
            scale: pixelsPerPoint,
            pixelRatio: density,
            signal: abort.signal,
          });
          if (abort.signal.aborted) return;
          canvas.width = scratch.width;
          canvas.height = scratch.height;
          canvas.getContext("2d")?.drawImage(scratch, 0, 0);
          canvas.removeAttribute("data-hm-pending");
        })
        // A page that can't be drawn keeps its ink on a plain ground.
        .catch(() => undefined);
    }, 120);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [pdf, documents, pixelsPerPoint, density]);

  return (
    <section
      ref={element}
      className="hm-notes-page"
      data-hm-notes-page={info.id}
      aria-label={label}
      aria-busy={items === undefined}
      style={{ width, height }}
    >
      {pdf ? (
        // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is pixels only and never focusable
        <canvas
          ref={background}
          className="hm-notes-page-canvas hm-notes-page-background"
          data-hm-pending=""
          aria-hidden="true"
        />
      ) : null}
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is pixels only and never focusable; the page's typed text is repeated as text */}
      <canvas ref={ink} className="hm-notes-page-canvas hm-notes-page-ink" aria-hidden="true" />
      {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is pixels only and never focusable */}
      <canvas ref={wet} className="hm-notes-page-canvas hm-notes-page-wet" aria-hidden="true" />
      {items?.some((item) => item.type === "text") ? (
        <VisuallyHidden as="div">
          {items.map((item) => (item.type === "text" ? <p key={item.id}>{item.text}</p> : null))}
        </VisuallyHidden>
      ) : null}
      {props.children}
    </section>
  );
});
