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

/** The longest a change waits to be saved while writing goes on, in milliseconds. */
const MAX_SAVE_WAIT = 2_000;

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
   * within that time are saved together. Defaults to 400. Steady writing
   * still saves at least every 2 seconds, or every `saveDelay` if longer.
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
  /**
   * Saves every change, then lets other tabs open the notebook. The session
   * can't be used afterwards.
   *
   * If the save fails, the call rejects and the session stays open, with
   * the notebook still held and the changes in memory, so it can be tried
   * again. With `discard`, the session closes even then, and what couldn't
   * be saved is lost.
   */
  close(options?: NotesSessionCloseOptions): Promise<void>;
}

/**
 * Options for closing a notebook session.
 *
 * @public
 */
export interface NotesSessionCloseOptions {
  /** Close even when the last save fails, losing what it couldn't store. */
  readonly discard?: boolean;
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
  const { store, notebook: notebookId, onSaved } = options;
  /** Tells the host. What its analytics throws never reaches the notebook. */
  const emit = (event: NotesSessionEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      // An analytics failure isn't the notebook's.
    }
  };
  const now = options.now ?? Date.now;
  const saveDelay = options.saveDelay ?? 400;
  // Each change restarts the delay, so steady writing would never save:
  // the first unsaved change is saved within this, however much follows it.
  const saveMaxWait = Math.max(MAX_SAVE_WAIT, saveDelay);
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
  /** The typed text stored for each page, and the PDF text read when the notebook opened. */
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
    emit({ type: "failed", operation: "load", code: asNotesError(error).code });
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
    // A change made since waits for its own save: the earlier failure isn't its result.
    error: saveState === "failed" ? saveError : undefined,
    warnings: warningsOf(document),
  });
  const state = createStore<NotesSessionSnapshot>(snapshotOf());
  const publish = () => state.set(snapshotOf());

  // What the next save writes.
  const dirty = { notebook: false, pages: new Set<string>(), removed: new Set<string>() };
  const loading = new Map<string, Promise<NotesPage>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The save the first unsaved change is due by, however much follows it. */
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let saving: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  /** Giving the notebook back, once that has begun. */
  let finishing: Promise<void> | undefined;
  /** The files being stored: the notebook is held until each has finished. */
  const assetWrites = new Set<Promise<unknown>>();
  /** The search text of pages removed and saved, in case an undo brings one back. */
  const removedTexts = new Map<string, NotesPageText>();

  const assertOpen = () => {
    if (closed) throw new NotesError("NOT_FOUND", "The notebook session is closed.");
  };

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    if (deadline !== undefined) clearTimeout(deadline);
    timer = undefined;
    deadline = undefined;
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
    // While the session closes, close() saves what's due itself.
    if (closing) {
      cancelTimer();
      return;
    }
    const due = () => {
      cancelTimer();
      void save().catch(() => {
        // The failure is in the snapshot; the next change or flush() retries.
      });
    };
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(due, saveDelay);
    deadline ??= setTimeout(due, saveMaxWait);
  };

  const hasChanges = () => dirty.notebook || dirty.pages.size > 0 || dirty.removed.size > 0;

  /** One save at a time: a save that finds another running waits for it, then runs. */
  const save = async (): Promise<void> => {
    while (saving) await saving.catch(() => undefined);
    // The notebook is no longer this session's to write.
    if (closed) return;
    if (!hasChanges()) {
      // Nothing to write, so nothing to tell: a snapshot is published only when it differs.
      if (saveState !== "failed" && saveState !== "saved") {
        saveState = "saved";
        publish();
      }
      return;
    }
    // The slot is taken before the save tells anyone it has started: a
    // listener that calls flush() waits for this save, and never starts
    // another beside it.
    const run = Promise.resolve().then(writeChanges);
    saving = run;
    try {
      await run;
    } finally {
      if (saving === run) saving = undefined;
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
        // A page that an undo brought back gets its PDF's text back too.
        const revived = removedTexts.get(id);
        const known = texts.get(id);
        if (revived?.pdf !== undefined || (known?.typed ?? "") !== typed) {
          // Only this session's fields: the PDF's text has its own writer.
          const pdf = revived?.pdf;
          await store.writePageText({
            notebook: notebookId,
            page: id,
            typed,
            ...(pdf === undefined ? {} : { pdf }),
          });
          texts.set(id, {
            notebook: notebookId,
            page: id,
            typed,
            ...(pdf === undefined ? {} : { pdf }),
          });
        }
        removedTexts.delete(id);
      }
      // The notebook last: it never lists a page whose contents aren't stored yet.
      await store.writeNotebook(notebook);
      if (removed.length > 0) {
        // Read first: the PDF's text may have been indexed since the notebook opened.
        const kept = new Map(
          (await store.readPageTexts(notebookId)).map((entry) => [entry.page, entry]),
        );
        for (const id of removed) {
          await store.deletePage(notebookId, id);
          const text = kept.get(id);
          if (text) removedTexts.set(id, text);
          texts.delete(id);
        }
      }
      await onSaved?.(notebook);
    } catch (error) {
      // Nothing is lost: what wasn't written is still in memory, and is due again.
      dirty.notebook = true;
      for (const id of pages) if (!dirty.removed.has(id)) dirty.pages.add(id);
      for (const id of removed) if (!dirty.pages.has(id)) dirty.removed.add(id);
      saveError = asNotesError(error);
      saveState = "failed";
      emit({ type: "failed", operation: "save", code: saveError.code });
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
          emit({ type: "failed", operation: "load", code: asNotesError(error).code });
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
      emit({ type: "command", commands: list.map((command) => command.type) });
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
      emit({ type: "undo" });
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
      emit({ type: "redo" });
    },

    addAsset(data, mediaType) {
      const write = (async (): Promise<NotesAssetReference> => {
        assertOpen();
        try {
          const asset = await assetNameOf(await data.arrayBuffer());
          await store.writeAsset(notebookId, asset, data);
          return { asset, mediaType, size: data.size };
        } catch (error) {
          throw asNotesError(error);
        }
      })();
      // close() waits for it, so a file never lands in a notebook given back.
      assetWrites.add(write);
      const done = () => assetWrites.delete(write);
      write.then(done, done);
      return write;
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
      cancelTimer();
      await save();
    },

    close(input = {}) {
      if (finishing) return finishing;
      const discard = input.discard === true;
      // One close at a time: a second call joins the first, unless it alone discards.
      if (closing && !discard) return closing;
      const attempt = async (): Promise<void> => {
        try {
          // Edits and files accepted while a save runs are stored too, so
          // nothing is written after the notebook is given back.
          do {
            cancelTimer();
            await Promise.allSettled([...assetWrites]);
            await save();
          } while (!closed && (hasChanges() || assetWrites.size > 0));
        } catch (error) {
          if (!discard) throw error;
        }
        finishing ??= (async () => {
          // Nothing new is accepted from here. A file already on its way
          // lands before the notebook is given back, so it never arrives in
          // a notebook that's someone else's by then.
          closed = true;
          cancelTimer();
          while (assetWrites.size > 0) await Promise.allSettled([...assetWrites]);
          release();
          emit({ type: "notebook_closed" });
        })();
        await finishing;
      };
      const run = attempt().finally(() => {
        if (closing === run) closing = undefined;
      });
      closing = run;
      return run;
    },
  };

  emit({ type: "notebook_opened", pageCount: stored.pages.length });
  return session;
}
