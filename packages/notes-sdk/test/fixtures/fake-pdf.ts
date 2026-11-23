import { NotesError } from "../../src/core/errors/notes-error.js";
import type {
  NotesPdfAssembly,
  NotesPdfDocument,
  NotesPdfEngine,
} from "../../src/core/ports/notes-pdf.js";

/**
 * A fake PDF: bytes that name their pages, such as `fake-pdf:2:Hello|World`
 * for two pages with those texts, each 612 by 792 points.
 */
export function fakePdf(texts: readonly string[]): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`fake-pdf:${texts.length}:${texts.join("|")}`);
}

/** What the fake engine was asked to assemble, for a test to check. */
export interface FakePdfEngine extends NotesPdfEngine {
  readonly assemblies: NotesPdfAssembly[];
  readonly open: NotesPdfEngine["open"];
}

/**
 * A PDF engine for unit tests (sdk-core ADR 0008): it reads {@link fakePdf}
 * bytes, refuses anything else as `INVALID_PDF`, and records assemblies.
 */
export function createFakePdfEngine(): FakePdfEngine {
  const assemblies: NotesPdfAssembly[] = [];
  return {
    assemblies,
    async open(bytes): Promise<NotesPdfDocument> {
      const text = new TextDecoder().decode(bytes);
      const match = /^fake-pdf:(\d+):(.*)$/s.exec(text);
      if (!match) throw new NotesError("INVALID_PDF", "Not a fake PDF.");
      const texts = (match[2] ?? "").split("|");
      return {
        pageCount: Number(match[1]),
        pageSize: async () => ({ width: 612, height: 792 }),
        pageText: async (pageIndex) => texts[pageIndex] ?? "",
        render: async () => undefined,
        destroy: async () => undefined,
      };
    },
    async assemble(assembly) {
      assemblies.push(assembly);
      return new TextEncoder().encode(`assembled:${assembly.pages.length}`);
    },
    destroy: async () => undefined,
  };
}
