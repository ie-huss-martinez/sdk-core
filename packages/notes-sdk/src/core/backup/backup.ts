import { throwIfAborted } from "../errors/abort.js";
import { invalidDocument, isNotesError, NotesError } from "../errors/notes-error.js";
import type { NotesFilePolicy } from "../errors/notes-limits.js";
import {
  NOTES_BACKUP_FORMAT,
  NOTES_BACKUP_VERSION,
  type NotesBackupManifest,
  readNotesBackupManifest,
  readNotesNotebookDocument,
  readNotesPageDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "../format/documents.js";
import { assetNameOf, isNotesId } from "../model/ids.js";
import type { NotesAssetReference } from "../model/items.js";
import type { NotesFolder, NotesLibraryIndex, NotesNotebookSummary } from "../model/library.js";
import { type NotesNotebook, type NotesPage, notebookAssets } from "../model/notebook.js";
import type { NotesStore } from "../ports/notes-store.js";
import type { NotesProgress, NotesProgressOptions } from "../ports/options.js";
import { createZipWriter, readZip, type ZipArchive } from "./zip.js";

/**
 * Backup and restore of a library (docs/adr/0005). A backup is a zip that
 * ordinary tools open:
 *
 * ```
 * backup.json                                  the manifest, first
 * notebooks/<notebook>/notebook.json           the notebook's document
 * notebooks/<notebook>/pages/<page>.json       one document for each page
 * notebooks/<notebook>/assets/<64 hex digits>  each file, named by its SHA-256
 * ```
 */

const MANIFEST = "backup.json";
const notebookPath = (notebook: string): string => `notebooks/${notebook}/notebook.json`;
const pagePath = (notebook: string, page: string): string =>
  `notebooks/${notebook}/pages/${page}.json`;
/** An asset's entry is named by its hash alone: the name without `sha256:`. */
const assetPath = (notebook: string, asset: string): string =>
  `notebooks/${notebook}/assets/${asset.slice("sha256:".length)}`;

/** How often `newId` may return an identifier that's taken before restore gives up. */
const NEW_ID_ATTEMPTS = 8;

/**
 * Options of {@link createNotesBackup}.
 */
export interface NotesBackupOptions extends NotesProgressOptions {
  /** The notebooks to include. All that aren't in the bin, when omitted. */
  readonly notebooks?: readonly string[];
  /** The clock, in milliseconds since the Unix epoch. */
  readonly now: () => number;
}

/**
 * Options of {@link restoreNotesBackup}.
 */
export interface NotesRestoreOptions extends NotesProgressOptions {
  /** The file policy, whose limits bound the backup and each notebook in it. */
  readonly policy: NotesFilePolicy;
  /** The clock. Restore doesn't read it: a restored notebook keeps its own times. */
  readonly now: () => number;
  /** Makes the identifier of a notebook that's restored beside a changed one. */
  readonly newId: () => string;
}

/**
 * What a restore did.
 *
 * @public
 */
export interface NotesRestoreReport {
  /**
   * Notebooks written to the store, as the library should now list them.
   * None has an id the library already lists.
   */
  readonly restored: readonly NotesNotebookSummary[];
  /** Ids of notebooks left alone because the library already holds the same notebook, unchanged. */
  readonly unchanged: readonly string[];
  /** Folders the library must gain so the restored notebooks keep their place. */
  readonly folders: readonly NotesFolder[];
}

/** Reports progress as steps out of a total, never going backwards. */
function createProgress(
  onProgress: ((progress: NotesProgress) => void) | undefined,
  total: number,
) {
  let steps = total;
  let done = 0;
  let reported = 0;
  const report = (fraction: number): void => {
    if (!onProgress) return;
    reported = Math.min(1, Math.max(reported, fraction));
    onProgress({ fraction: reported });
  };
  return {
    /** Adds steps that weren't known at the start. */
    grow(by: number): void {
      steps += by;
    },
    step(by = 1): void {
      done += by;
      report(steps === 0 ? 1 : done / steps);
    },
    finish(): void {
      if (reported < 1) report(1);
    },
  };
}

function notFound(kind: "notebook" | "asset"): NotesError {
  return new NotesError("NOT_FOUND", `The library has no such ${kind}.`, { details: { kind } });
}

const json = (document: unknown): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(JSON.stringify(document));

/**
 * A page with only its pictures, which is all {@link notebookAssets} reads
 * of it: a notebook's files are found without holding its pages in memory.
 */
function picturesOf(page: NotesPage): NotesPage {
  return { id: page.id, items: page.items.filter((item) => item.type === "image") };
}

/** The folders some notebooks are in, with every folder those are in, in the library's order. */
function foldersOf(index: NotesLibraryIndex, inFolders: Iterable<string | null>): NotesFolder[] {
  const byId = new Map(index.folders.map((folder) => [folder.id, folder]));
  const included = new Set<string>();
  for (const start of inFolders) {
    let folder = start === null ? undefined : byId.get(start);
    while (folder && !included.has(folder.id)) {
      included.add(folder.id);
      folder = folder.parent === null ? undefined : byId.get(folder.parent);
    }
  }
  return index.folders
    .filter((folder) => included.has(folder.id))
    .map((folder) =>
      // A parent the library doesn't list would make the manifest unreadable.
      folder.parent === null || included.has(folder.parent) ? folder : { ...folder, parent: null },
    );
}

/**
 * Writes a backup of the library, or of some of its notebooks.
 *
 * It holds the manifest, then each notebook: its document, each page it
 * lists and every file it refers to. A page the store doesn't have is
 * written empty, because a page that was never written on has no file.
 *
 * A backup is never written with something missing: a notebook the library
 * doesn't have rejects with `NOT_FOUND` and `details.kind` `"notebook"`,
 * and a file the store doesn't have with `"asset"`. A stored file that no
 * longer matches its name or its size rejects with `INVALID_DOCUMENT` and
 * the reason `asset-mismatch`, since restore would refuse the whole backup
 * for it.
 *
 * Nothing stops the library changing while it's read: the caller saves
 * what's open first, and keeps edits out until the backup is done.
 *
 * @param store - Where the library is kept.
 * @param index - The library's index.
 * @param options - Which notebooks, the clock, a signal and a progress listener.
 * @returns The backup, as a zip file.
 */
export async function createNotesBackup(
  store: NotesStore,
  index: NotesLibraryIndex,
  options: NotesBackupOptions,
): Promise<Blob> {
  const { signal } = options;
  throwIfAborted(signal);
  const listed = new Map(index.notebooks.map((summary) => [summary.id, summary]));
  const ids =
    options.notebooks === undefined
      ? index.notebooks.filter((summary) => summary.deletedAt === null).map((summary) => summary.id)
      : [...new Set(options.notebooks)];

  // Every notebook is read before anything is written, so a missing one fails at once.
  const notebooks: NotesNotebook[] = [];
  for (const id of ids) {
    throwIfAborted(signal);
    const notebook = listed.has(id) ? await store.readNotebook(id) : undefined;
    if (notebook === undefined) throw notFound("notebook");
    notebooks.push(notebook);
  }

  const folders = foldersOf(
    index,
    ids.map((id) => listed.get(id)?.folder ?? null),
  );
  const inManifest = new Set(folders.map((folder) => folder.id));
  const manifest: NotesBackupManifest = {
    format: NOTES_BACKUP_FORMAT,
    version: NOTES_BACKUP_VERSION,
    createdAt: options.now(),
    scope: options.notebooks === undefined ? "library" : "notebooks",
    folders,
    notebooks: ids.map((id) => {
      const folder = listed.get(id)?.folder ?? null;
      return { id, folder: folder !== null && inManifest.has(folder) ? folder : null };
    }),
  };

  // The files a notebook's own document names are known now. Pictures are found page by page.
  const known = notebooks.map((notebook) => notebookAssets(notebook, []).size);
  const progress = createProgress(
    options.onProgress,
    notebooks.reduce(
      (sum, notebook, position) => sum + 1 + notebook.pages.length + (known[position] ?? 0),
      1,
    ),
  );

  const zip = createZipWriter();
  await zip.add(MANIFEST, json(manifest));
  progress.step();
  for (const [position, notebook] of notebooks.entries()) {
    throwIfAborted(signal);
    await zip.add(notebookPath(notebook.id), json(toNotesNotebookDocument(notebook)));
    progress.step();

    const pictures: NotesPage[] = [];
    for (const info of notebook.pages) {
      throwIfAborted(signal);
      const page = (await store.readPage(notebook.id, info.id)) ?? { id: info.id, items: [] };
      await zip.add(pagePath(notebook.id, info.id), json(toNotesPageDocument(page)));
      pictures.push(picturesOf(page));
      progress.step();
    }

    const assets = notebookAssets(notebook, pictures);
    progress.grow(assets.size - (known[position] ?? 0));
    for (const reference of assets.values()) {
      throwIfAborted(signal);
      const data = await store.readAsset(notebook.id, reference.asset);
      if (data === undefined) throw notFound("asset");
      // Restore checks the same, when it's too late to do anything about it.
      if (
        data.size !== reference.size ||
        (await assetNameOf(await data.arrayBuffer())) !== reference.asset
      ) {
        throw invalidDocument("asset-mismatch", `notebooks[${position}]/assets`);
      }
      // Pictures, PDFs and recordings are compressed already.
      await zip.add(assetPath(notebook.id, reference.asset), data, { compress: false });
      progress.step();
    }
  }
  throwIfAborted(signal);
  const backup = zip.finish();
  progress.finish();
  return backup;
}

/** What restore reads an archive with. */
interface RestoreContext {
  readonly archive: ZipArchive;
  readonly policy: NotesFilePolicy;
  readonly signal: AbortSignal | undefined;
}

/**
 * Reads one JSON document of the archive with its strict reader. A failure
 * says which document it's in, by its position and never by a name from
 * the file.
 */
async function readDocument<Document>(
  context: RestoreContext,
  path: string,
  where: string,
  read: (value: unknown) => Document,
): Promise<Document> {
  throwIfAborted(context.signal);
  const entry = context.archive.entries.get(path);
  if (!entry) throw invalidDocument("missing-entry", where);
  // A document is parsed in memory as a whole, so it's bounded before it's inflated.
  context.policy.check("maxDecodedSize", entry.size);
  const bytes = await context.archive.read(path);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw invalidDocument("malformed-document", where);
  }
  try {
    return read(value);
  } catch (error) {
    if (isNotesError(error, "INVALID_DOCUMENT")) {
      const reason = error.details?.["reason"];
      const at = error.details?.["at"];
      if (typeof reason === "string" && typeof at === "string") {
        throw new NotesError("INVALID_DOCUMENT", `${where}: ${error.message}`, {
          details: { reason, at: `${where}:${at}` },
          cause: error,
        });
      }
    }
    throw error;
  }
}

/** What restore does with one notebook of the backup, decided before anything is written. */
type RestorePlan =
  | {
      readonly kind: "write";
      /** The notebook's id in the backup, and the id it's written under. */
      readonly source: string;
      readonly target: string;
      readonly where: string;
      readonly folder: string | null;
      readonly assets: readonly NotesAssetReference[];
      /** How many entries it has in the archive. */
      readonly entries: number;
    }
  | { readonly kind: "list"; readonly summary: NotesNotebookSummary }
  | { readonly kind: "unchanged"; readonly id: string };

function summaryOf(notebook: NotesNotebook, folder: string | null): NotesNotebookSummary {
  return {
    id: notebook.id,
    title: notebook.title,
    cover: notebook.cover,
    template: notebook.pages[0]?.template ?? "blank",
    folder,
    pageCount: notebook.pages.length,
    createdAt: notebook.createdAt,
    updatedAt: notebook.updatedAt,
    deletedAt: null,
  };
}

/** Whether the store's notebook is the backup's, unchanged: the same time and the same pages. */
function sameNotebook(stored: NotesNotebook, backup: NotesNotebook): boolean {
  return (
    stored.updatedAt === backup.updatedAt &&
    stored.pages.length === backup.pages.length &&
    stored.pages.every((page, position) => page.id === backup.pages[position]?.id)
  );
}

/** The store's notebook of an id, `undefined` for none, or `"unreadable"` for a damaged one. */
async function storedNotebook(
  store: NotesStore,
  id: string,
): Promise<NotesNotebook | "unreadable" | undefined> {
  try {
    return await store.readNotebook(id);
  } catch (error) {
    // A notebook that can't be read is exactly what a backup is restored for.
    if (isNotesError(error, "INVALID_DOCUMENT") || isNotesError(error, "UNSUPPORTED_FORMAT")) {
      return "unreadable";
    }
    throw error;
  }
}

/** The text of a page's text boxes, as search reads it. */
function typedText(page: NotesPage): string {
  return page.items
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

/**
 * Restores a backup into a library. It rejects without having written
 * anything unless the whole backup is sound, and it never overwrites.
 *
 * **What's checked, before anything is written.** The archive is read as a
 * hostile file, within the policy's `maxBackupSize` and `maxBackupEntries`.
 * `backup.json`, every notebook's document and every page's document must
 * be there (`missing-entry`), be no larger than `maxDecodedSize`, and be
 * read by their strict readers, which refuse an unknown field
 * (`malformed-document`) and a later version (`UNSUPPORTED_FORMAT`). A
 * notebook's document has the id of its folder, and a page's the id of its
 * file (`malformed-document`). Each notebook is within `maxPages` and each
 * page within `maxPageItems`. Every file a notebook refers to is in the
 * archive (`missing-entry`), with the size its reference says and the
 * SHA-256 its name says (`asset-mismatch`). Entries the manifest doesn't
 * lead to are ignored.
 *
 * **What's written.** For each notebook of the backup:
 *
 * - the library doesn't have it: it's written under its own id;
 * - the store has the same notebook, with an equal `updatedAt` and the same
 *   pages in the same order: nothing is written. It's reported in
 *   `unchanged` when the index lists it, and in `restored` when the index
 *   doesn't, which is how a restore that was interrupted is picked up by
 *   the next;
 * - anything else, such as a notebook changed since the backup or one the
 *   store can't read: the backup's copy is written under a new id from
 *   `newId`, with its pages' and items' ids as they were, so both are kept.
 *
 * A notebook's files are written first, then its pages with their search
 * text, and its document last, so a restore that stops halfway never
 * leaves a notebook's document pointing at pages that aren't there. A
 * restore that fails while writing may leave notebooks the index doesn't
 * list; restoring the same backup again lists them.
 *
 * **Folders.** A folder of the backup whose id the library has is the
 * library's: it isn't duplicated, and the library's name and place stand.
 * The others that the restored notebooks need are returned in `folders`,
 * each under its own parent, or at the top if its parent is nowhere.
 *
 * The index isn't written here: the caller appends `restored` and
 * `folders` to it.
 *
 * @param store - Where the library is kept.
 * @param index - The library's index.
 * @param file - The backup.
 * @param options - The file policy, how to make an id, a signal and a progress listener.
 * @returns What was restored, what was left alone, and the folders to add.
 * @throws `TypeError` if `newId` keeps returning ids that are invalid or taken.
 */
export async function restoreNotesBackup(
  store: NotesStore,
  index: NotesLibraryIndex,
  file: Blob,
  options: NotesRestoreOptions,
): Promise<NotesRestoreReport> {
  const { policy, signal } = options;
  throwIfAborted(signal);
  const archive = await readZip(file, {
    maxEntries: policy.limits.maxBackupEntries.maximum,
    maxSize: policy.limits.maxBackupSize.maximum,
  });
  const context: RestoreContext = { archive, policy, signal };
  // Each entry is read to check it and again to write it, but for the manifest, read once.
  const progress = createProgress(options.onProgress, 2 * archive.entries.size - 1);

  const manifest = await readDocument(context, MANIFEST, MANIFEST, readNotesBackupManifest);
  progress.step();

  const listed = new Set(index.notebooks.map((summary) => summary.id));
  const taken = new Set([
    ...(await store.listNotebooks()),
    ...listed,
    ...manifest.notebooks.map((entry) => entry.id),
  ]);
  const freshId = (): string => {
    for (let attempt = 0; attempt < NEW_ID_ATTEMPTS; attempt += 1) {
      const id = options.newId();
      if (isNotesId(id) && !taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
    throw new TypeError("newId must return a valid identifier that no notebook has.");
  };

  // First pass: every notebook is read and checked whole. Nothing is written.
  const plans: RestorePlan[] = [];
  for (const [position, entry] of manifest.notebooks.entries()) {
    const where = `notebooks[${position}]`;
    const notebook = await readDocument(
      context,
      notebookPath(entry.id),
      `${where}/notebook.json`,
      readNotesNotebookDocument,
    );
    if (notebook.id !== entry.id) {
      throw invalidDocument("malformed-document", `${where}/notebook.json:$.id`);
    }
    policy.check("maxPages", notebook.pages.length);
    progress.step();

    const pictures: NotesPage[] = [];
    for (const [number, info] of notebook.pages.entries()) {
      const at = `${where}/pages[${number}]`;
      const page = await readDocument(
        context,
        pagePath(entry.id, info.id),
        at,
        readNotesPageDocument,
      );
      if (page.id !== info.id) throw invalidDocument("malformed-document", `${at}:$.id`);
      policy.check("maxPageItems", page.items.length);
      pictures.push(picturesOf(page));
      progress.step();
    }

    const assets = [...notebookAssets(notebook, pictures).values()];
    for (const reference of assets) {
      throwIfAborted(signal);
      const path = assetPath(entry.id, reference.asset);
      const found = archive.entries.get(path);
      if (!found) throw invalidDocument("missing-entry", `${where}/assets`);
      // One file at a time is hashed, and none is kept: the second pass reads them again.
      if (
        found.size !== reference.size ||
        (await assetNameOf(await archive.read(path))) !== reference.asset
      ) {
        throw invalidDocument("asset-mismatch", `${where}/assets`);
      }
      progress.step();
    }

    const entries = 1 + notebook.pages.length + assets.length;
    const stored = await storedNotebook(store, entry.id);
    if (stored !== undefined && stored !== "unreadable" && sameNotebook(stored, notebook)) {
      plans.push(
        listed.has(entry.id)
          ? { kind: "unchanged", id: entry.id }
          : { kind: "list", summary: summaryOf(stored, entry.folder) },
      );
      // Its entries aren't read a second time.
      progress.step(entries);
      continue;
    }
    plans.push({
      kind: "write",
      source: entry.id,
      // Its own id only where that id is free, in the store and in the index.
      target: stored === undefined && !listed.has(entry.id) ? entry.id : freshId(),
      where,
      folder: entry.folder,
      assets,
      entries,
    });
  }

  // The folders the restored notebooks need and the library doesn't have.
  const has = new Set(index.folders.map((folder) => folder.id));
  const inManifest = new Map(manifest.folders.map((folder) => [folder.id, folder]));
  const gained = new Set<string>();
  for (const plan of plans) {
    if (plan.kind === "unchanged") continue;
    const start = plan.kind === "write" ? plan.folder : plan.summary.folder;
    let folder = start === null ? undefined : inManifest.get(start);
    while (folder && !has.has(folder.id) && !gained.has(folder.id)) {
      gained.add(folder.id);
      folder = folder.parent === null ? undefined : inManifest.get(folder.parent);
    }
  }
  const folders = manifest.folders
    .filter((folder) => gained.has(folder.id))
    .map((folder) =>
      folder.parent === null || has.has(folder.parent) || gained.has(folder.parent)
        ? folder
        : { ...folder, parent: null },
    );

  // Second pass: files, then pages, then the notebook's document.
  const restored: NotesNotebookSummary[] = [];
  const unchanged: string[] = [];
  for (const plan of plans) {
    if (plan.kind === "unchanged") {
      unchanged.push(plan.id);
      continue;
    }
    if (plan.kind === "list") {
      restored.push(plan.summary);
      continue;
    }
    const { source, target, where } = plan;
    const notebook = await readDocument(
      context,
      notebookPath(source),
      `${where}/notebook.json`,
      readNotesNotebookDocument,
    );
    for (const reference of plan.assets) {
      throwIfAborted(signal);
      const data = await archive.readBlob(assetPath(source, reference.asset));
      await store.writeAsset(target, reference.asset, data);
      progress.step();
    }
    for (const [number, info] of notebook.pages.entries()) {
      const page = await readDocument(
        context,
        pagePath(source, info.id),
        `${where}/pages[${number}]`,
        readNotesPageDocument,
      );
      await store.writePage(target, page);
      await store.writePageText({ notebook: target, page: page.id, typed: typedText(page) });
      progress.step();
    }
    throwIfAborted(signal);
    const written: NotesNotebook = { ...notebook, id: target };
    await store.writeNotebook(written);
    restored.push(summaryOf(written, plan.folder));
    progress.step();
  }
  progress.finish();
  return { restored, unchanged, folders };
}
