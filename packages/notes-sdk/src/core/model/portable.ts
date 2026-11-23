/**
 * Units and bounds of the notes model, shared by the documents, the commands
 * and their readers (sdk-core ADR 0045, docs/adr/0003).
 *
 * Every position and length is an integer on a fixed grid of
 * {@link NOTES_UNITS_PER_POINT} units to a PDF point (1/72 inch), so a
 * notebook reads back exactly as it was written, in any language.
 */

/**
 * Page units in one PDF point. A point is 1/72 inch, so a unit is about
 * 3.5 micrometres.
 *
 * @public
 */
export const NOTES_UNITS_PER_POINT = 100;

/**
 * The value of full pen pressure. A stroke's pressures are integers from 0
 * to this.
 *
 * @public
 */
export const NOTES_PRESSURE_MAX = 1000;

/**
 * The longest side a page may have, in units: 200 inches, the largest page
 * a PDF viewer shows.
 *
 * @public
 */
export const NOTES_MAX_PAGE_SIDE = 1_440_000;

/**
 * The shortest side a page may have, in units: one inch.
 *
 * @public
 */
export const NOTES_MIN_PAGE_SIDE = 7_200;

/**
 * How far outside its page an item may reach, in units. Ink that runs off
 * the paper is kept, but a position far away is a damaged document.
 *
 * @public
 */
export const NOTES_PAGE_MARGIN = NOTES_MAX_PAGE_SIDE;

/**
 * The most points one stroke holds. A longer stroke is split as it's drawn.
 *
 * @public
 */
export const NOTES_MAX_STROKE_POINTS = 20_000;

/**
 * The longest identifier, in characters. Identifiers use only
 * `A-Z`, `a-z`, `0-9`, `_` and `-`.
 *
 * @public
 */
export const NOTES_MAX_ID_LENGTH = 64;

/**
 * The longest title or name, in Unicode code points.
 *
 * @public
 */
export const NOTES_MAX_TITLE_LENGTH = 200;

/**
 * The longest text of one text box, in Unicode code points.
 *
 * @public
 */
export const NOTES_MAX_TEXT_LENGTH = 20_000;

/**
 * The most entries a notebook's outline holds.
 *
 * @public
 */
export const NOTES_MAX_OUTLINE_ENTRIES = 2_000;

/**
 * The most recordings a notebook holds.
 *
 * @public
 */
export const NOTES_MAX_RECORDINGS = 2_000;

/**
 * The thinnest and thickest stroke, in units: 0.1 to 72 points.
 *
 * @public
 */
export const NOTES_STROKE_SIZE_RANGE: readonly [minimum: number, maximum: number] = [10, 7_200];

/**
 * The smallest and largest text size, in units: 4 to 288 points.
 *
 * @public
 */
export const NOTES_TEXT_SIZE_RANGE: readonly [minimum: number, maximum: number] = [400, 28_800];
