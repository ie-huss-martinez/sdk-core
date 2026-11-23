import { throwIfAborted } from "../errors/abort.js";
import { outlineSegments, strokeOutline } from "../ink/outline.js";
import type { NotesImage, NotesItem, NotesStroke, NotesText } from "../model/items.js";
import type { NotesPageInfo } from "../model/notebook.js";
import { NOTES_UNITS_PER_POINT } from "../model/portable.js";
import { NOTES_PAPER_COLOR, templateMarks } from "../model/templates.js";
import { PdfContent, pdfGraphicsState } from "./content.js";
import { encodeWinAnsi, helveticaWidth, replaceUnencodable } from "./helvetica.js";
import {
  latin1Bytes,
  type PdfDictionary,
  type PdfRef,
  PdfString,
  PdfWriter,
  pdfName,
  pdfTextString,
} from "./pdf-objects.js";

/**
 * One line of a text box, as it's shown.
 *
 * @public
 */
export interface NotesTextLine {
  readonly text: string;
  /** The line's width as measured on screen, in units. */
  readonly width: number;
}

/**
 * How a text box's text is laid out: its lines, and where each sits.
 *
 * @public
 */
export interface NotesTextLayout {
  readonly lines: readonly NotesTextLine[];
  /** The distance from one line's top to the next, in units. */
  readonly lineHeight: number;
  /** The distance from a line's top to its baseline, in units. */
  readonly ascent: number;
}

/**
 * A picture to put in an exported PDF.
 *
 * - `jpeg`: a baseline or progressive JPEG in RGB or grey, which is embedded
 *   as it is. Its size is read from the file, not from `width` and `height`.
 * - `rgba`: pixels in rows from the top, four bytes each, with straight
 *   (not premultiplied) alpha.
 *
 * @public
 */
export type NotesExportImage =
  | {
      readonly kind: "jpeg";
      readonly width: number;
      readonly height: number;
      readonly bytes: Uint8Array;
    }
  | {
      readonly kind: "rgba";
      readonly width: number;
      readonly height: number;
      readonly data: Uint8Array | Uint8ClampedArray;
    };

/**
 * What the exporter asks its host for: everything that needs a browser, or
 * the notebook's files. Each is optional.
 *
 * @public
 */
export interface NotesPdfExportPorts {
  /**
   * How a text box's lines break and how wide each is on screen. Without
   * it, the exporter wraps with Helvetica's own widths.
   */
  readonly layoutText?: (item: NotesText) => NotesTextLayout;
  /**
   * A picture of a text box whose text Helvetica can't write, such as
   * non-Latin scripts.
   */
  readonly rasterizeText?: (
    item: NotesText,
    layout: NotesTextLayout,
  ) => Promise<NotesExportImage | undefined>;
  /**
   * The pixels of a placed image. Without it, or when it resolves to
   * `undefined`, the image is left out.
   */
  readonly loadImage?: (item: NotesImage) => Promise<NotesExportImage | undefined>;
}

/**
 * One page to export.
 *
 * @public
 */
export interface NotesPdfExportPage {
  readonly info: NotesPageInfo;
  readonly items: readonly NotesItem[];
  /**
   * Whether to paint the paper: its white ground and its template's rules.
   * False for a page that goes over a PDF page, which stays transparent.
   */
  readonly paper: boolean;
}

/**
 * How to export.
 *
 * @public
 */
export interface NotesPdfExportOptions {
  /** Cancels the export, which then rejects with `ABORTED`. */
  readonly signal?: AbortSignal;
  /** Called after each page, with the fraction of pages written. */
  readonly onProgress?: (progress: { readonly fraction: number }) => void;
  /** The document's title, for its properties. */
  readonly title?: string;
  /**
   * The time, in milliseconds since the Unix epoch, for the document's
   * creation date. Without it the file has no date, and the same pages
   * always give the same bytes.
   */
  readonly now?: () => number;
}

/** The fallback layout's line height, as a multiple of the font size. */
const LINE_HEIGHT = 1.25;

/**
 * The fallback layout's baseline, as a multiple of the font size below a
 * line's top. A browser centres a font's ascent and descent in the line, so
 * at a line height of 1.25 the baseline of a sans-serif face lands between
 * about 0.9 and 0.97 of the size down, depending on the face. A host that
 * needs the exact figure gives it through `layoutText`.
 */
const ASCENT = 0.93;

/**
 * Lays text out with Helvetica's own widths, for exports without a
 * `layoutText` port. Lines break at explicit line breaks and, when the next
 * word doesn't fit, at spaces; a word longer than the width is broken where
 * it fills the line. Spaces at the end of a wrapped line aren't counted and
 * aren't kept.
 *
 * @param text - The text.
 * @param width - The width to wrap at, in units.
 * @param size - The font size, in units.
 * @returns At least one line. The line height is 1.25 x `size` and the
 * ascent 0.93 x `size`.
 * @public
 */
export function wrapText(text: string, width: number, size: number): NotesTextLayout {
  const lines: NotesTextLine[] = [];
  const push = (line: string): void => {
    const kept = line.replace(/ +$/, "");
    lines.push({ text: kept, width: helveticaWidth(kept, size) });
  };
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let line = "";
    let lineWidth = 0;
    for (const token of paragraph.match(/ +|[^ ]+/g) ?? []) {
      const tokenWidth = helveticaWidth(token, size);
      if (token.startsWith(" ")) {
        // Spaces never start a line: they hang off the end of this one.
        line += token;
        lineWidth += tokenWidth;
        continue;
      }
      if (line !== "" && lineWidth + tokenWidth > width) {
        push(line);
        line = "";
        lineWidth = 0;
      }
      if (tokenWidth <= width) {
        line += token;
        lineWidth += tokenWidth;
        continue;
      }
      // A word wider than the box: as many characters as fit on each line,
      // and always at least one.
      for (const character of token) {
        const characterWidth = helveticaWidth(character, size);
        if (line !== "" && lineWidth + characterWidth > width) {
          push(line);
          line = "";
          lineWidth = 0;
        }
        line += character;
        lineWidth += characterWidth;
      }
    }
    push(line);
  }
  return { lines, lineHeight: LINE_HEIGHT * size, ascent: ASCENT * size };
}

/** The names the pages' resources use. */
const FONT_NAME = "F1";
const HIGHLIGHTER_STATE_NAME = "GS1";

/** How opaque a highlighter's ink is, as on screen. */
const HIGHLIGHTER_OPACITY = 0.4;

/** The narrowest and widest Helvetica is drawn to match a measured line, in percent. */
const MIN_TEXT_SCALING = 50;
const MAX_TEXT_SCALING = 200;

/**
 * The decimals of positions in content streams. The unit is a hundredth of
 * a point, so two decimals are a ten-thousandth of a point.
 */
const CONTENT_DECIMALS = 2;

/** An image or a form in the file, and the name pages paint it by. */
interface EmbeddedObject {
  readonly name: string;
  readonly ref: PdfRef;
}

/** What one page's content uses, for its resource dictionary. */
interface PageResources {
  font: boolean;
  highlighter: boolean;
  /** The images and forms the page paints, by name. */
  readonly xObjects: Map<string, PdfRef>;
}

/** The red, green and blue of a `#rrggbb` colour, from 0 to 1. Anything else is black. */
function rgbOf(color: string): [red: number, green: number, blue: number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  const channel = (hex: string | undefined): number => Number.parseInt(hex ?? "0", 16) / 255;
  return [channel(match?.[1]), channel(match?.[2]), channel(match?.[3])];
}

/** The frame of a JPEG that `DCTDecode` reads: its size and its number of colour components. */
interface JpegFrame {
  readonly width: number;
  readonly height: number;
  readonly components: number;
}

const JPEG_MARKER = 0xff;
const JPEG_START = 0xd8;
const JPEG_END = 0xd9;
const JPEG_SCAN = 0xda;

/**
 * Reads a JPEG's frame header, which says how large it is and how many
 * colour components it has. Every offset is checked against the file's real
 * length before it's read.
 *
 * @returns `undefined` for anything `DCTDecode` doesn't read: a file that
 * isn't a JPEG or is cut short, a lossless, hierarchical or arithmetic-coded
 * one, or one that isn't 8 bits deep.
 */
function readJpegFrame(bytes: Uint8Array): JpegFrame | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 4 || view.getUint8(0) !== JPEG_MARKER || view.getUint8(1) !== JPEG_START) {
    return undefined;
  }
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== JPEG_MARKER) return undefined;
    const marker = view.getUint8(offset + 1);
    if (marker === JPEG_MARKER) {
      // A fill byte before the marker.
      offset += 1;
      continue;
    }
    offset += 2;
    // Markers that stand alone, with no segment after them: TEM, the
    // restart markers 0xD0 to 0xD7, and a second start of image.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= JPEG_START)) continue;
    // The picture's data starts or ends, and no frame header came first.
    if (marker === JPEG_END || marker === JPEG_SCAN) return undefined;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > view.byteLength) return undefined;
    // Start-of-frame markers are 0xC0 to 0xCF, except three that mean
    // something else: tables (0xC4), an extension (0xC8) and arithmetic
    // conditioning (0xCC).
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      // Only baseline, extended sequential and progressive Huffman frames.
      if (marker > 0xc2 || length < 8) return undefined;
      const precision = view.getUint8(offset + 2);
      const height = view.getUint16(offset + 3);
      const width = view.getUint16(offset + 5);
      const components = view.getUint8(offset + 7);
      if (precision !== 8 || width === 0 || height === 0) return undefined;
      return { width, height, components };
    }
    offset += length;
  }
  return undefined;
}

/**
 * Writes one document. It holds what pages share: the font, the
 * highlighter's state, the images and the rows of dotted paper.
 */
class NotesPdfExport {
  readonly #writer = new PdfWriter();
  readonly #ports: NotesPdfExportPorts;
  readonly #signal: AbortSignal | undefined;
  #font: PdfRef | undefined;
  #highlighterState: PdfRef | undefined;
  #imageCount = 0;
  /** Images by their asset, so a picture placed many times is in the file once. */
  readonly #assets = new Map<string, EmbeddedObject | undefined>();
  /** Rows of dots by their content, so pages of one width share a row. */
  readonly #dotRows = new Map<string, EmbeddedObject>();

  constructor(ports: NotesPdfExportPorts, signal: AbortSignal | undefined) {
    this.#ports = ports;
    this.#signal = signal;
  }

  async write(
    pages: readonly NotesPdfExportPage[],
    options: NotesPdfExportOptions,
  ): Promise<Uint8Array> {
    const writer = this.#writer;
    const catalog = writer.reserve();
    const tree = writer.reserve();
    const kids: PdfRef[] = [];
    for (const [index, page] of pages.entries()) {
      throwIfAborted(this.#signal);
      kids.push(await this.#writePage(page, tree));
      options.onProgress?.({ fraction: (index + 1) / pages.length });
    }
    throwIfAborted(this.#signal);
    writer.set(tree, { Type: pdfName("Pages"), Kids: kids, Count: kids.length });
    writer.set(catalog, { Type: pdfName("Catalog"), Pages: tree });
    const created = options.now ? pdfDate(options.now()) : undefined;
    const info = writer.add({
      ...(options.title === undefined ? {} : { Title: pdfTextString(options.title) }),
      Producer: pdfTextString("@hussmartinez/notes-sdk"),
      ...(created === undefined ? {} : { CreationDate: created }),
    });
    return writer.finish(catalog, info);
  }

  async #writePage(page: NotesPdfExportPage, parent: PdfRef): Promise<PdfRef> {
    const { width, height } = page.info;
    const content = new PdfContent({ decimals: CONTENT_DECIMALS });
    const resources: PageResources = { font: false, highlighter: false, xObjects: new Map() };
    // From here on everything is written in page units, from the top-left
    // corner with y growing downwards, as the model has it.
    content.transform(
      1 / NOTES_UNITS_PER_POINT,
      0,
      0,
      -1 / NOTES_UNITS_PER_POINT,
      0,
      height / NOTES_UNITS_PER_POINT,
    );
    if (page.paper) await this.#drawPaper(content, resources, page.info);

    // Highlighter under everything else, as on screen, so it never dims
    // the ink it marks.
    const highlights = page.items.filter(isHighlight);
    if (highlights.length > 0) {
      resources.highlighter = true;
      content.save().graphicsState(HIGHLIGHTER_STATE_NAME);
      for (const stroke of highlights) drawStroke(content, stroke);
      content.restore();
    }
    for (const item of page.items) {
      if (item.type === "stroke") {
        if (!isHighlight(item)) drawStroke(content, item);
      } else if (item.type === "text") {
        await this.#drawText(content, resources, item);
      } else if (item.type === "image") {
        await this.#drawImage(content, resources, item);
      }
      // A link draws nothing.
    }

    const stream = await this.#writer.addStream({}, content.toBytes(), { compress: true });
    return this.#writer.add({
      Type: pdfName("Page"),
      Parent: parent,
      MediaBox: [0, 0, width / NOTES_UNITS_PER_POINT, height / NOTES_UNITS_PER_POINT],
      Resources: this.#resourceDictionary(resources),
      Contents: stream,
    });
  }

  #resourceDictionary(resources: PageResources): PdfDictionary {
    if (resources.font) {
      // One of the standard fonts, which a file names and doesn't carry.
      this.#font ??= this.#writer.add({
        Type: pdfName("Font"),
        Subtype: pdfName("Type1"),
        BaseFont: pdfName("Helvetica"),
        Encoding: pdfName("WinAnsiEncoding"),
      });
    }
    if (resources.highlighter) {
      this.#highlighterState ??= this.#writer.add(
        pdfGraphicsState({ blendMode: "Multiply", fillOpacity: HIGHLIGHTER_OPACITY }),
      );
    }
    return {
      ...(resources.font ? { Font: { [FONT_NAME]: this.#font } } : {}),
      ...(resources.highlighter
        ? { ExtGState: { [HIGHLIGHTER_STATE_NAME]: this.#highlighterState } }
        : {}),
      ...(resources.xObjects.size > 0 ? { XObject: Object.fromEntries(resources.xObjects) } : {}),
    };
  }

  /** The paper: its white ground, then its template's rules and dots. */
  async #drawPaper(
    content: PdfContent,
    resources: PageResources,
    info: NotesPageInfo,
  ): Promise<void> {
    content
      .fillColor(...rgbOf(NOTES_PAPER_COLOR))
      .rect(0, 0, info.width, info.height)
      .fill();
    const marks = templateMarks(info.template, info.width, info.height);
    if (marks.lines.length > 0) {
      content.strokeColor(...rgbOf(marks.color)).lineWidth(marks.lineWidth);
      for (let index = 0; index + 3 < marks.lines.length; index += 4) {
        content
          .moveTo(marks.lines[index] ?? 0, marks.lines[index + 1] ?? 0)
          .lineTo(marks.lines[index + 2] ?? 0, marks.lines[index + 3] ?? 0);
      }
      content.stroke();
    }
    if (marks.dots.length > 0) {
      // The largest page has 921,600 dots, and a circle for each would be a
      // file of 30 MB for an empty page. Every row is the same, so one row
      // is written as a form and painted at each row's place.
      const { columns, rows } = dotGrid(marks.dots);
      const row = await this.#dotRow(columns, marks.dotSize / 2);
      resources.xObjects.set(row.name, row.ref);
      // A form is painted with the colour set when it's painted.
      content.fillColor(...rgbOf(marks.color));
      for (const y of rows) content.save().transform(1, 0, 0, 1, 0, y).paint(row.name).restore();
    }
  }

  /** A row of dots as a form: a filled circle at each column, along y = 0. */
  async #dotRow(columns: readonly number[], radius: number): Promise<EmbeddedObject> {
    const content = new PdfContent({ decimals: CONTENT_DECIMALS });
    for (const x of columns) content.circle(x, 0, radius);
    content.fill();
    const key = content.toString();
    const known = this.#dotRows.get(key);
    if (known) return known;
    const ref = await this.#writer.addStream(
      {
        Type: pdfName("XObject"),
        Subtype: pdfName("Form"),
        BBox: [(columns[0] ?? 0) - radius, -radius, (columns.at(-1) ?? 0) + radius, radius],
        Resources: {},
      },
      content.toBytes(),
      { compress: true },
    );
    const row = { name: `Fm${this.#dotRows.size + 1}`, ref };
    this.#dotRows.set(key, row);
    return row;
  }

  async #drawText(content: PdfContent, resources: PageResources, item: NotesText): Promise<void> {
    const measure = this.#ports.layoutText;
    const layout = measure ? measure(item) : wrapText(item.text, item.width, item.size);
    const texts = layout.lines.map((line) => printable(line.text));
    const rasterize = this.#ports.rasterizeText;
    if (rasterize && texts.some((text) => encodeWinAnsi(text) === undefined)) {
      const picture = await rasterize(item, layout);
      throwIfAborted(this.#signal);
      const image = picture && (await this.#embed(picture));
      if (image) {
        const height = layout.lines.length * layout.lineHeight;
        paintImage(content, resources, image, item.x, item.y, item.width, height);
        return;
      }
    }
    if (texts.every((text) => text === "")) return;
    resources.font = true;
    // Saved and restored, so one box's scaling never reaches the next.
    content
      .save()
      .fillColor(...rgbOf(item.color))
      .beginText()
      .font(FONT_NAME, item.size);
    for (const [index, text] of texts.entries()) {
      if (text === "") continue;
      const written = replaceUnencodable(text);
      const bytes = encodeWinAnsi(written);
      if (bytes === undefined) continue;
      if (measure) {
        const scaling = textScaling(layout.lines[index]?.width, helveticaWidth(written, item.size));
        if (scaling !== undefined) content.horizontalScaling(scaling);
      }
      // The page's transform turns y downwards, which would draw glyphs
      // upside down: this matrix turns them back, and places the baseline.
      const baseline = item.y + index * layout.lineHeight + layout.ascent;
      content.textMatrix(1, 0, 0, -1, item.x, baseline).showText(bytes);
    }
    content.endText().restore();
  }

  async #drawImage(content: PdfContent, resources: PageResources, item: NotesImage): Promise<void> {
    if (!(item.width > 0 && item.height > 0)) return;
    const asset = item.image.asset;
    if (!this.#assets.has(asset)) {
      const picture = await this.#ports.loadImage?.(item);
      throwIfAborted(this.#signal);
      this.#assets.set(asset, picture && (await this.#embed(picture)));
    }
    const image = this.#assets.get(asset);
    if (image) paintImage(content, resources, image, item.x, item.y, item.width, item.height);
  }

  /** Adds a picture to the file. Resolves to `undefined` for one that can't be embedded. */
  async #embed(image: NotesExportImage): Promise<EmbeddedObject | undefined> {
    const ref =
      image.kind === "jpeg" ? await this.#embedJpeg(image.bytes) : await this.#embedRgba(image);
    if (ref === undefined) return undefined;
    this.#imageCount += 1;
    return { name: `Im${this.#imageCount}`, ref };
  }

  async #embedJpeg(bytes: Uint8Array): Promise<PdfRef | undefined> {
    const frame = readJpegFrame(bytes);
    // Four components are CMYK, whose JPEGs disagree on which way ink runs.
    if (!frame || (frame.components !== 1 && frame.components !== 3)) return undefined;
    return this.#writer.addStream(
      {
        ...imageDictionary(
          frame.width,
          frame.height,
          frame.components === 1 ? "DeviceGray" : "DeviceRGB",
        ),
        Filter: pdfName("DCTDecode"),
      },
      bytes,
    );
  }

  async #embedRgba(image: {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8Array | Uint8ClampedArray;
  }): Promise<PdfRef | undefined> {
    const { width, height, data } = image;
    const pixels = width * height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      return undefined;
    }
    if (data.length !== pixels * 4) return undefined;
    const color = new Uint8Array(pixels * 3);
    const alpha = new Uint8Array(pixels);
    let translucent = false;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      color[pixel * 3] = data[pixel * 4] ?? 0;
      color[pixel * 3 + 1] = data[pixel * 4 + 1] ?? 0;
      color[pixel * 3 + 2] = data[pixel * 4 + 2] ?? 0;
      const opacity = data[pixel * 4 + 3] ?? 255;
      alpha[pixel] = opacity;
      if (opacity !== 255) translucent = true;
    }
    // The alpha is straight, so the colours need no matte: a soft mask of
    // the alpha alone is enough.
    const mask = translucent
      ? await this.#writer.addStream(imageDictionary(width, height, "DeviceGray"), alpha, {
          compress: true,
        })
      : undefined;
    return this.#writer.addStream(
      { ...imageDictionary(width, height, "DeviceRGB"), SMask: mask },
      color,
      { compress: true },
    );
  }
}

function imageDictionary(
  width: number,
  height: number,
  colorSpace: "DeviceGray" | "DeviceRGB",
): PdfDictionary {
  return {
    Type: pdfName("XObject"),
    Subtype: pdfName("Image"),
    Width: width,
    Height: height,
    ColorSpace: pdfName(colorSpace),
    BitsPerComponent: 8,
  };
}

function isHighlight(item: NotesItem): item is NotesStroke {
  return item.type === "stroke" && item.tool === "highlighter";
}

/**
 * The columns and rows of a template's dots, which are a grid listed row by
 * row: the `x` of each dot of the first row, and the `y` of each row.
 */
function dotGrid(dots: readonly number[]): {
  readonly columns: readonly number[];
  readonly rows: readonly number[];
} {
  const columns: number[] = [];
  for (let index = 0; index + 1 < dots.length && dots[index + 1] === dots[1]; index += 2) {
    columns.push(dots[index] ?? 0);
  }
  const rows: number[] = [];
  for (let index = 1; index < dots.length; index += 2 * columns.length) {
    rows.push(dots[index] ?? 0);
  }
  return { columns, rows };
}

/** A stroke: its outline, filled with its colour. */
function drawStroke(content: PdfContent, stroke: NotesStroke): void {
  const segments = outlineSegments(strokeOutline(stroke));
  // A start point and at least one curve.
  if (segments.length < 6) return;
  content.fillColor(...rgbOf(stroke.color)).moveTo(segments[0] ?? 0, segments[1] ?? 0);
  for (let index = 2; index + 3 < segments.length; index += 4) {
    content.quadraticTo(
      segments[index] ?? 0,
      segments[index + 1] ?? 0,
      segments[index + 2] ?? 0,
      segments[index + 3] ?? 0,
    );
  }
  content.closePath().fill();
}

/**
 * Paints an image into a rectangle of the page. An image fills the unit
 * square with its first row at the top, where y is 1, so its matrix turns it
 * over as well as sizing and placing it, or the page's transform would draw
 * it upside down.
 */
function paintImage(
  content: PdfContent,
  resources: PageResources,
  image: EmbeddedObject,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  resources.xObjects.set(image.name, image.ref);
  content
    .save()
    .transform(width, 0, 0, -height, x, y + height)
    .paint(image.name)
    .restore();
}

/**
 * A line's text as it's written: without the line break a measured line may
 * end with, and without soft hyphens, which a screen hides but Helvetica
 * would draw as hyphens.
 */
function printable(text: string): string {
  return text.replace(/[\r\n]+$/, "").replaceAll("\u00ad", "");
}

/**
 * How much to stretch or squeeze Helvetica so a line is as wide as it was
 * measured on screen, in percent, within limits that keep it readable.
 * `undefined` when there's nothing to match.
 */
function textScaling(measured: number | undefined, natural: number): number | undefined {
  if (measured === undefined || !(measured > 0) || !(natural > 0)) return undefined;
  const scaling = (measured / natural) * 100;
  if (!Number.isFinite(scaling)) return undefined;
  return Math.min(Math.max(scaling, MIN_TEXT_SCALING), MAX_TEXT_SCALING);
}

/** A time as a PDF date in UTC, `D:YYYYMMDDHHmmSSZ`, or `undefined` for a time that isn't one. */
function pdfDate(time: number): PdfString | undefined {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return undefined;
  const year = date.getUTCFullYear();
  if (year < 0 || year > 9999) return undefined;
  const two = (value: number): string => String(value).padStart(2, "0");
  return new PdfString(
    latin1Bytes(
      `D:${String(year).padStart(4, "0")}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}` +
        `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`,
    ),
  );
}

/**
 * Writes pages of a notebook as a PDF: one PDF page each, in order, with
 * ink as vector paths, text as text and pictures embedded once each. It
 * needs no DOM, so it runs in a browser, a worker and Node alike.
 *
 * A page with `paper` draws its white ground and its template's marks; one
 * without stays transparent, to go over a page of another PDF. Highlighter
 * strokes are drawn first, multiplied over what's under them, and then
 * every other item in order. Text Helvetica can't write goes through
 * `rasterizeText`, and without it has `?` for each such character. A
 * picture that can't be loaded or embedded is left out.
 *
 * Streams are compressed where the platform has `CompressionStream`, and
 * written as they are elsewhere. The same input gives the same bytes.
 *
 * @param pages - The pages, at least one.
 * @param ports - What the host provides: text layout, pictures of text, and images.
 * @param options - A signal, a progress callback, the title and the clock.
 * @returns The PDF's bytes.
 * @throws `TypeError` when there are no pages.
 * @throws `NotesError` `ABORTED` when the signal aborts.
 * @public
 */
export async function writeNotesPdf(
  pages: readonly NotesPdfExportPage[],
  ports: NotesPdfExportPorts = {},
  options: NotesPdfExportOptions = {},
): Promise<Uint8Array> {
  if (pages.length === 0) throw new TypeError("A PDF needs at least one page.");
  return new NotesPdfExport(ports, options.signal).write(pages, options);
}
