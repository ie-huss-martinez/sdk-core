import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isNotesId } from "../../core/model/ids.js";
import { fromAssetFileName, fromFileName, toAssetFileName, toFileName } from "./opfs-names.js";

const ID_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const id = fc.string({ unit: fc.constantFrom(...ID_CHARACTERS), minLength: 1, maxLength: 64 });

describe("toFileName", () => {
  it("leaves an id without uppercase letters as it is", () => {
    expect(toFileName("hm-notes_2")).toBe("hm-notes_2");
  });

  it("writes an uppercase letter as ~ and its lowercase", () => {
    expect(toFileName("aBc")).toBe("a~bc");
    expect(toFileName("ABC")).toBe("~a~b~c");
  });

  it("gives back the id it was made from", () => {
    fc.assert(
      fc.property(id, (value) => {
        expect(isNotesId(value)).toBe(true);
        expect(fromFileName(toFileName(value))).toBe(value);
      }),
    );
  });

  it("never gives two ids names that a case-folding disk takes for one", () => {
    fc.assert(
      fc.property(id, id, (first, second) => {
        fc.pre(first !== second);
        expect(toFileName(first).toLowerCase()).not.toBe(toFileName(second).toLowerCase());
      }),
    );
    // The pair random ids would almost never hit: the same letters, in another case.
    fc.assert(
      fc.property(id, (value) => {
        fc.pre(value !== value.toLowerCase());
        expect(toFileName(value).toLowerCase()).not.toBe(toFileName(value.toLowerCase()));
      }),
    );
  });

  it("stays within what a file name can hold", () => {
    const name = toFileName("Z".repeat(64));
    expect(name).toHaveLength(128);
    expect(name).toMatch(/^[a-z0-9_~-]+$/);
  });
});

describe("fromFileName", () => {
  it.each(["", "ABC", "a~", "a~~b", "a~1", "a.json", "page.json.crswap", "a b", "..", "a/b"])(
    "has no id for %j, which toFileName never writes",
    (name) => {
      expect(fromFileName(name)).toBeUndefined();
    },
  );
});

describe("asset file names", () => {
  const hash = "0123456789abcdef".repeat(4);

  it("are the asset's hash, and back", () => {
    expect(toAssetFileName(`sha256:${hash}`)).toBe(hash);
    expect(fromAssetFileName(hash)).toBe(`sha256:${hash}`);
  });

  it.each(["", "abc", `${hash}.crswap`, hash.toUpperCase(), `${hash}0`, hash.slice(1)])(
    "have no asset for %j",
    (name) => {
      expect(fromAssetFileName(name)).toBeUndefined();
    },
  );
});
