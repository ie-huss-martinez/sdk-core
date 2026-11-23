import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isNotesError } from "../errors/notes-error.js";
import {
  assetReference,
  color,
  fields,
  header,
  id,
  idOrNull,
  integer,
  list,
  MAX_TIME,
  oneOf,
  text,
  time,
  timeOrNull,
} from "./read.js";

/** The rejection's code, reason and place, or `undefined` when the call returns. */
function refusal(run: () => unknown): { code: string; reason: unknown; at?: unknown } | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (!isNotesError(error)) throw error;
    const at = error.details?.["at"];
    return {
      code: error.code,
      reason: error.details?.["reason"],
      ...(at === undefined ? {} : { at }),
    };
  }
}

const invalid = (reason: string, at: string) => ({ code: "INVALID_DOCUMENT", reason, at });
const malformed = (at: string) => invalid("malformed-document", at);

/** An object with an own field of any name, as `JSON.parse` makes one named `__proto__`. */
const withOwn = (base: object, name: string, value: unknown): object =>
  Object.defineProperty({ ...base }, name, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });

const EMOJI = "\u{1F4D3}";
const HIGH = "\uD83D";
const LOW = "\uDCD3";

describe("fields", () => {
  it("returns an object's own fields, required and optional", () => {
    const read = fields({ a: 1, b: null }, "$", ["a"], ["b", "c"]);
    expect({ ...read }).toStrictEqual({ a: 1, b: null });
  });

  it("returns a copy with no prototype, so every name is just a field", () => {
    const read = fields({ a: 1 }, "$", ["a"]);
    expect(Object.getPrototypeOf(read)).toBeNull();
    expect(read["toString"]).toBeUndefined();
    expect(read["constructor"]).toBeUndefined();
    expect(Object.hasOwn(read, "a")).toBe(true);
  });

  it("refuses what isn't a plain object", () => {
    class Point {
      a = 1;
    }
    for (const value of [
      null,
      undefined,
      1,
      "a",
      true,
      [],
      [{ a: 1 }],
      new Point(),
      new Map(),
      new Date(0),
    ]) {
      expect(
        refusal(() => fields(value, "$.x", ["a"])),
        String(value),
      ).toStrictEqual(malformed("$.x"));
    }
  });

  it("reads an object with no prototype", () => {
    const value = Object.assign(Object.create(null), { a: 1 });
    expect(fields(value, "$", ["a"])["a"]).toBe(1);
  });

  it("refuses an unknown field, and names it", () => {
    expect(refusal(() => fields({ a: 1, extra: 2 }, "$", ["a"]))).toStrictEqual(
      malformed("$.extra"),
    );
  });

  it("refuses a missing field, and names it", () => {
    expect(refusal(() => fields({ a: 1 }, "$.page", ["a", "b"]))).toStrictEqual(
      malformed("$.page.b"),
    );
  });

  it("refuses a required field that's only inherited", () => {
    const value = Object.create({ a: 1 }) as object;
    // Its prototype isn't Object's, so it isn't a plain object at all.
    expect(refusal(() => fields(value, "$", ["a"]))).toStrictEqual(malformed("$"));
    // And a name Object.prototype has isn't a field of an empty object.
    expect(refusal(() => fields({}, "$", ["toString"]))).toStrictEqual(malformed("$.toString"));
    expect(refusal(() => fields({}, "$", ["constructor"]))).toStrictEqual(
      malformed("$.constructor"),
    );
  });

  it("refuses own fields named __proto__, constructor and toString, without changing any prototype", () => {
    const parsed: unknown = JSON.parse('{"a":1,"__proto__":{"polluted":true}}');
    expect(refusal(() => fields(parsed, "$", ["a"]))).toStrictEqual(malformed("$.__proto__"));
    for (const name of ["constructor", "toString"]) {
      expect(refusal(() => fields(withOwn({ a: 1 }, name, 1), "$", ["a"]))).toStrictEqual(
        malformed(`$.${name}`),
      );
    }
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("reads a field named __proto__ as data when it's allowed", () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"polluted":true}}');
    const read = fields(parsed, "$", ["__proto__"]);
    expect(Object.getPrototypeOf(read)).toBeNull();
    expect(Object.hasOwn(read, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(read, "__proto__")?.value).toStrictEqual({
      polluted: true,
    });
  });

  it("never puts a field's name in an error unless it's short and plain", () => {
    for (const name of ["two words", "x".repeat(41), "caf\u00E9", "a.b", "", "<b>"]) {
      expect(refusal(() => fields(withOwn({}, name, 1), "$", []))?.at, name).toBe("$.?");
    }
    expect(refusal(() => fields(withOwn({}, "x".repeat(40), 1), "$", []))?.at).toBe(
      `$.${"x".repeat(40)}`,
    );
  });
});

describe("list", () => {
  it("returns a list of up to the most entries", () => {
    expect(list([], "$", 0)).toStrictEqual([]);
    expect(list([1, "a"], "$", 2)).toStrictEqual([1, "a"]);
  });

  it("refuses a longer list, and what isn't a list", () => {
    expect(refusal(() => list([1, 2, 3], "$.items", 2))).toStrictEqual(malformed("$.items"));
    for (const value of [null, undefined, {}, "ab", { length: 1, 0: "a" }, new Set([1])]) {
      expect(refusal(() => list(value, "$", 5))).toStrictEqual(malformed("$"));
    }
  });
});

describe("integer", () => {
  it("returns a whole number within its bounds, ends included", () => {
    expect(integer(5, "$", 5, 9)).toBe(5);
    expect(integer(9, "$", 5, 9)).toBe(9);
    expect(integer(1e3, "$", 0, 1_000)).toBe(1_000);
    expect(integer(Number.MAX_SAFE_INTEGER, "$", 0, Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("returns zero for negative zero", () => {
    expect(Object.is(integer(-0, "$", 0, 1), 0)).toBe(true);
    expect(Object.is(integer(-0, "$", -5, 5), 0)).toBe(true);
    expect(Object.is(integer(0, "$", 0, 1), 0)).toBe(true);
  });

  it("refuses a number out of bounds, a fraction, and what isn't a number, with the reason given", () => {
    const values = [
      4,
      10,
      5.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      "5",
      null,
      undefined,
      true,
      [5],
      { valueOf: () => 5 },
      5n,
    ];
    for (const value of values) {
      expect(
        refusal(() => integer(value, "$.n", 5, 9)),
        String(value),
      ).toStrictEqual(malformed("$.n"));
      expect(refusal(() => integer(value, "$.n", 5, 9, "invalid-size"))).toStrictEqual(
        invalid("invalid-size", "$.n"),
      );
    }
  });

  it("returns exactly the whole numbers within the bounds", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.double()),
        fc.integer(),
        fc.integer(),
        (value, a, b) => {
          const [minimum, maximum] = a <= b ? [a, b] : [b, a];
          const fits = Number.isSafeInteger(value) && value >= minimum && value <= maximum;
          expect(refusal(() => integer(value, "$", minimum, maximum)) === undefined).toBe(fits);
        },
      ),
    );
  });
});

describe("text", () => {
  it("returns text of up to the most code points", () => {
    expect(text("", "$", 0)).toBe("");
    expect(text("abc", "$", 3)).toBe("abc");
  });

  it("counts a character outside the BMP as one", () => {
    expect(text(EMOJI.repeat(3), "$", 3)).toBe(EMOJI.repeat(3));
    expect(EMOJI.repeat(3)).toHaveLength(6);
    expect(refusal(() => text(EMOJI.repeat(4), "$", 3, "text-too-long"))).toStrictEqual(
      invalid("text-too-long", "$"),
    );
    // Three in the BMP and one outside: four code points, five units.
    expect(refusal(() => text(`abc${EMOJI}`, "$", 3, "text-too-long"))?.reason).toBe(
      "text-too-long",
    );
    expect(text(`ab${EMOJI}`, "$", 3)).toHaveLength(4);
  });

  it("refuses longer text with the reason given, or as malformed without one", () => {
    expect(refusal(() => text("abcd", "$.t", 3))).toStrictEqual(malformed("$.t"));
    expect(refusal(() => text("abcd", "$.t", 3, "text-too-long"))).toStrictEqual(
      invalid("text-too-long", "$.t"),
    );
    expect(refusal(() => text("x".repeat(1_000_000), "$.t", 3, "text-too-long"))?.reason).toBe(
      "text-too-long",
    );
  });

  it("refuses what isn't text as malformed, whatever the reason given", () => {
    for (const value of [
      null,
      undefined,
      1,
      true,
      ["a"],
      { toString: () => "a" },
      new String("a"),
    ]) {
      expect(refusal(() => text(value, "$.t", 3, "text-too-long"))).toStrictEqual(malformed("$.t"));
    }
  });

  it("refuses a lone surrogate, anywhere in the text", () => {
    for (const value of [
      HIGH,
      LOW,
      `a${HIGH}`,
      `${HIGH}a`,
      `a${LOW}`,
      `${LOW}a`,
      `${LOW}${HIGH}`,
      `${HIGH}${HIGH}${LOW}`,
      `${HIGH}${LOW}${LOW}`,
      `${EMOJI}${HIGH}`,
    ]) {
      expect(
        refusal(() => text(value, "$.t", 10, "text-too-long")),
        JSON.stringify(value),
      ).toStrictEqual(malformed("$.t"));
    }
  });

  it("keeps every other character, such as controls, joiners and marks of direction", () => {
    const value = `a\u0000\n\t\u200B\u200D\u202E\uFEFF\uFFFF${HIGH}${LOW}`;
    expect(text(value, "$", 20)).toBe(value);
  });

  it("accepts exactly the well-formed text that fits", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 12 }), fc.nat(12), (value, maximum) => {
        const fits = [...value].length <= maximum;
        expect(refusal(() => text(value, "$", maximum)) === undefined).toBe(fits);
      }),
    );
    fc.assert(
      fc.property(
        fc.string({ unit: "binary", maxLength: 6 }),
        fc.constantFrom(HIGH, LOW),
        fc.string({ unit: "binary", maxLength: 6 }),
        (before, half, after) => {
          // Between whole code points, half a pair is always on its own.
          expect(refusal(() => text(`${before}${half}${after}`, "$", 100))).toStrictEqual(
            malformed("$"),
          );
        },
      ),
    );
  });
});

describe("oneOf", () => {
  it("returns one of the options", () => {
    expect(oneOf("b", "$", ["a", "b"])).toBe("b");
  });

  it("refuses anything else, and names of Object.prototype's properties", () => {
    for (const value of [
      "c",
      "A",
      "",
      "toString",
      "constructor",
      "__proto__",
      "length",
      0,
      null,
      ["a"],
    ]) {
      expect(refusal(() => oneOf(value, "$.kind", ["a", "b"]))).toStrictEqual(malformed("$.kind"));
    }
  });
});

describe("id and idOrNull", () => {
  it("return a valid id, including ones named after Object.prototype's properties", () => {
    for (const value of [
      "a",
      "A-Z_a-z_0-9",
      "__proto__",
      "constructor",
      "toString",
      "-",
      "_",
      "a".repeat(64),
    ]) {
      expect(id(value, "$")).toBe(value);
      expect(idOrNull(value, "$")).toBe(value);
    }
  });

  it("refuse anything else with invalid-id", () => {
    for (const value of [
      "",
      "a".repeat(65),
      "a b",
      "a.b",
      "a/b",
      "a\n",
      "\na",
      "caf\u00E9",
      EMOJI,
      1,
      undefined,
      {},
      ["a"],
    ]) {
      expect(
        refusal(() => id(value, "$.id")),
        JSON.stringify(value),
      ).toStrictEqual(invalid("invalid-id", "$.id"));
      expect(refusal(() => idOrNull(value, "$.id"))).toStrictEqual(invalid("invalid-id", "$.id"));
    }
  });

  it("take null only where it's allowed", () => {
    expect(idOrNull(null, "$")).toBeNull();
    expect(refusal(() => id(null, "$"))).toStrictEqual(invalid("invalid-id", "$"));
  });
});

describe("color", () => {
  it("returns #rrggbb in lowercase", () => {
    for (const value of ["#000000", "#ffffff", "#0b57d0", "#123abc"])
      expect(color(value, "$")).toBe(value);
  });

  it("refuses anything else with invalid-color", () => {
    for (const value of [
      "#FFFFFF",
      "#fff",
      "#ffffff80",
      "ffffff",
      "red",
      "#gggggg",
      "#ffffff\n",
      " #ffffff",
      "",
      0xffffff,
      null,
    ]) {
      expect(
        refusal(() => color(value, "$.color")),
        JSON.stringify(value),
      ).toStrictEqual(invalid("invalid-color", "$.color"));
    }
  });
});

describe("time and timeOrNull", () => {
  it("return whole milliseconds from the epoch to the last a date holds", () => {
    expect(time(0, "$")).toBe(0);
    expect(time(1_700_000_000_000, "$")).toBe(1_700_000_000_000);
    expect(time(MAX_TIME, "$")).toBe(MAX_TIME);
    expect(new Date(MAX_TIME).getTime()).toBe(MAX_TIME);
    expect(Number.isNaN(new Date(MAX_TIME + 1).getTime())).toBe(true);
    expect(Object.is(time(-0, "$"), 0)).toBe(true);
  });

  it("refuse anything else with invalid-time", () => {
    for (const value of [
      -1,
      0.5,
      MAX_TIME + 1,
      "0",
      "2023-11-14T22:13:20Z",
      undefined,
      new Date(0),
    ]) {
      expect(refusal(() => time(value, "$.at"))).toStrictEqual(invalid("invalid-time", "$.at"));
      expect(refusal(() => timeOrNull(value, "$.at"))).toStrictEqual(
        invalid("invalid-time", "$.at"),
      );
    }
  });

  it("take null only where it's allowed", () => {
    expect(timeOrNull(null, "$")).toBeNull();
    expect(timeOrNull(5, "$")).toBe(5);
    expect(refusal(() => time(null, "$"))).toStrictEqual(invalid("invalid-time", "$"));
  });
});

describe("assetReference", () => {
  const name = `sha256:${"0a".repeat(32)}`;
  const types = ["image/png", "image/jpeg"];
  const reference = { asset: name, mediaType: "image/png", size: 12 };

  it("returns a reference to a file of an allowed type", () => {
    expect(assetReference(reference, "$", types)).toStrictEqual(reference);
    expect(assetReference({ ...reference, size: 0 }, "$", types).size).toBe(0);
    expect(assetReference({ ...reference, size: Number.MAX_SAFE_INTEGER }, "$", types).size).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("refuses a name that isn't sha256: and 64 lowercase hexadecimal digits", () => {
    for (const asset of [
      `sha256:${"0A".repeat(32)}`,
      `sha256:${"0".repeat(63)}`,
      `sha256:${"0".repeat(65)}`,
      `SHA256:${"0a".repeat(32)}`,
      "0a".repeat(32),
      `${name}\n`,
      `md5:${"0".repeat(32)}`,
      "",
      1,
      null,
    ]) {
      expect(
        refusal(() => assetReference({ ...reference, asset }, "$.image", types)),
        String(asset),
      ).toStrictEqual(invalid("invalid-asset", "$.image.asset"));
    }
  });

  it("refuses a media type that isn't one of those allowed, as written", () => {
    for (const mediaType of [
      "image/svg+xml",
      "image/gif",
      "IMAGE/PNG",
      "image/png ",
      "image/png; q=1",
      "image",
      "",
      "toString",
      1,
      null,
      ["image/png"],
    ]) {
      expect(
        refusal(() => assetReference({ ...reference, mediaType }, "$.image", types)),
        String(mediaType),
      ).toStrictEqual(invalid("invalid-asset", "$.image.mediaType"));
    }
  });

  it("refuses an allowed type that isn't a well-formed media type", () => {
    // The list a caller passes is trusted, but a malformed name never is.
    expect(
      refusal(() => assetReference({ ...reference, mediaType: "PNG" }, "$", ["PNG"]))?.reason,
    ).toBe("invalid-asset");
  });

  it("refuses a size that isn't a whole number of bytes", () => {
    for (const size of [-1, 0.5, 2 ** 53, "12", null]) {
      expect(refusal(() => assetReference({ ...reference, size }, "$.image", types))).toStrictEqual(
        invalid("invalid-asset", "$.image.size"),
      );
    }
  });

  it("refuses a missing or an unknown field, such as the file's name", () => {
    expect(
      refusal(() => assetReference({ asset: name, mediaType: "image/png" }, "$.image", types)),
    ).toStrictEqual(malformed("$.image.size"));
    expect(
      refusal(() => assetReference({ ...reference, name: "holiday.png" }, "$.image", types)),
    ).toStrictEqual(malformed("$.image.name"));
    expect(refusal(() => assetReference(name, "$.image", types))).toStrictEqual(
      malformed("$.image"),
    );
  });
});

describe("header", () => {
  const check = (value: unknown) => refusal(() => header(value, "hm-notes-page", 1));
  const unsupported = (reason: string) => ({ code: "UNSUPPORTED_FORMAT", reason });

  it("accepts the format at its version, or an earlier one", () => {
    expect(check({ format: "hm-notes-page", version: 1 })).toBeUndefined();
    expect(check({ format: "hm-notes-page", version: 1, anything: "else" })).toBeUndefined();
    expect(
      refusal(() => header({ format: "hm-notes-page", version: 1 }, "hm-notes-page", 3)),
    ).toBeUndefined();
    expect(
      refusal(() => header({ format: "hm-notes-page", version: 3 }, "hm-notes-page", 3)),
    ).toBeUndefined();
  });

  it("refuses another format before it looks at the version", () => {
    for (const format of [
      "hm-notes-notebook",
      "HM-NOTES-PAGE",
      "hm-notes-page ",
      "",
      1,
      null,
      undefined,
      ["hm-notes-page"],
    ]) {
      expect(check({ format, version: 99 }), String(format)).toStrictEqual(
        unsupported("unknown-format"),
      );
    }
    expect(check({ version: 1 })).toStrictEqual(unsupported("unknown-format"));
    expect(check({})).toStrictEqual(unsupported("unknown-format"));
  });

  it("refuses a later version", () => {
    expect(check({ format: "hm-notes-page", version: 2 })).toStrictEqual(
      unsupported("unknown-format-version"),
    );
    expect(check({ format: "hm-notes-page", version: Number.MAX_SAFE_INTEGER })).toStrictEqual(
      unsupported("unknown-format-version"),
    );
  });

  it("refuses a version that isn't a whole number from 1", () => {
    for (const version of [
      0,
      -1,
      1.5,
      "1",
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      [1],
    ]) {
      expect(check({ format: "hm-notes-page", version }), String(version)).toStrictEqual(
        malformed("$.version"),
      );
    }
  });

  it("refuses what isn't an object", () => {
    for (const value of [
      null,
      undefined,
      "hm-notes-page",
      1,
      [],
      [{ format: "hm-notes-page", version: 1 }],
    ]) {
      expect(check(value)).toStrictEqual(malformed("$"));
    }
  });

  it("reads only the document's own format and version", () => {
    const inherited = Object.create({ format: "hm-notes-page", version: 1 }) as unknown;
    expect(check(inherited)).toStrictEqual(unsupported("unknown-format"));
    const half = Object.assign(Object.create({ version: 1 }), {
      format: "hm-notes-page",
    }) as unknown;
    expect(check(half)).toStrictEqual(malformed("$.version"));
  });
});
