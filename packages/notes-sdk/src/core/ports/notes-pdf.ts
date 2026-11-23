import type { NotesCallOptions, NotesProgressOptions } from "./options.js";

/**
 * How to draw a PDF page.
 *
 * @public
 */
export interface NotesPdfRenderOptions extends NotesCallOptions {
  /** CSS pixels per PDF point. */
  readonly scale: number;
  /** Canvas pixels per CSS pixel. Defaults to 1. */
  readonly pixelRatio?: number;
}

/**
 * An open PDF: its pages' sizes, text and drawings.
 *
 * @public
 */
export interface NotesPdfDocument {
  readonly pageCount: number;
  /** A page's size as shown, in PDF points, after its own rotation. */
  pageSize(
    pageIndex: number,
    options?: NotesCallOptions,
  ): Promise<{ readonly width: number; readonly height: number }>;
  /** A page's text, in reading order, with a space or a line break between runs. */
  pageText(pageIndex: number, options?: NotesCallOptions): Promise<string>;
  /** Draws a page onto a canvas, which it sizes. */
  render(
    pageIndex: number,
    canvas: HTMLCanvasElement,
    options: NotesPdfRenderOptions,
  ): Promise<void>;
  destroy(): Promise<void>;
}

/**
 * One page of an exported PDF: a page of a source, and optionally a page of
 * another source drawn over it, scaled to fit.
 *
 * @public
 */
export interface NotesPdfAssemblyPage {
  readonly source: string;
  readonly pageIndex: number;
  readonly overlay?: { readonly source: string; readonly pageIndex: number };
}

/**
 * What an exported PDF is assembled from.
 *
 * @public
 */
export interface NotesPdfAssembly {
  readonly sources: readonly { readonly id: string; readonly bytes: Uint8Array }[];
  readonly pages: readonly NotesPdfAssemblyPage[];
}

/**
 * The PDF engine the notes SDK reads and writes PDFs with (sdk-core
 * ADR 0008). The SDK's own, `createNotesPdfEngine`, wraps
 * `@hussmartinez/pdf-sdk`, which parses in workers. Failures reject with
 * `NotesError`: `INVALID_PDF`, `PASSWORD_REQUIRED` or `EXPORT_FAILED`.
 *
 * @public
 */
export interface NotesPdfEngine {
  /** Opens a PDF. The bytes are copied, so the caller keeps its own. */
  open(bytes: Uint8Array, options?: NotesCallOptions): Promise<NotesPdfDocument>;
  /** Builds a PDF from pages of several, some with another page drawn over them. */
  assemble(assembly: NotesPdfAssembly, options?: NotesProgressOptions): Promise<Uint8Array>;
  destroy(): Promise<void>;
}
