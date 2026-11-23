import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PdfContent, pdfGraphicsState } from "./content.js";
import { operatorsOf } from "./fixtures/read-pdf.js";
import { serializePdfObject } from "./pdf-objects.js";

describe("PdfContent", () => {
  it("writes path operators, one per line, operands first", () => {
    const content = new PdfContent()
      .moveTo(10, 20)
      .lineTo(30.5, 40)
      .curveTo(1, 2, 3, 4, 5, 6)
      .closePath()
      .rect(0, 0, 100, 50)
      .fill()
      .stroke();
    expect(content.toString()).toBe("10 20 m\n30.5 40 l\n1 2 3 4 5 6 c\nh\n0 0 100 50 re\nf\nS\n");
  });

  it("writes graphics state operators", () => {
    const content = new PdfContent()
      .save()
      .transform(0.01, 0, 0, -0.01, 0, 842)
      .lineWidth(50)
      .lineCap(1)
      .lineJoin(2)
      .fillColor(1, 0.5, 0)
      .strokeColor(0, 1 / 3, 1)
      .graphicsState("GS1")
      .restore();
    expect(content.toString()).toBe(
      "q\n0.01 0 0 -0.01 0 842 cm\n50 w\n1 J\n2 j\n1 0.5 0 rg\n0 0.3333 1 RG\n/GS1 gs\nQ\n",
    );
  });

  it("writes text operators, with a string's bytes escaped", () => {
    const content = new PdfContent()
      .beginText()
      .font("F1", 1200)
      .horizontalScaling(97.5)
      .moveText(100, 200)
      .textMatrix(1, 0, 0, -1, 100, 200)
      .showText(Uint8Array.of(0x48, 0x69, 0x28, 0xe9, 0x29))
      .endText();
    expect(content.toString()).toBe(
      "BT\n/F1 1200 Tf\n97.5 Tz\n100 200 Td\n1 0 0 -1 100 200 Tm\n(Hi\\(\\351\\)) Tj\nET\n",
    );
  });

  it("paints an image or a form by name", () => {
    expect(new PdfContent().paint("Im3").toString()).toBe("/Im3 Do\n");
  });

  it("writes a quadratic curve as the cubic with control points two thirds of the way", () => {
    const content = new PdfContent().moveTo(0, 0).quadraticTo(3, 6, 6, 0);
    expect(content.toString()).toBe("0 0 m\n2 4 4 4 6 0 c\n");
  });

  it("starts a quadratic curve where the last line or curve ended", () => {
    const content = new PdfContent()
      .moveTo(100, 100)
      .lineTo(0, 0)
      .quadraticTo(3, 6, 6, 0)
      .curveTo(0, 0, 0, 0, 30, 30)
      .quadraticTo(33, 36, 36, 30);
    const curves = operatorsOf(content.toString()).filter((op) => op.operator === "c");
    expect(curves[0]?.numbers).toEqual([2, 4, 4, 4, 6, 0]);
    expect(curves[2]?.numbers).toEqual([32, 34, 34, 34, 36, 30]);
  });

  it("starts a quadratic curve at the subpath's start once the path is closed", () => {
    // `h` takes the current point back to where the subpath started.
    const closed = new PdfContent().moveTo(0, 0).lineTo(10, 0).closePath().quadraticTo(3, 6, 6, 0);
    expect(closed.toString()).toBe("0 0 m\n10 0 l\nh\n2 4 4 4 6 0 c\n");
    // The start is the last `m`, not the first.
    const second = new PdfContent()
      .moveTo(100, 100)
      .lineTo(50, 50)
      .moveTo(30, 30)
      .curveTo(0, 0, 0, 0, 90, 90)
      .closePath()
      .quadraticTo(33, 36, 36, 30);
    expect(operatorsOf(second.toString()).at(-1)?.numbers).toEqual([32, 34, 34, 34, 36, 30]);
  });

  it("starts a quadratic curve at a rectangle's corner, where `re` leaves the path", () => {
    // A rectangle is a closed subpath that starts and ends at its `x, y`.
    const content = new PdfContent()
      .moveTo(10, 0)
      .rect(30, 30, 100, 50)
      .quadraticTo(33, 36, 36, 30);
    expect(content.toString()).toBe("10 0 m\n30 30 100 50 re\n32 34 34 34 36 30 c\n");
    // Closing after it goes back to the same corner, not to an earlier subpath's start.
    const closed = new PdfContent()
      .moveTo(10, 0)
      .rect(0, 0, 100, 50)
      .lineTo(40, 40)
      .closePath()
      .quadraticTo(3, 6, 6, 0);
    expect(operatorsOf(closed.toString()).at(-1)?.numbers).toEqual([2, 4, 4, 4, 6, 0]);
  });

  it("writes the same curve as the quadratic it was given, at every point", () => {
    const coordinate = fc.integer({ min: -100_000, max: 100_000 });
    fc.assert(
      fc.property(
        fc.tuple(coordinate, coordinate, coordinate, coordinate, coordinate, coordinate),
        fc.double({ min: 0, max: 1, noNaN: true }),
        ([x0, y0, cx, cy, x1, y1], t) => {
          const content = new PdfContent().moveTo(x0, y0).quadraticTo(cx, cy, x1, y1);
          const cubic = operatorsOf(content.toString())[1]?.numbers ?? [];
          const [ax = 0, ay = 0, bx = 0, by = 0, ex = 0, ey = 0] = cubic;
          const u = 1 - t;
          const quadratic = (p0: number, p1: number, p2: number): number =>
            u * u * p0 + 2 * u * t * p1 + t * t * p2;
          const bezier = (p0: number, p1: number, p2: number, p3: number): number =>
            u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
          // Within the four decimals the control points are written with.
          expect(bezier(x0, ax, bx, ex)).toBeCloseTo(quadratic(x0, cx, x1), 3);
          expect(bezier(y0, ay, by, ey)).toBeCloseTo(quadratic(y0, cy, y1), 3);
        },
      ),
    );
  });

  it("draws a circle as four curves through its four sides, closed", () => {
    const operators = operatorsOf(new PdfContent().circle(100, 200, 10).toString());
    expect(operators.map((op) => op.operator)).toEqual(["m", "c", "c", "c", "c", "h"]);
    expect(operators[0]?.numbers).toEqual([110, 200]);
    const ends = operators.slice(1, 5).map((op) => op.numbers.slice(4));
    expect(ends).toEqual([
      [100, 210],
      [90, 200],
      [100, 190],
      [110, 200],
    ]);
    // The middle of each curve is on the circle, within a thousandth of the radius.
    const [c1x = 0, c1y = 0, c2x = 0, c2y = 0] = operators[1]?.numbers ?? [];
    const middleX = (110 + 3 * c1x + 3 * c2x + 100) / 8;
    const middleY = (200 + 3 * c1y + 3 * c2y + 210) / 8;
    expect(Math.hypot(middleX - 100, middleY - 200)).toBeCloseTo(10, 2);
  });

  it("rounds positions to the decimals asked for, and keeps four for colours and scales", () => {
    const content = new PdfContent({ decimals: 2 })
      .transform(0.0125, 0, 0, -0.0125, 0.123_456, 841.888)
      .moveTo(1.234_56, -0.001)
      .lineWidth(0.555)
      .fillColor(0.123_45, 0, 1)
      .font("F1", 12.345)
      .horizontalScaling(101.234_56);
    expect(content.toString()).toBe(
      "0.0125 0 0 -0.0125 0.12 841.89 cm\n1.23 0 m\n0.56 w\n0.1235 0 1 rg\n/F1 12.35 Tf\n101.2346 Tz\n",
    );
  });

  it("refuses a number that isn't finite", () => {
    expect(() => new PdfContent().moveTo(Number.NaN, 0)).toThrow(TypeError);
  });

  it("gives its bytes as ASCII, and nothing for no operators", () => {
    expect(new PdfContent().toString()).toBe("");
    expect(new PdfContent().toBytes()).toHaveLength(0);
    const content = new PdfContent().showText(Uint8Array.of(0xff)).fill();
    expect(new TextDecoder().decode(content.toBytes())).toBe("(\\377) Tj\nf\n");
  });
});

describe("pdfGraphicsState", () => {
  it("makes the highlighter's state: multiplied, with translucent fills", () => {
    expect(serializePdfObject(pdfGraphicsState({ blendMode: "Multiply", fillOpacity: 0.4 }))).toBe(
      "<< /Type /ExtGState /BM /Multiply /ca 0.4 >>",
    );
  });

  it("sets the opacity of strokes and fills apart, and only what was asked", () => {
    expect(serializePdfObject(pdfGraphicsState({ strokeOpacity: 0.25 }))).toBe(
      "<< /Type /ExtGState /CA 0.25 >>",
    );
    expect(serializePdfObject(pdfGraphicsState({ fillOpacity: 1, strokeOpacity: 0.5 }))).toBe(
      "<< /Type /ExtGState /ca 1 /CA 0.5 >>",
    );
    expect(serializePdfObject(pdfGraphicsState({}))).toBe("<< /Type /ExtGState >>");
  });
});
