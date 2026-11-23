import type { Applied } from "@hussmartinez/sdk-core";
import { invalidCommand, isNotesError, NotesError } from "../errors/notes-error.js";
import { readOutline, readPageInfo, readRecording } from "../format/documents.js";
import { readItem } from "../format/items.js";
import { fields, id, integer, list, oneOf, text } from "../format/read.js";
import type { NotesItem } from "../model/items.js";
import type {
  NotesNotebook,
  NotesOutlineEntry,
  NotesPage,
  NotesPageInfo,
  NotesRecording,
  NotesTemplate,
} from "../model/notebook.js";
import { NOTES_MAX_RECORDINGS, NOTES_MAX_TITLE_LENGTH } from "../model/portable.js";

/**
 * Every edit of a notebook is one of these commands (sdk-core ADR 0010,
 * docs/adr/0003): plain data, applied by {@link applyNotesCommand}, which
 * returns the new state and the command that undoes it.
 */

/**
 * Adds items to a page, on top of its others, or at `index` from the bottom.
 *
 * @public
 */
export interface NotesAddItemsCommand {
  readonly type: "notes.addItems";
  readonly page: string;
  readonly items: readonly NotesItem[];
  readonly index?: number;
}

/**
 * Removes items from a page.
 *
 * @public
 */
export interface NotesRemoveItemsCommand {
  readonly type: "notes.removeItems";
  readonly page: string;
  readonly ids: readonly string[];
}

/**
 * Puts removed items back where they were. It's the inverse of
 * {@link NotesRemoveItemsCommand}, written by the SDK.
 *
 * @public
 */
export interface NotesRestoreItemsCommand {
  readonly type: "notes.restoreItems";
  readonly page: string;
  /** Each item with the index it returns to, in ascending order. */
  readonly entries: readonly { readonly index: number; readonly item: NotesItem }[];
}

/**
 * Replaces items by others with the same ids, each in its place: a move, a
 * resize, a new colour or new text.
 *
 * @public
 */
export interface NotesReplaceItemsCommand {
  readonly type: "notes.replaceItems";
  readonly page: string;
  readonly items: readonly NotesItem[];
}

/**
 * Adds pages, with their contents, at a position.
 *
 * @public
 */
export interface NotesAddPagesCommand {
  readonly type: "notes.addPages";
  /** The index of the first new page. */
  readonly at: number;
  readonly pages: readonly { readonly info: NotesPageInfo; readonly items: readonly NotesItem[] }[];
}

/**
 * Removes pages. A notebook keeps at least one. Outline entries that led to
 * them go too, and undo brings both back.
 *
 * @public
 */
export interface NotesRemovePagesCommand {
  readonly type: "notes.removePages";
  readonly pages: readonly string[];
}

/**
 * Puts removed pages back where they were, with the outline as it was. It's
 * the inverse of {@link NotesRemovePagesCommand}, written by the SDK.
 *
 * @public
 */
export interface NotesRestorePagesCommand {
  readonly type: "notes.restorePages";
  /** Each page with the index it returns to, in ascending order. */
  readonly entries: readonly {
    readonly index: number;
    readonly info: NotesPageInfo;
    readonly items: readonly NotesItem[];
  }[];
  readonly outline: readonly NotesOutlineEntry[];
}

/**
 * Puts the pages in a new order: every page's id, once.
 *
 * @public
 */
export interface NotesReorderPagesCommand {
  readonly type: "notes.reorderPages";
  readonly order: readonly string[];
}

/**
 * Changes the paper of pages.
 *
 * @public
 */
export interface NotesSetTemplatesCommand {
  readonly type: "notes.setTemplates";
  readonly templates: readonly { readonly page: string; readonly template: NotesTemplate }[];
}

/**
 * Replaces the notebook's outline.
 *
 * @public
 */
export interface NotesSetOutlineCommand {
  readonly type: "notes.setOutline";
  readonly outline: readonly NotesOutlineEntry[];
}

/**
 * Renames the notebook.
 *
 * @public
 */
export interface NotesRenameCommand {
  readonly type: "notes.rename";
  readonly title: string;
}

/**
 * Replaces the notebook's list of recordings: one more after recording, one
 * fewer after deleting one.
 *
 * @public
 */
export interface NotesSetRecordingsCommand {
  readonly type: "notes.setRecordings";
  readonly recordings: readonly NotesRecording[];
}

/**
 * An edit of a notebook.
 *
 * @public
 */
export type NotesCommand =
  | NotesAddItemsCommand
  | NotesRemoveItemsCommand
  | NotesRestoreItemsCommand
  | NotesReplaceItemsCommand
  | NotesAddPagesCommand
  | NotesRemovePagesCommand
  | NotesRestorePagesCommand
  | NotesReorderPagesCommand
  | NotesSetTemplatesCommand
  | NotesSetOutlineCommand
  | NotesRenameCommand
  | NotesSetRecordingsCommand;

/**
 * What commands change: a notebook, and the contents of the pages that are
 * loaded. A command on a page that isn't loaded is refused with
 * `page-not-loaded`.
 *
 * @public
 */
export interface NotesDocumentState {
  readonly notebook: NotesNotebook;
  readonly pages: ReadonlyMap<string, NotesPage>;
}

/**
 * The limits a command is checked against: the most pages a notebook holds,
 * and the most items a page holds.
 *
 * @public
 */
export interface NotesCommandLimits {
  readonly maxPages: number;
  readonly maxPageItems: number;
}

const NO_LIMITS: NotesCommandLimits = {
  maxPages: Number.POSITIVE_INFINITY,
  maxPageItems: Number.POSITIVE_INFINITY,
};

function loaded(state: NotesDocumentState, page: string): NotesPage {
  if (!state.notebook.pages.some((info) => info.id === page)) {
    throw invalidCommand("unknown-page", `The notebook has no page ${page}.`);
  }
  const contents = state.pages.get(page);
  if (!contents) throw invalidCommand("page-not-loaded", `The page ${page} isn't loaded.`);
  return contents;
}

function withPage(state: NotesDocumentState, page: NotesPage): NotesDocumentState {
  const pages = new Map(state.pages);
  pages.set(page.id, page);
  return { notebook: state.notebook, pages };
}

function withNotebook(state: NotesDocumentState, notebook: NotesNotebook): NotesDocumentState {
  return { notebook, pages: state.pages };
}

function tooMany(limit: "maxPages" | "maxPageItems", maximum: number, actual: number): NotesError {
  const pages = limit === "maxPages";
  return new NotesError(pages ? "TOO_MANY_PAGES" : "TOO_MANY_ITEMS", `Over the ${limit} limit.`, {
    details: { limit, maximum, actual, unit: "count" },
  });
}

/**
 * Refuses a new link to a page the notebook doesn't have. Only the commands
 * that bring new items check it. Removing a page leaves the links that led
 * to it, so the commands that are inverses, which put items back as they
 * were, must take such a link.
 */
function checkReferences(state: NotesDocumentState, items: readonly NotesItem[]): void {
  for (const item of items) {
    if (item.type === "link" && !state.notebook.pages.some((page) => page.id === item.page)) {
      throw invalidCommand("unknown-page", `A link leads to ${item.page}, which isn't a page.`);
    }
  }
}

function addItems(
  state: NotesDocumentState,
  command: NotesAddItemsCommand,
  limits: NotesCommandLimits,
): Applied<NotesDocumentState, NotesCommand> {
  const page = loaded(state, command.page);
  if (command.items.length === 0) throw invalidCommand("malformed-command", "No items to add.");
  const index = command.index ?? page.items.length;
  if (!Number.isInteger(index) || index < 0 || index > page.items.length) {
    throw invalidCommand("invalid-index", `There's no index ${index} on the page.`);
  }
  const ids = new Set(page.items.map((item) => item.id));
  for (const item of command.items) {
    if (ids.has(item.id)) throw invalidCommand("duplicate-id", `The item ${item.id} exists.`);
    ids.add(item.id);
  }
  if (ids.size > limits.maxPageItems) throw tooMany("maxPageItems", limits.maxPageItems, ids.size);
  checkReferences(state, command.items);
  const items = [...page.items.slice(0, index), ...command.items, ...page.items.slice(index)];
  return {
    state: withPage(state, { id: page.id, items }),
    inverse: {
      type: "notes.removeItems",
      page: page.id,
      ids: command.items.map((item) => item.id),
    },
  };
}

function removeItems(
  state: NotesDocumentState,
  command: NotesRemoveItemsCommand,
): Applied<NotesDocumentState, NotesCommand> {
  const page = loaded(state, command.page);
  const ids = new Set(command.ids);
  if (ids.size === 0 || ids.size !== command.ids.length) {
    throw invalidCommand("malformed-command", "The ids to remove must be distinct, and not none.");
  }
  const entries: { index: number; item: NotesItem }[] = [];
  const items: NotesItem[] = [];
  page.items.forEach((item, index) => {
    if (ids.has(item.id)) entries.push({ index, item });
    else items.push(item);
  });
  if (entries.length !== ids.size) {
    throw invalidCommand("unknown-item", "An item to remove isn't on the page.");
  }
  return {
    state: withPage(state, { id: page.id, items }),
    inverse: { type: "notes.restoreItems", page: page.id, entries },
  };
}

function restoreItems(
  state: NotesDocumentState,
  command: NotesRestoreItemsCommand,
  limits: NotesCommandLimits,
): Applied<NotesDocumentState, NotesCommand> {
  const page = loaded(state, command.page);
  if (command.entries.length === 0)
    throw invalidCommand("malformed-command", "Nothing to restore.");
  const items = [...page.items];
  const ids = new Set(items.map((item) => item.id));
  let previous = -1;
  for (const { index, item } of command.entries) {
    if (!Number.isInteger(index) || index <= previous || index > items.length) {
      throw invalidCommand("invalid-index", `An item can't return to index ${index}.`);
    }
    if (ids.has(item.id)) throw invalidCommand("duplicate-id", `The item ${item.id} exists.`);
    ids.add(item.id);
    items.splice(index, 0, item);
    previous = index;
  }
  if (items.length > limits.maxPageItems) {
    throw tooMany("maxPageItems", limits.maxPageItems, items.length);
  }
  return {
    state: withPage(state, { id: page.id, items }),
    inverse: {
      type: "notes.removeItems",
      page: page.id,
      ids: command.entries.map((entry) => entry.item.id),
    },
  };
}

function replaceItems(
  state: NotesDocumentState,
  command: NotesReplaceItemsCommand,
): Applied<NotesDocumentState, NotesCommand> {
  const page = loaded(state, command.page);
  const next = new Map(command.items.map((item) => [item.id, item]));
  if (next.size === 0 || next.size !== command.items.length) {
    throw invalidCommand(
      "malformed-command",
      "The items to replace must be distinct, and not none.",
    );
  }
  const before: NotesItem[] = [];
  const items = page.items.map((item) => {
    const replacement = next.get(item.id);
    if (!replacement) return item;
    if (replacement.type !== item.type) {
      throw invalidCommand("malformed-command", "An item can't become one of another kind.");
    }
    before.push(item);
    return replacement;
  });
  if (before.length !== next.size) {
    throw invalidCommand("unknown-item", "An item to replace isn't on the page.");
  }
  return {
    state: withPage(state, { id: page.id, items }),
    inverse: { type: "notes.replaceItems", page: page.id, items: before },
  };
}

function addPages(
  state: NotesDocumentState,
  command: NotesAddPagesCommand,
  limits: NotesCommandLimits,
): Applied<NotesDocumentState, NotesCommand> {
  const { notebook } = state;
  if (command.pages.length === 0) throw invalidCommand("malformed-command", "No pages to add.");
  if (!Number.isInteger(command.at) || command.at < 0 || command.at > notebook.pages.length) {
    throw invalidCommand("invalid-index", `There's no position ${command.at} in the notebook.`);
  }
  const ids = new Set(notebook.pages.map((page) => page.id));
  for (const { info, items } of command.pages) {
    if (ids.has(info.id)) throw invalidCommand("duplicate-page", `The page ${info.id} exists.`);
    ids.add(info.id);
    if (items.length > limits.maxPageItems) {
      throw tooMany("maxPageItems", limits.maxPageItems, items.length);
    }
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw invalidCommand("duplicate-id", `Two items of the page ${info.id} share an id.`);
    }
  }
  if (ids.size > limits.maxPages) throw tooMany("maxPages", limits.maxPages, ids.size);
  const pages = new Map(state.pages);
  for (const { info, items } of command.pages) pages.set(info.id, { id: info.id, items });
  const next: NotesDocumentState = {
    notebook: {
      ...notebook,
      pages: [
        ...notebook.pages.slice(0, command.at),
        ...command.pages.map((page) => page.info),
        ...notebook.pages.slice(command.at),
      ],
    },
    pages,
  };
  for (const { items } of command.pages) checkReferences(next, items);
  return {
    state: next,
    inverse: { type: "notes.removePages", pages: command.pages.map((page) => page.info.id) },
  };
}

function removePages(
  state: NotesDocumentState,
  command: NotesRemovePagesCommand,
): Applied<NotesDocumentState, NotesCommand> {
  const { notebook } = state;
  const ids = new Set(command.pages);
  if (ids.size === 0 || ids.size !== command.pages.length) {
    throw invalidCommand(
      "malformed-command",
      "The pages to remove must be distinct, and not none.",
    );
  }
  const entries: { index: number; info: NotesPageInfo; items: readonly NotesItem[] }[] = [];
  const kept: NotesPageInfo[] = [];
  notebook.pages.forEach((info, index) => {
    if (!ids.has(info.id)) {
      kept.push(info);
      return;
    }
    entries.push({ index, info, items: loaded(state, info.id).items });
  });
  if (entries.length !== ids.size) {
    throw invalidCommand("unknown-page", "A page to remove isn't in the notebook.");
  }
  if (kept.length === 0) throw invalidCommand("last-page", "A notebook keeps at least one page.");
  const pages = new Map(state.pages);
  for (const page of ids) pages.delete(page);
  return {
    state: {
      notebook: {
        ...notebook,
        pages: kept,
        outline: notebook.outline.filter((entry) => !ids.has(entry.page)),
      },
      pages,
    },
    inverse: { type: "notes.restorePages", entries, outline: notebook.outline },
  };
}

function restorePages(
  state: NotesDocumentState,
  command: NotesRestorePagesCommand,
  limits: NotesCommandLimits,
): Applied<NotesDocumentState, NotesCommand> {
  const { notebook } = state;
  if (command.entries.length === 0)
    throw invalidCommand("malformed-command", "Nothing to restore.");
  const order = [...notebook.pages];
  const ids = new Set(order.map((page) => page.id));
  const pages = new Map(state.pages);
  let previous = -1;
  for (const { index, info, items } of command.entries) {
    if (!Number.isInteger(index) || index <= previous || index > order.length) {
      throw invalidCommand("invalid-index", `A page can't return to position ${index}.`);
    }
    if (ids.has(info.id)) throw invalidCommand("duplicate-page", `The page ${info.id} exists.`);
    ids.add(info.id);
    if (items.length > limits.maxPageItems) {
      throw tooMany("maxPageItems", limits.maxPageItems, items.length);
    }
    if (new Set(items.map((item) => item.id)).size !== items.length) {
      throw invalidCommand("duplicate-id", `Two items of the page ${info.id} share an id.`);
    }
    order.splice(index, 0, info);
    pages.set(info.id, { id: info.id, items });
    previous = index;
  }
  if (order.length > limits.maxPages) throw tooMany("maxPages", limits.maxPages, order.length);
  for (const entry of command.outline) {
    if (!ids.has(entry.page)) {
      throw invalidCommand("unknown-page", "The outline leads to a page that isn't there.");
    }
  }
  // The inverse removes these pages with their entries, so the other entries
  // must be the outline as it is. Anything else couldn't be undone.
  const restored = new Set(command.entries.map((entry) => entry.info.id));
  const kept = command.outline.filter((entry) => !restored.has(entry.page));
  const unchanged =
    kept.length === notebook.outline.length &&
    notebook.outline.every((entry, index) => {
      const other = kept[index];
      return other?.id === entry.id && other.title === entry.title && other.page === entry.page;
    });
  if (!unchanged) {
    throw invalidCommand(
      "malformed-command",
      "The outline must be the notebook's own, with entries for the pages restored.",
    );
  }
  return {
    state: { notebook: { ...notebook, pages: order, outline: command.outline }, pages },
    inverse: { type: "notes.removePages", pages: command.entries.map((entry) => entry.info.id) },
  };
}

function reorderPages(
  state: NotesDocumentState,
  command: NotesReorderPagesCommand,
): Applied<NotesDocumentState, NotesCommand> {
  const { notebook } = state;
  const byId = new Map(notebook.pages.map((page) => [page.id, page]));
  const order = new Set(command.order);
  if (
    order.size !== command.order.length ||
    order.size !== byId.size ||
    command.order.some((page) => !byId.has(page))
  ) {
    throw invalidCommand("invalid-order", "The order must name every page of the notebook once.");
  }
  return {
    state: withNotebook(state, {
      ...notebook,
      pages: command.order.map((page) => byId.get(page) as NotesPageInfo),
    }),
    inverse: { type: "notes.reorderPages", order: notebook.pages.map((page) => page.id) },
  };
}

function setTemplates(
  state: NotesDocumentState,
  command: NotesSetTemplatesCommand,
): Applied<NotesDocumentState, NotesCommand> {
  const { notebook } = state;
  const next = new Map(command.templates.map((entry) => [entry.page, entry.template]));
  if (next.size === 0 || next.size !== command.templates.length) {
    throw invalidCommand("malformed-command", "The pages must be distinct, and not none.");
  }
  const before: { page: string; template: NotesTemplate }[] = [];
  const pages = notebook.pages.map((page) => {
    const template = next.get(page.id);
    if (template === undefined) return page;
    before.push({ page: page.id, template: page.template });
    return { ...page, template };
  });
  if (before.length !== next.size) {
    throw invalidCommand("unknown-page", "A page to change isn't in the notebook.");
  }
  return {
    state: withNotebook(state, { ...notebook, pages }),
    inverse: { type: "notes.setTemplates", templates: before },
  };
}

function setOutline(
  state: NotesDocumentState,
  command: NotesSetOutlineCommand,
): Applied<NotesDocumentState, NotesCommand> {
  const { notebook } = state;
  const pages = new Set(notebook.pages.map((page) => page.id));
  const ids = new Set<string>();
  for (const entry of command.outline) {
    if (!pages.has(entry.page)) {
      throw invalidCommand("unknown-page", "The outline leads to a page that isn't there.");
    }
    if (ids.has(entry.id)) throw invalidCommand("duplicate-id", "Two outline entries share an id.");
    ids.add(entry.id);
  }
  return {
    state: withNotebook(state, { ...notebook, outline: command.outline }),
    inverse: { type: "notes.setOutline", outline: notebook.outline },
  };
}

function setRecordings(
  state: NotesDocumentState,
  command: NotesSetRecordingsCommand,
): Applied<NotesDocumentState, NotesCommand> {
  const { notebook } = state;
  if (new Set(command.recordings.map((entry) => entry.id)).size !== command.recordings.length) {
    throw invalidCommand("duplicate-id", "Two recordings share an id.");
  }
  return {
    state: withNotebook(state, { ...notebook, recordings: command.recordings }),
    inverse: { type: "notes.setRecordings", recordings: notebook.recordings },
  };
}

/**
 * Applies one command to a notebook, and returns the new state with the
 * command that undoes it. The state given is never changed. A command that
 * doesn't apply throws `INVALID_COMMAND`, with `details.reason`, or a limit's
 * own code, and changes nothing.
 *
 * Commands from an untrusted source go through
 * {@link readNotesCommandDocument} first: this function trusts their shape.
 *
 * @public
 */
export function applyNotesCommand(
  state: NotesDocumentState,
  command: NotesCommand,
  limits: NotesCommandLimits = NO_LIMITS,
): Applied<NotesDocumentState, NotesCommand> {
  switch (command.type) {
    case "notes.addItems":
      return addItems(state, command, limits);
    case "notes.removeItems":
      return removeItems(state, command);
    case "notes.restoreItems":
      return restoreItems(state, command, limits);
    case "notes.replaceItems":
      return replaceItems(state, command);
    case "notes.addPages":
      return addPages(state, command, limits);
    case "notes.removePages":
      return removePages(state, command);
    case "notes.restorePages":
      return restorePages(state, command, limits);
    case "notes.reorderPages":
      return reorderPages(state, command);
    case "notes.setTemplates":
      return setTemplates(state, command);
    case "notes.setOutline":
      return setOutline(state, command);
    case "notes.rename": {
      const title = command.title;
      return {
        state: withNotebook(state, { ...state.notebook, title }),
        inverse: { type: "notes.rename", title: state.notebook.title },
      };
    }
    case "notes.setRecordings":
      return setRecordings(state, command);
    default:
      throw invalidCommand("unknown-command", "The command's type isn't one the notebook knows.");
  }
}

/** What a command changes, so the session saves only that. */
export interface NotesCommandEffect {
  /** Whether the notebook's own document changed. */
  readonly notebook: boolean;
  /** The pages whose contents changed, and the pages that are gone. */
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

/** Which documents a command changes. */
export function commandEffect(command: NotesCommand): NotesCommandEffect {
  switch (command.type) {
    case "notes.addItems":
    case "notes.removeItems":
    case "notes.restoreItems":
    case "notes.replaceItems":
      return { notebook: false, changed: [command.page], removed: [] };
    case "notes.addPages":
      return { notebook: true, changed: command.pages.map((page) => page.info.id), removed: [] };
    case "notes.restorePages":
      return { notebook: true, changed: command.entries.map((page) => page.info.id), removed: [] };
    case "notes.removePages":
      return { notebook: true, changed: [], removed: command.pages };
    default:
      return { notebook: true, changed: [], removed: [] };
  }
}

/** Turns a reader's `INVALID_DOCUMENT` into the command's own `INVALID_COMMAND`. */
function asCommandError(error: unknown): unknown {
  if (!isNotesError(error, "INVALID_DOCUMENT")) return error;
  const reason = error.details?.["reason"];
  return new NotesError("INVALID_COMMAND", "The command is malformed.", {
    details: {
      reason:
        reason === "malformed-document" || typeof reason !== "string"
          ? "malformed-command"
          : reason,
    },
    cause: error,
  });
}

const TEMPLATES = ["blank", "lined", "grid", "dotted"] as const;
const MAX = 1_000_000;

const items = (value: unknown, at: string): NotesItem[] =>
  list(value, at, MAX).map((item, index) => readItem(item, `${at}[${index}]`));

const ids = (value: unknown, at: string): string[] =>
  list(value, at, MAX).map((item, index) => id(item, `${at}[${index}]`));

function read(value: unknown): NotesCommand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidCommand("malformed-command", "A command is an object.");
  }
  const type = Object.hasOwn(value, "type") ? (value as { type: unknown }).type : undefined;
  switch (type) {
    case "notes.addItems": {
      const entry = fields(value, "$", ["type", "page", "items"], ["index"]);
      return {
        type,
        page: id(entry["page"], "$.page"),
        items: items(entry["items"], "$.items"),
        ...(Object.hasOwn(entry, "index")
          ? { index: integer(entry["index"], "$.index", 0, MAX) }
          : {}),
      };
    }
    case "notes.removeItems": {
      const entry = fields(value, "$", ["type", "page", "ids"]);
      return { type, page: id(entry["page"], "$.page"), ids: ids(entry["ids"], "$.ids") };
    }
    case "notes.restoreItems": {
      const entry = fields(value, "$", ["type", "page", "entries"]);
      return {
        type,
        page: id(entry["page"], "$.page"),
        entries: list(entry["entries"], "$.entries", MAX).map((item, index) => {
          const at = `$.entries[${index}]`;
          const pair = fields(item, at, ["index", "item"]);
          return {
            index: integer(pair["index"], `${at}.index`, 0, MAX),
            item: readItem(pair["item"], `${at}.item`),
          };
        }),
      };
    }
    case "notes.replaceItems": {
      const entry = fields(value, "$", ["type", "page", "items"]);
      return { type, page: id(entry["page"], "$.page"), items: items(entry["items"], "$.items") };
    }
    case "notes.addPages": {
      const entry = fields(value, "$", ["type", "at", "pages"]);
      return {
        type,
        at: integer(entry["at"], "$.at", 0, MAX),
        pages: list(entry["pages"], "$.pages", MAX).map((item, index) => {
          const at = `$.pages[${index}]`;
          const pair = fields(item, at, ["info", "items"]);
          return {
            info: readPageInfo(pair["info"], `${at}.info`),
            items: items(pair["items"], `${at}.items`),
          };
        }),
      };
    }
    case "notes.removePages": {
      const entry = fields(value, "$", ["type", "pages"]);
      return { type, pages: ids(entry["pages"], "$.pages") };
    }
    case "notes.restorePages": {
      const entry = fields(value, "$", ["type", "entries", "outline"]);
      return {
        type,
        entries: list(entry["entries"], "$.entries", MAX).map((item, index) => {
          const at = `$.entries[${index}]`;
          const triple = fields(item, at, ["index", "info", "items"]);
          return {
            index: integer(triple["index"], `${at}.index`, 0, MAX),
            info: readPageInfo(triple["info"], `${at}.info`),
            items: items(triple["items"], `${at}.items`),
          };
        }),
        outline: readOutline(entry["outline"], "$.outline"),
      };
    }
    case "notes.reorderPages": {
      const entry = fields(value, "$", ["type", "order"]);
      return { type, order: ids(entry["order"], "$.order") };
    }
    case "notes.setTemplates": {
      const entry = fields(value, "$", ["type", "templates"]);
      return {
        type,
        templates: list(entry["templates"], "$.templates", MAX).map((item, index) => {
          const at = `$.templates[${index}]`;
          const pair = fields(item, at, ["page", "template"]);
          return {
            page: id(pair["page"], `${at}.page`),
            template: oneOf(pair["template"], `${at}.template`, TEMPLATES),
          };
        }),
      };
    }
    case "notes.setOutline": {
      const entry = fields(value, "$", ["type", "outline"]);
      return { type, outline: readOutline(entry["outline"], "$.outline") };
    }
    case "notes.rename": {
      const entry = fields(value, "$", ["type", "title"]);
      return {
        type,
        title: text(entry["title"], "$.title", NOTES_MAX_TITLE_LENGTH, "text-too-long"),
      };
    }
    case "notes.setRecordings": {
      const entry = fields(value, "$", ["type", "recordings"]);
      return {
        type,
        recordings: list(entry["recordings"], "$.recordings", NOTES_MAX_RECORDINGS).map(
          (item, index) => readRecording(item, `$.recordings[${index}]`),
        ),
      };
    }
    default:
      throw invalidCommand("unknown-command", "The command's type isn't one the notebook knows.");
  }
}

/**
 * Reads a command from untrusted JSON, strictly: an unknown field, a wrong
 * type or a value out of range throws `INVALID_COMMAND`, with
 * `details.reason`. A command is its own document: `JSON.stringify` writes it.
 *
 * @public
 */
export function readNotesCommandDocument(value: unknown): NotesCommand {
  try {
    return read(value);
  } catch (error) {
    throw asCommandError(error);
  }
}
