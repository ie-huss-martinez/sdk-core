import type { PdfAnnotation } from "./annotations.js";
import type { PdfBytes, PdfFieldValue } from "./document.js";
import type { PdfRotation } from "./geometry.js";

/**
 * One source document of a {@link PdfBuildJob}.
 *
 * @public
 */
export interface PdfBuildSource {
  /** An identifier, unique within the job, that pages and form values refer to. */
  readonly id: string;
  readonly bytes: PdfBytes;
  /**
   * The password that opens this source, if it needs one. The processor
   * reads the source with it, and never puts it in an error or in the
   * output (docs/adr/0013).
   */
  readonly password?: string;
  /** Form values to fill into this source before its pages are assembled. */
  readonly formValues?: Readonly<Record<string, PdfFieldValue>>;
}

/**
 * A page drawn over a {@link PdfBuildPage}: a page of another source, or of
 * the same one, such as a page of ink over the page it was written on
 * (ADR 0011).
 *
 * The overlay is drawn over the page's content as the page is displayed,
 * after its rotation: upright, and centred on it. An overlay that's wider or
 * taller than the displayed page is scaled down to fit, keeping its
 * proportions. A smaller one keeps its size; it's never enlarged. So an
 * overlay for a page turned a quarter turn has the page's displayed size:
 * its width is the page's height. The overlay page's own `/Rotate` is
 * applied first, and each page is measured by its trim box, which is the
 * crop box or the media box when it has none.
 *
 * Where the overlay page draws nothing, the page shows through. The overlay
 * page's links and form fields come with it, placed as its content is, and a
 * field whose name is taken is renamed as in a merge.
 *
 * @public
 */
export interface PdfPageOverlay {
  /** The {@link PdfBuildSource.id} the overlay page comes from. */
  readonly source: string;
  /** The overlay page's zero-based index in its source. */
  readonly pageIndex: number;
}

/**
 * One page of the output: a page of a source, with a rotation added to the
 * page's own, a page to draw over it, and the annotations to draw on it.
 *
 * @public
 */
export interface PdfBuildPage {
  /** The {@link PdfBuildSource.id} the page comes from. */
  readonly source: string;
  /** The page's zero-based index in its source. */
  readonly pageIndex: number;
  /** Rotation added to the page's own `/Rotate`. Defaults to 0. */
  readonly rotation?: PdfRotation;
  /** A page to draw over this one, once it's rotated. */
  readonly overlay?: PdfPageOverlay;
  /** Annotations to flatten into the page's content. */
  readonly annotations?: readonly PdfAnnotation[];
}

/**
 * Lossy image recompression, on top of lossless compression.
 *
 * @public
 */
export interface PdfImageCompression {
  /** JPEG quality, from 0 to 1. */
  readonly quality: number;
  /** The longest image edge to keep, in pixels. Larger images are scaled down. */
  readonly maxDimension: number;
}

/**
 * How to compress the output. Compression is lossless unless `images` is set.
 *
 * @public
 */
export interface PdfCompression {
  readonly images?: PdfImageCompression;
}

/**
 * How to encrypt the output. Encryption is always AES-256.
 *
 * @public
 */
export interface PdfEncryption {
  /** The password needed to open the document. */
  readonly userPassword: string;
  /** The password that grants full access. Defaults to the user password. */
  readonly ownerPassword?: string;
}

/**
 * Everything needed to build an output document from the page plan, in one
 * call to the processor (ADR 0003): the sources, the pages in order, and the
 * export options. Plain data, so it crosses the worker boundary as it is.
 *
 * The processor runs the steps in this order, skipping those with nothing to
 * do: fill each source's form values, assemble the pages with their
 * rotations, draw the page overlays, flatten the annotations, compress,
 * encrypt.
 *
 * The output is encrypted only when `encrypt` is set. A source's own
 * encryption, its passwords and its permission restrictions, never carries
 * over to what's built from it (docs/adr/0013).
 *
 * @public
 */
export interface PdfBuildJob {
  readonly sources: readonly PdfBuildSource[];
  readonly pages: readonly PdfBuildPage[];
  readonly compress?: PdfCompression;
  readonly encrypt?: PdfEncryption;
}

/**
 * The steps of a build, in the order they run, reported as progress.
 *
 * @public
 */
export type PdfBuildStep = "fill" | "assemble" | "overlay" | "flatten" | "compress" | "encrypt";

/**
 * Progress of a build: the step running now, and the fraction of the whole
 * build that's done, from 0 to 1.
 *
 * @public
 */
export interface PdfBuildProgress {
  readonly step: PdfBuildStep;
  readonly fraction: number;
}
