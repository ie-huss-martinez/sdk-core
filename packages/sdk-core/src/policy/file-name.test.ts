import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { cleanFileName, MAX_FILE_NAME_LENGTH } from "./file-name.js";

describe("cleanFileName (ADR 0051)", () => {
  it.each([
    ["report.pdf", "report.pdf"],
    ["  Quarterly report.pdf  ", "Quarterly report.pdf"],
    ["../../etc/passwd", "passwd"],
    ["C:\\Users\\me\\report.pdf", "report.pdf"],
    ["folder/sub\\mixed.pdf", "mixed.pdf"],
    ["re\u0000po\u0007rt\u007F\u0085.pdf", "report.pdf"],
    ["line\nbreak\r\t.pdf", "linebreak.pdf"],
    ["a\u2066b\u2069c\u200Ed\u200Fe\u061Cf.pdf", "abcdef.pdf"],
    ['a<b>c:d"e|f?g*h.pdf', "abcdefgh.pdf"],
    [".hidden.pdf", "hidden.pdf"],
    ["... . .pdf", "pdf"],
    // NFC: "e" and a combining acute accent become one "é".
    ["re\u0301sume\u0301.pdf", "résumé.pdf"],
    // Removing a control character must not leave "e" and its accent apart.
    ["re\u0000\u0301sume.pdf", "résume.pdf"],
    ["文書.pdf", "文書.pdf"],
    ["😀 holiday.png", "😀 holiday.png"],
    // Half a surrogate pair isn't text; a whole pair is.
    ["clip\uD83D.mp4", "clip.mp4"],
    ["\uDE00clip.mp4", "clip.mp4"],
  ])("cleans %j to %j", (raw, clean) => {
    expect(cleanFileName(raw)).toBe(clean);
  });

  it.each([
    [""],
    ["   "],
    ["..."],
    ["/"],
    ["a/"],
    ["../.."],
    ["\u0000\u202E"],
    ['<>:"|?*'],
    ["\uD83D"],
  ])("gives no name for %j", (raw) => {
    expect(cleanFileName(raw)).toBeUndefined();
  });

  it("removes a right-to-left override that disguises an extension", () => {
    // Shown as "invoiceexe.pdf", but it's an .exe.
    const clean = cleanFileName("invoice\u202Efdp.exe");

    expect(clean).toBe("invoicefdp.exe");
  });

  it("gives no name for anything that isn't a string", () => {
    for (const value of [undefined, null, 42, {}, ["a.pdf"], new String("a.pdf")]) {
      expect(cleanFileName(value)).toBeUndefined();
    }
  });

  it("caps the length in code points, never splitting a surrogate pair", () => {
    const clean = cleanFileName("😀".repeat(MAX_FILE_NAME_LENGTH + 10));

    expect(clean).toBe("😀".repeat(MAX_FILE_NAME_LENGTH));
    expect(cleanFileName("a".repeat(MAX_FILE_NAME_LENGTH))).toHaveLength(MAX_FILE_NAME_LENGTH);
    expect(cleanFileName("a".repeat(MAX_FILE_NAME_LENGTH + 1))).toHaveLength(MAX_FILE_NAME_LENGTH);
  });

  it("leaves no whitespace at the end when the cap falls after a space", () => {
    const clean = cleanFileName(`${"a".repeat(MAX_FILE_NAME_LENGTH - 1)} b`);

    expect(clean).toBe("a".repeat(MAX_FILE_NAME_LENGTH - 1));
  });

  it("always gives a safe name, or none, for any string", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 400 }), (raw) => {
        const clean = cleanFileName(raw);
        if (clean === undefined) {
          return;
        }
        expect(clean).not.toBe("");
        expect(clean).not.toMatch(
          /[/\\<>:"|?*\p{Cc}\p{Cs}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u,
        );
        expect(clean).not.toMatch(/^[\s.]|\s$/u);
        expect(Array.from(clean).length).toBeLessThanOrEqual(MAX_FILE_NAME_LENGTH);
        expect(clean).toBe(clean.normalize("NFC"));
        // Well-formed Unicode: encoding it never throws.
        expect(() => encodeURIComponent(clean)).not.toThrow();
        // Cleaning is stable: a clean name stays as it is.
        expect(cleanFileName(clean)).toBe(clean);
      }),
    );
  });
});

describe("cleanFileName on an engine without String.prototype.normalize (ADR 0069)", () => {
  it("still cleans the name, and leaves it in the form it came in", () => {
    const normalize = String.prototype.normalize;
    // biome-ignore lint/suspicious/noExplicitAny: removing a built-in method is the case.
    delete (String.prototype as any).normalize;
    try {
      // "e" and a combining acute accent stay two code points; the path,
      // the bidirectional override and the refused character still go.
      expect(cleanFileName("C:\\docs\\re\u0301sume\u202E?.pdf")).toBe("re\u0301sume.pdf");
      expect(cleanFileName("../..")).toBeUndefined();
    } finally {
      String.prototype.normalize = normalize;
    }
    expect(cleanFileName("re\u0301sume.pdf")).toBe("r\u00E9sume.pdf");
  });
});
