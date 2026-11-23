import { VisuallyHidden } from "@hussmartinez/ui/react";
import { memo, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { NotesItem } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import { pageCanvasSize } from "../canvas/canvas-size.js";
import type { ImageCache } from "../canvas/image-cache.js";
import { paintPage } from "../canvas/paint.js";
import type { InkPage } from "./ink-controller.js";
import type { PdfDocuments } from "./pdf-documents.js";

export interface PageViewProps {
  readonly info: NotesPageInfo;
  /** The page's items, or `undefined` while they load. */
  readonly items: readonly NotesItem[] | undefined;
  /** Whether the items couldn't be read: the page isn't busy loading them any more. */
  readonly failed?: boolean | undefined;
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
 * (docs/adr/0002). Once the PDF page is drawn, the ink canvas paints it as
 * its paper too, so a highlight is multiplied over the PDF's text as it is
 * in the exported PDF. The canvases are hidden from assistive technology;
 * the page's typed text is repeated as real text.
 */
export const PageView = /* @__PURE__ */ memo(function PageView(props: PageViewProps): ReactNode {
  const { info, items, label, pixelsPerPoint, images, imagesVersion, documents, dim, skip } = props;
  const { register, failed } = props;
  const element = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const wet = useRef<HTMLCanvasElement>(null);
  const background = useRef<HTMLCanvasElement>(null);
  /** What the ink engine asked to show in place of the session's items. */
  const override = useRef<readonly NotesItem[] | undefined>(undefined);
  /** Whether the PDF page has been drawn, and so can be the ink's paper. */
  const drawn = useRef(false);
  const latest = useRef({ items, images, dim, skip, info });

  const width = (info.width / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
  const height = (info.height / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
  const { width: pixelWidth, height: pixelHeight } = pageCanvasSize(
    width,
    height,
    typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
  );

  /** Paints the finished ink over its paper, from what was last rendered. */
  const repaint = useCallback(() => {
    const context = ink.current?.getContext("2d");
    if (!context) return;
    const current = latest.current;
    paintPage(context, current.info, override.current ?? current.items ?? [], {
      images: current.images,
      dim: current.dim,
      skip: current.skip,
      backdrop: (drawn.current && background.current) || undefined,
    });
  }, []);

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
    repaint();
    // imagesVersion isn't read, but a picture that finished loading must repaint the page.
    void imagesVersion;
  }, [items, images, imagesVersion, dim, skip, info, pixelWidth, pixelHeight, repaint]);

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
        repaint();
      },
    });
    return () => register(info.id, undefined);
  }, [info, register, repaint]);

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
            // The ink canvas's own density, which the pixel budget may have lowered.
            pixelRatio: pixelWidth / width,
            signal: abort.signal,
          });
          if (abort.signal.aborted) return;
          canvas.width = scratch.width;
          canvas.height = scratch.height;
          canvas.getContext("2d")?.drawImage(scratch, 0, 0);
          canvas.removeAttribute("data-hm-pending");
          // The ink is painted again, over the PDF page: highlights blend with it from now on.
          // A canvas with no pixels can't be painted from.
          drawn.current = canvas.width > 0 && canvas.height > 0;
          repaint();
        })
        // A page that can't be drawn keeps its ink on a plain ground.
        .catch(() => undefined);
    }, 120);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [pdf, documents, pixelsPerPoint, pixelWidth, width, repaint]);

  return (
    <section
      ref={element}
      className="hm-notes-page"
      data-hm-notes-page={info.id}
      aria-label={label}
      aria-busy={items === undefined && !failed}
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
