import { inflateSync } from "node:zlib";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readPdf, referenced } from "./fixtures/read-pdf.js";
import {
  deflate,
  formatPdfNumber,
  PdfRef,
  PdfString,
  PdfWriter,
  pdfName,
  pdfTextString,
  serializePdfObject,
} from "./pdf-objects.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("formatPdfNumber", () => {
  it("writes plain decimals with at most four places and no trailing zeros", () => {
    expect(formatPdfNumber(0)).toBe("0");
    expect(formatPdfNumber(100)).toBe("100");
    expect(formatPdfNumber(0.5)).toBe("0.5");
    expect(formatPdfNumber(-12.25)).toBe("-12.25");
    expect(formatPdfNumber(1 / 3)).toBe("0.3333");
    expect(formatPdfNumber(2 / 3)).toBe("0.6667");
    expect(formatPdfNumber(123456789.123456)).toBe("123456789.1235");
    expect(formatPdfNumber(1500.5)).toBe("1500.5");
  });

  it("never writes an exponent", () => {
    expect(formatPdfNumber(1e20)).toBe("100000000000000000000");
    expect(formatPdfNumber(1e-7)).toBe("0");
    expect(formatPdfNumber(0.00012)).toBe("0.0001");
  });

  it("never writes a negative zero", () => {
    expect(formatPdfNumber(-0)).toBe("0");
    expect(formatPdfNumber(-0.00001)).toBe("0");
    expect(formatPdfNumber(-0.004, 2)).toBe("0");
  });

  it("writes fewer places when asked, and never more than four", () => {
    expect(formatPdfNumber(1.239, 2)).toBe("1.24");
    expect(formatPdfNumber(841.89, 2)).toBe("841.89");
    expect(formatPdfNumber(12.6, 0)).toBe("13");
    expect(formatPdfNumber(1 / 3, 9)).toBe("0.3333");
  });

  it("refuses numbers a PDF can't hold", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e21]) {
      expect(() => formatPdfNumber(value)).toThrow(TypeError);
    }
  });

  it("stays within half a ten-thousandth of any number, in PDF's syntax", () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (value) => {
        const text = formatPdfNumber(value);
        expect(text).toMatch(/^-?\d+(\.\d{1,4})?$/);
        expect(text).not.toMatch(/^-0(\.0+)?$/);
        expect(Math.abs(Number(text) - value)).toBeLessThanOrEqual(0.00005 + 1e-7);
      }),
    );
  });
});

describe("serializePdfObject", () => {
  it("writes the simple objects", () => {
    expect(serializePdfObject(null)).toBe("null");
    expect(serializePdfObject(true)).toBe("true");
    expect(serializePdfObject(false)).toBe("false");
    expect(serializePdfObject(-0)).toBe("0");
    expect(serializePdfObject(new PdfRef(12))).toBe("12 0 R");
    expect(serializePdfObject(pdfName("FlateDecode"))).toBe("/FlateDecode");
  });

  it("escapes what a name can't hold as it is", () => {
    expect(serializePdfObject(pdfName("A B"))).toBe("/A#20B");
    expect(serializePdfObject(pdfName("a/b#c(d)"))).toBe("/a#2fb#23c#28d#29");
    // Outside ASCII, a name holds the character's UTF-8 bytes.
    expect(serializePdfObject(pdfName("\u00e9"))).toBe("/#c3#a9");
  });

  it("escapes parentheses, backslashes and every byte that isn't printable ASCII", () => {
    const bytes = Uint8Array.of(0x41, 0x28, 0x29, 0x5c, 0x0a, 0x00, 0xe9, 0x80, 0x31);
    expect(serializePdfObject(new PdfString(bytes))).toBe("(A\\(\\)\\\\\\012\\000\\351\\2001)");
  });

  it("writes a hexadecimal string, two digits a byte", () => {
    expect(serializePdfObject(new PdfString(Uint8Array.of(0, 0x0f, 0xfe, 0xff), true))).toBe(
      "<000ffeff>",
    );
  });

  it("writes arrays and dictionaries, nested, leaving undefined entries out", () => {
    expect(
      serializePdfObject({
        Type: pdfName("Page"),
        MediaBox: [0, 0, 595, 841.89],
        Missing: undefined,
        Resources: { Font: { F1: new PdfRef(4) }, Empty: {} },
        Kids: [],
      }),
    ).toBe(
      "<< /Type /Page /MediaBox [0 0 595 841.89] /Resources << /Font << /F1 4 0 R >> /Empty <<>> >> /Kids [] >>",
    );
  });
});

describe("pdfTextString", () => {
  it("writes printable ASCII as a literal string", () => {
    expect(serializePdfObject(pdfTextString("Notes (draft)"))).toBe("(Notes \\(draft\\))");
    expect(serializePdfObject(pdfTextString(""))).toBe("()");
  });

  it("writes anything else as UTF-16BE with a byte order mark, in hexadecimal", () => {
    expect(serializePdfObject(pdfTextString("A\u00f1o"))).toBe("<feff004100f1006f>");
    // Outside the basic plane: a surrogate pair.
    expect(serializePdfObject(pdfTextString("\u{1f600}"))).toBe("<feffd83dde00>");
    // A control character isn't printable, so the whole string is hexadecimal.
    expect(serializePdfObject(pdfTextString("a\nb"))).toBe("<feff0061000a0062>");
  });
});

describe("deflate", () => {
  it("compresses in the zlib format, which FlateDecode reads", async () => {
    const bytes = new TextEncoder().encode("0 0 m 10 10 l S\n".repeat(200));
    const compressed = await deflate(bytes);
    expect(compressed).toBeDefined();
    expect(compressed?.length).toBeLessThan(bytes.length);
    expect(new Uint8Array(inflateSync(compressed ?? bytes))).toEqual(bytes);
  });

  it("resolves to undefined where the platform can't compress", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    await expect(deflate(Uint8Array.of(1, 2, 3))).resolves.toBeUndefined();
  });
});

describe("PdfWriter", () => {
  it("writes a header that marks the file as binary", () => {
    const writer = new PdfWriter();
    const bytes = writer.finish(writer.add({ Type: pdfName("Catalog") }));
    expect(Buffer.from(bytes.subarray(0, 10)).toString("latin1")).toBe("%PDF-1.7\n%");
    expect([...bytes.subarray(10, 14)].every((byte) => byte > 127)).toBe(true);
    expect(bytes[14]).toBe(0x0a);
  });

  it("writes a cross-reference table whose every offset points at its object", () => {
    const writer = new PdfWriter();
    const catalog = writer.reserve();
    const pages = writer.add({ Type: pdfName("Pages"), Kids: [], Count: 0 });
    const info = writer.add({ Producer: pdfTextString("test") });
    writer.set(catalog, { Type: pdfName("Catalog"), Pages: pages });
    // readPdf checks the table: 20-byte entries, each at "N 0 obj".
    const pdf = readPdf(writer.finish(catalog, info));
    expect([...pdf.objects.keys()]).toEqual([1, 2, 3]);
    expect(pdf.trailer).toBe("<< /Size 4 /Root 1 0 R /Info 3 0 R >>");
    expect(referenced(pdf, pdf.trailer, "Root").text).toBe("<< /Type /Catalog /Pages 2 0 R >>");
    expect(referenced(pdf, pdf.trailer, "Info").text).toBe("<< /Producer (test) >>");
  });

  it("leaves Info out of the trailer when there is none", () => {
    const writer = new PdfWriter();
    const pdf = readPdf(writer.finish(writer.add({ Type: pdfName("Catalog") })));
    expect(pdf.trailer).toBe("<< /Size 2 /Root 1 0 R >>");
  });

  it("refuses to finish with an object reserved and never set", () => {
    const writer = new PdfWriter();
    const root = writer.add({});
    writer.reserve();
    expect(() => writer.finish(root)).toThrow(TypeError);
  });

  it("refuses to set an object twice, or one that isn't its own", () => {
    const writer = new PdfWriter();
    const ref = writer.add({});
    expect(() => writer.set(ref, {})).toThrow(TypeError);
    expect(() => writer.set(new PdfRef(7), {})).toThrow(TypeError);
    expect(() => writer.set(new PdfRef(0), {})).toThrow(TypeError);
  });

  it("writes a compressed stream with its filter and its stored length", async () => {
    const writer = new PdfWriter();
    const data = new TextEncoder().encode("1 0 0 RG 0 0 m 100 100 l S\n".repeat(100));
    const stream = await writer.addStream({ Kind: pdfName("Test") }, data, { compress: true });
    const pdf = readPdf(writer.finish(writer.add({ Stream: stream })));
    const object = pdf.objects.get(stream.id);
    expect(object?.text).toBe(
      `<< /Kind /Test /Filter /FlateDecode /Length ${object?.raw?.length} >>`,
    );
    expect(object?.raw?.length).toBeLessThan(data.length);
    expect(object?.data).toEqual(data);
  });

  it("writes a stream as it is when not asked to compress, byte for byte", async () => {
    const writer = new PdfWriter();
    // Every byte value, and the words that end a stream and an object.
    const data = Uint8Array.from([
      ...Array.from({ length: 256 }, (_, byte) => byte),
      ...new TextEncoder().encode("\nendstream\nendobj\n"),
    ]);
    const stream = await writer.addStream({ Filter: pdfName("DCTDecode") }, data);
    const pdf = readPdf(writer.finish(writer.add({ Stream: stream })));
    const object = pdf.objects.get(stream.id);
    expect(object?.text).toBe(`<< /Filter /DCTDecode /Length ${data.length} >>`);
    expect(object?.raw).toEqual(data);
  });

  it("writes a stream uncompressed where the platform can't compress", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const writer = new PdfWriter();
    const data = new TextEncoder().encode("0 0 m 1 1 l S\n".repeat(50));
    const stream = await writer.addStream({}, data, { compress: true });
    const pdf = readPdf(writer.finish(writer.add({ Stream: stream })));
    expect(pdf.objects.get(stream.id)?.text).toBe(`<< /Length ${data.length} >>`);
    expect(pdf.objects.get(stream.id)?.raw).toEqual(data);
  });

  it("numbers objects in the order they were added, whatever finishes compressing first", async () => {
    const writer = new PdfWriter();
    const large = new Uint8Array(200_000).fill(7);
    const [first, second] = await Promise.all([
      writer.addStream({}, large, { compress: true }),
      writer.addStream({}, Uint8Array.of(1), { compress: true }),
    ]);
    const third = writer.add({});
    expect([first.id, second.id, third.id]).toEqual([1, 2, 3]);
    const pdf = readPdf(writer.finish(third));
    expect(pdf.objects.get(1)?.data).toEqual(large);
    expect(pdf.objects.get(2)?.data).toEqual(Uint8Array.of(1));
  });

  it("keeps any stream's bytes, compressed or not", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ maxLength: 2_000 }),
        fc.boolean(),
        async (data, compress) => {
          const writer = new PdfWriter();
          const stream = await writer.addStream({}, data, { compress });
          const pdf = readPdf(writer.finish(writer.add({ Stream: stream })));
          expect(pdf.objects.get(stream.id)?.data).toEqual(data);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("writes the same bytes for the same calls", async () => {
    const build = async (): Promise<Uint8Array> => {
      const writer = new PdfWriter();
      const stream = await writer.addStream({}, new Uint8Array(5_000).fill(3), { compress: true });
      return writer.finish(writer.add({ Stream: stream }));
    };
    expect(await build()).toEqual(await build());
  });
});
