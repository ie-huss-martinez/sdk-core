import {
  createPdfJsEngine,
  createPdfProcessor,
  type PdfBuildJob,
  type PdfDocumentHandle,
  type PdfEngine,
  type PdfProcessor,
} from "@hussmartinez/pdf-sdk";
import { isSdkError } from "@hussmartinez/sdk-core";
import { asNotesError } from "../../core/errors/abort.js";
import { NotesError } from "../../core/errors/notes-error.js";
import type {
  NotesPdfAssembly,
  NotesPdfDocument,
  NotesPdfEngine,
  NotesPdfRenderOptions,
} from "../../core/ports/notes-pdf.js";
import type { NotesCallOptions, NotesProgressOptions } from "../../core/ports/options.js";

/**
 * Options for {@link createNotesPdfEngine}.
 *
 * @public
 */
export interface NotesPdfEngineOptions {
  /**
   * Where your application serves `@hussmartinez/pdf-sdk`'s `dist/assets/`
   * directory, on its own origin, such as `"/pdf-sdk/"`. Its workers then
   * load from there, which a Content Security Policy without
   * `worker-src blob:` needs. By default they're inlined.
   */
  readonly assetsUrl?: string | URL;
  /** A PDF engine to use in place of pdf-sdk's own, such as a test's fake. */
  readonly engine?: PdfEngine;
  /** A PDF processor to use in place of pdf-sdk's own. */
  readonly processor?: PdfProcessor;
}

/** The PDF SDK's own codes that the notes SDK has no code for. */
const PDF_ONLY_CODES: ReadonlySet<string> = new Set([
  "PROCESSING_FAILED",
  "SESSION_TOO_LARGE",
  "IMAGE_TOO_LARGE",
  "INVALID_COMMAND",
  "INVALID_DOCUMENT",
  "UNSUPPORTED_FORMAT",
]);

/**
 * Makes a PDF SDK failure a `NotesError`:
 * - a code the two SDKs share (`INVALID_PDF`, `PASSWORD_REQUIRED`,
 *   `TOO_MANY_PAGES`), and sdk-core's codes such as `ABORTED` and
 *   `WORKER_CRASHED`, as they are;
 * - the PDF SDK's own codes, such as `PROCESSING_FAILED`, and its
 *   `RangeError` and `TypeError` for a bad request, as `fallback`.
 *
 * The original error is kept as `cause`.
 */
function fromPdfError(error: unknown, fallback: "INVALID_PDF" | "EXPORT_FAILED"): NotesError {
  if (error instanceof RangeError || error instanceof TypeError) {
    return new NotesError(fallback, "The PDF engine refused the request.", { cause: error });
  }
  if (isSdkError(error) && error.name === "PdfError" && PDF_ONLY_CODES.has(error.code)) {
    return new NotesError(fallback, "The PDF engine failed.", { cause: error });
  }
  return asNotesError(error);
}

const signalOf = (options: NotesCallOptions | undefined) =>
  options?.signal ? { signal: options.signal } : {};

function wrap(handle: PdfDocumentHandle): NotesPdfDocument {
  return {
    pageCount: handle.pageCount,
    async pageSize(pageIndex, options) {
      try {
        const page = await handle.getPage(pageIndex, signalOf(options));
        // The size as shown: a page turned on its side swaps its box's sides.
        const sideways = page.rotation === 90 || page.rotation === 270;
        return sideways
          ? { width: page.height, height: page.width }
          : { width: page.width, height: page.height };
      } catch (error) {
        throw fromPdfError(error, "INVALID_PDF");
      }
    },
    async pageText(pageIndex, options) {
      try {
        const { items } = await handle.getTextContent(pageIndex, signalOf(options));
        let text = "";
        for (const item of items) {
          text += item.text;
          text += item.endOfLine ? "\n" : " ";
        }
        return text.trim();
      } catch (error) {
        throw fromPdfError(error, "INVALID_PDF");
      }
    },
    async render(pageIndex, canvas, options: NotesPdfRenderOptions) {
      try {
        await handle.renderPage(pageIndex, canvas, {
          scale: options.scale,
          ...(options.pixelRatio === undefined ? {} : { pixelRatio: options.pixelRatio }),
          ...signalOf(options),
        });
      } catch (error) {
        throw fromPdfError(error, "INVALID_PDF");
      }
    },
    async destroy() {
      await handle.destroy();
    },
  };
}

/**
 * Creates the notes SDK's PDF engine, on `@hussmartinez/pdf-sdk`: pdf.js to
 * read and draw PDFs, and qpdf to assemble exported ones, each in a worker
 * (docs/adr/0006). Nothing loads until the first PDF is opened or exported.
 *
 * @example
 * ```ts
 * const library = createNotesLibrary({
 *   store: createOpfsNotesStore(),
 *   pdf: createNotesPdfEngine({ assetsUrl: "/pdf-sdk/" }),
 * });
 * ```
 *
 * @public
 */
export function createNotesPdfEngine(options: NotesPdfEngineOptions = {}): NotesPdfEngine {
  const assets = options.assetsUrl === undefined ? {} : { assetsUrl: options.assetsUrl };
  let engine = options.engine;
  let processor = options.processor;

  return {
    async open(bytes, callOptions) {
      engine ??= createPdfJsEngine(assets);
      try {
        return wrap(await engine.open(bytes, signalOf(callOptions)));
      } catch (error) {
        throw fromPdfError(error, "INVALID_PDF");
      }
    },
    async assemble(assembly: NotesPdfAssembly, callOptions: NotesProgressOptions = {}) {
      processor ??= createPdfProcessor(assets);
      const job: PdfBuildJob = {
        sources: assembly.sources,
        pages: assembly.pages.map((page) => ({
          source: page.source,
          pageIndex: page.pageIndex,
          ...(page.overlay ? { overlay: page.overlay } : {}),
        })),
      };
      const { onProgress } = callOptions;
      try {
        return await processor.build(job, {
          ...signalOf(callOptions),
          ...(onProgress ? { onProgress: ({ fraction }) => onProgress({ fraction }) } : {}),
        });
      } catch (error) {
        throw fromPdfError(error, "EXPORT_FAILED");
      }
    },
    async destroy() {
      await Promise.all([engine?.destroy(), processor?.destroy()]);
    },
  };
}
