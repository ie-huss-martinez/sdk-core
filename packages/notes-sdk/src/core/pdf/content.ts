import {
  formatPdfNumber,
  latin1Bytes,
  type PdfDictionary,
  PdfString,
  pdfName,
  serializePdfObject,
} from "./pdf-objects.js";

/** How the end of an open path is drawn: butt, round or projecting square. */
export type PdfLineCap = 0 | 1 | 2;

/** How two segments of a path meet: mitre, round or bevel. */
export type PdfLineJoin = 0 | 1 | 2;

/** How a content stream's numbers are written. */
export interface PdfContentOptions {
  /**
   * The decimals positions and lengths are written with, up to four, which
   * is the default. Fewer make a smaller file when the unit is small.
   * Colours, matrix scales and percentages always keep four.
   */
  readonly decimals?: number;
}

/** What a graphics state dictionary sets. */
export interface PdfGraphicsState {
  /** The opacity of fills, from 0 to 1. */
  readonly fillOpacity?: number;
  /** The opacity of strokes, from 0 to 1. */
  readonly strokeOpacity?: number;
  /** How what's painted mixes with what's under it. */
  readonly blendMode?: "Normal" | "Multiply";
}

/**
 * An `ExtGState` dictionary, which a page lists in its resources and a
 * content stream selects with `gs`. Opacity and blend modes can only be set
 * this way.
 */
export function pdfGraphicsState(state: PdfGraphicsState): PdfDictionary {
  return {
    Type: pdfName("ExtGState"),
    ...(state.blendMode === undefined ? {} : { BM: pdfName(state.blendMode) }),
    ...(state.fillOpacity === undefined ? {} : { ca: state.fillOpacity }),
    ...(state.strokeOpacity === undefined ? {} : { CA: state.strokeOpacity }),
  };
}

/**
 * How far a cubic Bezier's control points sit from its ends, as a fraction
 * of the radius, for a quarter of a circle: 4/3 x (sqrt(2) - 1).
 */
const CIRCLE_CONTROL = 0.552_284_749_831;

/**
 * Builds a page's content stream, one operator per line. Each method writes
 * one operator and returns the builder, and nothing checks that operators
 * come in a valid order: the caller writes paths, text and state as PDF
 * expects them.
 */
export class PdfContent {
  readonly #decimals: number;
  readonly #lines: string[] = [];
  /** Where the current path is, which a quadratic curve starts from. */
  #x = 0;
  #y = 0;

  constructor(options: PdfContentOptions = {}) {
    this.#decimals = options.decimals ?? 4;
  }

  /** A position or a length, in the stream's unit. */
  #length(value: number): string {
    return formatPdfNumber(value, this.#decimals);
  }

  #write(operator: string, ...operands: string[]): this {
    this.#lines.push(operands.length === 0 ? operator : `${operands.join(" ")} ${operator}`);
    return this;
  }

  /** `q`: saves the graphics state. */
  save(): this {
    return this.#write("q");
  }

  /** `Q`: restores the graphics state last saved. */
  restore(): this {
    return this.#write("Q");
  }

  /** `cm`: applies a matrix to everything drawn after it. */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): this {
    return this.#write("cm", ...this.#matrix(a, b, c, d, e, f));
  }

  #matrix(a: number, b: number, c: number, d: number, e: number, f: number): string[] {
    return [
      formatPdfNumber(a),
      formatPdfNumber(b),
      formatPdfNumber(c),
      formatPdfNumber(d),
      this.#length(e),
      this.#length(f),
    ];
  }

  /** `w`: the width of strokes. */
  lineWidth(width: number): this {
    return this.#write("w", this.#length(width));
  }

  /** `J`: how the ends of strokes are drawn. */
  lineCap(cap: PdfLineCap): this {
    return this.#write("J", String(cap));
  }

  /** `j`: how the corners of strokes are drawn. */
  lineJoin(join: PdfLineJoin): this {
    return this.#write("j", String(join));
  }

  /** `rg`: the colour of fills and text, as red, green and blue from 0 to 1. */
  fillColor(red: number, green: number, blue: number): this {
    return this.#write("rg", formatPdfNumber(red), formatPdfNumber(green), formatPdfNumber(blue));
  }

  /** `RG`: the colour of strokes, as red, green and blue from 0 to 1. */
  strokeColor(red: number, green: number, blue: number): this {
    return this.#write("RG", formatPdfNumber(red), formatPdfNumber(green), formatPdfNumber(blue));
  }

  /** `gs`: selects a graphics state dictionary by its name in the page's resources. */
  graphicsState(name: string): this {
    return this.#write("gs", serializePdfObject(pdfName(name)));
  }

  /** `m`: starts a new subpath. */
  moveTo(x: number, y: number): this {
    this.#x = x;
    this.#y = y;
    return this.#write("m", this.#length(x), this.#length(y));
  }

  /** `l`: a straight line. */
  lineTo(x: number, y: number): this {
    this.#x = x;
    this.#y = y;
    return this.#write("l", this.#length(x), this.#length(y));
  }

  /** `c`: a cubic Bezier curve, with two control points. */
  curveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    this.#x = x;
    this.#y = y;
    return this.#write(
      "c",
      this.#length(c1x),
      this.#length(c1y),
      this.#length(c2x),
      this.#length(c2y),
      this.#length(x),
      this.#length(y),
    );
  }

  /**
   * A quadratic Bezier curve, with one control point. PDF has only cubic
   * curves, so it's written as the cubic that is the same curve exactly:
   * each of its control points is two thirds of the way from an end to the
   * quadratic's control point.
   */
  quadraticTo(cx: number, cy: number, x: number, y: number): this {
    return this.curveTo(
      this.#x + (2 * (cx - this.#x)) / 3,
      this.#y + (2 * (cy - this.#y)) / 3,
      x + (2 * (cx - x)) / 3,
      y + (2 * (cy - y)) / 3,
      x,
      y,
    );
  }

  /** `h`: closes the subpath with a straight line to its start. */
  closePath(): this {
    return this.#write("h");
  }

  /** `re`: a rectangle, as a closed subpath. */
  rect(x: number, y: number, width: number, height: number): this {
    return this.#write(
      "re",
      this.#length(x),
      this.#length(y),
      this.#length(width),
      this.#length(height),
    );
  }

  /** A circle, as a closed subpath of four curves. */
  circle(cx: number, cy: number, radius: number): this {
    const k = radius * CIRCLE_CONTROL;
    return this.moveTo(cx + radius, cy)
      .curveTo(cx + radius, cy + k, cx + k, cy + radius, cx, cy + radius)
      .curveTo(cx - k, cy + radius, cx - radius, cy + k, cx - radius, cy)
      .curveTo(cx - radius, cy - k, cx - k, cy - radius, cx, cy - radius)
      .curveTo(cx + k, cy - radius, cx + radius, cy - k, cx + radius, cy)
      .closePath();
  }

  /** `f`: fills the path, by the nonzero winding rule. */
  fill(): this {
    return this.#write("f");
  }

  /** `S`: strokes the path. */
  stroke(): this {
    return this.#write("S");
  }

  /** `BT`: starts a text object. */
  beginText(): this {
    return this.#write("BT");
  }

  /** `ET`: ends a text object. */
  endText(): this {
    return this.#write("ET");
  }

  /** `Tf`: the font, by its name in the page's resources, and its size. */
  font(name: string, size: number): this {
    return this.#write("Tf", serializePdfObject(pdfName(name)), this.#length(size));
  }

  /** `Tz`: how wide glyphs are drawn, as a percentage of their own width. */
  horizontalScaling(percent: number): this {
    return this.#write("Tz", formatPdfNumber(percent));
  }

  /** `Td`: moves to the start of a line, from the start of the last one. */
  moveText(x: number, y: number): this {
    return this.#write("Td", this.#length(x), this.#length(y));
  }

  /** `Tm`: the matrix text is drawn with, which also places its line. */
  textMatrix(a: number, b: number, c: number, d: number, e: number, f: number): this {
    return this.#write("Tm", ...this.#matrix(a, b, c, d, e, f));
  }

  /** `Tj`: draws a string, whose bytes are character codes of the font's encoding. */
  showText(bytes: Uint8Array): this {
    return this.#write("Tj", serializePdfObject(new PdfString(bytes)));
  }

  /** `Do`: paints an image or a form, by its name in the page's resources. */
  paint(name: string): this {
    return this.#write("Do", serializePdfObject(pdfName(name)));
  }

  /** The stream, as text. It's ASCII: strings escape every other byte. */
  toString(): string {
    return this.#lines.length === 0 ? "" : `${this.#lines.join("\n")}\n`;
  }

  /** The stream's bytes. */
  toBytes(): Uint8Array<ArrayBuffer> {
    return latin1Bytes(this.toString());
  }
}
