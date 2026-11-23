import { createShortcutRegistry, createToolRegistry } from "@hussmartinez/sdk-core";
import {
  Button,
  Heading,
  ProgressBar,
  useAnnounce,
  useLatest,
  usePlatform,
} from "@hussmartinez/ui/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { asNotesError } from "../../core/errors/abort.js";
import type { NotesError } from "../../core/errors/notes-error.js";
import { cloneItems, recolorItems, translateItems } from "../../core/ink/transform.js";
import type { NotesRect } from "../../core/model/geometry.js";
import type { NotesColor, NotesItem, NotesText } from "../../core/model/items.js";
import type { NotesOutlineEntry, NotesPageInfo, NotesTemplate } from "../../core/model/notebook.js";
import { NOTES_MAX_TEXT_LENGTH, NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type { NotesRecorderSession } from "../../core/ports/notes-recorder.js";
import type { NotesSession } from "../../core/session/notebook-session.js";
import type {
  NotesInkSettings,
  NotesTool,
  NotesToolContext,
  NotesToolState,
} from "../../features/tool-types.js";
import { DEFAULT_TOOLBAR, notesTools } from "../../features/tools.js";
import { createExportPorts } from "../canvas/export-ports.js";
import { createImageCache } from "../canvas/image-cache.js";
import { useNotes } from "../context.js";
import { checkImage, downloadName, toBlob } from "../files.js";
import type { NotesSelection } from "./ink-controller.js";
import { LinkDialog } from "./LinkDialog.js";
import { NotesToolbar } from "./NotebookToolbar.js";
import { type NotesPlayback, PageSidebar, type SidebarTab } from "./PageSidebar.js";
import { MAX_ZOOM, MIN_ZOOM, PagesViewport, type PagesViewportHandle } from "./PagesViewport.js";
import { createPdfDocuments } from "./pdf-documents.js";
import { SelectionOverlay } from "./SelectionOverlay.js";
import { TextEditor } from "./TextEditor.js";
import { ToolOptions } from "./ToolOptions.js";

/**
 * Props for {@link NotesNotebook}.
 *
 * @public
 */
export interface NotesNotebookProps {
  /** The open notebook, from `NotesLibrary.open`. */
  readonly session: NotesSession;
  /** The writing settings: the tool in hand, colours and sizes. */
  readonly settings: NotesInkSettings;
  readonly onSettingsChange: (settings: NotesInkSettings) => void;
  /** Called once the notebook is saved and closed, to go back to the library. */
  readonly onClose: () => void;
  /** A page to show first, such as the one a search found. */
  readonly initialPage?: string | undefined;
  /** The ids of the tools to offer. Every tool, when omitted. */
  readonly tools?: readonly string[] | undefined;
  /** The toolbar's groups of tool ids. The default arrangement, when omitted. */
  readonly toolbar?: readonly (readonly string[])[] | undefined;
}

/** A text box being typed: an existing one, or a new one that isn't on the page yet. */
interface Editing {
  readonly page: string;
  readonly item: NotesText;
  readonly isNew: boolean;
}

/**
 * An open notebook: the toolbar across the top, the page sidebar, and the
 * pages to write on. It saves as you write, and again when the tab is
 * hidden, so there's nothing to save by hand.
 *
 * @public
 */
export function NotesNotebook(props: NotesNotebookProps): ReactNode {
  const { session, settings, onSettingsChange, onClose } = props;
  const { library, messages, recorder, pdf, newId, policy, saveFile } = useNotes();
  const announce = useAnnounce();
  const platform = usePlatform();
  const snapshot = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  );
  const { notebook } = snapshot;
  const t = messages.t as (key: string, params?: Record<string, unknown>) => string;

  const viewport = useRef<PagesViewportHandle>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [zoom, setZoom] = useState(1);
  const [sidebar, setSidebar] = useState<{ open: boolean; tab: SidebarTab }>({
    open: false,
    tab: "pages",
  });
  const [currentPage, setCurrentPage] = useState<string | undefined>(notebook.pages[0]?.id);
  const [selection, setSelection] = useState<NotesSelection | undefined>(undefined);
  const [moving, setMoving] = useState(false);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [linking, setLinking] = useState<{ page: string; area: NotesRect } | undefined>(undefined);
  const [error, setError] = useState<NotesError | undefined>(undefined);
  const [exporting, setExporting] = useState<
    { fraction: number; abort: AbortController } | undefined
  >(undefined);
  const [recording, setRecording] = useState<
    { id: string; session: NotesRecorderSession } | undefined
  >(undefined);
  const [playback, setPlayback] = useState<NotesPlayback | undefined>(undefined);
  const [imagesVersion, setImagesVersion] = useState(0);
  const selectedItems = useMemo(() => {
    if (!selection) return [];
    const ids = new Set(selection.ids);
    return (snapshot.pages.get(selection.page)?.items ?? []).filter((item) => ids.has(item.id));
  }, [selection, snapshot.pages]);
  // A selection whose items are gone, after an undo for instance, is no selection.
  const active = selection && selectedItems.length > 0 ? selection : undefined;
  const latestRef = useLatest({ settings, snapshot, currentPage, selection: active, recording });

  const images = useMemo(
    () =>
      createImageCache(
        (reference) => session.readAsset(reference),
        () => setImagesVersion((version) => version + 1),
      ),
    [session],
  );
  const documents = useMemo(
    () => createPdfDocuments(pdf, (reference) => session.readAsset(reference)),
    [pdf, session],
  );
  useEffect(
    () => () => {
      images.dispose();
      documents.dispose();
    },
    [images, documents],
  );

  const fail = useCallback((reason: unknown) => {
    const failure = asNotesError(reason);
    if (failure.code !== "ABORTED") setError(failure);
  }, []);

  // Saved when the tab is hidden or the page goes away: the last strokes mustn't wait for the timer.
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void session.flush().catch(() => undefined);
    };
    const leave = () => void session.flush().catch(() => undefined);
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", leave);
    };
  }, [session]);

  // The text of the PDF's pages, read in the background so search finds it.
  useEffect(() => {
    const abort = new AbortController();
    void library.indexPdfText(notebook.id, { signal: abort.signal }).catch(() => undefined);
    return () => abort.abort();
  }, [library, notebook.id]);

  const update = useCallback(
    (patch: Partial<NotesInkSettings>) =>
      onSettingsChange({ ...latestRef.current.settings, ...patch }),
    [latestRef, onSettingsChange],
  );

  const execute = useCallback(
    (run: () => void) => {
      try {
        run();
      } catch (reason) {
        fail(reason);
      }
    },
    [fail],
  );

  const pageIndex = (id: string | undefined) => notebook.pages.findIndex((page) => page.id === id);

  const goToPage = useCallback((page: string) => {
    viewport.current?.scrollToPage(page);
    setCurrentPage(page);
  }, []);

  // The page a search led to, shown once the pages are laid out.
  const { initialPage } = props;
  useEffect(() => {
    if (!initialPage) return;
    const frame = requestAnimationFrame(() => goToPage(initialPage));
    return () => cancelAnimationFrame(frame);
  }, [initialPage, goToPage]);

  const addPage = useCallback(() => {
    const { snapshot: now, currentPage: at } = latestRef.current;
    const index = Math.max(
      0,
      now.notebook.pages.findIndex((page) => page.id === at),
    );
    const like = now.notebook.pages[index];
    if (!like) return;
    const info: NotesPageInfo = {
      id: newId(),
      width: like.width,
      height: like.height,
      template: like.background ? "blank" : like.template,
    };
    execute(() => {
      session.execute({ type: "notes.addPages", at: index + 1, pages: [{ info, items: [] }] });
      announce(messages.t("notebook.pageAdded", { page: index + 2 }));
      // Once the new page is laid out.
      requestAnimationFrame(() => goToPage(info.id));
    });
  }, [announce, execute, goToPage, latestRef, messages, newId, session]);

  const deletePage = useCallback(
    (page: string) => {
      const number =
        latestRef.current.snapshot.notebook.pages.findIndex((info) => info.id === page) + 1;
      // Its contents are loaded first, so undo can bring them back.
      void session
        .loadPage(page)
        .then(() => {
          session.execute({ type: "notes.removePages", pages: [page] });
          setSelection(undefined);
          announce(messages.t("notebook.pageDeleted", { page: number }));
        })
        .catch(fail);
    },
    [announce, fail, latestRef, messages, session],
  );

  const deleteSelection = useCallback(() => {
    const current = latestRef.current.selection;
    if (!current) return;
    execute(() => {
      session.execute({ type: "notes.removeItems", page: current.page, ids: current.ids });
      announce(messages.t("notebook.deleted", { count: current.ids.length }));
    });
    setSelection(undefined);
  }, [announce, execute, latestRef, messages, session]);

  const selectAll = useCallback(() => {
    const { snapshot: now, currentPage: page } = latestRef.current;
    const items = page ? now.pages.get(page)?.items : undefined;
    if (!page || !items || items.length === 0) return;
    update({ tool: "lasso" });
    setSelection({ page, ids: items.map((item) => item.id) });
    announce(messages.t("notebook.selected", { count: items.length }));
  }, [announce, latestRef, messages, update]);

  const placeImage = useCallback(
    async (file: File) => {
      const page = latestRef.current.currentPage;
      const info = latestRef.current.snapshot.notebook.pages.find((entry) => entry.id === page);
      if (!page || !info) return;
      try {
        const checked = await checkImage(file, policy);
        await session.loadPage(page);
        const image = await session.addAsset(file, checked.mediaType);
        // At most three fifths of the page's width, and never taller than the page.
        const fit = Math.min(
          (info.width * 0.6) / checked.width,
          (info.height * 0.8) / checked.height,
          NOTES_UNITS_PER_POINT,
        );
        const width = Math.max(1, Math.round(checked.width * fit));
        const height = Math.max(1, Math.round(checked.height * fit));
        const item: NotesItem = {
          id: newId(),
          type: "image",
          x: Math.round((info.width - width) / 2),
          y: Math.round((info.height - height) / 2),
          width,
          height,
          image,
        };
        session.execute({ type: "notes.addItems", page, items: [item] });
        // Selected, so it can be moved and resized at once.
        update({ tool: "lasso" });
        setSelection({ page, ids: [item.id] });
      } catch (reason) {
        fail(reason);
      }
    },
    [fail, latestRef, newId, policy, session, update],
  );

  const exportPdf = useCallback(() => {
    const abort = new AbortController();
    setExporting({ fraction: 0, abort });
    const name = downloadName(
      latestRef.current.snapshot.notebook.title,
      "pdf",
      messages.t("notebook.fileName"),
    );
    void library
      .exportPdf(session.getSnapshot().notebook.id, createExportPorts(images), {
        signal: abort.signal,
        onProgress: ({ fraction }) =>
          setExporting((current) => (current ? { ...current, fraction } : current)),
      })
      .then((bytes) => saveFile(toBlob(bytes, "application/pdf"), name, "pdf"))
      .then(() => announce(messages.t("notebook.exported")))
      .catch(fail)
      .finally(() => setExporting(undefined));
  }, [announce, fail, images, latestRef, library, messages, saveFile, session]);

  const stopRecording = useCallback(async () => {
    const current = latestRef.current.recording;
    if (!current) return;
    setRecording(undefined);
    try {
      const result = await current.session.stop();
      const reference = await session.addAsset(result.audio, result.audio.type);
      session.execute({
        type: "notes.setRecordings",
        recordings: [
          ...session.getSnapshot().notebook.recordings,
          {
            id: current.id,
            audio: reference,
            startedAt: current.session.startedAt,
            duration: result.duration,
          },
        ],
      });
      announce(messages.t("recordings.stopped"));
    } catch (reason) {
      fail(reason);
    }
  }, [announce, fail, latestRef, messages, session]);

  const toggleRecording = useCallback(() => {
    if (latestRef.current.recording) {
      void stopRecording();
      return;
    }
    void recorder
      .start()
      .then((started) => {
        setRecording({ id: newId(), session: started });
        announce(messages.t("recordings.started"));
      })
      .catch(fail);
  }, [announce, fail, latestRef, messages, newId, recorder, stopRecording]);

  const close = useCallback(() => {
    void (async () => {
      await stopRecording();
      try {
        await session.close();
        onClose();
      } catch (reason) {
        // The notebook stays open, with its changes, until they can be saved.
        fail(reason);
      }
    })();
  }, [fail, onClose, session, stopRecording]);

  /** Searches this notebook, after saving it, so text typed a moment ago is found. */
  const notebookId = notebook.id;
  const search = useCallback(
    async (query: string) => {
      await session.flush().catch(() => undefined);
      return library.search(query, { notebook: notebookId });
    },
    [library, notebookId, session],
  );

  const context: NotesToolContext = useMemo(
    () => ({
      session,
      setSettings: update,
      toggle: (option) => update({ [option]: !latestRef.current.settings[option] }),
      addPage,
      deletePage: () => {
        const page = latestRef.current.currentPage;
        if (page) deletePage(page);
      },
      deleteSelection,
      selectAll,
      chooseImage: () => imageInput.current?.click(),
      zoom: (change) => {
        if (change === "fit") setZoom(1);
        else viewport.current?.zoomBy(change);
      },
      toggleSidebar: () => setSidebar((current) => ({ ...current, open: !current.open })),
      search: () => setSidebar({ open: true, tab: "search" }),
      toggleRecording,
      exportPdf,
      close,
    }),
    [
      addPage,
      close,
      deletePage,
      deleteSelection,
      exportPdf,
      latestRef,
      selectAll,
      session,
      toggleRecording,
      update,
    ],
  );

  // Mistakes in `tools` or `toolbar`, such as an unknown id, throw here, when
  // the notebook renders, rather than leaving a tool silently missing.
  const registry = useMemo(
    () =>
      createToolRegistry(notesTools, {
        ...(props.tools ? { tools: props.tools } : {}),
        toolbar:
          props.toolbar ??
          DEFAULT_TOOLBAR.map((group) =>
            group.filter((id) => !props.tools || props.tools.includes(id)),
          ).filter((group) => group.length > 0),
      }),
    [props.tools, props.toolbar],
  );
  const shortcuts = useMemo(
    () => createShortcutRegistry({ platform, tools: registry.tools }),
    [platform, registry],
  );

  const state: NotesToolState = {
    snapshot,
    settings,
    selected: active?.ids.length ?? 0,
    sidebar: sidebar.open,
    recording: recording !== undefined,
    canRecord: recorder.supported,
    exporting: exporting !== undefined,
    zoom,
    minZoom: MIN_ZOOM,
    maxZoom: MAX_ZOOM,
  };

  const runTool = (tool: NotesTool) => {
    if (!(tool.isAvailable?.(state) ?? true) || !(tool.isEnabled?.(state) ?? true)) return;
    execute(() => {
      void tool.run(context);
      if (tool.id === "notes.undo") announce(messages.t("notebook.undone"));
      if (tool.id === "notes.redo") announce(messages.t("notebook.redone"));
    });
  };

  // Shortcuts work while focus is inside the notebook, never on the whole page
  // (WCAG 2.1.4, sdk-core ADR 0030).
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && active) {
      setSelection(undefined);
      return;
    }
    const id = shortcuts.match(event.nativeEvent);
    const tool = id ? registry.get(id) : undefined;
    if (!tool) return;
    event.preventDefault();
    runTool(tool);
  };

  const onImageChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void placeImage(file);
  };

  const editText = useCallback(
    (page: string, target: NotesText | { readonly x: number; readonly y: number }) => {
      if ("type" in target) {
        setEditing({ page, item: target, isNew: false });
        return;
      }
      const info = latestRef.current.snapshot.notebook.pages.find((entry) => entry.id === page);
      if (!info) return;
      const { textColor, textSize } = latestRef.current.settings;
      // As wide as the room to the page's right edge allows, within a readable measure.
      const width = Math.round(Math.min(36_000, Math.max(8_000, info.width - target.x - 3_600)));
      setEditing({
        page,
        isNew: true,
        item: {
          id: newId(),
          type: "text",
          x: target.x,
          y: Math.round(target.y - textSize / 2),
          width,
          text: "",
          size: textSize,
          color: textColor,
        },
      });
    },
    [latestRef, newId],
  );

  const finishText = (text: string) => {
    const current = editing;
    if (!current) return;
    setEditing(undefined);
    const cut = [...text].slice(0, NOTES_MAX_TEXT_LENGTH).join("");
    const empty = cut.trim() === "";
    execute(() => {
      if (current.isNew) {
        if (empty) return;
        const anchor = audioAnchor();
        session.execute({
          type: "notes.addItems",
          page: current.page,
          items: [{ ...current.item, text: cut, ...(anchor ? { audio: anchor } : {}) }],
        });
      } else if (empty) {
        session.execute({ type: "notes.removeItems", page: current.page, ids: [current.item.id] });
      } else if (cut !== current.item.text) {
        session.execute({
          type: "notes.replaceItems",
          page: current.page,
          items: [{ ...current.item, text: cut }],
        });
      }
    });
  };

  const audioAnchor = useCallback(() => {
    const current = latestRef.current.recording;
    return current ? { recording: current.id, at: current.session.elapsed() } : undefined;
  }, [latestRef]);

  const createLink = (target: number) => {
    const current = linking;
    const page = notebook.pages[target - 1];
    setLinking(undefined);
    if (!current || !page) return;
    execute(() =>
      session.execute({
        type: "notes.addItems",
        page: current.page,
        items: [{ id: newId(), type: "link", ...current.area, page: page.id }],
      }),
    );
  };

  // --- Playback ---

  const togglePlayback = (id: string) => {
    const element = audio.current;
    const entry = notebook.recordings.find((item) => item.id === id);
    if (!element || !entry) return;
    if (playback?.recording === id) {
      if (element.paused) void element.play().catch(fail);
      else element.pause();
      return;
    }
    void session
      .readAsset(entry.audio)
      .then((blob) => {
        if (element.src) URL.revokeObjectURL(element.src);
        element.src = URL.createObjectURL(blob);
        setPlayback({ recording: id, playing: false, time: 0 });
        return element.play();
      })
      .catch(fail);
  };

  const stopPlayback = useCallback(() => {
    const element = audio.current;
    if (element?.src) {
      element.pause();
      URL.revokeObjectURL(element.src);
      element.removeAttribute("src");
    }
    setPlayback(undefined);
  }, []);
  useEffect(() => stopPlayback, [stopPlayback]);

  const deleteRecording = (id: string) => {
    if (playback?.recording === id) stopPlayback();
    execute(() =>
      session.execute({
        type: "notes.setRecordings",
        recordings: notebook.recordings.filter((entry) => entry.id !== id),
      }),
    );
  };

  /** While a recording plays, ink it hasn't reached yet is faint. */
  const dim = useMemo(() => {
    if (!playback) return undefined;
    const { recording: id, time } = playback;
    return (item: NotesItem) =>
      "audio" in item && item.audio?.recording === id && item.audio.at > time;
  }, [playback]);

  const skip = useMemo(() => {
    if (editing && !editing.isNew) return { page: editing.page, ids: new Set([editing.item.id]) };
    if (moving && active) return { page: active.page, ids: new Set(active.ids) };
    return undefined;
  }, [editing, moving, active]);

  const renderOverlay = (info: NotesPageInfo, pixelsPerPoint: number): ReactNode => (
    <>
      {active?.page === info.id ? (
        <SelectionOverlay
          info={info}
          pixelsPerPoint={pixelsPerPoint}
          items={selectedItems}
          page={() => viewport.current?.page(info.id)}
          images={images}
          onDragStart={() => setMoving(true)}
          onDragEnd={(next) => {
            setMoving(false);
            if (next) {
              execute(() =>
                session.execute({ type: "notes.replaceItems", page: info.id, items: next }),
              );
            }
          }}
          onRecolor={(color: NotesColor) =>
            execute(() =>
              session.execute({
                type: "notes.replaceItems",
                page: info.id,
                items: recolorItems(selectedItems, color),
              }),
            )
          }
          onDuplicate={() => {
            // Offset by a quarter of an inch, so the copy is seen beside the original.
            const copies = translateItems(cloneItems(selectedItems, newId), 1_800, 1_800);
            execute(() => {
              session.execute({ type: "notes.addItems", page: info.id, items: copies });
              setSelection({ page: info.id, ids: copies.map((item) => item.id) });
            });
          }}
          onDelete={deleteSelection}
        />
      ) : null}
      {editing?.page === info.id ? (
        <TextEditor
          key={editing.item.id}
          item={editing.item}
          pixelsPerPoint={pixelsPerPoint}
          onDone={finishText}
        />
      ) : null}
    </>
  );

  const saveText =
    snapshot.saveState === "failed"
      ? messages.t("notebook.saveFailed")
      : snapshot.saveState === "saved"
        ? messages.t("notebook.saved")
        : messages.t("notebook.saving");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: shortcuts are handled where focus is, inside the notebook
    <div
      className="hm-notes-notebook"
      data-hm-sidebar={sidebar.open ? "open" : "closed"}
      onKeyDown={onKeyDown}
    >
      <header className="hm-notes-notebook-header">
        <NotesToolbar
          className="hm-notes-toolbar"
          registry={registry}
          shortcuts={shortcuts}
          state={state}
          onRun={runTool}
        />
        <div className="hm-notes-notebook-bar">
          <Heading className="hm-notes-notebook-title">{notebook.title}</Heading>
          <span className="hm-notes-notebook-position">
            {messages.t("notebook.page", {
              page: Math.max(1, pageIndex(currentPage) + 1),
              count: notebook.pages.length,
            })}
          </span>
          <output className="hm-notes-notebook-save" data-hm-save={snapshot.saveState}>
            {saveText}
          </output>
          {snapshot.saveState === "failed" ? (
            <Button size="small" onClick={() => void session.flush().catch(() => undefined)}>
              {messages.t("notebook.retrySave")}
            </Button>
          ) : null}
          {recording ? (
            <Button size="small" variant="danger" onClick={() => void stopRecording()}>
              {messages.t("recordings.stop")}
            </Button>
          ) : null}
        </div>
        <ToolOptions settings={settings} onChange={update} />
        {exporting ? (
          <div className="hm-notes-notebook-progress">
            <ProgressBar
              label={messages.t("notebook.exporting")}
              value={exporting.fraction}
              max={1}
            />
            <Button size="small" onClick={() => exporting.abort.abort()}>
              {messages.t("notebook.cancel")}
            </Button>
          </div>
        ) : null}
        {snapshot.saveState === "failed" && snapshot.error ? (
          <p className="hm-notes-alert" role="alert">
            {messages.error(snapshot.error)}
          </p>
        ) : null}
        {error ? (
          <p className="hm-notes-alert" role="alert">
            <span>{messages.error(error)}</span>
            <Button size="small" variant="quiet" onClick={() => setError(undefined)}>
              {messages.t("editor.dismiss")}
            </Button>
          </p>
        ) : null}
        {snapshot.warnings.map((warning) => (
          <p key={warning.limit} className="hm-notes-warning">
            {messages.warning(warning)}
          </p>
        ))}
      </header>
      <div className="hm-notes-notebook-body">
        {sidebar.open ? (
          <PageSidebar
            tab={sidebar.tab}
            onTabChange={(tab) => setSidebar({ open: true, tab })}
            session={session}
            snapshot={snapshot}
            currentPage={currentPage}
            images={images}
            imagesVersion={imagesVersion}
            documents={documents}
            playback={playback}
            onGoToPage={goToPage}
            onAddPage={addPage}
            onDeletePage={deletePage}
            onMovePage={(page, toIndex) => {
              const order = notebook.pages.map((info) => info.id).filter((id) => id !== page);
              order.splice(toIndex, 0, page);
              execute(() => session.execute({ type: "notes.reorderPages", order }));
            }}
            onSetTemplate={(page: string, template: NotesTemplate) =>
              execute(() =>
                session.execute({ type: "notes.setTemplates", templates: [{ page, template }] }),
              )
            }
            onSetOutline={(outline: readonly NotesOutlineEntry[]) =>
              execute(() => session.execute({ type: "notes.setOutline", outline }))
            }
            onTogglePlayback={togglePlayback}
            onDeleteRecording={deleteRecording}
            onSearch={search}
          />
        ) : null}
        <PagesViewport
          ref={viewport}
          session={session}
          snapshot={snapshot}
          settings={settings}
          zoom={zoom}
          onZoomChange={setZoom}
          images={images}
          imagesVersion={imagesVersion}
          documents={documents}
          label={messages.t("notebook.pages")}
          pageLabel={(page, count) => t("notebook.page", { page, count })}
          newId={newId}
          audioAnchor={audioAnchor}
          dim={dim}
          skip={skip}
          onSelectionChange={setSelection}
          onEditText={editText}
          onRequestLink={(page, area) => setLinking({ page, area })}
          onFollowLink={(page) => {
            if (pageIndex(page) !== -1) goToPage(page);
          }}
          onCurrentPageChange={setCurrentPage}
          onError={fail}
          renderOverlay={renderOverlay}
        />
      </div>
      {/* biome-ignore lint/a11y/useMediaCaption: a recording the user made alongside their own notes has no captions to offer */}
      <audio
        ref={audio}
        className="hm-notes-audio"
        onPlay={() => setPlayback((current) => (current ? { ...current, playing: true } : current))}
        onPause={() =>
          setPlayback((current) => (current ? { ...current, playing: false } : current))
        }
        onEnded={stopPlayback}
        onTimeUpdate={(event) => {
          const time = Math.round(event.currentTarget.currentTime * 1000);
          setPlayback((current) => (current ? { ...current, time } : current));
        }}
      />
      <input
        ref={imageInput}
        className="hm-notes-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onImageChosen}
      />
      {linking ? (
        <LinkDialog
          open
          pageCount={notebook.pages.length}
          fromPage={pageIndex(linking.page) + 1}
          onClose={() => setLinking(undefined)}
          onCreate={createLink}
        />
      ) : null}
    </div>
  );
}
