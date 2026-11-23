import { type ReactNode, useEffect, useRef, useState } from "react";
import type { NotesItem } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type { ImageCache } from "../canvas/image-cache.js";
import { beginPage, paintItems, paintPaper } from "../canvas/paint.js";
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
 * ink. It draws only once it's scrolled into view, so a long notebook
 * doesn't draw every page to show its sidebar.
 */
export function PageThumbnail(props: PageThumbnailProps): ReactNode {
  const { info, items, images, imagesVersion, documents, onVisible } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [background, setBackground] = useState<HTMLCanvasElement | undefined>(undefined);
  const height = Math.round((WIDTH * info.height) / info.width);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible && items === undefined) onVisible();
  }, [visible, items, onVisible]);

  const pdf = info.background;
  useEffect(() => {
    if (!visible || !pdf) return;
    const abort = new AbortController();
    void documents
      .get(pdf.pdf)
      .then(async (document) => {
        if (!document || abort.signal.aborted || pdf.pageIndex >= document.pageCount) return;
        const scratch = window.document.createElement("canvas");
        await document.render(pdf.pageIndex, scratch, {
          scale: WIDTH / (info.width / NOTES_UNITS_PER_POINT),
          pixelRatio: 2,
          signal: abort.signal,
        });
        if (!abort.signal.aborted) setBackground(scratch);
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [visible, pdf, documents, info.width]);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context || !visible) return;
    void imagesVersion;
    element.width = WIDTH * 2;
    element.height = height * 2;
    if (background) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(background, 0, 0, element.width, element.height);
      const scale = element.width / info.width;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    } else {
      beginPage(context, info);
      paintPaper(context, info);
    }
    paintItems(context, items ?? [], { images });
  }, [visible, items, images, imagesVersion, background, info, height]);

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
