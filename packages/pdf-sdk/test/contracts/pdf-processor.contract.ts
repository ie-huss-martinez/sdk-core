import { describe, expect, it } from "vitest";
import {
  isPdfError,
  type PdfBuildProgress,
  type PdfFieldValue,
  type PdfProcessor,
  type PdfRotation,
} from "../../src/index.js";
import { everythingIn } from "../secrets.js";

/** What a build produced, read back by the harness. */
export interface InspectedPdf {
  readonly pages: readonly {
    readonly width: number;
    readonly height: number;
    readonly rotation: PdfRotation;
  }[];
  /** Every form field's value, by its name in the output. */
  readonly fields: Readonly<Record<string, PdfFieldValue>>;
  /**
   * Whether the document is encrypted at all: with a password to open it,
   * or with permission restrictions alone.
   */
  readonly encrypted: boolean;
}

/**
 * What a processor's contract test needs: a way to create the processor,
 * documents to build from, and a way to read the output. The qpdf adapter
 * supplies real PDFs and reads them with pdf-lib; the fakes supply fake ones.
 */
export interface PdfProcessorHarness {
  createProcessor(): PdfProcessor;
  /** A document with one unrotated page of each given size, in points. */
  pages(sizes: readonly { width: number; height: number }[]): Promise<Uint8Array>;
  /** A one-page document with a text field `name` and a checkbox `agree`, both empty. */
  form(): Promise<Uint8Array>;
  /**
   * Reads a built document, opening it with the password when one is given.
   * Rejects when the document is encrypted and no password, or a wrong one,
   * is given.
   */
  inspect(bytes: Uint8Array, password?: string): Promise<InspectedPdf>;
  /**
   * Documents that need a password to open, one for each cipher the
   * processor reads, each with one unrotated page of each given size.
   */
  readonly protected: readonly {
    readonly name: string;
    document(sizes: readonly { width: number; height: number }[]): Promise<Uint8Array>;
    readonly password: string;
  }[];
  /**
   * A document with an owner password only: encrypted, with permission
   * restrictions, and no password to open it. One unrotated page of each
   * given size.
   */
  restricted(sizes: readonly { width: number; height: number }[]): Promise<Uint8Array>;
}

const A4 = { width: 595, height: 842 };
const LETTER = { width: 612, height: 792 };
const SQUARE = { width: 400, height: 400 };

/**
 * The behaviour every {@link PdfProcessor} must have (ADR 0003, ADR 0008).
 * Adapters run it with their own harness.
 */
export function describePdfProcessorContract(name: string, harness: PdfProcessorHarness): void {
  describe(`${name}: the PdfProcessor contract`, () => {
    it("builds every page of one source unchanged", async () => {
      const processor = harness.createProcessor();
      const bytes = await harness.pages([A4, LETTER]);
      const output = await processor.build({
        sources: [{ id: "a", bytes }],
        pages: [
          { source: "a", pageIndex: 0 },
          { source: "a", pageIndex: 1 },
        ],
      });
      expect((await harness.inspect(output)).pages).toEqual([
        { ...A4, rotation: 0 },
        { ...LETTER, rotation: 0 },
      ]);
      await processor.destroy();
    });

    it("assembles pages from several sources in plan order, with rotations", async () => {
      const processor = harness.createProcessor();
      const output = await processor.build({
        sources: [
          { id: "a", bytes: await harness.pages([A4, LETTER]) },
          { id: "b", bytes: await harness.pages([SQUARE]) },
        ],
        pages: [
          { source: "a", pageIndex: 1, rotation: 90 },
          { source: "b", pageIndex: 0 },
          { source: "a", pageIndex: 0, rotation: 270 },
          { source: "a", pageIndex: 0 },
        ],
      });
      expect((await harness.inspect(output)).pages).toEqual([
        { ...LETTER, rotation: 90 },
        { ...SQUARE, rotation: 0 },
        { ...A4, rotation: 270 },
        { ...A4, rotation: 0 },
      ]);
      await processor.destroy();
    });

    it("draws pages over others without changing the pages, and reports the step", async () => {
      const processor = harness.createProcessor();
      const progress: PdfBuildProgress[] = [];
      const output = await processor.build(
        {
          sources: [
            { id: "a", bytes: await harness.pages([A4, LETTER, A4]) },
            { id: "b", bytes: await harness.pages([SQUARE, A4]) },
          ],
          pages: [
            { source: "a", pageIndex: 0, overlay: { source: "b", pageIndex: 1 } },
            { source: "a", pageIndex: 1 },
            // An overlay of another size, on a rotated page, from the page's own source.
            { source: "b", pageIndex: 0, rotation: 90, overlay: { source: "b", pageIndex: 1 } },
            { source: "a", pageIndex: 2, overlay: { source: "a", pageIndex: 1 } },
          ],
          compress: {},
        },
        { onProgress: (value) => progress.push(value) },
      );
      expect((await harness.inspect(output)).pages).toEqual([
        { ...A4, rotation: 0 },
        { ...LETTER, rotation: 0 },
        { ...SQUARE, rotation: 90 },
        { ...A4, rotation: 0 },
      ]);
      expect(progress.map((value) => value.step)).toEqual([
        "fill",
        "assemble",
        "overlay",
        "compress",
      ]);
      expect(progress.at(-1)?.fraction).toBe(1);
      await processor.destroy();
    });

    it("fills each source's form values, keeping fields with the same name apart", async () => {
      const processor = harness.createProcessor();
      const form = await harness.form();
      const output = await processor.build({
        sources: [
          { id: "a", bytes: form, formValues: { name: "Ada", agree: true } },
          { id: "b", bytes: form, formValues: { name: "Grace" } },
        ],
        pages: [
          { source: "a", pageIndex: 0 },
          { source: "b", pageIndex: 0 },
        ],
      });
      const values = Object.values((await harness.inspect(output)).fields);
      expect(values).toEqual(expect.arrayContaining(["Ada", "Grace", true]));
      await processor.destroy();
    });

    it("compresses without changing the pages", async () => {
      const processor = harness.createProcessor();
      const output = await processor.build({
        sources: [{ id: "a", bytes: await harness.pages([A4, SQUARE]) }],
        pages: [
          { source: "a", pageIndex: 0 },
          { source: "a", pageIndex: 1 },
        ],
        compress: {},
      });
      expect((await harness.inspect(output)).pages).toEqual([
        { ...A4, rotation: 0 },
        { ...SQUARE, rotation: 0 },
      ]);
      await processor.destroy();
    });

    it("encrypts with the user password", async () => {
      const processor = harness.createProcessor();
      const output = await processor.build({
        sources: [{ id: "a", bytes: await harness.pages([A4]) }],
        pages: [{ source: "a", pageIndex: 0 }],
        encrypt: { userPassword: "correct horse" },
      });
      await expect(harness.inspect(output)).rejects.toBeDefined();
      await expect(harness.inspect(output, "wrong")).rejects.toBeDefined();
      expect((await harness.inspect(output, "correct horse")).pages).toEqual([
        { ...A4, rotation: 0 },
      ]);
      await processor.destroy();
    });

    describe.each(harness.protected)("a source protected with $name", (fixture) => {
      it("is read with its password, and built without it", async () => {
        const processor = harness.createProcessor();
        const bytes = await fixture.document([A4, LETTER]);
        const job = { sources: [{ id: "a", bytes, password: fixture.password }] };
        // Every page in order, which keeps the document whole, and a reordered one.
        for (const pages of [
          [
            { source: "a", pageIndex: 0 },
            { source: "a", pageIndex: 1 },
          ],
          [
            { source: "a", pageIndex: 1, rotation: 90 as const },
            { source: "a", pageIndex: 0 },
          ],
        ]) {
          const output = await harness.inspect(await processor.build({ ...job, pages }));
          expect(output.encrypted).toBe(false);
          expect(output.pages.map(({ width }) => width).sort()).toEqual([A4.width, LETTER.width]);
        }
        await processor.destroy();
      });

      it("is encrypted again only when the job asks, with the job's password", async () => {
        const processor = harness.createProcessor();
        const output = await processor.build({
          sources: [{ id: "a", bytes: await fixture.document([A4]), password: fixture.password }],
          pages: [{ source: "a", pageIndex: 0, rotation: 180 }],
          encrypt: { userPassword: "another password" },
        });
        await expect(harness.inspect(output)).rejects.toBeDefined();
        await expect(harness.inspect(output, fixture.password)).rejects.toBeDefined();
        expect(await harness.inspect(output, "another password")).toMatchObject({
          pages: [{ ...A4, rotation: 180 }],
          encrypted: true,
        });
        await processor.destroy();
      });

      it("rejects without its password, and with a wrong one, saying which", async () => {
        const processor = harness.createProcessor();
        const bytes = await fixture.document([A4]);
        const pages = [{ source: "a", pageIndex: 0 }];
        const missing = await processor
          .build({ sources: [{ id: "a", bytes }], pages })
          .catch((error: unknown) => error);
        expect(isPdfError(missing, "PASSWORD_REQUIRED")).toBe(true);
        expect((missing as { details?: { reason?: unknown } }).details?.reason).toBeUndefined();

        const wrong = await processor
          .build({ sources: [{ id: "a", bytes, password: "wrong-PASSWORD-sentinel" }], pages })
          .catch((error: unknown) => error);
        expect(isPdfError(wrong, "PASSWORD_REQUIRED")).toBe(true);
        expect((wrong as { details?: unknown }).details).toEqual({ reason: "incorrect-password" });
        await processor.destroy();
      });
    });

    it("never puts a password in an error (docs/adr/0013)", async () => {
      const processor = harness.createProcessor();
      const [fixture] = harness.protected;
      if (!fixture) throw new Error("The harness has no protected document.");
      const bytes = await fixture.document([A4]);
      const failures = await Promise.all(
        [
          // A wrong password.
          processor.build({
            sources: [{ id: "a", bytes, password: "source-PASSWORD-sentinel" }],
            pages: [{ source: "a", pageIndex: 0 }],
          }),
          // Passwords on a job that fails for another reason: a source that
          // isn't a PDF, and a build cancelled before it starts.
          processor.build({
            sources: [
              {
                id: "a",
                bytes: new TextEncoder().encode("not a PDF"),
                password: "source-PASSWORD-sentinel",
              },
            ],
            pages: [{ source: "a", pageIndex: 0 }],
            encrypt: {
              userPassword: "user-PASSWORD-sentinel",
              ownerPassword: "owner-PASSWORD-sentinel",
            },
          }),
          processor.build(
            {
              sources: [{ id: "a", bytes, password: "source-PASSWORD-sentinel" }],
              pages: [{ source: "a", pageIndex: 0 }],
              encrypt: { userPassword: "user-PASSWORD-sentinel" },
            },
            { signal: AbortSignal.abort() },
          ),
        ].map((build) => build.catch((error: unknown) => error)),
      );
      expect(failures.map((failure) => (failure as { code?: string }).code)).toEqual([
        "PASSWORD_REQUIRED",
        "INVALID_PDF",
        "ABORTED",
      ]);
      for (const failure of failures)
        expect(everythingIn(failure)).not.toContain("-PASSWORD-sentinel");
      await processor.destroy();
    });

    it("builds a document with only an owner password without one, and never carries its restrictions over", async () => {
      const processor = harness.createProcessor();
      const bytes = await harness.restricted([A4, LETTER]);
      for (const pages of [
        [
          { source: "a", pageIndex: 0 },
          { source: "a", pageIndex: 1 },
        ],
        [{ source: "a", pageIndex: 1, rotation: 90 as const }],
      ]) {
        const output = await harness.inspect(
          await processor.build({ sources: [{ id: "a", bytes }], pages }),
        );
        expect(output.encrypted).toBe(false);
        expect(output.pages).toHaveLength(pages.length);
      }
      await processor.destroy();
    });

    it("ignores a password given for a source that needs none", async () => {
      const processor = harness.createProcessor();
      // Not encrypted at all, and encrypted with restrictions only.
      for (const bytes of [await harness.pages([A4]), await harness.restricted([A4])]) {
        const output = await processor.build({
          sources: [{ id: "a", bytes, password: "not needed" }],
          pages: [{ source: "a", pageIndex: 0 }],
        });
        expect(await harness.inspect(output)).toMatchObject({ pages: [A4], encrypted: false });
      }
      await processor.destroy();
    });

    it("reports progress that only moves forward and ends at 1", async () => {
      const processor = harness.createProcessor();
      const progress: PdfBuildProgress[] = [];
      await processor.build(
        {
          sources: [{ id: "a", bytes: await harness.pages([A4]) }],
          pages: [{ source: "a", pageIndex: 0 }],
          compress: {},
          encrypt: { userPassword: "secret" },
        },
        { onProgress: (value) => progress.push(value) },
      );
      expect(progress.length).toBeGreaterThan(0);
      const fractions = progress.map((value) => value.fraction);
      expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
      expect(fractions.at(-1)).toBe(1);
      await processor.destroy();
    });

    it("copies the caller's bytes, and returns a buffer of its own", async () => {
      const processor = harness.createProcessor();
      const bytes = await harness.pages([A4]);
      const before = [...bytes];
      const output = await processor.build({
        sources: [{ id: "a", bytes }],
        pages: [{ source: "a", pageIndex: 0 }],
      });
      expect(bytes.byteLength).toBe(before.length);
      expect([...bytes]).toEqual(before);
      expect(output.buffer).not.toBe(bytes.buffer);
      expect(output.byteOffset).toBe(0);
      expect(output.byteLength).toBe(output.buffer.byteLength);
      await processor.destroy();
    });

    it("rejects a job that refers to an unknown source or page", async () => {
      const processor = harness.createProcessor();
      const bytes = await harness.pages([A4]);
      await expect(
        processor.build({ sources: [{ id: "a", bytes }], pages: [{ source: "b", pageIndex: 0 }] }),
      ).rejects.toThrow(TypeError);
      await expect(
        processor.build({ sources: [{ id: "a", bytes }], pages: [{ source: "a", pageIndex: 1 }] }),
      ).rejects.toThrow(RangeError);
      await processor.destroy();
    });

    it("rejects an overlay that refers to an unknown source or page, or to an unreadable one", async () => {
      const processor = harness.createProcessor();
      const a = { id: "a", bytes: await harness.pages([A4]) };
      const broken = { id: "broken", bytes: new TextEncoder().encode("not a PDF") };
      const page = { source: "a", pageIndex: 0 };
      await expect(
        processor.build({
          sources: [a],
          pages: [{ ...page, overlay: { source: "b", pageIndex: 0 } }],
        }),
      ).rejects.toThrow(TypeError);
      await expect(
        processor.build({
          sources: [a],
          pages: [{ ...page, overlay: { source: "a", pageIndex: 1 } }],
        }),
      ).rejects.toThrow(RangeError);
      await expect(
        processor.build({
          sources: [a, broken],
          pages: [{ ...page, overlay: { source: "broken", pageIndex: 0 } }],
        }),
      ).rejects.toSatisfy((error) => isPdfError(error, "INVALID_PDF"));
      await processor.destroy();
    });

    it("rejects a source that isn't a PDF with INVALID_PDF", async () => {
      const processor = harness.createProcessor();
      await expect(
        processor.build({
          sources: [{ id: "a", bytes: new TextEncoder().encode("not a PDF") }],
          pages: [{ source: "a", pageIndex: 0 }],
        }),
      ).rejects.toSatisfy((error) => isPdfError(error, "INVALID_PDF"));
      await processor.destroy();
    });

    it("rejects an aborted build with ABORTED", async () => {
      const processor = harness.createProcessor();
      const controller = new AbortController();
      controller.abort();
      await expect(
        processor.build(
          {
            sources: [{ id: "a", bytes: await harness.pages([A4]) }],
            pages: [{ source: "a", pageIndex: 0 }],
          },
          { signal: controller.signal },
        ),
      ).rejects.toSatisfy((error) => isPdfError(error, "ABORTED"));
      await processor.destroy();
    });

    it("rejects builds after it's destroyed", async () => {
      const processor = harness.createProcessor();
      const bytes = await harness.pages([A4]);
      await processor.destroy();
      await expect(
        processor.build({ sources: [{ id: "a", bytes }], pages: [{ source: "a", pageIndex: 0 }] }),
      ).rejects.toBeDefined();
    });
  });
}
