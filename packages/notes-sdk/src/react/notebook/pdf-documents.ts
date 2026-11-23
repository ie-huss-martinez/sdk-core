import type { NotesAssetReference } from "../../core/model/items.js";
import type { NotesPdfDocument, NotesPdfEngine } from "../../core/ports/notes-pdf.js";

/** The PDFs under an open notebook's pages, each opened once. */
export interface PdfDocuments {
  /** The open PDF, or `undefined` when there's no engine or the PDF can't be opened. */
  get(reference: NotesAssetReference): Promise<NotesPdfDocument | undefined>;
  /**
   * Closes the PDFs. They're opened again when next asked for: React's
   * development mode runs a cleanup once on mount too.
   */
  dispose(): void;
}

export function createPdfDocuments(
  engine: NotesPdfEngine | undefined,
  read: (reference: NotesAssetReference) => Promise<Blob>,
): PdfDocuments {
  const open = new Map<string, Promise<NotesPdfDocument | undefined>>();
  /** Counts disposals: a PDF that opens from before the last one is closed again. */
  let generation = 0;
  return {
    get(reference) {
      if (!engine) return Promise.resolve(undefined);
      let document = open.get(reference.asset);
      if (!document) {
        const started = generation;
        document = read(reference)
          .then(async (blob) => engine.open(new Uint8Array(await blob.arrayBuffer())))
          .then((opened) => {
            if (started !== generation) {
              void opened.destroy();
              return undefined;
            }
            return opened;
          })
          // A PDF that can't be opened leaves its pages' ink on plain paper.
          .catch(() => undefined);
        open.set(reference.asset, document);
      }
      return document;
    },
    dispose() {
      generation += 1;
      for (const document of open.values()) {
        void document.then((opened) => opened?.destroy()).catch(() => undefined);
      }
      open.clear();
    },
  };
}
