# 0011. Drawing one page over another

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** [ADR 0001](0001-pdf-engines.md) (qpdf transforms) and [ADR 0003](0003-page-plan-document-model.md) (the build job)

## Context

notes-sdk exports notebooks as PDF. A notebook page can be written over a page of an imported PDF. For such a page, notes-sdk makes a one-page PDF of its own that holds only the ink, as vector outlines on a page of the same size with nothing else painted. It needs the processor to draw that page over the original one.

A build job could take pages from several sources, in any order, but it couldn't put one page over another.

Flattening annotations ([ADR 0003](0003-page-plan-document-model.md)) is still to come, and is a different thing. An annotation is a pen stroke, a highlight or a note that the editor made and that pdf-lib will draw. A page overlay is a whole page of another document, drawn by qpdf as it is. ADR 0003 calls annotations and form values "overlays" of the plan; this record is only about page overlays.

## Decision

### The field

`PdfBuildPage` gains an optional `overlay`, a `PdfPageOverlay`: the `source` and zero-based `pageIndex` of a page to draw over this one. The source is any source of the job, including the page's own. A page has at most one overlay.

The build gains a step, `"overlay"`, after `"assemble"` and before `"flatten"`. It runs, and is reported to `onProgress`, only when a page has an overlay. A job without overlays builds exactly as before.

The page plan, its commands and the `hm-pdf-plan` format don't change. The session never builds a job with overlays; hosts that call the processor do.

### How it's drawn

qpdf draws it, with `--overlay`. The pipeline merges the overlay pages into one stamp document, in the order of the pages they go on, then runs one pass with `--to=<those pages> --from=1-z`. qpdf draws the first page of `--from` over the first page listed in `--to`, the second over the second, and so on.

What the qpdf in `pdfstudio` 0.4.0 does, measured, and asserted by the processor's browser tests on the pixels the SDK's own engine renders:

- **Over the content.** The overlay is drawn after the page's own content. Where the overlay page paints nothing, the page shows through. Pages without an overlay aren't touched.
- **On the page as displayed.** The overlay is placed after the page's rotation, both the page's own `/Rotate` and the job's `rotation`. It stays upright for the reader; it isn't turned with the page.
- **Centred, scaled down to fit, never enlarged.** An overlay wider or taller than the displayed page is scaled down, keeping its proportions, until it fits. A smaller one keeps its size. Either is centred.
- **By trim box.** Each page is measured by its trim box, which is its crop box when it has none, and its media box when it has neither. The overlay page's own `/Rotate` is applied first.

| Page, as displayed | Overlay page | Where the overlay lands |
|---|---|---|
| 400 × 600 | 400 × 600 | Over the whole page |
| 400 × 600 | 800 × 800 | At half size, 400 × 400, with 100 points above and below |
| 400 × 600 | 200 × 300 | At its own size, 100 points in and 150 points up |
| 400 × 600 turned a quarter turn, shown 600 × 400 | 600 × 400 | Over the whole page, upright |
| 400 × 600 turned a quarter turn, shown 600 × 400 | 400 × 600 | At two thirds, 267 × 400, upright and centred |

So an overlay made for a rotated page has the page's displayed size: for a quarter turn, its width is the page's height.

### Links and form fields come along

qpdf copies the overlay page's annotations to the page it's drawn over, placed as the content is, which the pipeline's unit tests assert. Its links stay links. Its form fields become fields of the output, with their values, and a field whose name is already taken is renamed as in a merge: `name` becomes `name+1`. Form values given for a source are filled before its pages are used, as overlays too.

We keep that. An overlay page is a page of a source, and it brings what a page brings. A host that wants only the drawing passes a page that has only the drawing, as notes-sdk does.

### Validation and errors

- An overlay that names a source the job doesn't have is a `TypeError`, thrown before any work, as for a page.
- An overlay `pageIndex` outside its source is a `RangeError`, as for a page.
- A source used only by overlays is normalised and checked like any other: `INVALID_PDF` when it can't be read, `PASSWORD_REQUIRED` when it's encrypted. A source that neither a page nor an overlay uses is still never read.
- A failure while drawing is `PROCESSING_FAILED`, with qpdf's error as its cause.
- The build checks for cancellation after each qpdf pass of the step, as in the other steps.

### A whole document stays whole

When the job's pages are every page of one source, in order, the pipeline doesn't reassemble them, so the document keeps what a merge drops, such as its title and outline. That now holds when the overlays come from other sources too: only pages decide it.

## Alternatives considered

- **Flattening annotations now, with a "filled path" annotation:** the surface is much larger: a new annotation type in the plan, its commands and the portable format, and pdf-lib's drawing and fonts in the pipeline. notes-sdk's ink is outlines of variable width, which the stroke annotation, a line of one width, can't express.
- **A separate `overlay()` method on the processor:** a second trip across the worker boundary and a second parse of the same bytes, for something the build already has open. One job keeps the rule of ADR 0003: one call builds the document.
- **Removing the overlay page's links and fields:** it needs another pass over the stamp document, and it would make an overlay page behave unlike any other page of a source. A host can leave them out of the page it passes.
- **Overlay coordinates in the unrotated page, as annotations have:** qpdf doesn't place overlays that way, and undoing its placement means rewriting the overlay page before it's drawn. The rule is documented instead.

## Consequences

- notes-sdk can export ink over imported pages with one build. For a rotated page, it makes the ink page in the displayed size.
- A build with overlays costs two more qpdf passes, whatever the number of overlays: one to make the stamp document and one to draw.
- qpdf moves the content of a page that gets an overlay into a form XObject. The browser tests show that the page's own content is drawn as before; nothing here checks its text layer.
- `PdfBuildStep` has a new member. Code that switches over every step, such as a progress label, needs a case for `"overlay"`.
- Every `PdfProcessor` must accept `overlay`: the contract tests check the pages, the step and the errors, and the fake processor passes them. Where the overlay lands is checked on the qpdf adapter, in a browser.
- When flattening arrives, annotations are drawn after the overlay, on top of it.
