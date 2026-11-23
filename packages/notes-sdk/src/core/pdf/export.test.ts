import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isNotesError } from "../errors/notes-error.js";
import { outlineSegments, strokeOutline } from "../ink/outline.js";
import type {
  NotesColor,
  NotesImage,
  NotesItem,
  NotesLink,
  NotesStroke,
  NotesStrokeTool,
  NotesText,
} from "../model/items.js";
import type { NotesPageInfo, NotesTemplate } from "../model/notebook.js";
import { NOTES_MAX_PAGE_SIDE } from "../model/portable.js";
import { templateMarks } from "../model/templates.js";
import {
  type NotesExportImage,
  type NotesPdfExportPage,
  type NotesTextLayout,
  wrapText,
  writeNotesPdf,
} from "./export.js";
import {
  type ContentOperator,
  contentOf,
  literalBytes,
  operatorsOf,
  pagesOf,
  type ReadPdf,
  type ReadPdfObject,
  readPdf,
  referenced,
} from "./fixtures/read-pdf.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const RED: NotesColor = "#d92d20";
const BLUE: NotesColor = "#1570ef";
const YELLOW: NotesColor = "#fdb022";
/** The colours above as `rg` writes them: each channel over 255, to four decimals. */
const RED_RG = "0.851 0.1765 0.1255";
const BLUE_RG = "0.0824 0.4392 0.9373";
const YELLOW_RG = "0.9922 0.6902 0.1333";

function pageInfo(
  template: NotesTemplate = "blank",
  width = 59_500,
  height = 84_200,
): NotesPageInfo {
  return { id: "page", width, height, template };
}

function page(items: readonly NotesItem[], paper = true, info = pageInfo()): NotesPdfExportPage {
  return { info, items, paper };
}

function stroke(id: string, tool: NotesStrokeTool, color: NotesColor, y = 10_000): NotesStroke {
  const points = [5_000, y, 500, 12_000, y + 800, 700, 20_000, y, 600, 30_000, y + 1_500, 400];
  return { id, type: "stroke", tool, color, size: 400, points };
}

function text(value: string, overrides: Partial<NotesText> = {}): NotesText {
  return {
    id: "text",
    type: "text",
    x: 5_000,
    y: 20_000,
    width: 30_000,
    text: value,
    size: 1_000,
    color: BLUE,
    ...overrides,
  };
}

function image(id: string, asset: string, overrides: Partial<NotesImage> = {}): NotesImage {
  return {
    id,
    type: "image",
    x: 4_000,
    y: 6_000,
    width: 12_000,
    height: 9_000,
    image: { asset: `sha256:${asset.repeat(64)}`, mediaType: "image/png", size: 100 },
    ...overrides,
  };
}

/** A JPEG as far as its frame header, which is all the exporter reads of it. */
function jpeg(frameMarker: number, width: number, height: number, components: number): Uint8Array {
  return Uint8Array.of(
    ...[0xff, 0xd8],
    // An APP0 segment to step over, with a few bytes in it.
    ...[0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00],
    ...[0xff, frameMarker, 0x00, 8 + components * 3, 8],
    ...[height >> 8, height & 0xff, width >> 8, width & 0xff, components],
    ...Array.from({ length: components * 3 }, () => 0x11),
    // A scan, some data that holds bytes above 127, and the end.
    ...[0xff, 0xda, 0x00, 0x02, 0x80, 0xfe, 0x00, 0xc3, 0xff, 0xd9],
  );
}

function rgba(width: number, height: number, pixel: readonly number[]): NotesExportImage {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < data.length; index += 1) data[index] = pixel[index % 4] ?? 0;
  return { kind: "rgba", width, height, data };
}

interface Exported {
  readonly bytes: Uint8Array;
  readonly pdf: ReadPdf;
  readonly pages: readonly ReadPdfObject[];
  /** Each page's operators. */
  readonly operators: readonly (readonly ContentOperator[])[];
}

async function exported(...parameters: Parameters<typeof writeNotesPdf>): Promise<Exported> {
  const bytes = await writeNotesPdf(...parameters);
  const pdf = readPdf(bytes);
  const pages = pagesOf(pdf);
  return {
    bytes,
    pdf,
    pages,
    operators: pages.map((each) => operatorsOf(contentOf(pdf, each))),
  };
}

const named = (operators: readonly ContentOperator[], operator: string): ContentOperator[] =>
  operators.filter((each) => each.operator === operator);

const lines = (operators: readonly ContentOperator[]): string[] =>
  operators.map((each) =>
    each.operands === "" ? each.operator : `${each.operands} ${each.operator}`,
  );

/** The image objects of a file. */
const imagesOf = (pdf: ReadPdf): ReadPdfObject[] =>
  [...pdf.objects.values()].filter((object) => object.text.includes("/Subtype /Image"));

describe("writeNotesPdf: the document", () => {
  it("rejects with a TypeError when there are no pages", async () => {
    await expect(writeNotesPdf([])).rejects.toBeInstanceOf(TypeError);
  });

  it("writes one page per entry, in order, each with its size in points", async () => {
    const { pdf, pages, operators } = await exported([
      page([]),
      page([], true, pageInfo("blank", 61_200, 79_200)),
      page([], false, pageInfo("blank", 10_050, 20_025)),
    ]);
    expect(pages.map((each) => /\/MediaBox \[([^\]]*)\]/.exec(each.text)?.[1])).toEqual([
      "0 0 595 842",
      "0 0 612 792",
      "0 0 100.5 200.25",
    ]);
    const tree = referenced(pdf, referenced(pdf, pdf.trailer, "Root").text, "Pages");
    expect(tree.text).toContain("/Type /Pages");
    expect(tree.text).toContain("/Count 3");
    for (const each of pages) {
      expect(each.text).toContain("/Type /Page ");
      expect(each.text).toContain(`/Parent ${tree.id} 0 R`);
    }
    // One transform first: page units from the top-left corner, y downwards.
    expect(lines(operators[0] ?? [])[0]).toBe("0.01 0 0 -0.01 0 842 cm");
    expect(lines(operators[1] ?? [])[0]).toBe("0.01 0 0 -0.01 0 792 cm");
    expect(lines(operators[2] ?? [])[0]).toBe("0.01 0 0 -0.01 0 200.25 cm");
    for (const each of operators) expect(named(each, "cm")).toHaveLength(1);
  });

  it("is a PDF 1.7 file with a catalog and compressed page contents", async () => {
    const { bytes, pdf, pages } = await exported([page([stroke("a", "pen", RED)])]);
    expect(Buffer.from(bytes.subarray(0, 9)).toString("latin1")).toBe("%PDF-1.7\n");
    expect(referenced(pdf, pdf.trailer, "Root").text).toContain("/Type /Catalog");
    const first = pages[0];
    expect(first && referenced(pdf, first.text, "Contents").text).toContain("/Filter /FlateDecode");
  });

  it("writes its contents uncompressed where the platform can't compress", async () => {
    vi.stubGlobal("CompressionStream", undefined);
    const { pdf, pages, operators } = await exported([page([stroke("a", "pen", RED)])]);
    const first = pages[0];
    expect(first && referenced(pdf, first.text, "Contents").text).not.toContain("/Filter");
    expect(named(operators[0] ?? [], "f")).toHaveLength(2);
  });

  it("names its producer and its title, and has no date without a clock", async () => {
    const { pdf } = await exported([page([])], {}, { title: "Lecture (week 3)" });
    expect(referenced(pdf, pdf.trailer, "Info").text).toBe(
      "<< /Title (Lecture \\(week 3\\)) /Producer (@hussmartinez/notes-sdk) >>",
    );
    const untitled = await exported([page([])]);
    expect(referenced(untitled.pdf, untitled.pdf.trailer, "Info").text).toBe(
      "<< /Producer (@hussmartinez/notes-sdk) >>",
    );
  });

  it("writes a title outside ASCII as UTF-16BE, in hexadecimal", async () => {
    const { pdf } = await exported([page([])], {}, { title: "A\u00f1o \u4e2d" });
    expect(referenced(pdf, pdf.trailer, "Info").text).toContain(
      "/Title <feff004100f1006f00204e2d>",
    );
  });

  it("takes its creation date from the clock it's given, in UTC", async () => {
    const now = (): number => Date.UTC(2026, 10, 23, 9, 5, 7);
    const { pdf } = await exported([page([])], {}, { now });
    expect(referenced(pdf, pdf.trailer, "Info").text).toContain(
      "/CreationDate (D:20261123090507Z)",
    );
  });

  it("writes the same bytes for the same input", async () => {
    const pages = [
      page(
        [
          stroke("a", "pen", RED),
          stroke("b", "highlighter", YELLOW),
          text("Hello\nworld"),
          image("i", "a"),
        ],
        true,
        pageInfo("dotted"),
      ),
      page([stroke("c", "pen", BLUE)], false),
    ];
    const ports = { loadImage: async () => rgba(3, 2, [10, 20, 30, 128]) };
    const options = { title: "Notes", now: () => 1_700_000_000_000 };
    const first = await writeNotesPdf(pages, ports, options);
    const second = await writeNotesPdf(pages, ports, options);
    expect(first).toEqual(second);
  });

  it("reports progress after each page", async () => {
    const fractions: number[] = [];
    await writeNotesPdf(
      [page([]), page([]), page([]), page([])],
      {},
      { onProgress: ({ fraction }) => fractions.push(fraction) },
    );
    expect(fractions).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it("rejects with ABORTED when the signal has aborted already", async () => {
    const loadImage = vi.fn(async () => rgba(1, 1, [0, 0, 0, 255]));
    const failure = await writeNotesPdf(
      [page([image("i", "a")])],
      { loadImage },
      { signal: AbortSignal.abort() },
    ).catch((error: unknown) => error);
    expect(isNotesError(failure, "ABORTED")).toBe(true);
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("rejects with ABORTED between pages, and leaves the rest unwritten", async () => {
    const controller = new AbortController();
    const loadImage = vi.fn(async () => rgba(1, 1, [0, 0, 0, 255]));
    const fractions: number[] = [];
    const failure = await writeNotesPdf(
      [page([]), page([image("i", "a")]), page([])],
      { loadImage },
      {
        signal: controller.signal,
        onProgress: ({ fraction }) => {
          fractions.push(fraction);
          controller.abort();
        },
      },
    ).catch((error: unknown) => error);
    expect(isNotesError(failure, "ABORTED")).toBe(true);
    expect(fractions).toEqual([1 / 3]);
    expect(loadImage).not.toHaveBeenCalled();
  });

  it("rejects with ABORTED when the signal aborts while an image loads", async () => {
    const controller = new AbortController();
    const failure = await writeNotesPdf(
      [page([image("i", "a")])],
      {
        loadImage: async () => {
          controller.abort();
          return rgba(1, 1, [0, 0, 0, 255]);
        },
      },
      { signal: controller.signal },
    ).catch((error: unknown) => error);
    expect(isNotesError(failure, "ABORTED")).toBe(true);
  });
});

describe("writeNotesPdf: paper", () => {
  it("fills a page with paper white before anything else", async () => {
    const { operators } = await exported([page([stroke("a", "pen", RED)])]);
    expect(lines(operators[0] ?? []).slice(1, 4)).toEqual(["1 1 1 rg", "0 0 59500 84200 re", "f"]);
  });

  it("paints nothing under the ink of a page without paper, which stays transparent", async () => {
    const { operators } = await exported([
      page([stroke("a", "pen", RED)], false, pageInfo("lined")),
    ]);
    const all = operators[0] ?? [];
    expect(named(all, "re")).toHaveLength(0);
    expect(named(all, "S")).toHaveLength(0);
    expect(lines(all)).not.toContain("1 1 1 rg");
    // Only the stroke: its colour, its path, one fill.
    expect(lines(all)[1]).toBe(`${RED_RG} rg`);
    expect(named(all, "f")).toHaveLength(1);
  });

  it("writes only its transform for a blank page without paper", async () => {
    const { operators, pages } = await exported([page([], false)]);
    expect(lines(operators[0] ?? [])).toEqual(["0.01 0 0 -0.01 0 842 cm"]);
    expect(pages[0]?.text).toContain("/Resources <<>>");
  });

  it.each(["lined", "grid"] as const)(
    "rules %s paper with its template's lines",
    async (template) => {
      const info = pageInfo(template);
      const marks = templateMarks(template, info.width, info.height);
      const { operators } = await exported([page([], true, info)]);
      const all = lines(operators[0] ?? []);
      expect(marks.lines.length).toBeGreaterThan(0);
      // After the ground: the rules' colour and width, a line each, one stroke.
      expect(all.slice(4, 6)).toEqual(["0.7647 0.7961 0.8392 RG", "50 w"]);
      const ruled = all.slice(6, -1);
      expect(ruled).toHaveLength((marks.lines.length / 4) * 2);
      for (let index = 0; index < marks.lines.length; index += 4) {
        const [x1, y1, x2, y2] = marks.lines.slice(index, index + 4);
        expect(ruled[index / 2]).toBe(`${x1} ${y1} m`);
        expect(ruled[index / 2 + 1]).toBe(`${x2} ${y2} l`);
      }
      expect(all.at(-1)).toBe("S");
    },
  );

  it("dots dotted paper with one row of filled circles, painted once for each row", async () => {
    const info = pageInfo("dotted", 12_000, 9_000);
    const marks = templateMarks("dotted", info.width, info.height);
    const { pdf, pages, operators } = await exported([page([], true, info)]);
    const all = lines(operators[0] ?? []);
    const columns = [750, 2_250, 3_750, 5_250, 6_750, 8_250, 9_750, 11_250];
    const rows = [750, 2_250, 3_750, 5_250, 6_750, 8_250];
    // Every dot of the template, once: each row's place times each column's.
    expect(rows.flatMap((y) => columns.flatMap((x) => [x, y]))).toEqual(marks.dots);
    // After the ground: the dots' colour, then the row moved to each of its places.
    expect(all[4]).toBe("0.7647 0.7961 0.8392 rg");
    expect(all.slice(5)).toEqual(rows.flatMap((y) => ["q", `1 0 0 1 0 ${y} cm`, "/Fm1 Do", "Q"]));
    const row = referenced(pdf, pages[0]?.text ?? "", "Fm1");
    expect(row.text).toBe(
      `<< /Type /XObject /Subtype /Form /BBox [675 -75 11325 75] /Resources <<>> /Filter /FlateDecode /Length ${row.raw?.length} >>`,
    );
    const drawn = operatorsOf(Buffer.from(row.data ?? []).toString("latin1"));
    // A circle for each column, on the row's own line, starting at its right
    // side, half the dot's size away. One fill for them all.
    expect(named(drawn, "m").map((start) => start.numbers)).toEqual(
      columns.map((x) => [x + marks.dotSize / 2, 0]),
    );
    expect(named(drawn, "c")).toHaveLength(columns.length * 4);
    expect(named(drawn, "h")).toHaveLength(columns.length);
    expect(lines(drawn).at(-1)).toBe("f");
    expect(named(drawn, "f")).toHaveLength(1);
  });

  it("writes the row of dots once for pages of one width, and again for another", async () => {
    const { pdf, pages } = await exported([
      page([], true, pageInfo("dotted", 12_000, 9_000)),
      page([], true, pageInfo("dotted", 12_000, 30_000)),
      page([], true, pageInfo("dotted", 13_000, 9_000)),
      page([], true, pageInfo("lined", 12_000, 9_000)),
    ]);
    const rowOf = (index: number): number => referenced(pdf, pages[index]?.text ?? "", "Fm\\d+").id;
    expect(rowOf(1)).toBe(rowOf(0));
    expect(rowOf(2)).not.toBe(rowOf(0));
    expect(pages[0]?.text).toContain("/XObject << /Fm1 ");
    expect(pages[2]?.text).toContain("/XObject << /Fm2 ");
    expect(pages[3]?.text).not.toContain("/XObject");
    const forms = [...pdf.objects.values()].filter((each) => each.text.includes("/Subtype /Form"));
    expect(forms).toHaveLength(2);
  });

  it("keeps the largest dotted page a document may hold small", async () => {
    // 960 rows of 960 dots: 921,600 dots, written as one row and its 960 places.
    const info = pageInfo("dotted", NOTES_MAX_PAGE_SIDE, NOTES_MAX_PAGE_SIDE);
    const { bytes, operators } = await exported([page([], true, info)]);
    expect(named(operators[0] ?? [], "Do")).toHaveLength(960);
    expect(operators[0]?.length).toBeLessThan(4_000);
    expect(bytes.length).toBeLessThan(200_000);
  });

  it("draws no marks on blank paper", async () => {
    const { operators } = await exported([page([])]);
    expect(lines(operators[0] ?? [])).toEqual([
      "0.01 0 0 -0.01 0 842 cm",
      "1 1 1 rg",
      "0 0 59500 84200 re",
      "f",
    ]);
  });
});

describe("writeNotesPdf: ink", () => {
  it("writes a pen stroke as its outline, closed and filled with its colour", async () => {
    const pen = stroke("a", "pen", RED);
    const segments = outlineSegments(strokeOutline(pen));
    const { operators } = await exported([page([pen], false)]);
    const all = operators[0] ?? [];
    const curves = (segments.length - 2) / 4;
    expect(curves).toBeGreaterThan(4);
    expect(all.map((each) => each.operator)).toEqual([
      "cm",
      "rg",
      "m",
      ...Array.from({ length: curves }, () => "c"),
      "h",
      "f",
    ]);
    expect(all[1]?.operands).toBe(RED_RG);
    expect(all[2]?.numbers).toEqual([segments[0], segments[1]]);
    // Each curve ends where its quadratic segment does, and the last one
    // where the path started.
    const drawn = named(all, "c");
    for (const [index, curve] of drawn.entries()) {
      expect(curve.numbers.slice(4)).toEqual([segments[4 + index * 4], segments[5 + index * 4]]);
    }
    expect(drawn.at(-1)?.numbers.slice(4)).toEqual([segments[0], segments[1]]);
    // The first curve's control points: two thirds of the way from each end
    // to the quadratic's control point.
    const [startX = 0, startY = 0, controlX = 0, controlY = 0, endX = 0, endY = 0] = segments;
    const [c1x, c1y, c2x, c2y] = drawn[0]?.numbers ?? [];
    expect(c1x).toBeCloseTo(startX + (2 * (controlX - startX)) / 3, 1);
    expect(c1y).toBeCloseTo(startY + (2 * (controlY - startY)) / 3, 1);
    expect(c2x).toBeCloseTo(endX + (2 * (controlX - endX)) / 3, 1);
    expect(c2y).toBeCloseTo(endY + (2 * (controlY - endY)) / 3, 1);
  });

  it("uses no graphics state for pen strokes alone", async () => {
    const { operators, pages } = await exported([page([stroke("a", "pen", RED)], false)]);
    expect(named(operators[0] ?? [], "gs")).toHaveLength(0);
    expect(pages[0]?.text).not.toContain("/ExtGState");
  });

  it("draws highlighter strokes first, multiplied and translucent, whatever the order of items", async () => {
    const { pdf, pages, operators } = await exported([
      page(
        [
          stroke("a", "pen", RED),
          stroke("b", "highlighter", YELLOW, 30_000),
          stroke("c", "pen", BLUE, 50_000),
          stroke("d", "highlighter", YELLOW, 60_000),
        ],
        false,
      ),
    ]);
    const all = lines(operators[0] ?? []);
    // Colours, fills and state changes, in the order they're written.
    const order = all.filter((line) => /( rg| gs)$|^(q|Q|f)$/.test(line));
    expect(order).toEqual([
      "q",
      "/GS1 gs",
      `${YELLOW_RG} rg`,
      "f",
      `${YELLOW_RG} rg`,
      "f",
      "Q",
      `${RED_RG} rg`,
      "f",
      `${BLUE_RG} rg`,
      "f",
    ]);
    const state = referenced(pdf, pages[0]?.text ?? "", "GS1");
    expect(state.text).toBe("<< /Type /ExtGState /BM /Multiply /ca 0.4 >>");
  });

  it("shares one highlighter state between pages", async () => {
    const { pdf, pages } = await exported([
      page([stroke("a", "highlighter", YELLOW)]),
      page([stroke("b", "highlighter", YELLOW)]),
    ]);
    const states = pages.map((each) => referenced(pdf, each.text, "GS1").id);
    expect(states[0]).toBe(states[1]);
    const all = [...pdf.objects.values()].filter((object) =>
      object.text.includes("/Type /ExtGState"),
    );
    expect(all).toHaveLength(1);
  });

  it("draws nothing for a stroke with no points, or for a link", async () => {
    const empty: NotesStroke = { ...stroke("a", "pen", RED), points: [] };
    const link: NotesLink = {
      id: "l",
      type: "link",
      x: 1_000,
      y: 1_000,
      width: 5_000,
      height: 2_000,
      page: "other",
    };
    const { operators } = await exported([page([empty, link], false)]);
    expect(lines(operators[0] ?? [])).toEqual(["0.01 0 0 -0.01 0 842 cm"]);
  });
});

describe("writeNotesPdf: text", () => {
  it("writes each line with Helvetica, at the item's size and colour, upright", async () => {
    const item = text("Hello\nworld");
    const { pdf, pages, operators } = await exported([page([item], false)]);
    // The fallback layout: lines 1.25 of the size apart, the baseline 0.93 down.
    expect(lines(operators[0] ?? []).slice(1)).toEqual([
      "q",
      `${BLUE_RG} rg`,
      "BT",
      "/F1 1000 Tf",
      "1 0 0 -1 5000 20930 Tm",
      "(Hello) Tj",
      "1 0 0 -1 5000 22180 Tm",
      "(world) Tj",
      "ET",
      "Q",
    ]);
    expect(referenced(pdf, pages[0]?.text ?? "", "F1").text).toBe(
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    );
  });

  it("writes text as WinAnsi bytes", async () => {
    const { operators } = await exported([page([text("caf\u00e9 (5 \u20ac)")], false)]);
    const shown = named(operators[0] ?? [], "Tj")[0];
    expect(literalBytes(shown?.operands ?? "")).toEqual([
      0x63, 0x61, 0x66, 0xe9, 0x20, 0x28, 0x35, 0x20, 0x80, 0x29,
    ]);
  });

  it("wraps with Helvetica's widths when the host gives no layout, and skips empty lines", async () => {
    // "aaa bbb" is 3614 wide at this size and "aaa bbb ccc" 5560.
    const item = text("aaa bbb ccc\n\nddd", { width: 4_000 });
    const { operators } = await exported([page([item], false)]);
    const all = operators[0] ?? [];
    expect(named(all, "Tj").map((each) => each.operands)).toEqual(["(aaa bbb)", "(ccc)", "(ddd)"]);
    expect(named(all, "Tm").map((each) => each.numbers[5])).toEqual([20_930, 22_180, 24_680]);
    expect(named(all, "Tz")).toHaveLength(0);
  });

  it("stretches each line to the width the host measured, within 50% and 200%", async () => {
    // "Hello" is 2278 wide in Helvetica at this size.
    const layout: NotesTextLayout = {
      lines: [
        { text: "Hello", width: 2_505.8 },
        { text: "", width: 0 },
        { text: "Hello", width: 2_050.2 },
        { text: "Hello", width: 10_000 },
        { text: "Hello", width: 100 },
      ],
      lineHeight: 1_400,
      ascent: 1_100,
    };
    const layoutText = vi.fn(() => layout);
    const item = text("Hello\n\nHello Hello Hello");
    const { operators } = await exported([page([item], false)], { layoutText });
    expect(layoutText).toHaveBeenCalledExactlyOnceWith(item);
    expect(lines(operators[0] ?? []).slice(4, -2)).toEqual([
      "/F1 1000 Tf",
      "110 Tz",
      "1 0 0 -1 5000 21100 Tm",
      "(Hello) Tj",
      "90 Tz",
      "1 0 0 -1 5000 23900 Tm",
      "(Hello) Tj",
      "200 Tz",
      "1 0 0 -1 5000 25300 Tm",
      "(Hello) Tj",
      "50 Tz",
      "1 0 0 -1 5000 26700 Tm",
      "(Hello) Tj",
    ]);
  });

  it("keeps one box's scaling from the next", async () => {
    const layoutText = (item: NotesText): NotesTextLayout => ({
      lines: [{ text: item.text, width: item.id === "wide" ? 4_556 : 0 }],
      lineHeight: 1_250,
      ascent: 930,
    });
    const { operators } = await exported(
      [page([text("Hello", { id: "wide" }), text("Hello", { id: "unmeasured" })], false)],
      { layoutText },
    );
    // The second box sets no scaling of its own, so the first box's must
    // have been restored before it.
    expect(lines(operators[0] ?? []).filter((line) => /( Tz| Tj)$|^(q|Q)$/.test(line))).toEqual([
      "q",
      "200 Tz",
      "(Hello) Tj",
      "Q",
      "q",
      "(Hello) Tj",
      "Q",
    ]);
  });

  it("leaves out soft hyphens and the line break a measured line may end with", async () => {
    const layoutText = (): NotesTextLayout => ({
      lines: [{ text: "co\u00adoperate\n", width: 4_000 }],
      lineHeight: 1_250,
      ascent: 930,
    });
    const rasterizeText = vi.fn(async () => undefined);
    const { operators } = await exported([page([text("co\u00adoperate\n")], false)], {
      layoutText,
      rasterizeText,
    });
    expect(named(operators[0] ?? [], "Tj")[0]?.operands).toBe("(cooperate)");
    expect(rasterizeText).not.toHaveBeenCalled();
  });

  it("asks the host for a picture of text Helvetica can't write, and places it over the box", async () => {
    const item = text("\u4e2d\u6587\nabc", { x: 3_000, y: 7_000, width: 20_000 });
    const rasterizeText = vi.fn(async () => rgba(4, 2, [0, 0, 0, 200]));
    const { pdf, pages, operators } = await exported([page([item], false)], { rasterizeText });
    const layout = wrapText(item.text, item.width, item.size);
    expect(rasterizeText).toHaveBeenCalledExactlyOnceWith(item, layout);
    // Two lines of 1250 each: the box is 2500 high, and the image's matrix
    // turns it over, so its first row is at the box's top.
    expect(lines(operators[0] ?? []).slice(1)).toEqual([
      "q",
      "20000 0 0 -2500 3000 9500 cm",
      "/Im1 Do",
      "Q",
    ]);
    expect(pages[0]?.text).not.toContain("/Font");
    expect(referenced(pdf, pages[0]?.text ?? "", "Im1").text).toContain("/Width 4 /Height 2");
  });

  it("never asks for a picture of text Helvetica can write", async () => {
    const rasterizeText = vi.fn(async () => rgba(1, 1, [0, 0, 0, 255]));
    const { operators } = await exported([page([text("Plain \u00e9\u20ac")], false)], {
      rasterizeText,
    });
    expect(rasterizeText).not.toHaveBeenCalled();
    expect(named(operators[0] ?? [], "Tj")).toHaveLength(1);
  });

  it.each([
    ["no port", undefined],
    ["a port that gives nothing", async () => undefined],
    [
      "a port that gives a picture that can't be embedded",
      async () => ({ kind: "rgba" as const, width: 2, height: 2, data: new Uint8Array(3) }),
    ],
  ])("writes a question mark for each character it can't write, with %s", async (_name, port) => {
    const item = text("a\u4e2db\tc\u{1f600}");
    const { operators } = await exported(
      [page([item], false)],
      port ? { rasterizeText: port } : {},
    );
    expect(named(operators[0] ?? [], "Tj").map((each) => each.operands)).toEqual(["(a?b?c?)"]);
    expect(named(operators[0] ?? [], "Do")).toHaveLength(0);
  });

  it("writes nothing for a box whose lines are all empty", async () => {
    const { operators, pages } = await exported([page([text("\n\n")], false)]);
    expect(lines(operators[0] ?? [])).toEqual(["0.01 0 0 -0.01 0 842 cm"]);
    expect(pages[0]?.text).not.toContain("/Font");
  });

  it("shares one font between pages", async () => {
    const { pdf, pages } = await exported([page([text("a")]), page([text("b")])]);
    const fonts = pages.map((each) => referenced(pdf, each.text, "F1").id);
    expect(fonts[0]).toBe(fonts[1]);
  });
});

describe("writeNotesPdf: images", () => {
  it("embeds a JPEG as it is, with the size and colours its frame header gives", async () => {
    const bytes = jpeg(0xc0, 640, 480, 3);
    const item = image("i", "a");
    const loadImage = vi.fn(async () => ({ kind: "jpeg" as const, width: 1, height: 1, bytes }));
    const { pdf, pages, operators } = await exported([page([item], false)], { loadImage });
    expect(loadImage).toHaveBeenCalledExactlyOnceWith(item);
    const embedded = referenced(pdf, pages[0]?.text ?? "", "Im1");
    expect(embedded.text).toBe(
      `<< /Type /XObject /Subtype /Image /Width 640 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>`,
    );
    expect(embedded.raw).toEqual(bytes);
    // Sized and placed over its rectangle, and turned over so its first row
    // is at the top.
    expect(lines(operators[0] ?? []).slice(1)).toEqual([
      "q",
      "12000 0 0 -9000 4000 15000 cm",
      "/Im1 Do",
      "Q",
    ]);
  });

  it("embeds a grey JPEG in DeviceGray, and a progressive one as it is", async () => {
    const grey = jpeg(0xc0, 20, 10, 1);
    const progressive = jpeg(0xc2, 30, 40, 3);
    const { pdf, pages } = await exported([page([image("g", "a"), image("p", "b")], false)], {
      loadImage: async (item) => ({
        kind: "jpeg",
        width: 0,
        height: 0,
        bytes: item.id === "g" ? grey : progressive,
      }),
    });
    const first = referenced(pdf, pages[0]?.text ?? "", "Im1");
    expect(first.text).toContain("/Width 20 /Height 10 /ColorSpace /DeviceGray");
    expect(first.raw).toEqual(grey);
    const second = referenced(pdf, pages[0]?.text ?? "", "Im2");
    expect(second.text).toContain("/Width 30 /Height 40 /ColorSpace /DeviceRGB");
    expect(second.raw).toEqual(progressive);
  });

  it("reads a JPEG that is a view into a larger buffer", async () => {
    const bytes = jpeg(0xc0, 7, 9, 3);
    const padded = new Uint8Array(bytes.length + 20);
    padded.set(bytes, 11);
    const view = padded.subarray(11, 11 + bytes.length);
    const { pdf, pages } = await exported([page([image("i", "a")], false)], {
      loadImage: async () => ({ kind: "jpeg", width: 7, height: 9, bytes: view }),
    });
    const embedded = referenced(pdf, pages[0]?.text ?? "", "Im1");
    expect(embedded.text).toContain("/Width 7 /Height 9");
    expect(embedded.raw).toEqual(bytes);
  });

  it.each([
    ["a JPEG with four components", jpeg(0xc0, 10, 10, 4)],
    ["a lossless JPEG", jpeg(0xc3, 10, 10, 3)],
    ["an arithmetic-coded JPEG", jpeg(0xc9, 10, 10, 3)],
    ["a JPEG with no width", jpeg(0xc0, 0, 10, 3)],
    ["a JPEG cut short in its frame header", jpeg(0xc0, 10, 10, 3).subarray(0, 16)],
    [
      "a JPEG whose scan comes before any frame",
      Uint8Array.of(0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9),
    ],
    [
      "a segment longer than the file",
      Uint8Array.of(0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0, 0),
    ],
    ["a file that isn't a JPEG", new TextEncoder().encode("%PDF-1.7 not a picture")],
    ["no bytes", new Uint8Array(0)],
  ])("leaves out %s", async (_name, bytes) => {
    const { pdf, pages, operators } = await exported([page([image("i", "a")], false)], {
      loadImage: async () => ({ kind: "jpeg", width: 10, height: 10, bytes }),
    });
    expect(named(operators[0] ?? [], "Do")).toHaveLength(0);
    expect(pages[0]?.text).not.toContain("/XObject");
    expect(imagesOf(pdf)).toHaveLength(0);
  });

  it("never reads past the end of whatever it's given as a JPEG", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 64 }), async (noise) => {
        const bytes = Uint8Array.of(0xff, 0xd8, ...noise);
        const pdf = readPdf(
          await writeNotesPdf([page([image("i", "a")], false)], {
            loadImage: async () => ({ kind: "jpeg", width: 1, height: 1, bytes }),
          }),
        );
        // Embedded or left out, and never a failure: an embedded one is the
        // file's own bytes.
        for (const embedded of imagesOf(pdf)) expect(embedded.raw).toEqual(bytes);
      }),
      { numRuns: 200 },
    );
  });

  it("embeds opaque pixels as a compressed RGB image, with no mask", async () => {
    const pixels: NotesExportImage = {
      kind: "rgba",
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 8, 7, 255]),
    };
    const { pdf, pages } = await exported([page([image("i", "a")], false)], {
      loadImage: async () => pixels,
    });
    const embedded = referenced(pdf, pages[0]?.text ?? "", "Im1");
    expect(embedded.text).toBe(
      `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${embedded.raw?.length} >>`,
    );
    expect([...(embedded.data ?? [])]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 8, 7]);
    expect(imagesOf(pdf)).toHaveLength(1);
  });

  it("gives pixels with any transparency a grey soft mask of their alpha", async () => {
    const pixels: NotesExportImage = {
      kind: "rgba",
      width: 3,
      height: 1,
      data: Uint8Array.of(10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0),
    };
    const { pdf, pages } = await exported([page([image("i", "a")], false)], {
      loadImage: async () => pixels,
    });
    const embedded = referenced(pdf, pages[0]?.text ?? "", "Im1");
    // Straight alpha: the colours are kept as they are.
    expect([...(embedded.data ?? [])]).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const mask = referenced(pdf, embedded.text, "SMask");
    expect(mask.text).toBe(
      `<< /Type /XObject /Subtype /Image /Width 3 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.raw?.length} >>`,
    );
    expect([...(mask.data ?? [])]).toEqual([255, 128, 0]);
  });

  it.each([
    [
      "too few bytes for their size",
      { kind: "rgba", width: 2, height: 2, data: new Uint8Array(15) },
    ],
    ["no width", { kind: "rgba", width: 0, height: 2, data: new Uint8Array(0) }],
    ["a size that isn't whole", { kind: "rgba", width: 1.5, height: 2, data: new Uint8Array(12) }],
  ] as const)("leaves out pixels with %s", async (_name, pixels) => {
    const { pdf, operators } = await exported([page([image("i", "a")], false)], {
      loadImage: async () => pixels,
    });
    expect(named(operators[0] ?? [], "Do")).toHaveLength(0);
    expect(imagesOf(pdf)).toHaveLength(0);
  });

  it("embeds an asset once, however often and on however many pages it's placed", async () => {
    const loadImage = vi.fn(async (item: NotesImage) =>
      rgba(2, 2, item.image.asset.includes("aaaa") ? [1, 2, 3, 255] : [4, 5, 6, 255]),
    );
    const { pdf, pages, operators } = await exported(
      [
        page([image("one", "a"), image("two", "b"), image("three", "a", { x: 30_000 })], false),
        page([image("four", "a")], false),
      ],
      { loadImage },
    );
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(imagesOf(pdf)).toHaveLength(2);
    expect(named(operators[0] ?? [], "Do").map((each) => each.operands)).toEqual([
      "/Im1",
      "/Im2",
      "/Im1",
    ]);
    expect(named(operators[1] ?? [], "Do").map((each) => each.operands)).toEqual(["/Im1"]);
    // Each page lists only the images it paints, and both pages share one object.
    expect(pages[1]?.text).not.toContain("/Im2");
    expect(referenced(pdf, pages[0]?.text ?? "", "Im1").id).toBe(
      referenced(pdf, pages[1]?.text ?? "", "Im1").id,
    );
  });

  it.each([
    ["no port to load it", undefined],
    ["a port that gives nothing", async () => undefined],
  ])("leaves an image out with %s, and asks once for its asset", async (_name, port) => {
    const loadImage = port && vi.fn(port);
    const { operators, pages } = await exported(
      [page([image("one", "a"), image("two", "a")], false)],
      loadImage ? { loadImage } : {},
    );
    expect(lines(operators[0] ?? [])).toEqual(["0.01 0 0 -0.01 0 842 cm"]);
    expect(pages[0]?.text).toContain("/Resources <<>>");
    if (loadImage) expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("draws items in the model's order, text and images between strokes", async () => {
    const { operators } = await exported(
      [
        page(
          [image("i", "a"), stroke("a", "pen", RED), text("Hi"), stroke("b", "pen", BLUE)],
          false,
        ),
      ],
      { loadImage: async () => rgba(1, 1, [0, 0, 0, 255]) },
    );
    const order = lines(operators[0] ?? []).filter((line) => / (rg|Do|Tj)$/.test(line));
    expect(order).toEqual(["/Im1 Do", `${RED_RG} rg`, `${BLUE_RG} rg`, "(Hi) Tj", `${BLUE_RG} rg`]);
  });
});

describe("wrapText", () => {
  it("keeps text that fits on one line, with its width, line height and ascent", () => {
    expect(wrapText("Hello", 10_000, 1_000)).toEqual({
      lines: [{ text: "Hello", width: 2_278 }],
      lineHeight: 1_250,
      ascent: 930,
    });
  });

  it("breaks at spaces when the next word doesn't fit", () => {
    // "aaa" is 1668 wide and a space 278, so "aaa bbb" is 3614.
    const layout = wrapText("aaa bbb aaa bbb", 4_000, 1_000);
    expect(layout.lines).toEqual([
      { text: "aaa bbb", width: 3_614 },
      { text: "aaa bbb", width: 3_614 },
    ]);
  });

  it("fits a line that is exactly as wide as the box", () => {
    expect(wrapText("aaa bbb", 3_614, 1_000).lines.map((line) => line.text)).toEqual(["aaa bbb"]);
    expect(wrapText("aaa bbb", 3_613, 1_000).lines.map((line) => line.text)).toEqual([
      "aaa",
      "bbb",
    ]);
  });

  it("doesn't count or keep the spaces a line was broken at", () => {
    const layout = wrapText("aaa    bbb", 2_000, 1_000);
    expect(layout.lines).toEqual([
      { text: "aaa", width: 1_668 },
      { text: "bbb", width: 1_668 },
    ]);
  });

  it("keeps the spaces inside a line and at its start", () => {
    expect(wrapText("  a  b", 10_000, 1_000).lines.map((line) => line.text)).toEqual(["  a  b"]);
  });

  it("breaks at explicit line breaks, of any kind, and keeps empty lines", () => {
    const texts = (value: string): string[] =>
      wrapText(value, 10_000, 1_000).lines.map((line) => line.text);
    expect(texts("a\n\nb")).toEqual(["a", "", "b"]);
    expect(texts("a\r\nb\rc")).toEqual(["a", "b", "c"]);
    expect(texts("a\n")).toEqual(["a", ""]);
    expect(texts("")).toEqual([""]);
  });

  it("breaks a word longer than the width where it fills the line", () => {
    // Three letters of 556 fit in 1700, four don't.
    expect(wrapText("aaaaaaa", 1_700, 1_000).lines).toEqual([
      { text: "aaa", width: 1_668 },
      { text: "aaa", width: 1_668 },
      { text: "a", width: 556 },
    ]);
  });

  it("starts a long word on a new line before breaking it", () => {
    expect(wrapText("a bbbbbbb", 1_700, 1_000).lines.map((line) => line.text)).toEqual([
      "a",
      "bbb",
      "bbb",
      "b",
    ]);
  });

  it("puts at least one character on each line, however narrow the box", () => {
    for (const width of [10, 0, -5]) {
      expect(wrapText("abc", width, 1_000).lines.map((line) => line.text)).toEqual(["a", "b", "c"]);
    }
  });

  it("counts a character Helvetica can't write as 0.6 of the size, and never splits it", () => {
    expect(wrapText("\u4e2d\u4e2d\u{1f600}", 1_300, 1_000).lines).toEqual([
      { text: "\u4e2d\u4e2d", width: 1_200 },
      { text: "\u{1f600}", width: 600 },
    ]);
  });

  it("scales with the font size", () => {
    const layout = wrapText("Hello", 100_000, 2_400);
    expect(layout.lineHeight).toBe(3_000);
    expect(layout.ascent).toBeCloseTo(2_232, 8);
    expect(layout.lines[0]?.width).toBeCloseTo(5_467.2, 8);
  });

  it("loses no character but the spaces it breaks at, and never overflows a box a character fits in", () => {
    const character = fc.constantFrom("a", "W", "i", ".", " ", " ", "\n", "\u00e9", "\u4e2d");
    fc.assert(
      fc.property(
        fc.array(character, { maxLength: 200 }).map((characters) => characters.join("")),
        fc.integer({ min: 1_100, max: 20_000 }),
        (value, width) => {
          const layout = wrapText(value, width, 1_000);
          expect(layout.lines.length).toBeGreaterThanOrEqual(value.split("\n").length);
          for (const line of layout.lines) {
            expect(line.width).toBeLessThanOrEqual(width);
            expect(line.text).not.toMatch(/\n| $/);
          }
          const joined = layout.lines.map((line) => line.text).join("");
          expect(joined.replaceAll(" ", "")).toBe(value.replace(/[ \n]/g, ""));
        },
      ),
    );
  });
});
