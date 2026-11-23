import type { NotesRect } from "./geometry.js";

/**
 * A colour as `#rrggbb`, in lowercase.
 *
 * @public
 */
export type NotesColor = `#${string}`;

/**
 * A reference to a file a notebook keeps: a PDF, an image or a recording.
 * The file is stored once under its SHA-256, and never inline (sdk-core
 * ADR 0045).
 *
 * @public
 */
export interface NotesAssetReference {
  /** `sha256:` and 64 lowercase hexadecimal digits. */
  readonly asset: string;
  /** The file's media type, such as `application/pdf` or `image/png`. */
  readonly mediaType: string;
  /** The file's size, in bytes. */
  readonly size: number;
}

/**
 * When an item was written during a recording, so playback can follow it.
 *
 * @public
 */
export interface NotesAudioAnchor {
  /** The recording's id, in the notebook's `recordings`. */
  readonly recording: string;
  /** Milliseconds from the recording's start. */
  readonly at: number;
}

/**
 * What a stroke was drawn with.
 *
 * @public
 */
export type NotesStrokeTool = "pen" | "highlighter";

/**
 * One stroke of ink: a pen's, which follows pressure, or a highlighter's,
 * which is translucent and drawn under the pen's.
 *
 * @public
 */
export interface NotesStroke {
  readonly id: string;
  readonly type: "stroke";
  readonly tool: NotesStrokeTool;
  readonly color: NotesColor;
  /** The stroke's width at full pressure, in units. */
  readonly size: number;
  /**
   * The pen's path as `x, y, pressure` triples: positions in units, and
   * pressure from 0 to `NOTES_PRESSURE_MAX`.
   */
  readonly points: readonly number[];
  /**
   * A stroke of one width from end to end, as a straightened shape is. Its
   * pressures are ignored.
   */
  readonly uniform?: true;
  /** When it was written, if a recording was running. */
  readonly audio?: NotesAudioAnchor;
}

/**
 * A box of typed text. Its text wraps at the box's width, and its height
 * follows from the text.
 *
 * @public
 */
export interface NotesText {
  readonly id: string;
  readonly type: "text";
  /** The box's top-left corner, in units. */
  readonly x: number;
  readonly y: number;
  /** The width the text wraps at, in units. */
  readonly width: number;
  /** The text. It's drawn as text, never interpreted as markup. */
  readonly text: string;
  /** The font size, in units. */
  readonly size: number;
  readonly color: NotesColor;
  readonly audio?: NotesAudioAnchor;
}

/**
 * A picture placed on the page.
 *
 * @public
 */
export interface NotesImage {
  readonly id: string;
  readonly type: "image";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The picture's file: PNG, JPEG, WebP or GIF. */
  readonly image: NotesAssetReference;
}

/**
 * An area of a page that leads to another page of the same notebook.
 *
 * @public
 */
export interface NotesLink {
  readonly id: string;
  readonly type: "link";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The id of the page it leads to. */
  readonly page: string;
}

/**
 * Anything on a page, over its paper: ink, text, pictures and links.
 *
 * @public
 */
export type NotesItem = NotesStroke | NotesText | NotesImage | NotesLink;

/**
 * An item's kind.
 *
 * @public
 */
export type NotesItemType = NotesItem["type"];

/** An item with a rectangle of its own: everything but a stroke. */
export type NotesBoxItem = NotesImage | NotesLink;

/** The rectangle of an image or a link. */
export function boxOf(item: NotesBoxItem): NotesRect {
  return { x: item.x, y: item.y, width: item.width, height: item.height };
}
