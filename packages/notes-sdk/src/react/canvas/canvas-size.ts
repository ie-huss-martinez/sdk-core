import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";

/** A canvas's size, in whole pixels. */
export interface CanvasSize {
  readonly width: number;
  readonly height: number;
}

/** What a canvas may hold. */
export interface CanvasBudget {
  /** The most pixels in all. */
  readonly maxPixels: number;
  /** The longest a side may be, in pixels. No limit, when omitted. */
  readonly maxSide?: number;
}

/**
 * The canvas for a box of `width` by `height`, in any unit, at `density`
 * pixels per unit, or at the highest density below it that the budget
 * allows. The budget is checked on the whole numbers returned, so rounding
 * never takes a canvas past it. Each side is at least one pixel.
 */
export function fitCanvas(
  width: number,
  height: number,
  density: number,
  budget: CanvasBudget,
): CanvasSize {
  if (!(width > 0 && height > 0 && density > 0)) return { width: 1, height: 1 };
  const maxSide = budget.maxSide ?? Number.POSITIVE_INFINITY;
  const scale = Math.min(
    density,
    Math.sqrt(budget.maxPixels / (width * height)),
    maxSide / width,
    maxSide / height,
  );
  const side = (length: number): number =>
    Math.min(maxSide, Math.max(1, Math.round(length * scale)));
  let pixelWidth = side(width);
  let pixelHeight = side(height);
  // Both sides can round up, and a side under a pixel is brought up to one:
  // the longer side gives back what that added.
  if (pixelWidth * pixelHeight > budget.maxPixels) {
    if (pixelWidth >= pixelHeight) {
      pixelWidth = Math.max(1, Math.floor(budget.maxPixels / pixelHeight));
    } else {
      pixelHeight = Math.max(1, Math.floor(budget.maxPixels / pixelWidth));
    }
  }
  return { width: pixelWidth, height: pixelHeight };
}

/**
 * What one page's canvas may hold. Beyond it, the canvas is drawn at a lower
 * density. The pixels alone don't bound a long, narrow page: Firefox draws
 * nothing on a canvas with a side over 32,767 pixels.
 */
const PAGE_BUDGET: CanvasBudget = { maxPixels: 12_000_000, maxSide: 32_767 };
/** The lowest density a page is drawn at while the budget allows it: below it, ink is a blur. */
const MIN_PAGE_DENSITY = 0.5;

/**
 * The canvas of a page that's `width` by `height` CSS pixels on screen, on a
 * display of `devicePixelRatio`: as sharp as the display, and never under
 * half a pixel per CSS pixel unless the page is too large for that. The
 * budget wins over the floor, as a page at the highest zoom needs, and no
 * side is over 32,767 pixels.
 */
export function pageCanvasSize(
  width: number,
  height: number,
  devicePixelRatio: number,
): CanvasSize {
  const density = Math.max(MIN_PAGE_DENSITY, devicePixelRatio > 0 ? devicePixelRatio : 1);
  return fitCanvas(width, height, density, PAGE_BUDGET);
}

/** How many pixels a rasterised text box has per PDF point: 300 dots per inch. */
const TEXT_DENSITY = 300 / 72;
/**
 * What the picture of one text box may hold: 64 MB of pixels, and sides
 * every browser's canvas allows.
 */
const TEXT_BUDGET: CanvasBudget = { maxPixels: 16_000_000, maxSide: 8_192 };

/**
 * The picture of a text box of `width` by `height` units, for an exported
 * PDF: 300 dots per inch, or fewer for a box so large that its picture would
 * pass the budget. The PDF places the picture over the box's own rectangle,
 * so a smaller picture is only less sharp, never smaller on the page.
 */
export function textRasterSize(width: number, height: number): CanvasSize {
  return fitCanvas(width, height, TEXT_DENSITY / NOTES_UNITS_PER_POINT, TEXT_BUDGET);
}
