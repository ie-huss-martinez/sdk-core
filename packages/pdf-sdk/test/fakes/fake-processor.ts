import { throwIfAborted } from "../../src/core/errors/abort.js";
import { assertPageIndex, copyBytes } from "../../src/core/model/bytes.js";
import { addRotation, type PdfBuildStep, PdfError, type PdfProcessor } from "../../src/index.js";
import {
  decodeFakePdf,
  encodeFakePdf,
  type FakeField,
  type FakePage,
  unlockFakePdf,
} from "./fake-pdf.js";

/**
 * An in-memory {@link PdfProcessor} over fake PDF bytes, for unit tests of
 * the session and the editor. It follows the real pipeline's order and
 * passes the processor's contract suite.
 */
export function createFakeProcessor(): PdfProcessor {
  let destroyed = false;
  return {
    async build(job, options = {}) {
      if (destroyed) {
        throw new PdfError("WORKER_TERMINATED", "The processor was destroyed.");
      }
      throwIfAborted(options.signal);
      const steps: PdfBuildStep[] = ["fill", "assemble"];
      if (job.pages.some((page) => page.overlay)) steps.push("overlay");
      if (job.pages.some((page) => page.annotations?.length)) steps.push("flatten");
      if (job.compress) steps.push("compress");
      if (job.encrypt) steps.push("encrypt");
      const report = (step: PdfBuildStep) =>
        options.onProgress?.({ step, fraction: (steps.indexOf(step) + 1) / steps.length });

      // Read and fill each source, keeping fields with the same name apart.
      const sources = new Map<string, { pages: readonly FakePage[]; fields: FakeField[] }>();
      for (const source of job.sources) {
        if (sources.has(source.id)) {
          throw new TypeError(`The source ${source.id} appears twice.`);
        }
        const pdf = decodeFakePdf(copyBytes(source.bytes));
        if (!pdf) throw new PdfError("INVALID_PDF", `The source ${source.id} isn't a PDF.`);
        const unlocked = unlockFakePdf(pdf, source.password);
        if (unlocked === "missing") {
          throw new PdfError("PASSWORD_REQUIRED", `The source ${source.id} is encrypted.`);
        }
        if (unlocked === "wrong") {
          throw new PdfError("PASSWORD_REQUIRED", `The password of ${source.id} is wrong.`, {
            details: { reason: "incorrect-password" },
          });
        }
        const fields = (pdf.fields ?? []).map((field) =>
          source.formValues && Object.hasOwn(source.formValues, field.name)
            ? { ...field, value: source.formValues[field.name] as FakeField["value"] }
            : field,
        );
        sources.set(source.id, { pages: pdf.pages, fields });
      }
      report("fill");
      await Promise.resolve();
      throwIfAborted(options.signal);

      const pages: FakePage[] = [];
      const fields: FakeField[] = [];
      const taken = new Set<string>();
      job.pages.forEach((page, outputIndex) => {
        const source = sources.get(page.source);
        if (!source) throw new TypeError(`The page refers to an unknown source, ${page.source}.`);
        assertPageIndex(page.pageIndex, source.pages.length);
        const original = source.pages[page.pageIndex] as FakePage;
        if (page.overlay) {
          const overlay = sources.get(page.overlay.source);
          if (!overlay) {
            throw new TypeError(`The overlay refers to an unknown source, ${page.overlay.source}.`);
          }
          assertPageIndex(page.overlay.pageIndex, overlay.pages.length);
        }
        pages.push({
          ...original,
          rotation: addRotation(original.rotation ?? 0, page.rotation ?? 0),
          drawn: (original.drawn ?? 0) + (page.annotations?.length ?? 0),
          // An overlay changes what a page shows, never its size or rotation.
          ...(page.overlay ? { overlaid: (original.overlaid ?? 0) + 1 } : {}),
        });
        for (const field of source.fields.filter((f) => f.page === page.pageIndex)) {
          // Rename as qpdf does, so both values survive (ADR 0003).
          let name = field.name;
          for (let suffix = 1; taken.has(name); suffix += 1) name = `${field.name}+${suffix}`;
          taken.add(name);
          fields.push({ ...field, name, page: outputIndex });
        }
      });
      report("assemble");
      if (steps.includes("overlay")) report("overlay");
      if (steps.includes("flatten")) report("flatten");
      if (job.compress) report("compress");
      if (job.encrypt) report("encrypt");
      throwIfAborted(options.signal);

      return encodeFakePdf({
        pages,
        fields,
        // Only the job's own passwords: a source's never carry over.
        ...(job.encrypt
          ? {
              password: job.encrypt.userPassword,
              ownerPassword: job.encrypt.ownerPassword ?? job.encrypt.userPassword,
            }
          : {}),
      });
    },
    async destroy() {
      destroyed = true;
    },
  };
}
