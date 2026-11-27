import {
  applyCommands,
  checkFile,
  cleanFileName,
  createHistory,
  createStore,
  type HistoryStep,
  withProcessingTime,
} from "@hussmartinez/sdk-core";
import { asPdfError, throwIfAborted } from "../errors/abort.js";
import { isPdfError, PdfError } from "../errors/pdf-error.js";
import { type PdfFilePolicyOverrides, type PdfLimitName, pdfLimits } from "../errors/pdf-limits.js";
import type { PdfBuildJob, PdfCompression, PdfEncryption } from "../model/build-job.js";
import { copyBytes } from "../model/bytes.js";
import type {
  PdfBytes,
  PdfFormField,
  PdfLink,
  PdfPageInfo,
  PdfTextContent,
} from "../model/document.js";
import { addRotation } from "../model/geometry.js";
import { EMPTY_PLAN, type PdfPlan, type PdfPlanPage } from "../model/plan.js";
import { createPdfReducer, type PdfCommand } from "../operations/commands.js";
import type { PdfCallOptions } from "../ports/options.js";
import type { PdfDocumentHandle, PdfEngine, PdfRenderOptions } from "../ports/pdf-engine.js";
import type { PdfBuildOptions, PdfProcessor } from "../ports/pdf-processor.js";

/**
 * A source document the session holds: opened or inserted, never changed.
 *
 * @public
 */
export interface PdfSourceInfo {
  /** Unique within the session, and never reused. */
  readonly id: string;
  readonly pageCount: number;
  /** The size of its bytes. */
  readonly byteLength: number;
  /**
   * The file's name, from `File.name` or the `name` option, cleaned as
   * docs/adr/0009 describes: one path segment, without control or
   * bidirectional formatting characters, at most 128 code points. Absent
   * when there was none. Show it only as text; it never reaches `onEvent`.
   */
  readonly name?: string;
}

/**
 * A file policy warning: a value at or above a limit's warning threshold,
 * but within its maximum (ADR 0020). Show its text from
 * `warnings.<limit>` in the message catalogue, with `actual` as a parameter.
 *
 * @public
 */
export interface PdfWarning {
  readonly limit: PdfLimitName;
  readonly actual: number;
}

/**
 * What the session is doing.
 *
 * - `empty`: no document is open.
 * - `opening`: a document is being opened, replacing any other.
 * - `ready`: a document is open.
 * - `error`: no document is open, because the last open failed; `error`
 *   says why. A failed open while a document is open keeps that document,
 *   with the status `ready` and `error` set.
 *
 * @public
 */
export type PdfSessionStatus = "empty" | "opening" | "ready" | "error";

/**
 * The session's state at one moment. Snapshots are immutable: every change
 * makes a new one, so `useSyncExternalStore` and other subscribers can
 * compare them by identity.
 *
 * @public
 */
export interface PdfSessionSnapshot {
  readonly status: PdfSessionStatus;
  /** The document being edited: its pages, in order, and form values. */
  readonly plan: PdfPlan;
  /** The source documents the session holds. */
  readonly sources: readonly PdfSourceInfo[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Whether a document is being opened or inserted. */
  readonly busy: boolean;
  /** Why the last open or insert failed. Show its text by its code. */
  readonly error: PdfError | undefined;
  /** Limits the open documents are close to. */
  readonly warnings: readonly PdfWarning[];
  /**
   * The bytes of every document the session holds, which the
   * `maxSessionSize` limit counts: those the plan uses, and those the undo
   * and redo history can bring back (docs/adr/0004).
   */
  readonly sessionBytes: number;
  /**
   * Whether undo steps were dropped since the document opened, to make room
   * for an insert within `maxSessionSize`. Editors say so, because the
   * earliest edits can no longer be undone (ADR 0010).
   */
  readonly historyTrimmed: boolean;
  /**
   * The keys of the selected pages, in plan order. Tools act on them, such as
   * rotating the selection. View state: not part of the plan and never in
   * events, but undo and redo bring back the selection and current page
   * that went with each step (docs/adr/0008).
   */
  readonly selection: readonly string[];
  /** The key of the page the user is looking at, if a document is open. */
  readonly currentPage: string | undefined;
  /**
   * Whether the open document needed a password to open. `export()` then
   * protects its result with the same password, unless it's told not to
   * (docs/adr/0013). The password itself is never in a snapshot.
   */
  readonly passwordProtected: boolean;
  /**
   * Whether the open document's own encryption restricts printing, copying
   * or changing it, as the engine reports it. An export that's built, rather
   * than the document's original bytes, doesn't carry the restrictions: see
   * `exportsOriginal` (docs/adr/0013).
   */
  readonly restricted: boolean;
  /**
   * The latest request to bring a page into view, from `goToPage`. Viewers
   * scroll to `page` each time `sequence` changes.
   */
  readonly navigation: { readonly page: string; readonly sequence: number } | undefined;
}

/**
 * Anonymous usage events, for a host's analytics (ADR 0010). They never
 * contain file names, contents, form values or annotation text.
 *
 * @public
 */
export type PdfSessionEvent =
  | { readonly type: "document_opened"; readonly pageCount: number }
  | { readonly type: "document_closed" }
  | { readonly type: "pages_inserted"; readonly pageCount: number }
  | { readonly type: "command"; readonly commands: readonly PdfCommand["type"][] }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | {
      readonly type: "document_exported";
      readonly pageCount: number;
      readonly compressed: boolean;
      readonly encrypted: boolean;
    }
  | {
      readonly type: "failed";
      readonly operation: "open" | "insert" | "export";
      readonly code: string;
    };

/**
 * Options for {@link createPdfSession}.
 *
 * @public
 */
export interface PdfSessionOptions {
  /** Opens, reads and renders documents, such as `createPdfJsEngine()`. */
  readonly engine: PdfEngine;
  /** Builds exported documents, such as `createPdfProcessor()`. Needed for `export()`. */
  readonly processor?: PdfProcessor;
  /** Limits for untrusted files (docs/adr/0004). Unknown names throw. */
  readonly filePolicy?: PdfFilePolicyOverrides;
  /** Receives anonymous usage events. Errors it throws are ignored. */
  readonly onEvent?: (event: PdfSessionEvent) => void;
}

/**
 * Options for {@link PdfSession.open}.
 *
 * @public
 */
export interface PdfOpenOptions extends PdfCallOptions {
  /**
   * The file's name, for bytes or a `Blob` that isn't a `File`. It wins over
   * `File.name`, and is cleaned before it's kept (docs/adr/0009).
   */
  readonly name?: string;
  /**
   * The password to open the file with, used only if the file needs one:
   * its user password, or its owner password. Without it, such a file
   * rejects with `PASSWORD_REQUIRED`; with a wrong one, with
   * `PASSWORD_REQUIRED` and `details.reason` `"incorrect-password"`.
   *
   * The session keeps it in memory, with the document, to build exports,
   * and drops it when the document closes or another replaces it. It's
   * never in a snapshot, an event or an error (docs/adr/0013).
   */
  readonly password?: string;
}

/**
 * Options for {@link PdfSession.insert}.
 *
 * @public
 */
export interface PdfInsertOptions extends PdfOpenOptions {
  /** The position of the first inserted page. Defaults to the end. */
  readonly at?: number;
  /** Zero-based indexes of the pages to insert. Defaults to every page. */
  readonly pageIndexes?: readonly number[];
}

/**
 * Options for {@link PdfSession.export}.
 *
 * @public
 */
export interface PdfExportOptions extends PdfCallOptions {
  /** Compress the result, losslessly unless `images` is set. */
  readonly compress?: PdfCompression;
  /**
   * Encrypt the result with AES-256, with these passwords, whatever the
   * open document's own.
   */
  readonly encrypt?: PdfEncryption;
  /**
   * Whether a document that needed a password to open keeps it: the result
   * is then encrypted with AES-256 and opens with the password `open()` was
   * given. Defaults to `true`; `false` builds a document anyone can open.
   * Ignored when `encrypt` is set, and for a document that needed no
   * password (docs/adr/0013).
   */
  readonly keepPassword?: boolean;
  /** Called as the export moves through its steps. */
  readonly onProgress?: PdfBuildOptions["onProgress"];
}

/**
 * The document being edited, as a framework-agnostic store (ADR 0008): a
 * page plan over the documents opened and inserted, edited with commands,
 * with undo and redo (ADR 0010, docs/adr/0003). React binds to it with
 * `useSyncExternalStore`, and the element binds to the same store.
 *
 * @public
 */
export interface PdfSession {
  /** The current snapshot, the same object until something changes. */
  getSnapshot(): PdfSessionSnapshot;
  /** Calls the listener after every change. Returns a function that unsubscribes. */
  subscribe(listener: () => void): () => void;
  /**
   * Opens a document, replacing the current one and its history once it has
   * opened. The file is checked against the file policy before it's read.
   * Rejects with a `PdfError`, which the snapshot also holds; the current
   * document, if any, stays open. A file that needs a password rejects with
   * `PASSWORD_REQUIRED` until it's opened with the right `password`.
   */
  open(file: Blob | PdfBytes, options?: PdfOpenOptions): Promise<void>;
  /**
   * Inserts the pages of another document, as one undoable step. If the
   * documents held would then exceed `maxSessionSize`, the session first
   * drops the redo steps, then the oldest undo steps, as far as needed to
   * release documents only they refer to, and sets `historyTrimmed`. If even
   * that isn't enough, it rejects with `SESSION_TOO_LARGE` and changes
   * nothing.
   */
  insert(file: Blob | PdfBytes, options?: PdfInsertOptions): Promise<void>;
  /**
   * Runs one command, or several as one undoable step. Throws `PdfError`
   * with `INVALID_COMMAND` for a command that doesn't fit the plan, with a
   * `PdfCommandRejection` as `details.reason`, and changes nothing then.
   * Positions and sizes are snapped to millionths of the page
   * (`PDF_POSITION_GRID`).
   */
  execute(commands: PdfCommand | readonly PdfCommand[]): void;
  undo(): void;
  redo(): void;
  /** A plan page's size, and its rotation as shown: its own plus the plan's. */
  getPage(key: string, options?: PdfCallOptions): Promise<PdfPageInfo>;
  /** Renders a plan page with its rotation. */
  renderPage(
    key: string,
    canvas: HTMLCanvasElement,
    options: Omit<PdfRenderOptions, "rotation">,
  ): Promise<void>;
  /** A plan page's text, positioned on the unrotated page. */
  getTextContent(key: string, options?: PdfCallOptions): Promise<PdfTextContent>;
  /** A plan page's form fields, with the session's values applied. */
  getFormFields(key: string, options?: PdfCallOptions): Promise<readonly PdfFormField[]>;
  /** A plan page's web and email links, positioned on the unrotated page. */
  getLinks(key: string, options?: PdfCallOptions): Promise<readonly PdfLink[]>;
  /**
   * Builds the document as it is now: its pages in plan order, with their
   * rotations, form values and annotations, compressed or encrypted if asked.
   * An unchanged document with no options is returned as its original bytes,
   * without the processor. The result is a new buffer the caller owns.
   *
   * A document that needed a password to open keeps it, unless
   * `keepPassword` is `false`. The passwords of inserted documents only
   * read them, and permission restrictions are never carried into a built
   * document (docs/adr/0013).
   */
  export(options?: PdfExportOptions): Promise<Uint8Array>;
  /**
   * Whether `export()` with these options would return the opened file's own
   * bytes, because nothing about the document has changed, rather than
   * build a new one. Only a built document differs from the original: it
   * carries none of its permission restrictions, and is encrypted only as
   * the options say (docs/adr/0013). `false` when no document is open.
   */
  exportsOriginal(
    options?: Pick<PdfExportOptions, "compress" | "encrypt" | "keepPassword">,
  ): boolean;
  /**
   * Selects pages, by key, replacing the selection. Keys the plan doesn't
   * have are ignored.
   */
  select(keys: readonly string[]): void;
  /** Records the page the user is looking at, as a viewer scrolls. */
  setCurrentPage(key: string): void;
  /** Makes a page current and asks viewers to bring it into view. */
  goToPage(key: string): void;
  /** Closes the document and releases its sources. */
  close(): Promise<void>;
}

/** The view state kept beside a history step (docs/adr/0008). */
interface View {
  readonly selection: readonly string[];
  readonly currentPage: string | undefined;
}

interface Source extends PdfSourceInfo {
  readonly bytes: Uint8Array;
  readonly document: PdfDocumentHandle;
  /**
   * The password the source needed, to read it again when exporting. Only
   * here and in the build job: never in a snapshot, an event or an error
   * (docs/adr/0013).
   */
  readonly password?: string;
}

/**
 * Creates a {@link PdfSession}. Pass the engine to use; the headless core
 * doesn't choose one, so it can't pull pdf.js into applications that don't
 * want it.
 *
 * @example
 * ```ts
 * const session = createPdfSession({ engine: createPdfJsEngine() });
 * await session.open(file);
 * const [first] = session.getSnapshot().plan.pages;
 * session.execute({ type: "pdf.rotatePages", pages: [first.key], angle: 90 });
 * session.undo();
 * ```
 *
 * @public
 */
export function createPdfSession(options: PdfSessionOptions): PdfSession {
  const { engine } = options;
  const policy = pdfLimits.resolve(options.filePolicy);
  // Undo and redo stacks of command steps, which the memory policy below
  // trims (ADR 0010 and ADR 0029 in sdk-core, docs/adr/0004).
  const history = createHistory<PdfCommand>();
  /**
   * The view before each step, and the view when it was last undone, by the
   * history's own step object. Steps the history drops are released with it.
   */
  const views = new WeakMap<HistoryStep<PdfCommand>, { readonly before: View; after?: View }>();
  const sources = new Map<string, Source>();
  // Checks commands against the sources the session holds (sdk-core ADR 0045).
  const reduce = createPdfReducer((id) => sources.get(id)?.pageCount);
  let plan: PdfPlan = EMPTY_PLAN;
  let status: PdfSessionStatus = "empty";
  let error: PdfError | undefined;
  let warnings: PdfWarning[] = [];
  let busy = 0;
  let selection: readonly string[] = [];
  let currentPage: string | undefined;
  let navigation: { page: string; sequence: number } | undefined;
  let nextKey = 0;
  let nextSource = 0;
  /**
   * The document `open()` opened, if it needed a password: the password
   * exports keep. Dropped on close, and when another document replaces it.
   */
  let opened: { readonly source: string; readonly password: string } | undefined;
  /** Whether the document `open()` opened has restrictions of its own. */
  let restricted = false;
  /** Cancels the load in progress when a newer open replaces it. */
  let loading: AbortController | undefined;
  const heldBytes = (): number =>
    [...sources.values()].reduce((total, source) => total + source.byteLength, 0);

  /** The sources the plan and the given history steps refer to: only pages need bytes. */
  function referenced(steps: readonly HistoryStep<PdfCommand>[]): Set<string> {
    const ids = new Set(plan.pages.map((page) => page.source));
    for (const { commands, inverses } of steps) {
      for (const command of [...commands, ...inverses]) {
        if (command.type === "pdf.insertPages") ids.add(command.source);
        if (command.type === "pdf.restorePages") {
          for (const { page } of command.entries) ids.add(page.source);
        }
      }
    }
    return ids;
  }

  /** Releases the sources nothing refers to any more, and their engine documents. */
  function collect(): void {
    const keep = referenced(history.steps);
    for (const [id, source] of sources) {
      if (keep.has(id)) continue;
      sources.delete(id);
      void source.document.destroy().catch(() => {});
    }
  }

  /**
   * How many history steps must be dropped, in drop order, for the held
   * sources plus `extra` bytes to fit `maxSessionSize`, or undefined if
   * dropping every step isn't enough.
   */
  function stepsToDrop(extra: number): number | undefined {
    const { maximum } = policy.limits.maxSessionSize;
    const order = history.dropOrder;
    for (let count = 0; count <= order.length; count += 1) {
      const kept = new Set(order.slice(count));
      const ids = referenced(history.steps.filter((entry) => kept.has(entry)));
      const total = [...ids].reduce((sum, id) => sum + (sources.get(id)?.byteLength ?? 0), 0);
      if (total + extra <= maximum) return count;
    }
    return undefined;
  }

  // Each change makes a new frozen snapshot (ADR 0029 in sdk-core).
  const store = createStore(makeSnapshot());

  /** The load warnings, and the session size warning, which follows every change. */
  function sessionWarnings(): PdfWarning[] {
    const bytes = heldBytes();
    const sessionWarning =
      bytes > 0 && bytes >= policy.limits.maxSessionSize.warning
        ? [{ limit: "maxSessionSize" as const, actual: bytes }]
        : [];
    return [...warnings, ...sessionWarning];
  }

  function makeSnapshot(): PdfSessionSnapshot {
    return Object.freeze({
      status,
      plan,
      sources: Object.freeze(
        [...sources.values()].map(({ id, pageCount, byteLength, name }) =>
          Object.freeze({ id, pageCount, byteLength, ...(name === undefined ? {} : { name }) }),
        ),
      ),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      busy: busy > 0,
      error,
      warnings: Object.freeze(sessionWarnings()),
      sessionBytes: heldBytes(),
      historyTrimmed: history.trimmed,
      selection: Object.freeze([...selection]),
      currentPage,
      passwordProtected: opened !== undefined,
      restricted,
      navigation: navigation ? Object.freeze({ ...navigation }) : undefined,
    });
  }

  function changed(): void {
    // View state follows the plan: pages that left it can't be selected or current.
    const keys = new Set(plan.pages.map((page) => page.key));
    if (selection.some((key) => !keys.has(key))) {
      selection = selection.filter((key) => keys.has(key));
    }
    if (currentPage !== undefined && !keys.has(currentPage)) {
      currentPage = plan.pages[0]?.key;
    }
    if (currentPage === undefined && plan.pages.length > 0) currentPage = plan.pages[0]?.key;
    if (navigation && !keys.has(navigation.page)) navigation = undefined;
    store.set(makeSnapshot());
  }

  function emit(event: PdfSessionEvent): void {
    try {
      options.onEvent?.(event);
    } catch {
      // A host's analytics must never break editing.
    }
  }

  /** Reads, checks and opens one file as a source, without registering it. */
  async function load(
    file: Blob | PdfBytes,
    signal: AbortSignal,
    given: string | undefined,
    password: string | undefined,
  ): Promise<Source> {
    // File isn't a global in every runtime the core supports (ADR 0007 in sdk-core).
    const fileName = typeof File !== "undefined" && file instanceof File ? file.name : undefined;
    const name = cleanFileName(given ?? fileName);
    const found: PdfWarning[] = [];
    const warnAt = (limit: PdfLimitName, actual: number) => {
      if (policy.check(limit, actual) === "warning") found.push({ limit, actual });
    };
    // The file size, before anything is read (ADR 0020).
    if (file instanceof Blob) {
      if (checkFile(policy, file) === "warning")
        found.push({ limit: "maxFileSize", actual: file.size });
    } else {
      warnAt("maxFileSize", file.byteLength);
    }
    const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : copyBytes(file);
    throwIfAborted(signal);
    // Without the password first, so the session knows whether the file
    // needs it: a password given for a file that opens without one isn't
    // kept, and never protects an export (docs/adr/0013). Both attempts
    // share one processing-time limit: it bounds the open, not each try.
    let needed = false;
    const document = await withProcessingTime(
      policy,
      async (limited) => {
        try {
          return await engine.open(bytes, { signal: limited });
        } catch (reason) {
          if (!password || !isPdfError(reason, "PASSWORD_REQUIRED")) throw reason;
        }
        needed = true;
        try {
          return await engine.open(bytes, { signal: limited, password });
        } catch (reason) {
          // The file needs a password and this one didn't open it, whatever
          // the engine calls that.
          if (
            !isPdfError(reason, "PASSWORD_REQUIRED") ||
            reason.details?.["reason"] !== undefined
          ) {
            throw reason;
          }
          throw new PdfError("PASSWORD_REQUIRED", "The password is wrong.", {
            details: { reason: "incorrect-password" },
            cause: reason,
          });
        }
      },
      { signal },
    ).catch((reason: unknown) => {
      throw asPdfError(reason, "The PDF couldn't be opened.");
    });
    try {
      throwIfAborted(signal);
      warnAt("maxPages", document.pageCount);
    } catch (reason) {
      await document.destroy();
      throw reason;
    }
    warnings = [...warnings.filter((warning) => warning.limit !== "maxFileSize"), ...found];
    nextSource += 1;
    return {
      id: `s${nextSource}`,
      pageCount: document.pageCount,
      byteLength: bytes.byteLength,
      ...(name === undefined ? {} : { name }),
      bytes,
      document,
      ...(needed && password ? { password } : {}),
    };
  }

  /** Runs a load, marking the session busy, and cancelling it if a newer open starts. */
  async function track<Value>(
    signal: AbortSignal | undefined,
    replaces: boolean,
    run: (signal: AbortSignal) => Promise<Value>,
  ): Promise<Value> {
    if (replaces) loading?.abort(new PdfError("ABORTED", "A newer document replaced this one."));
    const controller = new AbortController();
    if (replaces) loading = controller;
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    busy += 1;
    changed();
    try {
      return await run(combined);
    } finally {
      busy -= 1;
      if (loading === controller) loading = undefined;
      changed();
    }
  }

  async function release(): Promise<void> {
    const documents = [...sources.values()].map((source) => source.document);
    sources.clear();
    await Promise.all(documents.map((document) => document.destroy().catch(() => {})));
  }

  function pageFor(key: string): { page: PdfPlanPage; source: Source } {
    const page = plan.pages.find((entry) => entry.key === key);
    const source = page && sources.get(page.source);
    if (!page || !source) throw new TypeError(`The plan has no page ${key}.`);
    return { page, source };
  }

  /** The selection and current page, which undo and redo bring back (docs/adr/0008). */
  function view(): View {
    return { selection, currentPage };
  }

  /**
   * Brings back a view, keeping only pages the plan still has; changed()
   * settles the rest. The current page is brought into view.
   */
  function restore(saved: View): void {
    const keys = new Set(plan.pages.map((page) => page.key));
    selection = saved.selection.filter((key) => keys.has(key));
    if (saved.currentPage !== undefined && keys.has(saved.currentPage)) {
      currentPage = saved.currentPage;
      navigation = { page: saved.currentPage, sequence: (navigation?.sequence ?? 0) + 1 };
    }
  }

  function step(commands: readonly PdfCommand[]): void {
    const before = view();
    const result = applyCommands(reduce, plan, commands);
    plan = result.state;
    history.push({ commands, inverses: result.inverses });
    // The history stores its own frozen copy of the step, the object that
    // undo() and redo() return, so the view is kept against that one.
    const stored = history.steps.at(-1);
    if (stored) views.set(stored, { before });
    // A new step drops the redo steps, and the documents only they held.
    collect();
  }

  /**
   * What an export with these options is: the job a processor would build,
   * or the opened file itself, when nothing about it has changed.
   */
  function prepareExport(
    exportOptions: Pick<PdfExportOptions, "compress" | "encrypt" | "keepPassword">,
  ) {
    const pages = plan.pages;
    const used = [...new Set(pages.map((page) => page.source))];
    // The opened document's password protects the result, unless the
    // caller chooses passwords of its own or asks for none (docs/adr/0013).
    const kept =
      exportOptions.encrypt === undefined && exportOptions.keepPassword !== false
        ? opened
        : undefined;
    const encrypt = exportOptions.encrypt ?? (kept ? { userPassword: kept.password } : undefined);
    const job: PdfBuildJob = {
      sources: used.map((id) => {
        const values = plan.formValues[id];
        const { bytes, password } = sources.get(id) as Source;
        return {
          id,
          bytes,
          ...(password === undefined ? {} : { password }),
          ...(values && Object.keys(values).length > 0 ? { formValues: values } : {}),
        };
      }),
      pages: pages.map((page) => ({
        source: page.source,
        pageIndex: page.pageIndex,
        ...(page.rotation === 0 ? {} : { rotation: page.rotation }),
        ...(page.annotations.length === 0 ? {} : { annotations: page.annotations }),
      })),
      ...(exportOptions.compress ? { compress: exportOptions.compress } : {}),
      ...(encrypt ? { encrypt } : {}),
    };

    // An unchanged document with no options is its original bytes: as
    // protected as it was when its password is kept, and never the bytes
    // of a file that needed a password the result isn't to have.
    const [only] = job.sources;
    const source = only && sources.get(only.id);
    const asItWas =
      source?.password === undefined ? !encrypt : kept !== undefined && kept.source === source.id;
    const original =
      job.sources.length === 1 &&
      !only?.formValues &&
      !job.compress &&
      asItWas &&
      source &&
      job.pages.length === source.pageCount &&
      job.pages.every(
        (page, index) => page.pageIndex === index && !page.rotation && !page.annotations,
      )
        ? source
        : undefined;
    return { job, pages, encrypt, original };
  }

  return {
    getSnapshot: store.getSnapshot,

    subscribe: store.subscribe,

    async open(file, callOptions = {}) {
      status = "opening";
      error = undefined;
      try {
        const source = await track(callOptions.signal, true, async (signal) => {
          // The open document is released once this one opens, so this one
          // must fit on its own.
          policy.check("maxSessionSize", file instanceof Blob ? file.size : file.byteLength);
          return load(file, signal, callOptions.name, callOptions.password);
        });
        await release();
        sources.set(source.id, source);
        opened =
          source.password === undefined
            ? undefined
            : { source: source.id, password: source.password };
        restricted = source.document.restricted === true;
        history.clear();
        plan = {
          pages: Array.from({ length: source.pageCount }, (_, pageIndex) => {
            nextKey += 1;
            return {
              key: `p${nextKey}`,
              source: source.id,
              pageIndex,
              rotation: 0,
              annotations: [],
            };
          }),
          formValues: {},
        };
        status = "ready";
        changed();
        emit({ type: "document_opened", pageCount: source.pageCount });
      } catch (reason) {
        const failure = asPdfError(reason, "The PDF couldn't be opened.");
        // A newer open replaced this one; it reports its own outcome.
        if (failure.code === "ABORTED" && loading !== undefined) throw failure;
        // A failed open keeps the document that was already open, and its
        // history, so a bad file never costs the user their work.
        status = sources.size > 0 ? "ready" : "error";
        error = failure;
        changed();
        emit({ type: "failed", operation: "open", code: failure.code });
        throw failure;
      }
    },

    async insert(file, insertOptions = {}) {
      if (status !== "ready") {
        throw new PdfError("PROCESSING_FAILED", "Open a document before inserting another.");
      }
      error = undefined;
      try {
        const source = await track(insertOptions.signal, false, async (signal) => {
          policy.check("maxFiles", sources.size + 1);
          return load(file, signal, insertOptions.name, insertOptions.password);
        });
        try {
          const pageIndexes =
            insertOptions.pageIndexes ??
            Array.from({ length: source.pageCount }, (_, index) => index);
          for (const index of pageIndexes) {
            if (!Number.isInteger(index) || index < 0 || index >= source.pageCount) {
              throw new RangeError(`The inserted document has no page index ${index}.`);
            }
          }
          if (policy.check("maxPages", plan.pages.length + pageIndexes.length) === "warning") {
            warnings = [
              ...warnings.filter((warning) => warning.limit !== "maxPages"),
              { limit: "maxPages", actual: plan.pages.length + pageIndexes.length },
            ];
          }
          const keys = pageIndexes.map(() => {
            nextKey += 1;
            return `p${nextKey}`;
          });
          const drop = stepsToDrop(source.byteLength);
          if (drop === undefined) {
            throw policy.error("maxSessionSize", heldBytes() + source.byteLength);
          }
          history.drop(drop);
          collect();
          sources.set(source.id, source);
          step([
            {
              type: "pdf.insertPages",
              source: source.id,
              pageIndexes,
              at: insertOptions.at ?? plan.pages.length,
              keys,
            },
          ]);
          changed();
          emit({ type: "pages_inserted", pageCount: pageIndexes.length });
        } catch (reason) {
          sources.delete(source.id);
          await source.document.destroy().catch(() => {});
          throw reason;
        }
      } catch (reason) {
        // A mistake in the call, such as a position outside the plan, isn't
        // the file's failure.
        if (
          reason instanceof TypeError ||
          reason instanceof RangeError ||
          isPdfError(reason, "INVALID_COMMAND")
        ) {
          throw reason;
        }
        const failure = asPdfError(reason, "The PDF couldn't be inserted.");
        error = failure;
        changed();
        emit({ type: "failed", operation: "insert", code: failure.code });
        throw failure;
      }
    },

    execute(commands) {
      const list = Array.isArray(commands) ? commands : [commands as PdfCommand];
      if (list.length === 0) return;
      step(list);
      changed();
      emit({ type: "command", commands: list.map((command) => command.type) });
    },

    undo() {
      const entry = history.undo();
      if (!entry) return;
      const now = view();
      try {
        plan = applyCommands(reduce, plan, entry.inverses).state;
      } catch (reason) {
        history.restore("undo");
        throw reason;
      }
      const record = views.get(entry);
      if (record) {
        // Redo brings back what the user had when they undid.
        record.after = now;
        restore(record.before);
      }
      changed();
      emit({ type: "undo" });
    },

    redo() {
      const entry = history.redo();
      if (!entry) return;
      try {
        plan = applyCommands(reduce, plan, entry.commands).state;
      } catch (reason) {
        history.restore("redo");
        throw reason;
      }
      const after = views.get(entry)?.after;
      if (after) restore(after);
      changed();
      emit({ type: "redo" });
    },

    async getPage(key, callOptions) {
      const { page, source } = pageFor(key);
      const info = await source.document.getPage(page.pageIndex, callOptions);
      return { ...info, rotation: addRotation(info.rotation, page.rotation) };
    },

    async renderPage(key, canvas, renderOptions) {
      const { page, source } = pageFor(key);
      await source.document.renderPage(page.pageIndex, canvas, {
        ...renderOptions,
        rotation: page.rotation,
      });
    },

    async getTextContent(key, callOptions) {
      const { page, source } = pageFor(key);
      return source.document.getTextContent(page.pageIndex, callOptions);
    },

    async getFormFields(key, callOptions) {
      const { page, source } = pageFor(key);
      const fields = await source.document.getFormFields(page.pageIndex, callOptions);
      const values = plan.formValues[source.id] ?? {};
      return fields.map((field) =>
        Object.hasOwn(values, field.name)
          ? { ...field, value: values[field.name] as typeof field.value }
          : field,
      );
    },

    async getLinks(key, callOptions) {
      const { page, source } = pageFor(key);
      return source.document.getLinks(page.pageIndex, callOptions);
    },

    async export(exportOptions = {}) {
      if (status !== "ready" && sources.size === 0) {
        throw new PdfError("PROCESSING_FAILED", "Open a document before exporting it.");
      }
      const { job, pages, encrypt, original } = prepareExport(exportOptions);
      const done = () =>
        emit({
          type: "document_exported",
          pageCount: pages.length,
          compressed: Boolean(exportOptions.compress),
          encrypted: Boolean(encrypt),
        });

      if (original) {
        throwIfAborted(exportOptions.signal);
        done();
        return copyBytes(original.bytes);
      }

      const { processor } = options;
      if (!processor) {
        throw new TypeError("Exporting an edited document needs a processor in createPdfSession.");
      }
      busy += 1;
      changed();
      try {
        const output = await withProcessingTime(
          policy,
          (signal) =>
            processor.build(job, {
              signal,
              ...(exportOptions.onProgress ? { onProgress: exportOptions.onProgress } : {}),
            }),
          exportOptions.signal ? { signal: exportOptions.signal } : {},
        );
        done();
        return output;
      } catch (reason) {
        if (reason instanceof TypeError || reason instanceof RangeError) throw reason;
        const failure = asPdfError(reason, "The PDF couldn't be exported.");
        emit({ type: "failed", operation: "export", code: failure.code });
        throw failure;
      } finally {
        busy -= 1;
        changed();
      }
    },

    exportsOriginal(exportOptions = {}) {
      return sources.size > 0 && prepareExport(exportOptions).original !== undefined;
    },

    select(keys) {
      const wanted = new Set(keys);
      const next = plan.pages.filter((page) => wanted.has(page.key)).map((page) => page.key);
      if (
        next.length === selection.length &&
        next.every((key, index) => key === selection[index])
      ) {
        return;
      }
      selection = next;
      changed();
    },

    setCurrentPage(key) {
      if (key === currentPage || !plan.pages.some((page) => page.key === key)) return;
      currentPage = key;
      changed();
    },

    goToPage(key) {
      if (!plan.pages.some((page) => page.key === key)) {
        throw new TypeError(`The plan has no page ${key}.`);
      }
      currentPage = key;
      navigation = { page: key, sequence: (navigation?.sequence ?? 0) + 1 };
      changed();
    },

    async close() {
      loading?.abort(new PdfError("ABORTED", "The document was closed."));
      const hadDocument = status === "ready";
      opened = undefined;
      restricted = false;
      await release();
      plan = EMPTY_PLAN;
      history.clear();
      warnings = [];
      error = undefined;
      status = "empty";
      changed();
      if (hadDocument) emit({ type: "document_closed" });
    },
  };
}
