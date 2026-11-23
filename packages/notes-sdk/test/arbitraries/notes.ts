import fc from "fast-check";
import type { NotesBackupManifest } from "../../src/core/format/documents.js";
import {
  NOTES_AUDIO_TYPES,
  NOTES_IMAGE_TYPES,
  NOTES_PDF_TYPE,
} from "../../src/core/format/items.js";
import { MAX_TIME } from "../../src/core/format/read.js";
import type {
  NotesAssetReference,
  NotesAudioAnchor,
  NotesColor,
  NotesImage,
  NotesItem,
  NotesLink,
  NotesStroke,
  NotesText,
} from "../../src/core/model/items.js";
import type {
  NotesFolder,
  NotesLibraryIndex,
  NotesNotebookSummary,
} from "../../src/core/model/library.js";
import type {
  NotesCover,
  NotesNotebook,
  NotesOutlineEntry,
  NotesPage,
  NotesPageInfo,
  NotesRecording,
  NotesTemplate,
} from "../../src/core/model/notebook.js";
import {
  NOTES_MAX_PAGE_SIDE,
  NOTES_MIN_PAGE_SIDE,
  NOTES_PAGE_MARGIN,
  NOTES_PRESSURE_MAX,
  NOTES_STROKE_SIZE_RANGE,
  NOTES_TEXT_SIZE_RANGE,
} from "../../src/core/model/portable.js";
import {
  applyNotesCommand,
  type NotesCommand,
  type NotesDocumentState,
} from "../../src/core/operations/commands.js";

/**
 * The notes model's property-test generators (sdk-core ADR 0045): valid
 * items, pages, notebooks and library indexes, valid commands for a given
 * state, states reached by applying them, and mutated values. The
 * conformance vectors' generator reuses them.
 */

/**
 * `fc.record`, with plain objects only. By default it also makes objects
 * with no prototype, which the model accepts but strict equality tells
 * apart from the objects a reader returns.
 */
const record: typeof fc.record = ((model: never, constraints?: object) =>
  fc.record(model, { ...constraints, noNullPrototype: true } as never)) as typeof fc.record;

/** Names of `Object.prototype`'s properties, which are ordinary ids, names and text here. */
export const HOSTILE_NAMES = ["__proto__", "constructor", "toString"] as const;

/** Ids, including ones named after `Object.prototype`'s properties. */
export const notesId: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(...HOSTILE_NAMES) },
  { weight: 6, arbitrary: fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/) },
);

/** An id that isn't one of `taken`. */
const freshId = (taken: ReadonlySet<string>): fc.Arbitrary<string> =>
  notesId.filter((id) => !taken.has(id));

/** Text of whole code points, with characters outside the BMP, and never a lone surrogate. */
const textOf = (maxLength: number): fc.Arbitrary<string> =>
  fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom(...HOSTILE_NAMES, "") },
    { weight: 6, arbitrary: fc.string({ unit: "binary", maxLength }) },
  );

const title = textOf(12);
const time = fc.oneof(fc.integer({ min: 0, max: 2_000_000_000_000 }), fc.constantFrom(0, MAX_TIME));
const timeOrNull = fc.option(time, { nil: null });
const duration = fc.integer({ min: 0, max: 7_200_000 });

const color: fc.Arbitrary<NotesColor> = fc
  .integer({ min: 0, max: 0xff_ff_ff })
  .map((value): NotesColor => `#${value.toString(16).padStart(6, "0")}`);

/** A position on or near an A4 page, and now and then at the far ends of the range. */
const position = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: -1_000, max: 90_000 }) },
  { weight: 1, arbitrary: fc.constantFrom(-NOTES_PAGE_MARGIN, 0, 2 * NOTES_PAGE_MARGIN) },
);
const length = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: 1, max: 60_000 }) },
  { weight: 1, arbitrary: fc.constantFrom(1, 2 * NOTES_PAGE_MARGIN) },
);
const pressure = fc.integer({ min: 0, max: NOTES_PRESSURE_MAX });

const template: fc.Arbitrary<NotesTemplate> = fc.constantFrom("blank", "lined", "grid", "dotted");
const cover: fc.Arbitrary<NotesCover> = fc.constantFrom("blue", "green", "amber", "red", "gray");

const assetName = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map(
    (bytes) => `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
  );

const assetReference = (mediaTypes: readonly string[]): fc.Arbitrary<NotesAssetReference> =>
  record({
    asset: assetName,
    mediaType: fc.constantFrom(...mediaTypes),
    size: fc.oneof(fc.nat(), fc.constantFrom(0, Number.MAX_SAFE_INTEGER)),
  });

const audioAnchor: fc.Arbitrary<NotesAudioAnchor> = record({ recording: notesId, at: duration });

/** A stroke of one to five points. */
export const strokeItem: fc.Arbitrary<NotesStroke> = record(
  {
    id: notesId,
    type: fc.constant("stroke" as const),
    tool: fc.constantFrom("pen" as const, "highlighter" as const),
    color,
    size: fc.integer({ min: NOTES_STROKE_SIZE_RANGE[0], max: NOTES_STROKE_SIZE_RANGE[1] }),
    points: fc
      .array(fc.tuple(position, position, pressure), { minLength: 1, maxLength: 5 })
      .map((triples) => triples.flat()),
    uniform: fc.constant(true as const),
    audio: audioAnchor,
  },
  { requiredKeys: ["id", "type", "tool", "color", "size", "points"] },
);

/** A box of text. */
export const textItem: fc.Arbitrary<NotesText> = record(
  {
    id: notesId,
    type: fc.constant("text" as const),
    x: position,
    y: position,
    width: length,
    text: textOf(24),
    size: fc.integer({ min: NOTES_TEXT_SIZE_RANGE[0], max: NOTES_TEXT_SIZE_RANGE[1] }),
    color,
    audio: audioAnchor,
  },
  { requiredKeys: ["id", "type", "x", "y", "width", "text", "size", "color"] },
);

/** A picture. */
export const imageItem: fc.Arbitrary<NotesImage> = record({
  id: notesId,
  type: fc.constant("image" as const),
  x: position,
  y: position,
  width: length,
  height: length,
  image: assetReference(NOTES_IMAGE_TYPES),
});

/** A link to one of `pages`, or to any id when none is given. */
export const linkItem = (pages: readonly string[] = []): fc.Arbitrary<NotesLink> =>
  record({
    id: notesId,
    type: fc.constant("link" as const),
    x: position,
    y: position,
    width: length,
    height: length,
    page: pages.length > 0 ? fc.constantFrom(...pages) : notesId,
  });

/** A valid item of a given kind. Its links lead to one of `pages`, when given. */
const itemOfType = (type: NotesItem["type"], pages: readonly string[]): fc.Arbitrary<NotesItem> => {
  switch (type) {
    case "stroke":
      return strokeItem;
    case "text":
      return textItem;
    case "image":
      return imageItem;
    case "link":
      return linkItem(pages);
  }
};

/** Any valid item. Its links lead to one of `pages`, when given. */
export const item = (pages: readonly string[] = []): fc.Arbitrary<NotesItem> =>
  fc.oneof(
    { weight: 3, arbitrary: strokeItem },
    { weight: 2, arbitrary: textItem },
    { weight: 1, arbitrary: imageItem },
    { weight: 1, arbitrary: linkItem(pages) },
  );

/** Items with distinct ids, none of them in `taken`. */
const items = (
  pages: readonly string[],
  constraints: { readonly minLength?: number; readonly maxLength?: number } = {},
  taken: ReadonlySet<string> = new Set(),
): fc.Arbitrary<NotesItem[]> =>
  fc.uniqueArray(
    item(pages).filter((entry) => !taken.has(entry.id)),
    { maxLength: 4, ...constraints, selector: (entry) => entry.id },
  );

/** A page's contents: items with distinct ids. */
export const page: fc.Arbitrary<NotesPage> = record({ id: notesId, items: items([]) });

const pageSide = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: NOTES_MIN_PAGE_SIDE, max: 120_000 }) },
  { weight: 1, arbitrary: fc.constantFrom(NOTES_MIN_PAGE_SIDE, NOTES_MAX_PAGE_SIDE) },
);

const pageInfo = (id: string): fc.Arbitrary<NotesPageInfo> =>
  record(
    {
      id: fc.constant(id),
      width: pageSide,
      height: pageSide,
      template,
      background: record({
        pdf: assetReference([NOTES_PDF_TYPE]),
        pageIndex: fc.integer({ min: 0, max: 1_000_000 }),
      }),
    },
    { requiredKeys: ["id", "width", "height", "template"] },
  );

/** An outline with distinct ids, whose entries lead to `pages`. */
const outlineOf = (pages: readonly string[]): fc.Arbitrary<NotesOutlineEntry[]> =>
  fc.uniqueArray(record({ id: notesId, title, page: fc.constantFrom(...pages) }), {
    maxLength: 4,
    selector: (entry) => entry.id,
  });

const recordings: fc.Arbitrary<NotesRecording[]> = fc.uniqueArray(
  record({
    id: notesId,
    audio: assetReference(NOTES_AUDIO_TYPES),
    startedAt: time,
    duration,
  }),
  { maxLength: 3, selector: (entry) => entry.id },
);

/** A notebook of one to four pages, with distinct ids and an outline that leads to its pages. */
export const notebook: fc.Arbitrary<NotesNotebook> = fc
  .uniqueArray(notesId, { minLength: 1, maxLength: 4 })
  .chain((pages) =>
    record({
      id: notesId,
      title,
      cover,
      createdAt: time,
      updatedAt: time,
      pages: fc.tuple(...pages.map(pageInfo)),
      outline: outlineOf(pages),
      recordings,
    }),
  );

/** Folders with distinct ids, each at the top or inside an earlier one, in any order. */
const folders: fc.Arbitrary<NotesFolder[]> = fc
  .uniqueArray(notesId, { maxLength: 5 })
  .chain((ids) =>
    fc.tuple(
      ...ids.map((id, index) =>
        record({
          id: fc.constant(id),
          name: title,
          parent:
            index === 0
              ? fc.constant(null)
              : fc.option(fc.constantFrom(...ids.slice(0, index)), { nil: null }),
          createdAt: time,
        }),
      ),
    ),
  )
  .chain((list) => fc.shuffledSubarray(list, { minLength: list.length }));

const folderOf = (list: readonly NotesFolder[]): fc.Arbitrary<string | null> =>
  list.length === 0
    ? fc.constant(null)
    : fc.option(fc.constantFrom(...list.map((folder) => folder.id)), { nil: null });

const summary = (list: readonly NotesFolder[]): fc.Arbitrary<NotesNotebookSummary> =>
  record({
    id: notesId,
    title,
    cover,
    template,
    folder: folderOf(list),
    pageCount: fc.integer({ min: 1, max: 100_000 }),
    createdAt: time,
    updatedAt: time,
    deletedAt: timeOrNull,
  });

/** A library index: folders that never contain themselves, and notebooks in them. */
export const library: fc.Arbitrary<NotesLibraryIndex> = folders.chain((list) =>
  record({
    folders: fc.constant(list),
    notebooks: fc.uniqueArray(summary(list), { maxLength: 4, selector: (entry) => entry.id }),
    lastBackupAt: timeOrNull,
    lastChangeAt: timeOrNull,
  }),
);

/** A backup's manifest. */
export const backupManifest: fc.Arbitrary<NotesBackupManifest> = folders.chain((list) =>
  record({
    format: fc.constant("hm-notes-backup" as const),
    version: fc.constant(1 as const),
    createdAt: time,
    scope: fc.constantFrom("library" as const, "notebooks" as const),
    folders: fc.constant(list),
    notebooks: fc.uniqueArray(record({ id: notesId, folder: folderOf(list) }), {
      maxLength: 4,
      selector: (entry) => entry.id,
    }),
  }),
);

/** A notebook with every page loaded. Links lead to its pages. */
export const state: fc.Arbitrary<NotesDocumentState> = notebook.chain((value) => {
  const ids = value.pages.map((info) => info.id);
  return fc.tuple(...ids.map(() => items(ids, { maxLength: 3 }))).map((contents) => ({
    notebook: value,
    pages: new Map(ids.map((id, index) => [id, { id, items: contents[index] ?? [] }])),
  }));
});

/** `count` ascending indexes at which new entries fit, one after another, into a list of `size`. */
const ascendingIndexes = (size: number, count: number): fc.Arbitrary<number[]> =>
  fc
    .uniqueArray(fc.nat(size + count - 1), { minLength: count, maxLength: count })
    .map((indexes) => indexes.sort((a, b) => a - b));

/** New pages with their contents, none with an id of `taken`. Links lead to `known` or the new pages. */
const newPages = (
  known: readonly string[],
): fc.Arbitrary<{ info: NotesPageInfo; items: NotesItem[] }[]> =>
  fc
    .uniqueArray(freshId(new Set(known)), { minLength: 1, maxLength: 2 })
    .chain((ids) =>
      fc.tuple(
        ...ids.map((id) =>
          record({ info: pageInfo(id), items: items([...known, ...ids], { maxLength: 2 }) }),
        ),
      ),
    );

/** Any valid command for the state, which must have every page loaded. */
export function commandFor(current: NotesDocumentState): fc.Arbitrary<NotesCommand> {
  const { notebook: book } = current;
  const pageIds = book.pages.map((info) => info.id);
  const anyPage = fc.constantFrom(...pageIds);
  const contents = (id: string): readonly NotesItem[] => current.pages.get(id)?.items ?? [];
  const idsOn = (id: string): Set<string> => new Set(contents(id).map((entry) => entry.id));

  const commands: fc.Arbitrary<NotesCommand>[] = [
    anyPage.chain((id) =>
      record(
        {
          type: fc.constant("notes.addItems" as const),
          page: fc.constant(id),
          items: items(pageIds, { minLength: 1, maxLength: 3 }, idsOn(id)),
          index: fc.nat(contents(id).length),
        },
        { requiredKeys: ["type", "page", "items"] },
      ),
    ),
    anyPage.chain((id) =>
      fc.integer({ min: 1, max: 3 }).chain((count) =>
        record({
          type: fc.constant("notes.restoreItems" as const),
          page: fc.constant(id),
          entries: fc
            .tuple(
              ascendingIndexes(contents(id).length, count),
              items(pageIds, { minLength: count, maxLength: count }, idsOn(id)),
            )
            .map(([indexes, added]) =>
              added.map((entry, at) => ({ index: indexes[at] ?? 0, item: entry })),
            ),
        }),
      ),
    ),
    fc
      .tuple(fc.nat(pageIds.length), newPages(pageIds))
      .map(([at, pages]) => ({ type: "notes.addPages" as const, at, pages })),
    newPages(pageIds).chain((pages) => {
      const added = pages.map((entry) => entry.info.id);
      const taken = new Set(book.outline.map((entry) => entry.id));
      const extra = fc.uniqueArray(
        record({ id: freshId(taken), title, page: fc.constantFrom(...added) }),
        { maxLength: 2, selector: (entry) => entry.id },
      );
      return fc
        .tuple(
          ascendingIndexes(pageIds.length, pages.length),
          extra,
          fc.array(fc.nat(book.outline.length), { minLength: 2, maxLength: 2 }),
        )
        .map(([indexes, entries, places]) => {
          // The notebook's own outline, in order, with the new pages' entries among it.
          const outline = [...book.outline];
          entries.forEach((entry, at) => {
            outline.splice(Math.min(places[at] ?? 0, outline.length), 0, entry);
          });
          return {
            type: "notes.restorePages" as const,
            entries: pages.map((entry, at) => ({ index: indexes[at] ?? 0, ...entry })),
            outline,
          };
        });
    }),
    fc
      .shuffledSubarray(pageIds, { minLength: pageIds.length })
      .map((order) => ({ type: "notes.reorderPages" as const, order })),
    fc
      .subarray(pageIds, { minLength: 1 })
      .chain((chosen) =>
        fc.tuple(...chosen.map((id) => record({ page: fc.constant(id), template }))),
      )
      .map((templates) => ({ type: "notes.setTemplates" as const, templates })),
    outlineOf(pageIds).map((outline) => ({ type: "notes.setOutline" as const, outline })),
    title.map((value) => ({ type: "notes.rename" as const, title: value })),
    recordings.map((value) => ({ type: "notes.setRecordings" as const, recordings: value })),
  ];

  const withItems = pageIds.filter((id) => contents(id).length > 0);
  if (withItems.length > 0) {
    const onPage = fc.constantFrom(...withItems);
    commands.push(
      onPage.chain((id) =>
        fc
          .shuffledSubarray([...idsOn(id)], { minLength: 1 })
          .map((ids) => ({ type: "notes.removeItems" as const, page: id, ids })),
      ),
      onPage.chain((id) =>
        fc
          .shuffledSubarray([...contents(id)], { minLength: 1 })
          .chain((chosen) =>
            fc.tuple(
              ...chosen.map((existing) =>
                itemOfType(existing.type, pageIds).map((next) => ({ ...next, id: existing.id })),
              ),
            ),
          )
          .map((replacements) => ({
            type: "notes.replaceItems" as const,
            page: id,
            items: replacements,
          })),
      ),
    );
  }
  if (pageIds.length > 1) {
    commands.push(
      fc
        .shuffledSubarray(pageIds, { minLength: 1, maxLength: pageIds.length - 1 })
        .map((pages) => ({ type: "notes.removePages" as const, pages })),
    );
  }
  return fc.oneof(...commands);
}

/** A start state, valid commands applied one after another, and the state they reach. */
export interface NotesSteps {
  readonly start: NotesDocumentState;
  readonly commands: readonly NotesCommand[];
  readonly state: NotesDocumentState;
}

/** A sequence of up to `maxLength` valid commands, each for the state before it. */
export const steps = (maxLength: number): fc.Arbitrary<NotesSteps> =>
  fc.tuple(state, fc.integer({ min: 0, max: maxLength })).chain(([start, count]) => {
    let built: fc.Arbitrary<NotesSteps> = fc.constant({ start, commands: [], state: start });
    for (let index = 0; index < count; index += 1) {
      built = built.chain((so) =>
        commandFor(so.state).map((command) => ({
          start,
          commands: [...so.commands, command],
          state: applyNotesCommand(so.state, command).state,
        })),
      );
    }
    return built;
  });

/** A state and one valid command for it. */
export const stateAndCommand: fc.Arbitrary<readonly [NotesDocumentState, NotesCommand]> = steps(
  2,
).chain((so) => commandFor(so.state).map((command) => [so.state, command] as const));

/** Values a mutation puts in place of a field: any JSON, and the ones readers get wrong. */
const replacement: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 4, arbitrary: fc.jsonValue({ maxDepth: 2 }) },
  {
    weight: 3,
    arbitrary: fc.constantFrom<unknown>(
      -0,
      -1,
      0.5,
      1,
      1_001,
      2 ** 53,
      1e300,
      null,
      true,
      "",
      "\uD800",
      "a\uDC00",
      "#FFFFFF",
      ...HOSTILE_NAMES,
    ),
  },
);

const fieldName = fc.oneof(
  fc.string(),
  fc.constantFrom(...HOSTILE_NAMES, "format", "version", "id"),
);

/** Every object and list inside a JSON value, the value itself first. */
function containers(value: unknown, found: object[] = []): object[] {
  if (typeof value !== "object" || value === null) return found;
  found.push(value);
  for (const inner of Object.values(value)) containers(inner, found);
  return found;
}

/** Values near a number or a text: just past a bound, off the grid, or in another case. */
function near(value: unknown, which: number): unknown {
  if (typeof value === "number") {
    const options = [value + 1, value - 1, -value, value * 2, value + 0.5, 0, -0, 1_000, 1_001];
    return options[which % options.length];
  }
  if (typeof value === "string") {
    const options = [`${value}a`, value.slice(0, -1), value.toUpperCase(), `${value}\uD800`, ""];
    return options[which % options.length];
  }
  return value === null ? 0 : null;
}

/**
 * A JSON copy of a value with one change, anywhere inside it: a field or a
 * list's entry replaced by any value or by one near it, a field added, or a
 * list made one longer. A field is added as an own property even when it's
 * named `__proto__`, as `JSON.parse` makes it. Assigning
 * `copy.__proto__ = value` would set the prototype instead, and test nothing
 * (sdk-core ADR 0045, section 8).
 */
export const mutated = (value: fc.Arbitrary<unknown>): fc.Arbitrary<unknown> =>
  fc
    .tuple(
      value,
      fc.nat(),
      fc.nat(),
      fieldName,
      replacement,
      fc.constantFrom("replace" as const, "add" as const, "nudge" as const, "nudge" as const),
      fc.nat(),
    )
    .map(([original, where, which, name, changed, mode, variant]) => {
      const copy: unknown = JSON.parse(JSON.stringify(original));
      const all = containers(copy);
      const target = all[where % Math.max(1, all.length)];
      if (target === undefined) return changed;
      const add = mode === "add";
      const next = (current: unknown) => (mode === "nudge" ? near(current, variant) : changed);
      if (Array.isArray(target)) {
        if (add || target.length === 0) target.push(changed);
        else target[which % target.length] = next(target[which % target.length]);
        return copy;
      }
      const names = Object.keys(target);
      const field = add || names.length === 0 ? name : (names[which % names.length] as string);
      Object.defineProperty(target, field, {
        value: add ? changed : next((target as Record<string, unknown>)[field]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      return copy;
    });
