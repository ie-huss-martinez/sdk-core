import { useLatest } from "@hussmartinez/ui/react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NotesRect } from "../../core/model/geometry.js";
import type { NotesAudioAnchor, NotesItem, NotesText } from "../../core/model/items.js";
import type { NotesPageInfo } from "../../core/model/notebook.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type { NotesSession, NotesSessionSnapshot } from "../../core/session/notebook-session.js";
import type { NotesInkSettings } from "../../features/tool-types.js";
import type { ImageCache } from "../canvas/image-cache.js";
import { textHeight } from "../canvas/text-layout.js";
import { attachInk, type InkPage, type NotesSelection } from "./ink-controller.js";
import { PageView } from "./PageView.js";
import type { PdfDocuments } from "./pdf-documents.js";

/** The zoom's bounds, where 1 fits the widest page in the view. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** The space around and between pages, in CSS pixels. */
const GAP = 16;

/** What the notebook view asks of the viewport. */
export interface PagesViewportHandle {
  scrollToPage(id: string): void;
  /** Changes the zoom about the middle of the view. */
  zoomBy(factor: number): void;
  /** A page on screen, for controls that draw on it. */
  page(id: string): InkPage | undefined;
  focus(): void;
}

export interface PagesViewportProps {
  readonly session: NotesSession;
  readonly snapshot: NotesSessionSnapshot;
  readonly settings: NotesInkSettings;
  readonly zoom: number;
  readonly onZoomChange: (zoom: number) => void;
  readonly images: ImageCache;
  readonly imagesVersion: number;
  readonly documents: PdfDocuments;
  readonly label: string;
  readonly pageLabel: (index: number, count: number) => string;
  readonly newId: () => string;
  readonly audioAnchor: () => NotesAudioAnchor | undefined;
  readonly dim?: ((item: NotesItem) => boolean) | undefined;
  /** Items the page leaves out while a control draws them, by page. */
  readonly skip?: { readonly page: string; readonly ids: ReadonlySet<string> } | undefined;
  readonly onSelectionChange: (selection: NotesSelection | undefined) => void;
  readonly onEditText: (
    page: string,
    target: NotesText | { readonly x: number; readonly y: number },
  ) => void;
  readonly onRequestLink: (page: string, area: NotesRect) => void;
  readonly onFollowLink: (page: string) => void;
  readonly onCurrentPageChange: (page: string) => void;
  readonly onError: (error: unknown) => void;
  /** Controls drawn over a page: the selection's box and the text editor. */
  readonly renderOverlay: (info: NotesPageInfo, pixelsPerPoint: number) => ReactNode;
}

interface Layout {
  readonly pixelsPerPoint: number;
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  }[];
}

/** Where every page goes: a centred column, top to bottom. */
function layoutPages(pages: readonly NotesPageInfo[], viewWidth: number, zoom: number): Layout {
  const widest = Math.max(1, ...pages.map((page) => page.width / NOTES_UNITS_PER_POINT));
  const pixelsPerPoint = (Math.max(1, viewWidth - 2 * GAP) / widest) * zoom;
  const width = Math.max(viewWidth, widest * pixelsPerPoint + 2 * GAP);
  let top = GAP;
  const boxes = pages.map((page) => {
    const pageWidth = (page.width / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
    const pageHeight = (page.height / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
    const box = { left: (width - pageWidth) / 2, top, width: pageWidth, height: pageHeight };
    top += pageHeight + GAP;
    return box;
  });
  return { pixelsPerPoint, width, height: top, boxes };
}

/**
 * The pages of an open notebook, in a scrolling column: only the pages near
 * the view are mounted, the ink engine listens here, and zoom keeps the
 * point under the fingers still.
 */
export const PagesViewport = /* @__PURE__ */ forwardRef<PagesViewportHandle, PagesViewportProps>(
  function PagesViewport(props, handle): ReactNode {
    const { session, snapshot, zoom, images, imagesVersion, documents, dim, skip } = props;
    const { notebook } = snapshot;
    const viewport = useRef<HTMLElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const mounted = useRef(new Map<string, InkPage>());
    const [view, setView] = useState({ width: 0, height: 0 });
    const [range, setRange] = useState({ first: 0, last: 0 });
    /** The point to keep still when the zoom changes: a place on a page, and where it was on screen. */
    const anchor = useRef<
      { page: string; fx: number; fy: number; clientX: number; clientY: number } | undefined
    >(undefined);
    const latest = useLatest(props);

    const layout = useMemo(
      () => layoutPages(notebook.pages, view.width, zoom),
      [notebook.pages, view.width, zoom],
    );
    const latestLayout = useLatest(layout);

    const register = useCallback((id: string, page: InkPage | undefined) => {
      if (page) mounted.current.set(id, page);
      else mounted.current.delete(id);
    }, []);

    /** Which pages are near the view, and which one the reader is on. */
    const measure = useCallback(() => {
      const element = viewport.current;
      if (!element) return;
      const { boxes } = latestLayout.current;
      const top = element.scrollTop - element.clientHeight;
      const bottom = element.scrollTop + 2 * element.clientHeight;
      let first = boxes.findIndex((box) => box.top + box.height >= top);
      if (first === -1) first = Math.max(0, boxes.length - 1);
      let last = first;
      while (
        last + 1 < boxes.length &&
        (boxes[last + 1]?.top ?? Number.POSITIVE_INFINITY) <= bottom
      ) {
        last += 1;
      }
      setRange((current) =>
        current.first === first && current.last === last ? current : { first, last },
      );
      // The reader is on the page a third of the way down the view.
      const line = element.scrollTop + element.clientHeight / 3;
      const index = boxes.findIndex((box) => box.top + box.height + GAP / 2 >= line);
      const pages = latest.current.snapshot.notebook.pages;
      const current = pages[index === -1 ? pages.length - 1 : index];
      if (current) latest.current.onCurrentPageChange(current.id);
    }, [latest, latestLayout]);

    // The view's size, which the layout follows.
    useLayoutEffect(() => {
      const element = viewport.current;
      if (!element) return;
      const update = () =>
        setView((current) =>
          current.width === element.clientWidth && current.height === element.clientHeight
            ? current
            : { width: element.clientWidth, height: element.clientHeight },
        );
      update();
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    }, []);

    // After a zoom, the anchored point goes back under the fingers.
    useLayoutEffect(() => {
      const element = viewport.current;
      const area = content.current;
      if (area) area.style.transform = "";
      const kept = anchor.current;
      anchor.current = undefined;
      if (element && kept) {
        const index = notebook.pages.findIndex((page) => page.id === kept.page);
        const box = layout.boxes[index];
        if (box) {
          const rect = element.getBoundingClientRect();
          element.scrollLeft = box.left + kept.fx * box.width - (kept.clientX - rect.left);
          element.scrollTop = box.top + kept.fy * box.height - (kept.clientY - rect.top);
        }
      }
      measure();
    }, [layout, notebook.pages, measure]);

    useEffect(() => {
      const element = viewport.current;
      if (!element) return;
      let frame = 0;
      const onScroll = () => {
        if (frame === 0) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            measure();
          });
        }
      };
      element.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        element.removeEventListener("scroll", onScroll);
        if (frame !== 0) cancelAnimationFrame(frame);
      };
    }, [measure]);

    /** Remembers which point of which page is at a place on screen. */
    const anchorAt = useCallback(
      (clientX: number, clientY: number) => {
        const element = viewport.current;
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const x = element.scrollLeft + clientX - rect.left;
        const y = element.scrollTop + clientY - rect.top;
        const { boxes } = latestLayout.current;
        let index = boxes.findIndex((box) => y <= box.top + box.height + GAP / 2);
        if (index === -1) index = boxes.length - 1;
        const box = boxes[index];
        const page = latest.current.snapshot.notebook.pages[index];
        if (!box || !page) return;
        anchor.current = {
          page: page.id,
          fx: (x - box.left) / box.width,
          fy: (y - box.top) / box.height,
          clientX,
          clientY,
        };
      },
      [latest, latestLayout],
    );

    const commitZoom = useCallback(
      (factor: number, clientX: number, clientY: number) => {
        const current = latest.current.zoom;
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor));
        if (content.current) content.current.style.transform = "";
        if (Math.abs(next - current) < 0.001) return;
        anchorAt(clientX, clientY);
        latest.current.onZoomChange(next);
      },
      [anchorAt, latest],
    );

    // The ink engine, attached once for the life of the session.
    useEffect(() => {
      const element = viewport.current;
      if (!element) return;
      return attachInk({
        viewport: element,
        session,
        page: (id) => mounted.current.get(id),
        settings: () => latest.current.settings,
        newId: () => latest.current.newId(),
        audioAnchor: () => latest.current.audioAnchor(),
        textHeight,
        setSelection: (selection) => latest.current.onSelectionChange(selection),
        editText: (page, target) => latest.current.onEditText(page, target),
        requestLink: (page, area) => latest.current.onRequestLink(page, area),
        followLink: (page) => latest.current.onFollowLink(page),
        previewZoom(factor, clientX, clientY) {
          const area = content.current;
          if (!area) return;
          const current = latest.current.zoom;
          const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)) / current;
          const rect = element.getBoundingClientRect();
          area.style.transformOrigin = `${element.scrollLeft + clientX - rect.left}px ${
            element.scrollTop + clientY - rect.top
          }px`;
          area.style.transform = `scale(${clamped})`;
        },
        commitZoom,
        onError: (error) => latest.current.onError(error),
      });
    }, [session, commitZoom, latest]);

    useImperativeHandle(
      handle,
      () => ({
        scrollToPage(id) {
          const element = viewport.current;
          const index = latest.current.snapshot.notebook.pages.findIndex((page) => page.id === id);
          const box = latestLayout.current.boxes[index];
          if (element && box) element.scrollTop = box.top - GAP;
        },
        zoomBy(factor) {
          const element = viewport.current;
          if (!element) return;
          const rect = element.getBoundingClientRect();
          commitZoom(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
        },
        page: (id) => mounted.current.get(id),
        focus: () => viewport.current?.focus(),
      }),
      [commitZoom, latest, latestLayout],
    );

    // The contents of the pages near the view.
    const first = Math.min(range.first, Math.max(0, notebook.pages.length - 1));
    const last = Math.min(range.last, notebook.pages.length - 1);
    const visible = notebook.pages.slice(first, last + 1);
    useEffect(() => {
      for (const page of visible) {
        if (!snapshot.pages.has(page.id)) {
          session.loadPage(page.id).catch((error: unknown) => latest.current.onError(error));
        }
      }
    });

    return (
      <section
        ref={viewport}
        className="hm-notes-viewport"
        aria-label={props.label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the region scrolls, so it must take focus
        tabIndex={0}
        data-hm-tool={props.settings.tool}
      >
        <div
          ref={content}
          className="hm-notes-pages"
          style={{ width: layout.width, height: layout.height }}
        >
          {visible.map((info, offset) => {
            const index = first + offset;
            const box = layout.boxes[index];
            if (!box) return null;
            return (
              <div
                key={info.id}
                className="hm-notes-page-slot"
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              >
                <PageView
                  info={info}
                  items={snapshot.pages.get(info.id)?.items}
                  label={props.pageLabel(index + 1, notebook.pages.length)}
                  pixelsPerPoint={layout.pixelsPerPoint}
                  images={images}
                  imagesVersion={imagesVersion}
                  documents={documents}
                  dim={dim}
                  skip={skip?.page === info.id ? skip.ids : undefined}
                  register={register}
                >
                  {props.renderOverlay(info, layout.pixelsPerPoint)}
                </PageView>
              </div>
            );
          })}
        </div>
      </section>
    );
  },
);
