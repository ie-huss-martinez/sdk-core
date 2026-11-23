import {
  Button,
  Heading,
  IconButton,
  ProgressBar,
  SegmentedControl,
  Spinner,
  TextField,
  useAnnounce,
} from "@hussmartinez/ui/react";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { asNotesError } from "../../core/errors/abort.js";
import type { NotesError } from "../../core/errors/notes-error.js";
import type { NotesFolder, NotesNotebookSummary } from "../../core/model/library.js";
import type { NotesSearchHit } from "../../core/session/search.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { createExportPorts } from "../canvas/export-ports.js";
import { createImageCache } from "../canvas/image-cache.js";
import { useNotes } from "../context.js";
import { downloadName, toBlob } from "../files.js";
import { NameDialog, NewNotebookDialog, NotebookDialog } from "./dialogs.js";

/**
 * Props for {@link NotesLibraryView}.
 *
 * @public
 */
export interface NotesLibraryViewProps {
  /** Called to open a notebook, and optionally to show one of its pages. */
  readonly onOpen: (notebook: string, page?: string) => void;
}

type Asking =
  | { readonly kind: "new-notebook" }
  | { readonly kind: "new-folder" }
  | { readonly kind: "rename-folder"; readonly folder: NotesFolder }
  | { readonly kind: "notebook"; readonly id: string }
  | { readonly kind: "delete"; readonly notebook: NotesNotebookSummary };

interface Working {
  readonly label: string;
  readonly fraction: number | undefined;
  readonly abort: AbortController;
}

/**
 * The library: a grid of notebook covers and folders, with the bin, search
 * across every notebook, import of PDFs, and backup and restore. It says
 * when the browser hasn't promised to keep the notes, and when a backup is
 * overdue.
 *
 * @public
 */
export function NotesLibraryView({ onOpen }: NotesLibraryViewProps): ReactNode {
  const { library, messages, icons, saveFile } = useNotes();
  const announce = useAnnounce();
  const snapshot = useSyncExternalStore(
    library.subscribe,
    library.getSnapshot,
    library.getSnapshot,
  );
  const { index, status, persistence } = snapshot;
  const t = messages.t as (key: string, params?: Record<string, unknown>) => string;

  const [folder, setFolder] = useState<string | null>(null);
  const [bin, setBin] = useState(false);
  const [sort, setSort] = useState<"date" | "name">("date");
  const [query, setQuery] = useState("");
  /** The last answer, with the query it answers: an answer to an earlier query isn't shown. */
  const [found, setFound] = useState<
    { readonly query: string; readonly hits: readonly NotesSearchHit[] } | undefined
  >(undefined);
  const [asking, setAsking] = useState<Asking | undefined>(undefined);
  const [working, setWorking] = useState<Working | undefined>(undefined);
  /** Whether a long operation runs, known before the next render. */
  const busy = useRef(false);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | undefined>(undefined);
  const [error, setError] = useState<NotesError | undefined>(undefined);
  const pdfInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  // A folder deleted in another tab leaves the view at the top.
  const current =
    folder !== null && index.folders.some((entry) => entry.id === folder) ? folder : null;

  const fail = useCallback((reason: unknown) => {
    const failure = asNotesError(reason);
    if (failure.code !== "ABORTED") setError(failure);
  }, []);

  const say = useCallback(
    (text: string, undo?: () => void) => {
      setNotice(undo ? { text, undo } : { text });
      announce(text);
    },
    [announce],
  );

  /** Runs a long operation with a progress bar that can cancel it. */
  const work = useCallback(
    async <Result,>(
      label: string,
      run: (options: {
        signal: AbortSignal;
        onProgress: (progress: { fraction: number }) => void;
      }) => Promise<Result>,
    ): Promise<Result | undefined> => {
      // One at a time: the progress bar and its Cancel belong to one operation.
      if (busy.current) return undefined;
      busy.current = true;
      const abort = new AbortController();
      setError(undefined);
      setWorking({ label, fraction: undefined, abort });
      try {
        return await run({
          signal: abort.signal,
          onProgress: ({ fraction }) =>
            setWorking((state) => (state ? { ...state, fraction } : state)),
        });
      } catch (reason) {
        fail(reason);
        return undefined;
      } finally {
        busy.current = false;
        setWorking(undefined);
      }
    },
    [fail],
  );

  // Searches every notebook as the query is typed, a moment after the last key.
  useEffect(() => {
    if (query.trim() === "") return;
    let stale = false;
    const timer = setTimeout(() => {
      void library
        .search(query)
        .then((hits) => {
          if (!stale) setFound({ query, hits });
        })
        .catch((reason: unknown) => {
          if (stale) return;
          setFound({ query, hits: [] });
          fail(reason);
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // `index` isn't read: a change to the library, such as a restored
    // notebook, runs the same query again.
  }, [library, query, index, fail]);
  const hits = query.trim() !== "" && found?.query === query ? found.hits : undefined;
  const searching = query.trim() !== "";

  const importPdf = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void work(messages.t("library.importing"), (options) =>
      library.importPdf(file, {
        ...options,
        title: messages.t("library.importedTitle"),
        folder: current,
      }),
    ).then((id) => {
      if (id) onOpen(id);
    });
  };

  const backup = (notebooks?: readonly string[]) => {
    void work(messages.t("library.backingUp"), async (options) => {
      const file = await library.backup({ ...options, ...(notebooks ? { notebooks } : {}) });
      // The date in the name is the day the backup was made, in the user's own calendar.
      const day = new Date().toISOString().slice(0, 10);
      await saveFile(
        file,
        downloadName(`${messages.t("library.backupName")}-${day}`, "zip", "backup"),
        "backup",
      );
      say(messages.t("library.backedUp"));
    });
  };

  const restore = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void work(messages.t("library.restoring"), async (options) => {
      const report = await library.restore(file, options);
      say(
        report.restored.length === 0
          ? messages.t("library.restoredNothing")
          : messages.t("library.restored", { count: report.restored.length }),
      );
    });
  };

  const exportPdf = (notebook: NotesNotebookSummary) => {
    const images = createImageCache(
      (reference) => library.readAsset(notebook.id, reference),
      () => undefined,
    );
    void work(messages.t("notebook.exporting"), async (options) => {
      try {
        const bytes = await library.exportPdf(notebook.id, createExportPorts(images), options);
        await saveFile(
          toBlob(bytes, "application/pdf"),
          downloadName(notebook.title, "pdf", messages.t("notebook.fileName")),
          "pdf",
        );
        say(messages.t("notebook.exported"));
      } finally {
        images.dispose();
      }
    });
  };

  const act = (run: () => Promise<unknown>, done?: () => void) => {
    setError(undefined);
    void run().then(done).catch(fail);
  };

  const folders = index.folders.filter((entry) => entry.parent === current);
  const notebooks = index.notebooks.filter((notebook) =>
    bin ? notebook.deletedAt !== null : notebook.deletedAt === null && notebook.folder === current,
  );
  const binned = index.notebooks.filter((notebook) => notebook.deletedAt !== null).length;
  const live = index.notebooks.filter((notebook) => notebook.deletedAt === null);
  const titleOf = (id: string) => index.notebooks.find((notebook) => notebook.id === id)?.title;

  /** The folders from the top down to the one shown. */
  const trail: NotesFolder[] = [];
  for (let at = current; at !== null; ) {
    const entry = index.folders.find((other) => other.id === at);
    if (!entry || trail.includes(entry)) break;
    trail.unshift(entry);
    at = entry.parent;
  }

  const icon = (name: string) => {
    const Icon = icons[name];
    return Icon ? <Icon /> : null;
  };
  const managed =
    asking?.kind === "notebook" ? index.notebooks.find((n) => n.id === asking.id) : undefined;

  if (status === "loading") {
    return (
      <div className="hm-notes-library" aria-busy="true">
        <div className="hm-notes-library-state" role="status">
          <Spinner label={messages.t("library.loading")} />
          <p>{messages.t("library.loading")}</p>
        </div>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="hm-notes-library">
        <div className="hm-notes-library-state">
          <p className="hm-notes-alert" role="alert">
            {messages.error(snapshot.error)}
          </p>
          <Button onClick={() => void library.load().catch(() => undefined)}>
            {messages.t("library.retry")}
          </Button>
        </div>
      </div>
    );
  }

  const empty = folders.length + notebooks.length === 0;
  const byName = (first: { title: string }, second: { title: string }) =>
    first.title.localeCompare(second.title, undefined, { numeric: true, sensitivity: "base" });
  const shown =
    sort === "name"
      ? [...notebooks].sort(byName)
      : [...notebooks].sort((first, second) => second.updatedAt - first.updatedAt);
  const heading = bin
    ? messages.t("library.binTitle")
    : (trail[trail.length - 1]?.name ?? messages.t("library.title"));

  return (
    <div
      className="hm-notes-library"
      aria-busy={working !== undefined}
      data-hm-section={bin ? "bin" : "documents"}
    >
      <nav className="hm-notes-rail" aria-label={messages.t("library.sections")}>
        <p className="hm-notes-rail-brand" aria-hidden="true">
          <span className="hm-notes-rail-mark">{icon("notebook")}</span>
          <span className="hm-notes-rail-text">{messages.t("editor.label")}</span>
        </p>
        <div className="hm-notes-rail-group">
          <button
            type="button"
            className="hm-notes-rail-item"
            aria-current={bin ? undefined : "page"}
            onClick={() => {
              setBin(false);
              setFolder(null);
            }}
          >
            {icon("notebook")}
            <span className="hm-notes-rail-text">{messages.t("library.documents")}</span>
          </button>
          <button
            type="button"
            className="hm-notes-rail-item"
            aria-pressed={bin}
            onClick={() => setBin(!bin)}
          >
            {icon("delete")}
            <span className="hm-notes-rail-text">
              {messages.t("library.bin", { count: binned })}
            </span>
          </button>
        </div>
        <div className="hm-notes-rail-group" data-hm-rail="tools">
          <RailAction
            icon={icon("download")}
            label={messages.t("library.backup")}
            disabled={live.length === 0 || working !== undefined}
            onClick={() => backup()}
          />
          <RailAction
            icon={icon("upload")}
            label={messages.t("library.restore")}
            disabled={working !== undefined}
            onClick={() => backupInput.current?.click()}
          />
        </div>
        <p className="hm-notes-rail-note">
          {icon("shield")}
          <span className="hm-notes-rail-text">{messages.t("library.private")}</span>
        </p>
      </nav>

      <div className="hm-notes-library-main">
        <header className="hm-notes-library-header">
          <div className="hm-notes-library-search">
            {icon("search")}
            <TextField
              className="hm-notes-library-search-field"
              type="search"
              label={messages.t("library.search")}
              placeholder={messages.t("library.search")}
              value={query}
              onValueChange={setQuery}
            />
          </div>
        </header>

        {persistence?.persisted === false ? (
          <p className="hm-notes-notice hm-notes-banner" data-hm-kind="storage">
            {icon("shield")}
            <span>{messages.t("storage.notice")}</span>
            <Button
              size="small"
              onClick={() =>
                act(
                  () => library.requestPersistence(),
                  () => undefined,
                )
              }
            >
              {messages.t("storage.keep")}
            </Button>
          </p>
        ) : null}
        {snapshot.backupDue ? (
          <p className="hm-notes-notice hm-notes-banner" data-hm-kind="backup">
            {icon("download")}
            <span>{messages.t("library.backupDue")}</span>
            <Button size="small" onClick={() => backup()}>
              {messages.t("library.backup")}
            </Button>
          </p>
        ) : null}

        {searching ? (
          <section className="hm-notes-library-results" aria-label={messages.t("library.results")}>
            <Heading className="hm-notes-library-title">{messages.t("library.results")}</Heading>
            <p className="hm-notes-library-count" role="status">
              {hits === undefined
                ? messages.t("library.searching")
                : hits.length === 0
                  ? messages.t("search.none")
                  : messages.t("search.count", { count: hits.length })}
            </p>
            <ul className="hm-notes-search-results">
              {(hits ?? []).map((hit) => (
                <li key={`${hit.notebook}-${hit.page}-${hit.source}`}>
                  <Button
                    variant="quiet"
                    classNames={{ root: "hm-notes-search-result" }}
                    onClick={() => onOpen(hit.notebook, hit.page)}
                  >
                    <span className="hm-notes-search-page">{titleOf(hit.notebook)}</span>
                    <span className="hm-notes-search-snippet">
                      {hit.snippet.slice(0, hit.matchStart)}
                      <mark>
                        {hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}
                      </mark>
                      {hit.snippet.slice(hit.matchStart + hit.matchLength)}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            <div className="hm-notes-library-heading">
              {bin || trail.length === 0 ? null : (
                <nav className="hm-notes-library-trail" aria-label={messages.t("library.trail")}>
                  <Button
                    size="small"
                    variant="quiet"
                    aria-current={current === null ? "page" : undefined}
                    onClick={() => setFolder(null)}
                  >
                    {messages.t("library.top")}
                  </Button>
                  {trail.map((entry) => (
                    <Button
                      key={entry.id}
                      size="small"
                      variant="quiet"
                      aria-current={entry.id === current ? "page" : undefined}
                      onClick={() => setFolder(entry.id)}
                    >
                      {entry.name}
                    </Button>
                  ))}
                </nav>
              )}
              <div className="hm-notes-library-title-row">
                {/* Keyed, so a change of place draws the title in again. */}
                <Heading key={heading} className="hm-notes-library-title">
                  {heading}
                </Heading>
                {bin ? null : (
                  <div className="hm-notes-library-actions">
                    <Button
                      variant="primary"
                      startIcon={icon("add")}
                      onClick={() => setAsking({ kind: "new-notebook" })}
                    >
                      {messages.t("library.new")}
                    </Button>
                    <Button
                      startIcon={icon("open")}
                      disabled={working !== undefined}
                      focusableWhenDisabled
                      onClick={() => pdfInput.current?.click()}
                    >
                      {messages.t("library.import")}
                    </Button>
                    <Button
                      startIcon={icon("folder-add")}
                      onClick={() => setAsking({ kind: "new-folder" })}
                    >
                      {messages.t("library.newFolder")}
                    </Button>
                    {notebooks.length < 2 ? null : (
                      <SegmentedControl<"date" | "name">
                        className="hm-notes-library-sort"
                        label={messages.t("library.sort")}
                        size="small"
                        value={sort}
                        onValueChange={setSort}
                        options={[
                          { value: "date", label: messages.t("library.sortDate") },
                          { value: "name", label: messages.t("library.sortName") },
                        ]}
                      />
                    )}
                  </div>
                )}
              </div>
              {bin ? (
                <p className="hm-notes-library-count">{messages.t("library.binHint")}</p>
              ) : null}
            </div>
            {empty || (bin && notebooks.length === 0) ? (
              <div className="hm-notes-library-state hm-notes-library-empty">
                <EmptyArt bin={bin} />
                <p className="hm-notes-library-empty-title">
                  {bin
                    ? messages.t("library.binEmpty")
                    : current === null
                      ? messages.t("library.empty")
                      : messages.t("library.folderEmpty")}
                </p>
                {bin || current !== null ? null : <p>{messages.t("library.emptyHint")}</p>}
              </div>
            ) : (
              // Keyed by place, so going into a folder deals its covers in again.
              <ul key={`${bin ? "bin" : "at"}-${current ?? ""}`} className="hm-notes-library-grid">
                {bin
                  ? null
                  : folders.map((entry) => (
                      <li key={entry.id} className="hm-notes-library-item">
                        <button
                          type="button"
                          className="hm-notes-folder"
                          aria-label={messages.t("library.folder", { name: entry.name })}
                          onClick={() => setFolder(entry.id)}
                        >
                          <span className="hm-notes-folder-art" aria-hidden="true">
                            <span className="hm-notes-folder-back" />
                            <span className="hm-notes-folder-sheet" />
                            <span className="hm-notes-folder-front" />
                          </span>
                          <span className="hm-notes-item-title">{entry.name}</span>
                        </button>
                        <IconButton
                          size="small"
                          variant="quiet"
                          className="hm-notes-item-more"
                          label={messages.t("library.manageFolder", { name: entry.name })}
                          icon={icon("chevron-down")}
                          onClick={() => setAsking({ kind: "rename-folder", folder: entry })}
                        />
                      </li>
                    ))}
                {shown.map((notebook) => (
                  <li key={notebook.id} className="hm-notes-library-item">
                    <button
                      type="button"
                      className="hm-notes-cover"
                      data-hm-cover={notebook.cover}
                      disabled={bin}
                      onClick={() => onOpen(notebook.id)}
                    >
                      <span
                        className="hm-notes-cover-art"
                        data-hm-template={notebook.template}
                        aria-hidden="true"
                      >
                        {/* The title on the cover is decoration: it's drawn from the attribute, so it's text only once. */}
                        <span className="hm-notes-cover-label" data-hm-title={notebook.title} />
                      </span>
                      <span className="hm-notes-item-title">{notebook.title}</span>
                      <span className="hm-notes-item-meta">
                        {t("library.pages", { count: notebook.pageCount })}
                        {" · "}
                        {t("library.changed", { changed: notebook.updatedAt })}
                      </span>
                    </button>
                    {bin ? (
                      <div className="hm-notes-item-actions">
                        <Button
                          size="small"
                          onClick={() => act(() => library.restoreNotebook(notebook.id))}
                        >
                          {messages.t("library.restoreNotebook")}
                        </Button>
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => setAsking({ kind: "delete", notebook })}
                        >
                          {messages.t("library.deleteForever")}
                        </Button>
                      </div>
                    ) : (
                      <IconButton
                        size="small"
                        variant="quiet"
                        className="hm-notes-item-more"
                        label={messages.t("library.manage", { title: notebook.title })}
                        icon={icon("chevron-down")}
                        onClick={() => setAsking({ kind: "notebook", id: notebook.id })}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* What just happened, and what's under way: floating over the foot of the library. */}
      <div className="hm-notes-toasts">
        {working ? (
          <div className="hm-notes-library-progress hm-notes-toast">
            <span>{working.label}</span>
            <ProgressBar
              label={working.label}
              {...(working.fraction === undefined ? {} : { value: working.fraction, max: 1 })}
            />
            <Button size="small" variant="quiet" onClick={() => working.abort.abort()}>
              {messages.t("dialogs.cancel")}
            </Button>
          </div>
        ) : null}
        {error ? (
          <p className="hm-notes-alert hm-notes-toast" role="alert">
            <span>{messages.error(error)}</span>
            <Button size="small" variant="quiet" onClick={() => setError(undefined)}>
              {messages.t("editor.dismiss")}
            </Button>
          </p>
        ) : null}
        {notice ? (
          <p className="hm-notes-notice hm-notes-toast">
            <span>{notice.text}</span>
            {notice.undo ? (
              <Button
                size="small"
                onClick={() => {
                  notice.undo?.();
                  setNotice(undefined);
                }}
              >
                {messages.t("library.undo")}
              </Button>
            ) : null}
            <IconButton
              size="small"
              variant="quiet"
              label={messages.t("editor.dismiss")}
              icon={icon("close")}
              onClick={() => setNotice(undefined)}
            />
          </p>
        ) : null}
      </div>

      <input
        ref={pdfInput}
        className="hm-notes-file-input"
        type="file"
        accept="application/pdf,.pdf"
        tabIndex={-1}
        aria-hidden="true"
        data-hm-input="pdf"
        onChange={importPdf}
      />
      <input
        ref={backupInput}
        className="hm-notes-file-input"
        type="file"
        accept="application/zip,.zip"
        tabIndex={-1}
        aria-hidden="true"
        data-hm-input="backup"
        onChange={restore}
      />

      {asking?.kind === "new-notebook" ? (
        <NewNotebookDialog
          open
          onClose={() => setAsking(undefined)}
          onCreate={(notebook) => {
            setAsking(undefined);
            // A new notebook opens at once, ready to write in.
            act(() => library.createNotebook({ ...notebook, folder: current }).then(onOpen));
          }}
        />
      ) : null}
      {asking?.kind === "new-folder" ? (
        <NameDialog
          open
          title={messages.t("folders.newTitle")}
          label={messages.t("folders.name")}
          action={messages.t("folders.create")}
          onClose={() => setAsking(undefined)}
          onSubmit={(name) => {
            setAsking(undefined);
            act(() => library.createFolder(name, current));
          }}
        />
      ) : null}
      {asking?.kind === "rename-folder" ? (
        <FolderDialog
          folder={asking.folder}
          onClose={() => setAsking(undefined)}
          onRename={(name) => {
            const { id } = asking.folder;
            setAsking(undefined);
            act(() => library.renameFolder(id, name));
          }}
          onDelete={() => {
            const { id, parent } = asking.folder;
            setAsking(undefined);
            if (current === id) setFolder(parent);
            act(() => library.deleteFolder(id));
          }}
        />
      ) : null}
      {managed ? (
        <NotebookDialog
          open
          notebook={managed}
          folders={index.folders}
          onClose={() => setAsking(undefined)}
          onRename={(title) => act(() => library.renameNotebook(managed.id, title))}
          onCover={(cover) => act(() => library.setNotebookCover(managed.id, cover))}
          onMove={(to) => act(() => library.moveNotebook(managed.id, to))}
          onDuplicate={() => {
            setAsking(undefined);
            act(() =>
              library.duplicateNotebook(
                managed.id,
                messages.t("library.copyTitle", { title: managed.title }).slice(0, 200),
              ),
            );
          }}
          onBackup={() => {
            setAsking(undefined);
            backup([managed.id]);
          }}
          onExport={() => {
            setAsking(undefined);
            exportPdf(managed);
          }}
          onBin={() => {
            setAsking(undefined);
            act(
              () => library.binNotebook(managed.id),
              () =>
                say(messages.t("library.binned", { title: managed.title }), () =>
                  act(() => library.restoreNotebook(managed.id)),
                ),
            );
          }}
        />
      ) : null}
      {asking?.kind === "delete" ? (
        <ConfirmDialog
          open
          title={messages.t("deleteForever.title")}
          body={messages.t("deleteForever.body", { title: asking.notebook.title })}
          action={messages.t("library.deleteForever")}
          onClose={() => setAsking(undefined)}
          onConfirm={() => {
            const { id } = asking.notebook;
            setAsking(undefined);
            act(
              () => library.deleteNotebook(id),
              () => say(messages.t("library.deleted")),
            );
          }}
        />
      ) : null}
    </div>
  );
}

interface RailActionProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

/** One of the rail's actions. Disabled, it stays in the tab order and says so, as ui's buttons do. */
function RailAction(props: RailActionProps): ReactNode {
  return (
    <button
      type="button"
      className="hm-notes-rail-item"
      aria-disabled={props.disabled || undefined}
      onClick={() => {
        if (!props.disabled) props.onClick();
      }}
    >
      {props.icon}
      <span className="hm-notes-rail-text">{props.label}</span>
    </button>
  );
}

/** The drawing over an empty library: two notebooks and a pen, or an empty bin. Decoration only. */
function EmptyArt({ bin }: { readonly bin: boolean }): ReactNode {
  return (
    <span className="hm-notes-empty-art" data-hm-art={bin ? "bin" : "notebooks"} aria-hidden="true">
      <span className="hm-notes-empty-book" />
      <span className="hm-notes-empty-book" />
      <span className="hm-notes-empty-pen" />
    </span>
  );
}

interface FolderDialogProps {
  readonly folder: NotesFolder;
  readonly onClose: () => void;
  readonly onRename: (name: string) => void;
  readonly onDelete: () => void;
}

/** A folder's name, and removing it. What it holds moves up a level, so nothing is lost. */
function FolderDialog(props: FolderDialogProps): ReactNode {
  const { messages } = useNotes();
  const [removing, setRemoving] = useState(false);
  if (removing) {
    return (
      <ConfirmDialog
        open
        title={messages.t("folders.deleteTitle")}
        body={messages.t("folders.deleteBody", { name: props.folder.name })}
        action={messages.t("folders.delete")}
        onClose={props.onClose}
        onConfirm={props.onDelete}
      />
    );
  }
  return (
    <NameDialog
      open
      title={messages.t("folders.renameTitle")}
      label={messages.t("folders.name")}
      action={messages.t("folders.rename")}
      initial={props.folder.name}
      onClose={props.onClose}
      onSubmit={(name) => {
        // The same name changes nothing.
        if (name === props.folder.name) props.onClose();
        else props.onRename(name);
      }}
      extra={
        <Button variant="danger" onClick={() => setRemoving(true)}>
          {messages.t("folders.delete")}
        </Button>
      }
    />
  );
}
