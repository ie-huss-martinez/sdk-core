import { Button, useLatest } from "@hussmartinez/ui/react";
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
import { useNotes } from "../context.js";
import { attachInk, type InkPage, type NotesSelection } from "./ink-controller.js";
import { PageView } from "./PageView.js";
import type { PdfDocuments } from "./pdf-documents.js";

/** The zoom's bounds, where 1 fits the widest page in the view. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** The space around and between pages, in CSS pixels. */
const GAP = 16;
/** The room above the first page and under the last, for the controls that float over the pages. */
const HEAD = 72;
/** The widest a page is drawn at a zoom of 1, in CSS pixels. */
const FIT_MAX = 980;

/** No page: the pages whose contents couldn't be read, when every read worked. */
const NONE: ReadonlySet<string> = new Set();

/** What the notebook view asks of the viewport. */
export interface PagesViewportHandle {
  /**
   * Brings a page to the top of the view, and makes it the current page
   * until the user scrolls away: a page shorter than a third of the view
   * isn't the one the reader's line falls on.
   */
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
  // At a zoom of 1 the page fits the width, up to a comfortable reading width on a wide screen.
  const fit = Math.min(Math.max(1, viewWidth - 2 * GAP), FIT_MAX);
  const pixelsPerPoint = (fit / widest) * zoom;
  const width = Math.max(viewWidth, widest * pixelsPerPoint + 2 * GAP);
  // The first page starts under what floats over the pages' top.
  let top = HEAD;
  const boxes = pages.map((page) => {
    const pageWidth = (page.width / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
    const pageHeight = (page.height / NOTES_UNITS_PER_POINT) * pixelsPerPoint;
    const box = { left: (width - pageWidth) / 2, top, width: pageWidth, height: pageHeight };
    top += pageHeight + GAP;
    return box;
  });
  return { pixelsPerPoint, width, height: top + HEAD - GAP, boxes };
}

/** What a page whose contents couldn't be read shows in their place: why, and a way to try again. */
function PageFailure({ onRetry }: { readonly onRetry: () => void }): ReactNode {
  const { messages } = useNotes();
  return (
    <div className="hm-notes-page-failure" data-hm-notes-control="">
      <p className="hm-notes-page-failure-text">{messages.t("notebook.pageFailed")}</p>
      <Button size="small" onClick={onRetry}>
        {messages.t("notebook.retryPage")}
      </Button>
    </div>
  );
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
    /** The pages near the view whose contents couldn't be read. They aren't read again unasked. */
    const [failed, setFailed] = useState(NONE);
    /** The pages being read, so one failure is reported once. */
    const reading = useRef(new Set<string>());
    /**
     * The page a jump asked for. It stays the current page while it shows,
     * until the user scrolls: `released` once the user has touched the view.
     */
    const pin = useRef<{ readonly page: string; released: boolean } | undefined>(undefined);
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
      const pages = latest.current.snapshot.notebook.pages;
      // A page that failed and has left the view is read again when it comes back.
      setFailed((current) => {
        if (current.size === 0) return current;
        const near = new Set(pages.slice(first, last + 1).map((page) => page.id));
        const kept = [...current].filter((id) => near.has(id));
        return kept.length === current.size ? current : new Set(kept);
      });
      // The reader is on the page a third of the way down the view.
      const line = element.scrollTop + element.clientHeight / 3;
      let index = boxes.findIndex((box) => box.top + box.height + GAP / 2 >= line);
      if (index === -1) index = pages.length - 1;
      // Unless a jump asked for a page that still shows: it may be too short to reach that line.
      const held = pin.current;
      if (held) {
        const at = pages.findIndex((page) => page.id === held.page);
        const box = boxes[at];
        const shows =
          box !== undefined &&
          box.top < element.scrollTop + element.clientHeight &&
          box.top + box.height > element.scrollTop;
        if (shows) index = at;
        else pin.current = undefined;
      }
      const current = pages[index];
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
      const observer = new ResizeObserver(() => {
        update();
        // A view that only grew taller has the same layout and didn't scroll,
        // yet shows pages it didn't: they're found here.
        measure();
      });
      observer.observe(element);
      return () => observer.disconnect();
    }, [measure]);

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
        // A scroll after the user touched the view is theirs: the page a jump pinned is let go.
        if (pin.current?.released) pin.current = undefined;
        if (frame === 0) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            measure();
          });
        }
      };
      // What a user scrolls with: the wheel, a finger or a pen, the scrollbar under a
      // pointer, and the keys. A jump's own scroll follows none of them.
      const release = () => {
        if (pin.current) pin.current.released = true;
      };
      element.addEventListener("scroll", onScroll, { passive: true });
      element.addEventListener("wheel", release, { passive: true });
      element.addEventListener("pointerdown", release);
      element.addEventListener("keydown", release);
      return () => {
        element.removeEventListener("scroll", onScroll);
        element.removeEventListener("wheel", release);
        element.removeEventListener("pointerdown", release);
        element.removeEventListener("keydown", release);
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
          if (!element || !box) return;
          pin.current = { page: id, released: false };
          element.scrollTop = box.top - GAP;
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
    const near = useLatest(visible);
    useEffect(() => {
      for (const { id } of visible) {
        // A page that failed waits to be asked for again, by leaving the view
        // and coming back or by its "Try again": reading it on every render
        // would never stop, since each failure renders the notebook again.
        if (snapshot.pages.has(id) || failed.has(id) || reading.current.has(id)) continue;
        reading.current.add(id);
        session.loadPage(id).then(
          () => {
            reading.current.delete(id);
          },
          (error: unknown) => {
            reading.current.delete(id);
            // Out of view by now, it's simply read again when it comes back.
            if (near.current.some((page) => page.id === id)) {
              setFailed((current) => new Set(current).add(id));
            }
            latest.current.onError(error);
          },
        );
      }
    });

    const retry = (id: string) => {
      setFailed((current) => new Set([...current].filter((other) => other !== id)));
      // The control goes away with the failure: focus stays in the notebook, on the pages.
      viewport.current?.focus();
    };

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
            // Read since by something else, such as the sidebar, it's no failure any more.
            const unread = failed.has(info.id) && !snapshot.pages.has(info.id);
            return (
              <div
                key={info.id}
                className="hm-notes-page-slot"
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
              >
                <PageView
                  info={info}
                  items={snapshot.pages.get(info.id)?.items}
                  failed={unread}
                  label={props.pageLabel(index + 1, notebook.pages.length)}
                  pixelsPerPoint={layout.pixelsPerPoint}
                  images={images}
                  imagesVersion={imagesVersion}
                  documents={documents}
                  dim={dim}
                  skip={skip?.page === info.id ? skip.ids : undefined}
                  register={register}
                >
                  {unread ? <PageFailure onRetry={() => retry(info.id)} /> : null}
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
