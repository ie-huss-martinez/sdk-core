import { applyCommands, createHistory, createStore } from "@hussmartinez/sdk-core";
import { asNotesError } from "../errors/abort.js";
import { NotesError } from "../errors/notes-error.js";
import {
  type NotesFilePolicy,
  type NotesFilePolicyOverrides,
  type NotesLimitName,
  notesLimits,
} from "../errors/notes-limits.js";
import { assetNameOf, isAssetName } from "../model/ids.js";
import type { NotesAssetReference } from "../model/items.js";
import type { NotesNotebook, NotesPage } from "../model/notebook.js";
import {
  applyNotesCommand,
  commandEffect,
  type NotesCommand,
  type NotesDocumentState,
} from "../operations/commands.js";
import type { NotesPageText, NotesStore } from "../ports/notes-store.js";

/**
 * Whether the notebook's last changes are on the device yet.
 *
 * - `saved`: everything is stored.
 * - `pending`: a change waits for the next save, a moment away.
 * - `saving`: a save is running.
 * - `failed`: the last save failed. The changes are kept in memory, and the
 *   next change or `flush()` tries again.
 *
 * @public
 */
export type NotesSaveState = "saved" | "pending" | "saving" | "failed";

/**
 * A limit the notebook has passed the warning threshold of.
 *
 * @public
 */
export interface NotesWarning {
  readonly type: "limit";
  readonly limit: NotesLimitName;
  readonly actual: number;
}

/**
 * The state of an open notebook.
 *
 * @public
 */
export interface NotesSessionSnapshot {
  readonly notebook: NotesNotebook;
  /** The contents of the pages loaded so far, by page id. */
  readonly pages: ReadonlyMap<string, NotesPage>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly saveState: NotesSaveState;
  /** Why the last save failed, while `saveState` is `failed`. */
  readonly error: NotesError | undefined;
  readonly warnings: readonly NotesWarning[];
}

/**
 * Anonymous events of a notebook session, for a host's analytics. They never
 * carry a title, text, ink or a file's name.
 *
 * @public
 */
export type NotesSessionEvent =
  | { readonly type: "notebook_opened"; readonly pageCount: number }
  | { readonly type: "notebook_closed" }
  | { readonly type: "command"; readonly commands: readonly NotesCommand["type"][] }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "failed"; readonly operation: "save" | "load"; readonly code: string };

/**
 * Options for {@link openNotesSession}.
 *
 * @public
 */
export interface NotesSessionOptions {
  readonly store: NotesStore;
  /** The id of the notebook to open. */
  readonly notebook: string;
  readonly filePolicy?: NotesFilePolicyOverrides;
  readonly onEvent?: (event: NotesSessionEvent) => void;
  /** The clock, in milliseconds since the Unix epoch. Defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * How long after a change the notebook is saved, in milliseconds. Changes
   * within that time are saved together. Defaults to 400.
   */
  readonly saveDelay?: number;
  /** Called after each save, with the notebook as stored. */
  readonly onSaved?: (notebook: NotesNotebook) => void | Promise<void>;
}

/**
 * An open notebook: its state, its edits with undo and redo, and saving as
 * you write (docs/adr/0003). It's framework-agnostic: React binds to
 * `subscribe` and `getSnapshot` with `useSyncExternalStore`.
 *
 * @public
 */
export interface NotesSession {
  getSnapshot(): NotesSessionSnapshot;
  subscribe(listener: () => void): () => void;
  /** Loads a page's contents, once. A page never written on is empty. */
  loadPage(page: string): Promise<NotesPage>;
  /**
   * Applies one edit, or several as one undoable step, and schedules a save.
   * Throws `INVALID_COMMAND`, changing nothing, when an edit doesn't apply.
   * The pages it changes must be loaded.
   */
  execute(commands: NotesCommand | readonly NotesCommand[]): void;
  /** Runs `fn`, and makes every edit it executes one undoable step. */
  group<Result>(fn: () => Result): Result;
  undo(): void;
  redo(): void;
  /** Stores a file with the notebook, and returns the reference items use. */
  addAsset(data: Blob, mediaType: string): Promise<NotesAssetReference>;
  /** Reads a file of the notebook. Rejects with `NOT_FOUND` if it's gone. */
  readAsset(reference: NotesAssetReference | string): Promise<Blob>;
  /** Saves now, and resolves once every change so far is stored. */
  flush(): Promise<void>;
  /** Saves, then lets other tabs open the notebook. The session can't be used afterwards. */
  close(): Promise<void>;
}

/** How many steps can be undone. Older steps are dropped, oldest first. */
const MAX_HISTORY_STEPS = 500;

/** The text of a page's text boxes, for search. */
export function typedTextOf(page: NotesPage): string {
  const parts: string[] = [];
  for (const item of page.items) {
    if (item.type === "text" && item.text.trim() !== "") parts.push(item.text);
  }
  return parts.join("\n");
}

/**
 * Opens a notebook for editing. Rejects with `NOT_FOUND` when the store has
 * no such notebook, and with `NOTEBOOK_IN_USE` when another tab has it open.
 *
 * @example
 * ```ts
 * const session = await openNotesSession({ store, notebook: id });
 * const page = session.getSnapshot().notebook.pages[0];
 * await session.loadPage(page.id);
 * session.execute({ type: "notes.addItems", page: page.id, items: [stroke] });
 * session.undo();
 * await session.close();
 * ```
 *
 * @public
 */
export async function openNotesSession(options: NotesSessionOptions): Promise<NotesSession> {
  const { store, notebook: notebookId, onEvent, onSaved } = options;
  const now = options.now ?? Date.now;
  const saveDelay = options.saveDelay ?? 400;
  const policy: NotesFilePolicy = notesLimits.resolve(options.filePolicy);
  const limits = {
    maxPages: policy.limits.maxPages.maximum,
    maxPageItems: policy.limits.maxPageItems.maximum,
  };

  const release = await store.lockNotebook(notebookId);
  if (!release) {
    throw new NotesError("NOTEBOOK_IN_USE", "The notebook is open in another tab.");
  }
  let stored: NotesNotebook | undefined;
  let texts: Map<string, NotesPageText>;
  try {
    stored = await store.readNotebook(notebookId);
    if (!stored) {
      throw new NotesError("NOT_FOUND", "The library has no such notebook.", {
        details: { kind: "notebook" },
      });
    }
    texts = new Map((await store.readPageTexts(notebookId)).map((entry) => [entry.page, entry]));
  } catch (error) {
    release();
    onEvent?.({ type: "failed", operation: "load", code: asNotesError(error).code });
    throw asNotesError(error);
  }

  const warningsOf = (state: NotesDocumentState): NotesWarning[] => {
    const warnings: NotesWarning[] = [];
    const pageCount = state.notebook.pages.length;
    if (pageCount >= policy.limits.maxPages.warning) {
      warnings.push({ type: "limit", limit: "maxPages", actual: pageCount });
    }
    return warnings;
  };

  let document: NotesDocumentState = { notebook: stored, pages: new Map() };
  const history = createHistory<NotesCommand>();
  let saveState: NotesSaveState = "saved";
  let saveError: NotesError | undefined;
  let closed = false;

  const snapshotOf = (): NotesSessionSnapshot => ({
    notebook: document.notebook,
    pages: document.pages,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    saveState,
    error: saveError,
    warnings: warningsOf(document),
  });
  const state = createStore<NotesSessionSnapshot>(snapshotOf());
  const publish = () => state.set(snapshotOf());

  // What the next save writes.
  const dirty = { notebook: false, pages: new Set<string>(), removed: new Set<string>() };
  const loading = new Map<string, Promise<NotesPage>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;

  const assertOpen = () => {
    if (closed) throw new NotesError("NOT_FOUND", "The notebook session is closed.");
  };

  const mark = (commands: readonly NotesCommand[]) => {
    for (const command of commands) {
      const effect = commandEffect(command);
      if (effect.notebook) dirty.notebook = true;
      for (const page of effect.changed) {
        dirty.removed.delete(page);
        dirty.pages.add(page);
      }
      for (const page of effect.removed) {
        dirty.pages.delete(page);
        dirty.removed.add(page);
      }
    }
    schedule();
  };

  const schedule = () => {
    if (closed) return;
    if (saveState !== "saving") saveState = "pending";
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void save().catch(() => {
        // The failure is in the snapshot; the next change or flush() retries.
      });
    }, saveDelay);
  };

  const hasChanges = () => dirty.notebook || dirty.pages.size > 0 || dirty.removed.size > 0;

  /** One save at a time: a save that finds another running waits for it, then runs. */
  const save = async (): Promise<void> => {
    while (saving) await saving.catch(() => undefined);
    if (!hasChanges()) {
      // Nothing to write, so nothing to tell: a snapshot is published only when it differs.
      if (saveState !== "failed" && saveState !== "saved") {
        saveState = "saved";
        publish();
      }
      return;
    }
    const run = writeChanges();
    saving = run;
    try {
      await run;
    } finally {
      saving = undefined;
    }
  };

  const writeChanges = async (): Promise<void> => {
    const pages = [...dirty.pages];
    const removed = [...dirty.removed];
    dirty.notebook = false;
    dirty.pages.clear();
    dirty.removed.clear();
    saveState = "saving";
    publish();
    const current = document;
    const updatedAt = Math.max(now(), current.notebook.updatedAt);
    const notebook: NotesNotebook = { ...current.notebook, updatedAt };
    try {
      for (const id of pages) {
        const page = current.pages.get(id);
        if (!page) continue;
        await store.writePage(notebookId, page);
        const typed = typedTextOf(page);
        const known = texts.get(id);
        if ((known?.typed ?? "") !== typed) {
          const entry: NotesPageText = {
            notebook: notebookId,
            page: id,
            typed,
            ...(known?.pdf === undefined ? {} : { pdf: known.pdf }),
          };
          await store.writePageText(entry);
          texts.set(id, entry);
        }
      }
      // The notebook last: it never lists a page whose contents aren't stored yet.
      await store.writeNotebook(notebook);
      for (const id of removed) {
        await store.deletePage(notebookId, id);
        texts.delete(id);
      }
      await onSaved?.(notebook);
    } catch (error) {
      // Nothing is lost: what wasn't written is still in memory, and is due again.
      dirty.notebook = true;
      for (const id of pages) if (!dirty.removed.has(id)) dirty.pages.add(id);
      for (const id of removed) if (!dirty.pages.has(id)) dirty.removed.add(id);
      saveError = asNotesError(error);
      saveState = "failed";
      onEvent?.({ type: "failed", operation: "save", code: saveError.code });
      publish();
      throw saveError;
    }
    saveError = undefined;
    // The time of this save, unless the notebook's own fields changed meanwhile.
    document = { notebook: { ...document.notebook, updatedAt }, pages: document.pages };
    saveState = hasChanges() ? "pending" : "saved";
    publish();
  };

  const apply = (commands: readonly NotesCommand[]) =>
    applyCommands<NotesDocumentState, NotesCommand>(
      (current, command) => applyNotesCommand(current, command, limits),
      document,
      commands,
    );

  const session: NotesSession = {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,

    loadPage(page) {
      assertOpen();
      const present = document.pages.get(page);
      if (present) return Promise.resolve(present);
      const pending = loading.get(page);
      if (pending) return pending;
      if (!document.notebook.pages.some((info) => info.id === page)) {
        return Promise.reject(
          new NotesError("NOT_FOUND", "The notebook has no such page.", {
            details: { kind: "page" },
          }),
        );
      }
      const load = (async () => {
        try {
          const read = (await store.readPage(notebookId, page)) ?? { id: page, items: [] };
          // An edit may have put the page there meanwhile, such as an undo.
          const present = document.pages.get(page);
          if (present) return present;
          if (!document.notebook.pages.some((info) => info.id === page)) return read;
          const pages = new Map(document.pages);
          pages.set(page, read);
          document = { notebook: document.notebook, pages };
          publish();
          return read;
        } catch (error) {
          onEvent?.({ type: "failed", operation: "load", code: asNotesError(error).code });
          throw asNotesError(error);
        } finally {
          loading.delete(page);
        }
      })();
      loading.set(page, load);
      return load;
    },

    execute(commands) {
      assertOpen();
      const list = Array.isArray(commands)
        ? (commands as readonly NotesCommand[])
        : [commands as NotesCommand];
      if (list.length === 0) return;
      const applied = apply(list);
      document = applied.state;
      history.push({ commands: list, inverses: applied.inverses });
      if (history.steps.length > MAX_HISTORY_STEPS) {
        history.drop(history.steps.length - MAX_HISTORY_STEPS);
      }
      mark(list);
      publish();
      onEvent?.({ type: "command", commands: list.map((command) => command.type) });
    },

    group(fn) {
      return history.group(fn);
    },

    undo() {
      assertOpen();
      const step = history.undo();
      if (!step) return;
      try {
        document = apply(step.inverses).state;
      } catch (error) {
        history.restore("undo");
        throw error;
      }
      mark(step.inverses);
      publish();
      onEvent?.({ type: "undo" });
    },

    redo() {
      assertOpen();
      const step = history.redo();
      if (!step) return;
      try {
        document = apply(step.commands).state;
      } catch (error) {
        history.restore("redo");
        throw error;
      }
      mark(step.commands);
      publish();
      onEvent?.({ type: "redo" });
    },

    async addAsset(data, mediaType) {
      assertOpen();
      const asset = await assetNameOf(await data.arrayBuffer());
      try {
        await store.writeAsset(notebookId, asset, data);
      } catch (error) {
        throw asNotesError(error);
      }
      return { asset, mediaType, size: data.size };
    },

    async readAsset(reference) {
      const asset = typeof reference === "string" ? reference : reference.asset;
      const data = isAssetName(asset) ? await store.readAsset(notebookId, asset) : undefined;
      if (!data) {
        throw new NotesError("NOT_FOUND", "The notebook has no such file.", {
          details: { kind: "asset" },
        });
      }
      return data;
    },

    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await save();
    },

    async close() {
      if (closed) return;
      try {
        await session.flush();
      } finally {
        closed = true;
        release();
        onEvent?.({ type: "notebook_closed" });
      }
    },
  };

  onEvent?.({ type: "notebook_opened", pageCount: stored.pages.length });
  return session;
}
