import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  state as anyState,
  commandFor,
  mutated,
  stateAndCommand,
  steps,
} from "../../../test/arbitraries/notes.js";
import { isNotesError } from "../errors/notes-error.js";
import {
  NOTES_DOCUMENT_MAX_ITEMS,
  NOTES_DOCUMENT_MAX_PAGES,
  readNotesNotebookDocument,
  readNotesPageDocument,
  toNotesNotebookDocument,
  toNotesPageDocument,
} from "../format/documents.js";
import type { NotesItem, NotesLink, NotesStroke } from "../model/items.js";
import type { NotesNotebook, NotesPageInfo } from "../model/notebook.js";
import {
  applyNotesCommand,
  commandEffect,
  type NotesCommand,
  type NotesDocumentState,
  readNotesCommandDocument,
} from "./commands.js";

/** A value as JSON carries it. */
const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** Freezes a JSON-like value all the way down, so any write to it throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** A copy of a state that throws on any change: frozen documents, and a map that can't be written. */
function frozen(state: NotesDocumentState): NotesDocumentState {
  const pages = new Map(structuredClone([...state.pages]));
  for (const page of pages.values()) deepFreeze(page);
  const refuse = (): never => {
    throw new TypeError("The state's pages were changed.");
  };
  Object.assign(pages, { set: refuse, delete: refuse, clear: refuse });
  return deepFreeze({ notebook: structuredClone(state.notebook), pages });
}

/** The rejection's code and reason, or `undefined` when the call returns. */
function refusal(run: () => unknown): { code: string; reason: unknown } | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (!isNotesError(error)) throw error;
    return { code: error.code, reason: error.details?.["reason"] };
  }
}

const info = (id: string): NotesPageInfo => ({
  id,
  width: 59_500,
  height: 84_200,
  template: "lined",
});
const stroke = (id: string): NotesStroke => ({
  id,
  type: "stroke",
  tool: "pen",
  color: "#1a1a1a",
  size: 200,
  points: [0, 0, 500, 100, 100, 500],
});
const link = (id: string, page: string): NotesLink => ({
  id,
  type: "link",
  x: 0,
  y: 0,
  width: 1_000,
  height: 1_000,
  page,
});

const NOTEBOOK: NotesNotebook = {
  id: "nb",
  title: "Field notes",
  cover: "blue",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  pages: [info("a"), info("b"), info("c")],
  outline: [
    { id: "o1", title: "First", page: "a" },
    { id: "o2", title: "Second", page: "b" },
  ],
  recordings: [],
};

/** Three pages, all loaded: `a` has a stroke and a link to `b`. */
const STATE: NotesDocumentState = {
  notebook: NOTEBOOK,
  pages: new Map<string, { id: string; items: NotesItem[] }>([
    ["a", { id: "a", items: [stroke("s1"), link("l1", "b")] }],
    ["b", { id: "b", items: [stroke("s1")] }],
    ["c", { id: "c", items: [] }],
  ]),
};

/** The codes a command is refused with. */
const REFUSALS = ["INVALID_COMMAND", "TOO_MANY_PAGES", "TOO_MANY_ITEMS"];

const apply = (state: NotesDocumentState, ...commands: NotesCommand[]): NotesDocumentState =>
  commands.reduce((current, command) => applyNotesCommand(current, command).state, state);

describe("applyNotesCommand", () => {
  it("restores the state exactly when each command's inverse is applied, last first", () => {
    fc.assert(
      fc.property(steps(6), ({ start, commands }) => {
        let current = start;
        const inverses: NotesCommand[] = [];
        for (const command of commands) {
          const applied = applyNotesCommand(current, command);
          expect(applyNotesCommand(applied.state, applied.inverse).state).toStrictEqual(current);
          inverses.push(applied.inverse);
          current = applied.state;
        }
        for (const inverse of inverses.reverse()) current = apply(current, inverse);
        expect(current).toStrictEqual(start);
      }),
      { numRuns: 300 },
    );
  });

  it("redoes a command with its inverse's inverse", () => {
    fc.assert(
      fc.property(stateAndCommand, ([state, command]) => {
        const done = applyNotesCommand(state, command);
        const undone = applyNotesCommand(done.state, done.inverse);
        expect(applyNotesCommand(undone.state, undone.inverse).state).toStrictEqual(done.state);
      }),
      { numRuns: 300 },
    );
  });

  it("never changes the state or the command it's given", () => {
    fc.assert(
      fc.property(stateAndCommand, ([state, command]) => {
        const before = structuredClone(state);
        const applied = applyNotesCommand(frozen(state), deepFreeze(structuredClone(command)));
        // The inverse is applied to a frozen state too, and the first state is as it was.
        applyNotesCommand(frozen(applied.state), deepFreeze(structuredClone(applied.inverse)));
        expect(state).toStrictEqual(before);
      }),
      { numRuns: 300 },
    );
  });

  it("refuses a command without changing the state", () => {
    // A valid command for one state is often invalid for another, and a mutated one for its own.
    const cases = fc
      .tuple(anyState, stateAndCommand)
      .chain(([other, [state, command]]) =>
        fc.tuple(
          fc.constantFrom(other, state),
          fc.oneof(fc.constant(command as unknown), mutated(fc.constant(command))),
        ),
      );
    let refused = 0;
    fc.assert(
      fc.property(cases, ([state, value]) => {
        const before = structuredClone(state);
        const outcome = refusal(() =>
          applyNotesCommand(frozen(state), readNotesCommandDocument(asJson(value))),
        );
        if (outcome === undefined) return;
        refused += 1;
        expect(typeof outcome.code).toBe("string");
        if (outcome.code === "INVALID_COMMAND") expect(typeof outcome.reason).toBe("string");
        else expect(["TOO_MANY_PAGES", "TOO_MANY_ITEMS"]).toContain(outcome.code);
        expect(state).toStrictEqual(before);
      }),
      { numRuns: 600 },
    );
    // The generator must reach refusals for the property to mean anything.
    expect(refused).toBeGreaterThan(30);
  });

  it("keeps the notebook and its pages readable as documents, whatever command it accepts", () => {
    const cases = stateAndCommand.chain(([state, command]) =>
      fc.tuple(
        fc.constant(state),
        fc.oneof(fc.constant(command as unknown), mutated(fc.constant(command))),
      ),
    );
    let accepted = 0;
    fc.assert(
      fc.property(cases, ([state, value]) => {
        // Only a refusal skips the case: any other error fails it, as `refusal` rethrows it.
        let next: NotesDocumentState | undefined;
        const outcome = refusal(() => {
          next = applyNotesCommand(state, readNotesCommandDocument(asJson(value))).state;
        });
        if (next === undefined) {
          expect(REFUSALS).toContain(outcome?.code);
          return;
        }
        accepted += 1;
        expect(
          readNotesNotebookDocument(asJson(toNotesNotebookDocument(next.notebook))),
        ).toStrictEqual(next.notebook);
        expect([...next.pages.keys()].sort()).toStrictEqual(
          next.notebook.pages.map((page) => page.id).sort(),
        );
        for (const page of next.pages.values()) {
          expect(readNotesPageDocument(asJson(toNotesPageDocument(page)))).toStrictEqual(page);
        }
      }),
      { numRuns: 600 },
    );
    // Half the cases are commands made for their state, which must all be accepted and checked.
    expect(accepted).toBeGreaterThan(200);
  });

  it("accepts every command made for its state, and keeps the documents readable", () => {
    // No refusal is expected here, so nothing is caught: an error of any kind fails the test.
    fc.assert(
      fc.property(stateAndCommand, ([state, command]) => {
        const next = applyNotesCommand(state, readNotesCommandDocument(asJson(command))).state;
        expect(
          readNotesNotebookDocument(asJson(toNotesNotebookDocument(next.notebook))),
        ).toStrictEqual(next.notebook);
        for (const page of next.pages.values()) {
          expect(readNotesPageDocument(asJson(toNotesPageDocument(page)))).toStrictEqual(page);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("checks the limits it's given, and only the document's own without them", () => {
    const three = [stroke("x"), stroke("y"), stroke("z")];
    const add: NotesCommand = { type: "notes.addItems", page: "c", items: three };
    expect(applyNotesCommand(STATE, add).state.pages.get("c")?.items).toHaveLength(3);
    expect(applyNotesCommand(STATE, add, { maxPages: 3, maxPageItems: 3 }).state).toBeDefined();
    try {
      applyNotesCommand(STATE, add, { maxPages: 3, maxPageItems: 2 });
      expect.unreachable();
    } catch (error) {
      expect(isNotesError(error, "TOO_MANY_ITEMS") && error.details).toStrictEqual({
        limit: "maxPageItems",
        maximum: 2,
        actual: 3,
        unit: "count",
      });
    }
    const pages: NotesCommand = {
      type: "notes.addPages",
      at: 0,
      pages: [{ info: info("d"), items: [] }],
    };
    try {
      applyNotesCommand(STATE, pages, { maxPages: 3, maxPageItems: 10 });
      expect.unreachable();
    } catch (error) {
      expect(isNotesError(error, "TOO_MANY_PAGES") && error.details).toStrictEqual({
        limit: "maxPages",
        maximum: 3,
        actual: 4,
        unit: "count",
      });
    }
  });

  describe("the most a document may hold", () => {
    // The readers refuse a notebook of more pages and a page of more items, so no command may
    // make one, whatever the host allows.
    const hostLimits = [
      undefined,
      { maxPages: Number.POSITIVE_INFINITY, maxPageItems: Number.POSITIVE_INFINITY },
      { maxPages: NOTES_DOCUMENT_MAX_PAGES + 5, maxPageItems: NOTES_DOCUMENT_MAX_ITEMS + 5 },
      { maxPages: Number.NaN, maxPageItems: Number.NaN },
    ];
    const notebookOf = (count: number): NotesDocumentState => ({
      notebook: {
        ...NOTEBOOK,
        outline: [],
        pages: Array.from({ length: count }, (_, index) => info(`p${index}`)),
      },
      pages: new Map(),
    });
    const pageOf = (count: number): NotesDocumentState => ({
      notebook: { ...NOTEBOOK, outline: [], pages: [info("a")] },
      pages: new Map([
        ["a", { id: "a", items: Array.from({ length: count }, (_, index) => stroke(`i${index}`)) }],
      ]),
    });
    const newPage = { info: info("new"), items: [] };

    it("holds a notebook to the pages its document may list", () => {
      const full = notebookOf(NOTES_DOCUMENT_MAX_PAGES);
      const add: NotesCommand = { type: "notes.addPages", at: 0, pages: [newPage] };
      const restore: NotesCommand = {
        type: "notes.restorePages",
        entries: [{ index: 0, ...newPage }],
        outline: [],
      };
      for (const limits of hostLimits) {
        for (const command of [add, restore]) {
          try {
            applyNotesCommand(full, command, limits);
            expect.unreachable();
          } catch (error) {
            expect(isNotesError(error, "TOO_MANY_PAGES") && error.details).toStrictEqual({
              limit: "maxPages",
              maximum: NOTES_DOCUMENT_MAX_PAGES,
              actual: NOTES_DOCUMENT_MAX_PAGES + 1,
              unit: "count",
            });
          }
        }
      }
      // A notebook exactly as long as its document may be is fine, and still reads.
      const almost = notebookOf(NOTES_DOCUMENT_MAX_PAGES - 1);
      for (const command of [add, restore]) {
        const { notebook } = applyNotesCommand(almost, command).state;
        expect(notebook.pages).toHaveLength(NOTES_DOCUMENT_MAX_PAGES);
        expect(readNotesNotebookDocument(toNotesNotebookDocument(notebook)).pages).toHaveLength(
          NOTES_DOCUMENT_MAX_PAGES,
        );
      }
    });

    it("holds a page to the items its document may list", () => {
      const full = pageOf(NOTES_DOCUMENT_MAX_ITEMS);
      const add: NotesCommand = { type: "notes.addItems", page: "a", items: [stroke("new")] };
      const restore: NotesCommand = {
        type: "notes.restoreItems",
        page: "a",
        entries: [{ index: 0, item: stroke("new") }],
      };
      for (const limits of hostLimits) {
        for (const command of [add, restore]) {
          try {
            applyNotesCommand(full, command, limits);
            expect.unreachable();
          } catch (error) {
            expect(isNotesError(error, "TOO_MANY_ITEMS") && error.details).toStrictEqual({
              limit: "maxPageItems",
              maximum: NOTES_DOCUMENT_MAX_ITEMS,
              actual: NOTES_DOCUMENT_MAX_ITEMS + 1,
              unit: "count",
            });
          }
        }
      }
      const almost = pageOf(NOTES_DOCUMENT_MAX_ITEMS - 1);
      for (const command of [add, restore]) {
        const page = applyNotesCommand(almost, command).state.pages.get("a");
        expect(page?.items).toHaveLength(NOTES_DOCUMENT_MAX_ITEMS);
      }
    });

    it("holds a page that comes with its items to the same count", () => {
      const items = pageOf(NOTES_DOCUMENT_MAX_ITEMS + 1).pages.get("a")?.items ?? [];
      const commands: NotesCommand[] = [
        { type: "notes.addPages", at: 0, pages: [{ info: info("new"), items }] },
        {
          type: "notes.restorePages",
          entries: [{ index: 0, info: info("new"), items }],
          outline: [],
        },
      ];
      for (const limits of hostLimits) {
        for (const command of commands) {
          expect(refusal(() => applyNotesCommand(notebookOf(1), command, limits))?.code).toBe(
            "TOO_MANY_ITEMS",
          );
        }
      }
    });
  });

  describe("undoing a removal under limits lower than what the notebook holds", () => {
    // A host may lower its limits after a notebook was made. The notebook still opens, and
    // deleting from it must stay undoable: the inverse only puts back what was there.
    const limits = { maxPages: 2, maxPageItems: 1 };

    it("puts a removed page back, with all its items", () => {
      for (const page of ["a", "c"]) {
        const removed = applyNotesCommand(
          STATE,
          { type: "notes.removePages", pages: [page] },
          limits,
        );
        expect(removed.inverse.type).toBe("notes.restorePages");
        expect(applyNotesCommand(removed.state, removed.inverse, limits).state).toStrictEqual(
          STATE,
        );
      }
    });

    it("puts a removed item back", () => {
      const removed = applyNotesCommand(
        STATE,
        { type: "notes.removeItems", page: "a", ids: ["s1"] },
        limits,
      );
      expect(removed.inverse.type).toBe("notes.restoreItems");
      expect(applyNotesCommand(removed.state, removed.inverse, limits).state).toStrictEqual(STATE);
    });

    it("still holds a new page and a new item to the limits", () => {
      const page: NotesCommand = {
        type: "notes.addPages",
        at: 0,
        pages: [{ info: info("d"), items: [] }],
      };
      expect(refusal(() => applyNotesCommand(STATE, page, limits))?.code).toBe("TOO_MANY_PAGES");
      const item: NotesCommand = { type: "notes.addItems", page: "b", items: [stroke("s2")] };
      expect(refusal(() => applyNotesCommand(STATE, item, limits))?.code).toBe("TOO_MANY_ITEMS");
    });
  });

  it("refuses a command type it doesn't know", () => {
    const unknown = { type: "notes.duplicatePages" } as unknown as NotesCommand;
    expect(refusal(() => applyNotesCommand(STATE, unknown))).toStrictEqual({
      code: "INVALID_COMMAND",
      reason: "unknown-command",
    });
  });

  describe("links to pages that are gone", () => {
    // Removing a page leaves the links that led to it, as a page read on its own may have them.
    const withoutB = apply(STATE, { type: "notes.removePages", pages: ["b"] });

    it("undoes removing a link whose page was removed", () => {
      const removed = applyNotesCommand(withoutB, {
        type: "notes.removeItems",
        page: "a",
        ids: ["l1"],
      });
      expect(applyNotesCommand(removed.state, removed.inverse).state).toStrictEqual(withoutB);
    });

    it("undoes pointing such a link at another page", () => {
      const replaced = applyNotesCommand(withoutB, {
        type: "notes.replaceItems",
        page: "a",
        items: [link("l1", "c")],
      });
      expect(applyNotesCommand(replaced.state, replaced.inverse).state).toStrictEqual(withoutB);
    });

    it("moves such a link", () => {
      const moved = { ...link("l1", "b"), x: 500 };
      const next = apply(withoutB, { type: "notes.replaceItems", page: "a", items: [moved] });
      expect(next.pages.get("a")?.items[1]).toStrictEqual(moved);
    });

    it("still refuses a new link to a page the notebook doesn't have", () => {
      const add: NotesCommand = { type: "notes.addItems", page: "a", items: [link("l2", "b")] };
      expect(refusal(() => applyNotesCommand(withoutB, add))).toStrictEqual({
        code: "INVALID_COMMAND",
        reason: "unknown-page",
      });
      const pages: NotesCommand = {
        type: "notes.addPages",
        at: 0,
        pages: [{ info: info("d"), items: [link("l1", "b")] }],
      };
      expect(refusal(() => applyNotesCommand(withoutB, pages))?.reason).toBe("unknown-page");
    });
  });

  describe("notes.restorePages", () => {
    const restore = (changes: Partial<Extract<NotesCommand, { type: "notes.restorePages" }>>) =>
      ({
        type: "notes.restorePages",
        entries: [{ index: 0, info: info("d"), items: [] }],
        outline: NOTEBOOK.outline,
        ...changes,
      }) satisfies NotesCommand;

    it("refuses a page with two items of one id, which its document couldn't hold", () => {
      const command = restore({
        entries: [{ index: 0, info: info("d"), items: [stroke("x"), stroke("x")] }],
      });
      expect(refusal(() => applyNotesCommand(STATE, command))).toStrictEqual({
        code: "INVALID_COMMAND",
        reason: "duplicate-id",
      });
    });

    it("refuses two outline entries with one id, which the notebook's document couldn't hold", () => {
      const [first, second] = NOTEBOOK.outline;
      if (!first || !second) throw new Error("The fixture has two outline entries.");
      // Without the new entry this is the notebook's own outline, and its page is restored.
      const outlines = [
        [first, second, { id: first.id, title: "Again", page: "d" }],
        [{ id: second.id, title: "Again", page: "d" }, first, second],
        [
          first,
          second,
          { id: "o3", title: "Once", page: "d" },
          { id: "o3", title: "Twice", page: "d" },
        ],
      ];
      for (const outline of outlines) {
        expect(
          refusal(() => applyNotesCommand(STATE, restore({ outline }))),
          JSON.stringify(outline),
        ).toStrictEqual({ code: "INVALID_COMMAND", reason: "duplicate-id" });
      }
    });

    it("refuses an outline its inverse couldn't undo", () => {
      // Its inverse removes the pages and their entries, so the rest must be the notebook's own.
      const [first, second] = NOTEBOOK.outline;
      if (!first || !second) throw new Error("The fixture has two outline entries.");
      const outlines = [
        [],
        [first],
        [second, first],
        [{ ...first, title: "Renamed" }, second],
        [first, second, { id: "o3", title: "Extra", page: "c" }],
      ];
      for (const outline of outlines) {
        expect(
          refusal(() => applyNotesCommand(STATE, restore({ outline }))),
          JSON.stringify(outline),
        ).toStrictEqual({
          code: "INVALID_COMMAND",
          reason: "malformed-command",
        });
      }
    });

    it("takes the notebook's outline with entries for the pages restored, and undoes it", () => {
      const [first, second] = NOTEBOOK.outline;
      if (!first || !second) throw new Error("The fixture has two outline entries.");
      const outline = [{ id: "o0", title: "Cover", page: "d" }, first, second];
      const applied = applyNotesCommand(STATE, restore({ outline }));
      expect(applied.state.notebook.outline).toStrictEqual(outline);
      expect(applyNotesCommand(applied.state, applied.inverse).state).toStrictEqual(STATE);
    });
  });
});

describe("readNotesCommandDocument", () => {
  it("accepts every command the generators make, unchanged", () => {
    fc.assert(
      fc.property(stateAndCommand, ([state, command]) => {
        const read = readNotesCommandDocument(asJson(command));
        expect(read).toStrictEqual(command);
        expect(applyNotesCommand(state, read)).toStrictEqual(applyNotesCommand(state, command));
      }),
      { numRuns: 300 },
    );
  });

  it("accepts every inverse, which is a command of the same format", () => {
    fc.assert(
      fc.property(stateAndCommand, ([state, command]) => {
        const { inverse } = applyNotesCommand(state, command);
        expect(readNotesCommandDocument(asJson(inverse))).toStrictEqual(inverse);
      }),
      { numRuns: 300 },
    );
  });

  it("refuses anything else with INVALID_COMMAND and a reason, and nothing but that", () => {
    const values = fc.oneof(
      fc.jsonValue(),
      anyState.chain((state) => mutated(commandFor(state))),
    );
    fc.assert(
      fc.property(values, (value) => {
        const outcome = refusal(() => readNotesCommandDocument(asJson(value)));
        if (outcome === undefined) return;
        expect(outcome.code).toBe("INVALID_COMMAND");
        expect(typeof outcome.reason).toBe("string");
        expect(outcome.reason).not.toBe("malformed-document");
      }),
      { numRuns: 600 },
    );
  });

  it("refuses text with a lone surrogate, which the conformance vectors can't hold", () => {
    // The vectors load in any JSON library, so they hold none (docs/formats/conformance.md).
    const HIGH = "\uD83D";
    const LOW = "\uDCD3";
    const textBox = { id: "t2", type: "text", x: 0, y: 0, width: 1_000, size: 1_200 };
    const commands = (text: string): unknown[] => [
      { type: "notes.rename", title: text },
      { type: "notes.setOutline", outline: [{ id: "o1", title: text, page: "a" }] },
      { type: "notes.addItems", page: "a", items: [{ ...textBox, text, color: "#0b57d0" }] },
    ];
    for (const text of [`Lab${LOW}`, HIGH, `a${HIGH}b`, `${LOW}${HIGH}`]) {
      for (const command of commands(text)) {
        expect(
          refusal(() => readNotesCommandDocument(command)),
          JSON.stringify(command),
        ).toStrictEqual({ code: "INVALID_COMMAND", reason: "malformed-command" });
      }
    }
    // The pair the right way round is text, and the same commands read.
    for (const command of commands(`Lab${HIGH}${LOW}`)) {
      expect(refusal(() => readNotesCommandDocument(command))).toBeUndefined();
    }
  });

  it("never reads through a prototype", () => {
    const inherited = Object.create({ type: "notes.rename", title: "x" }) as unknown;
    expect(refusal(() => readNotesCommandDocument(inherited))?.reason).toBe("unknown-command");
    class Rename {
      type = "notes.rename";
      title = "x";
    }
    expect(refusal(() => readNotesCommandDocument(new Rename()))?.reason).toBe("malformed-command");
    const own = JSON.parse('{"type":"notes.rename","title":"x","__proto__":{"polluted":true}}');
    expect(refusal(() => readNotesCommandDocument(own))?.reason).toBe("malformed-command");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("keeps the cause of a refusal, with where in the command", () => {
    try {
      readNotesCommandDocument({ type: "notes.rename", title: 7 });
      expect.unreachable();
    } catch (error) {
      const cause = (error as Error).cause;
      expect(isNotesError(cause, "INVALID_DOCUMENT") && cause.details).toStrictEqual({
        reason: "malformed-document",
        at: "$.title",
      });
    }
  });
});

describe("commandEffect", () => {
  it("names the pages an item command changes", () => {
    expect(commandEffect({ type: "notes.removeItems", page: "a", ids: ["s1"] })).toStrictEqual({
      notebook: false,
      changed: ["a"],
      removed: [],
    });
  });

  it("names the pages added, restored and removed", () => {
    const page = { info: info("d"), items: [] };
    expect(commandEffect({ type: "notes.addPages", at: 0, pages: [page] }).changed).toStrictEqual([
      "d",
    ]);
    expect(
      commandEffect({ type: "notes.restorePages", entries: [{ index: 0, ...page }], outline: [] }),
    ).toStrictEqual({ notebook: true, changed: ["d"], removed: [] });
    expect(commandEffect({ type: "notes.removePages", pages: ["a", "b"] })).toStrictEqual({
      notebook: true,
      changed: [],
      removed: ["a", "b"],
    });
  });

  it("names only the notebook for the other commands", () => {
    expect(commandEffect({ type: "notes.rename", title: "x" })).toStrictEqual({
      notebook: true,
      changed: [],
      removed: [],
    });
  });
});
