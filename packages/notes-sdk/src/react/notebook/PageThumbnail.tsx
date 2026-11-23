import { type ReactNode, useEffect, useRef, useState } from "react";
import type { NotesItem } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type { ImageCache } from "../canvas/image-cache.js";
import { paintPage } from "../canvas/paint.js";
import type { PdfDocuments } from "./pdf-documents.js";

/** A thumbnail's width, in CSS pixels. */
const WIDTH = 112;

export interface PageThumbnailProps {
  readonly info: NotesPageInfo;
  /** The page's items, or `undefined` until they're loaded. */
  readonly items: readonly NotesItem[] | undefined;
  readonly images: ImageCache;
  readonly imagesVersion: number;
  readonly documents: PdfDocuments;
  /** Asks for the page's items, once the thumbnail is in view. */
  readonly onVisible: () => void;
}

/**
 * A small picture of a page: its PDF page if it has one, its paper and its
 * ink. It draws only while it's scrolled into view, so a long notebook
 * doesn't draw every page to show its sidebar, and it lets its PDF page go
 * when it leaves: the rows a reader has scrolled past hold nothing but
 * their last picture.
 */
export function PageThumbnail(props: PageThumbnailProps): ReactNode {
  const { info, items, images, imagesVersion, documents, onVisible } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [inView, setInView] = useState(false);
  /**
   * The PDF page, drawn. `undefined` until its drawing ends, and `null` when
   * there's none to show: no engine, or a PDF that can't be drawn.
   */
  const [background, setBackground] = useState<HTMLCanvasElement | null | undefined>(undefined);
  const height = Math.round((WIDTH * info.height) / info.width);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      const intersecting = entries.at(-1)?.isIntersecting ?? false;
      setInView(intersecting);
      // Out of view, the PDF page is let go. It's drawn again if the row comes back.
      if (!intersecting) setBackground(undefined);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (inView && items === undefined) onVisible();
  }, [inView, items, onVisible]);

  const pdf = info.background;
  useEffect(() => {
    if (!inView || !pdf) return;
    const abort = new AbortController();
    const settle = (drawn: HTMLCanvasElement | null) => {
      if (!abort.signal.aborted) setBackground(drawn);
    };
    void documents
      .get(pdf.pdf)
      .then(async (document) => {
        if (!document || abort.signal.aborted || pdf.pageIndex >= document.pageCount) {
          settle(null);
          return;
        }
        const scratch = window.document.createElement("canvas");
        await document.render(pdf.pageIndex, scratch, {
          scale: WIDTH / (info.width / NOTES_UNITS_PER_POINT),
          pixelRatio: 2,
          signal: abort.signal,
        });
        // A canvas with no pixels can't be painted from.
        settle(scratch.width > 0 && scratch.height > 0 ? scratch : null);
      })
      .catch(() => settle(null));
    return () => abort.abort();
  }, [inView, pdf, documents, info.width]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    // A row out of view keeps its last picture. A page on a PDF waits for the
    // PDF page, so it's never shown as ink alone.
    if (!element || !context || !inView || (pdf && background === undefined)) return;
    void imagesVersion;
    element.width = WIDTH * 2;
    element.height = height * 2;
    paintPage(context, info, items ?? [], { images, backdrop: background ?? undefined });
  }, [inView, items, images, imagesVersion, background, pdf, info, height]);

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: the canvas is pixels only and never focusable; its row names the page
    <canvas
      ref={canvas}
      className="hm-notes-thumbnail-canvas"
      aria-hidden="true"
      style={{ width: WIDTH, height }}
    />
  );
}
