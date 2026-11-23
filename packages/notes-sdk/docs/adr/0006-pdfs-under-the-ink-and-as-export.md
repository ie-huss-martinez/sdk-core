# 0006. PDFs under the ink, and export with the ink as vector paths

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** [ADR 0002](0002-the-ink-engine.md) (the ink engine) and [ADR 0003](0003-a-library-on-the-device.md) (the model); in sdk-core, [ADR 0008](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md) (ports), [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md) (hostile input) and [ADR 0028](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0028-third-party-engines.md) (third-party engines); in pdf-sdk, [ADR 0011](../../../pdf-sdk/docs/adr/0011-drawing-one-page-over-another.md) (drawing one page over another)

## Context

Two things people do with a notes app involve PDFs: they import one, such as lecture slides, and write on it; and they export a notebook as a PDF to hand in or print.

The family already has `pdf-sdk`, which reads PDFs with pdf.js and transforms them with qpdf, each in a worker. Its processor assembles pages from several documents, but it can't draw on a page: flattening annotations is still to come there, and its stroke annotation is a line of one width, while this SDK's ink is a filled outline whose width follows pressure.

An exported page should look like the screen, stay sharp at any zoom, and stay small. That means vector paths, not a picture of the page.

## Decision

### The port

`NotesPdfEngine` is what this SDK needs from a PDF engine: open a PDF, read each page's size and text, draw a page onto a canvas, and assemble an exported document. `createNotesPdfEngine` implements it on `@hussmartinez/pdf-sdk`, a regular dependency. A host passes `assetsUrl` to self-host pdf-sdk's workers, or its own engine.

### Importing

- A PDF becomes a notebook with one page per PDF page, each the size the PDF page is shown at, after its own rotation.
- The PDF's bytes are stored once, as a file of the notebook. Each page refers to it and to its page index.
- Each page's text is read at import and kept for search. A notebook restored from a backup has its PDF text read again in the background when it's opened.
- On screen, pdf.js draws the PDF page onto a canvas under the ink, off screen first, so a page is never shown half drawn. It's redrawn when the zoom settles.
- A PDF that can't be opened is refused with `INVALID_PDF`, and a protected one with `PASSWORD_REQUIRED`. Nothing is stored for either.

### Exporting

The SDK writes its own PDF, with a small writer in `src/core/pdf`:

- **One page per notebook page,** in the page's size.
- **Ink is filled paths.** Each stroke's outline, the same one the screen draws, becomes a closed path of cubic curves. Highlighter ink is drawn first with the multiply blend at 40% opacity, as on screen.
- **Paper** is its white ground and its template's rules, as vectors.
- **Text** is written with Helvetica, one of the fonts every PDF viewer has, so no font is embedded. Lines break where they break on screen, because the editor passes its own measured layout, and each line is scaled to its measured width. Text Helvetica can't write, such as non-Latin scripts, is placed as a picture at 300 dots per inch.
- **Pictures** are embedded once each: photographs as JPEG, the others as pixels with their transparency.
- **Streams are deflated** with the browser's `CompressionStream`. The same notebook gives the same bytes.

For a notebook of plain pages, that file is the export, and no PDF engine is loaded.

For a page over a PDF, the SDK's page holds only the ink, on a transparent ground, and `pdf-sdk` draws it over the original page with qpdf (pdf-sdk ADR 0011: `PdfBuildPage.overlay`). The original page is kept as it is: its text, fonts, links and form fields. Both pages are the same size, so nothing is scaled.

### What isn't exported yet

Links between pages and the outline. The writer doesn't write link annotations or a document outline yet; both are later steps.

## Alternatives considered

- **Flattening through pdf-sdk's annotations:** its stroke annotation has one width, and its flattening isn't written. A "filled path" annotation, pictures and text with fonts would make pdf-sdk's drawing model this SDK's, in a worker this SDK doesn't own.
- **Bundling a PDF library here:** a second copy of what pdf-sdk already ships, and a third-party parser in this package.
- **Exporting pages as pictures:** large files, soft when zoomed, and no selectable text.
- **Embedding a font:** it would add hundreds of kilobytes to cover scripts Helvetica doesn't, and still not all of them. A picture of the text box covers every script the device can show.

## Consequences

- Exported ink is vectors: sharp at any size, and a few kilobytes a page.
- Typed text in Latin script is real text in the PDF; other scripts are pictures until a font is embedded.
- pdf-sdk gains one small, general capability, drawing a page over another, which other hosts can use.
- **A known limit: a PDF whose trim box differs from its crop box.** The editor shows a page by its crop box, as pdf.js does, and pdf-sdk places what's drawn over a page by its trim box ([pdf-sdk ADR 0011](../../../pdf-sdk/docs/adr/0011-drawing-one-page-over-another.md)). On such a file, usually one prepared for print with bleed, the exported ink is fitted to the trim box, so it comes out smaller than it was written, and shifted if the trim box isn't centred. Nothing is lost, and the notebook itself is unaffected. Closing it needs pdf-sdk to place by the box it's asked for, which is its own change.
- The PDF writer is our own code. It only writes, from the SDK's own checked model, so it faces no hostile input, and a browser test opens what it writes with pdf.js.
