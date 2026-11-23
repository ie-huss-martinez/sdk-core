import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EMPTY_LIBRARY, folderTree, type NotesFolder } from "./library.js";

const folder = (id: string, parent: string | null): NotesFolder => ({
  id,
  name: id,
  parent,
  createdAt: 0,
});

/** root > (a > (c > e, d), b), and another tree: other > f. */
const FOLDERS: NotesFolder[] = [
  folder("root", null),
  folder("a", "root"),
  folder("b", "root"),
  folder("c", "a"),
  folder("d", "a"),
  folder("e", "c"),
  folder("other", null),
  folder("f", "other"),
];

const sorted = (ids: Set<string>) => [...ids].sort();

describe("folderTree", () => {
  it("gives a folder with every folder inside it, however deep", () => {
    expect(sorted(folderTree(FOLDERS, "root"))).toStrictEqual(["a", "b", "c", "d", "e", "root"]);
    expect(sorted(folderTree(FOLDERS, "a"))).toStrictEqual(["a", "c", "d", "e"]);
    expect(sorted(folderTree(FOLDERS, "other"))).toStrictEqual(["f", "other"]);
  });

  it("gives a folder with nothing inside it alone", () => {
    expect(sorted(folderTree(FOLDERS, "e"))).toStrictEqual(["e"]);
    expect(sorted(folderTree([], "anything"))).toStrictEqual(["anything"]);
  });

  it("gives an unknown folder alone", () => {
    expect(sorted(folderTree(FOLDERS, "missing"))).toStrictEqual(["missing"]);
  });

  it("finds a folder listed before the folder it's in", () => {
    const reversed = [...FOLDERS].reverse();
    expect(sorted(folderTree(reversed, "root"))).toStrictEqual(["a", "b", "c", "d", "e", "root"]);
  });

  it("treats folders named after Object.prototype's properties as any other", () => {
    const named = [
      folder("__proto__", null),
      folder("constructor", "__proto__"),
      folder("toString", "constructor"),
    ];
    expect(sorted(folderTree(named, "__proto__"))).toStrictEqual([
      "__proto__",
      "constructor",
      "toString",
    ]);
    expect(sorted(folderTree(named, "constructor"))).toStrictEqual(["constructor", "toString"]);
    expect(sorted(folderTree(FOLDERS, "constructor"))).toStrictEqual(["constructor"]);
  });

  it("ends on folders that contain each other, which a damaged index could list", () => {
    const ring = [folder("a", "b"), folder("b", "a"), folder("c", null)];
    expect(sorted(folderTree(ring, "a"))).toStrictEqual(["a", "b"]);
  });

  it("gives exactly the folders whose way to the top passes through the root, in any order", () => {
    // Each folder is at the top or inside an earlier one, so there's never a ring.
    const trees = fc
      .array(fc.option(fc.nat(), { nil: null }), { minLength: 1, maxLength: 12 })
      .map((parents) =>
        parents.map((parent, index) =>
          folder(`f${index}`, parent === null || index === 0 ? null : `f${parent % index}`),
        ),
      );
    fc.assert(
      fc.property(trees, fc.nat(), fc.infiniteStream(fc.nat()), (folders, pick, order) => {
        const root = `f${pick % folders.length}`;
        const parents = new Map(folders.map((entry) => [entry.id, entry.parent]));
        const inside = folders.filter((entry) => {
          for (let id: string | null = entry.id; id !== null; id = parents.get(id) ?? null) {
            if (id === root) return true;
          }
          return false;
        });
        const keys = folders.map(() => order.next().value);
        const shuffled = folders
          .map((entry, index) => [keys[index] ?? 0, entry] as const)
          .sort((a, b) => a[0] - b[0])
          .map(([, entry]) => entry);
        expect(sorted(folderTree(shuffled, root))).toStrictEqual(
          inside.map((entry) => entry.id).sort(),
        );
      }),
    );
  });
});

describe("EMPTY_LIBRARY", () => {
  it("has no folders, no notebooks and no times", () => {
    expect(EMPTY_LIBRARY).toStrictEqual({
      folders: [],
      notebooks: [],
      lastBackupAt: null,
      lastChangeAt: null,
    });
  });
});
