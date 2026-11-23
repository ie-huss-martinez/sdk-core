---
"@hussmartinez/pdf-sdk": patch
---

A build can draw one page over another. `PdfBuildPage` takes an optional `overlay`, a `PdfPageOverlay` naming the `source` and `pageIndex` of a page to draw over it, from any source of the job: `{ source: "report", pageIndex: 0, overlay: { source: "ink", pageIndex: 0 } }`. The overlay lands on the page as displayed, after its rotation, upright and centred; a larger one is scaled down to fit and a smaller one keeps its size. Only what it paints covers the page, and its links and form fields come with it. `onProgress` reports a new `"overlay"` step, between `"assemble"` and `"compress"`, for jobs that have one, so a `switch` over every `PdfBuildStep` needs a case for it. An overlay that names an unknown source throws `TypeError`, and a page outside its source `RangeError`. Jobs without overlays build as before.
