import { describe, expect, it } from "vitest";
import { addRecentColor, nameOf, parseColor, toHex, toHsva } from "./color.js";

describe("parseColor", () => {
  it.each([
    ["#1570EF", false, "#1570ef"],
    ["1570ef", false, "#1570ef"],
    [" #abc ", false, "#aabbcc"],
    ["#1570ef", true, "#1570efff"],
    ["#1570ef80", true, "#1570ef80"],
    ["#abcd", true, "#aabbccdd"],
  ] as const)("reads %j (alpha %s) as %j", (text, alpha, expected) => {
    expect(parseColor(text, alpha)).toBe(expected);
  });

  it.each([
    ["#1570ef80", false],
    ["#abcd", false],
    ["#12", false],
    ["#ggg", false],
    ["red", true],
    ["rgb(0 0 0)", true],
    ['#000"/><script>', true],
    ["", true],
    [42, true],
    [null, true],
  ] as const)("refuses %j (alpha %s)", (text, alpha) => {
    expect(parseColor(text, alpha)).toBeUndefined();
  });
});

describe("toHsva and toHex", () => {
  it.each(["#000000", "#ffffff", "#ff0000", "#1570ef", "#7a5af8", "#12b76a", "#808080"])(
    "round-trips %s",
    (color) => {
      expect(toHex(toHsva(color))).toBe(color);
    },
  );

  it("round-trips alpha", () => {
    expect(toHex(toHsva("#1570ef80"), true)).toBe("#1570ef80");
    expect(toHsva("#1570ef80").a).toBeCloseTo(128 / 255);
  });

  it("keeps the previous hue for a grey, and the hue and saturation for black", () => {
    const blue = toHsva("#1570ef");
    expect(toHsva("#808080", blue)).toMatchObject({ h: blue.h, s: 0 });
    expect(toHsva("#000000", blue)).toMatchObject({ h: blue.h, s: blue.s, v: 0 });
  });

  it("wraps and clamps out-of-range values", () => {
    expect(toHex({ h: 360, s: 1, v: 1, a: 1 })).toBe("#ff0000");
    expect(toHex({ h: -120, s: 2, v: 1, a: 1 })).toBe("#0000ff");
    expect(toHex({ h: 0, s: 0, v: 1, a: 2 }, true)).toBe("#ffffffff");
  });
});

describe("nameOf", () => {
  it.each([
    ["#ffffff", { kind: "white" }],
    ["#000000", { kind: "black" }],
    ["#808080", { kind: "grey" }],
    ["#d0d0d0", { kind: "light-grey" }],
    ["#333333", { kind: "dark-grey" }],
    ["#ff0000", { kind: "hue", hue: "red", tone: "plain" }],
    ["#f79009", { kind: "hue", hue: "orange", tone: "plain" }],
    ["#fdd835", { kind: "hue", hue: "yellow", tone: "plain" }],
    ["#12b76a", { kind: "hue", hue: "green", tone: "plain" }],
    ["#00bcd4", { kind: "hue", hue: "cyan", tone: "plain" }],
    ["#1570ef", { kind: "hue", hue: "blue", tone: "plain" }],
    ["#0b2a5c", { kind: "hue", hue: "blue", tone: "dark" }],
    ["#a9c8fa", { kind: "hue", hue: "blue", tone: "light" }],
    ["#7a5af8", { kind: "hue", hue: "purple", tone: "plain" }],
    ["#ec4899", { kind: "hue", hue: "pink", tone: "plain" }],
    ["#8a7f99", { kind: "hue", hue: "purple", tone: "greyish" }],
  ] as const)("calls %s %j", (color, name) => {
    expect(nameOf(color)).toEqual(name);
  });
});

describe("addRecentColor", () => {
  it("puts the colour first without duplicates, whatever their case", () => {
    expect(addRecentColor(["#1570EF", "#d92d20"], "#D92D20")).toEqual(["#d92d20", "#1570ef"]);
  });

  it("keeps alpha, and opaque colours as #rrggbb", () => {
    expect(addRecentColor(["#1570efff"], "#1570ef80")).toEqual(["#1570ef80", "#1570ef"]);
  });

  it("keeps at most max colours, eight by default", () => {
    const list = Array.from({ length: 8 }, (_, index) => `#00000${index}`);
    expect(addRecentColor(list, "#ffffff")).toHaveLength(8);
    expect(addRecentColor(list, "#ffffff", 3)).toEqual(["#ffffff", "#000000", "#000001"]);
  });

  it("removes duplicates already in the list before cutting it to max", () => {
    expect(addRecentColor(["#aaa", "#AAAAAA", "#bbb", "#bbbbbb"], "#ccc", 3)).toEqual([
      "#cccccc",
      "#aaaaaa",
      "#bbbbbb",
    ]);
  });

  it("normalises, filters and cuts the list when the new colour isn't one", () => {
    expect(addRecentColor(["#ABC", "nope", "#aabbcc", "#fff"], "nope", 1)).toEqual(["#aabbcc"]);
  });

  it("ignores text that isn't a colour, in the list too, and returns a frozen copy", () => {
    const list = ["#1570ef", "javascript:alert(1)"];
    const result = addRecentColor(list, "url(x)");
    expect(result).toEqual(["#1570ef"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result).not.toBe(list);
  });
});
