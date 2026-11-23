# 0004. Notes limits, and checking pictures before they're decoded

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** in sdk-core, [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md) (hostile input), [ADR 0020](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0020-file-policy.md) (file policy) and [ADR 0031](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0031-platform-decoders-on-the-page.md) (platform decoders on the page)

## Context

Three kinds of file enter the SDK from outside: PDFs to write on, pictures to place, and backups to restore. Each is hostile until checked (sdk-core ADR 0012). The family's rule is to parse in workers, with one exception: a decoder that only exists on the page, for files that were probed and bounded first (sdk-core ADR 0031).

This SDK has no worker of its own. PDFs are parsed in `pdf-sdk`'s workers. That leaves pictures and backups.

## Decision

### Limits

`notesLimits` extends sdk-core's core limits, which bound each imported PDF and picture:

| Limit | Code | Default maximum | Default warning |
|---|---|---|---|
| `maxPages` | `TOO_MANY_PAGES` | 5,000 | 1,000 |
| `maxPageItems` | `TOO_MANY_ITEMS` | 50,000 | 20,000 |
| `maxImagePixels` | `IMAGE_TOO_LARGE` | 50 megapixels | none |
| `maxBackupSize` | `BACKUP_TOO_LARGE` | 4 GB | 1 GB |
| `maxBackupEntries` | `TOO_MANY_BACKUP_ENTRIES` | 500,000 | none |

Hosts change them through `filePolicy`. The model has bounds of its own that no policy changes, in `src/core/model/portable.ts`: 20,000 points in a stroke, 20,000 code points in a text box, 200 in a title.

### Pictures

A picture is checked in this order, and refused at the first failure:

1. **Its size in bytes,** against `maxFileSize`.
2. **Its header,** read by `probeImage`: the kind, told by the first bytes and never by the name or the browser's guess, and the width and height. PNG, JPEG, WebP and GIF only. SVG is never accepted: it can carry scripts.
3. **Its pixels,** width times height, against `maxImagePixels`.
4. **Only then the browser's decoder,** `createImageBitmap`, which is the platform's and decodes asynchronously. Where it decodes is the browser's choice, so the size check before it is the SDK's guarantee. What it decoded is checked against the limit again.

**The header probe runs on the page, not in a worker.** It reads fixed fields at offsets it checks against the bytes it has: at most 32 bytes for PNG, WebP and GIF, and segment headers up to the first megabyte for a JPEG. It decodes nothing and allocates nothing from a length in the file. A worker for it would add a second way to ship and start code, for a function that reads a few integers. It has property tests over arbitrary bytes.

Pictures are only ever drawn to a canvas from an `ImageBitmap`. They're never inserted as markup or given a URL.

### PDFs

A PDF is checked against `maxFileSize`, opened in `pdf-sdk`'s worker under its own limits, and its page count against `maxPages` ([ADR 0006](0006-pdfs-under-the-ink-and-as-export.md)).

### Backups

A backup's size, its entry count and what it inflates to are bounded while it's read ([ADR 0005](0005-backup-and-restore.md)).

### Names

A file's name is cleaned once with sdk-core's `cleanFileName` where it becomes a notebook's title or a download's name. Titles and names are text content, never markup, and never reach `onEvent`.

## Alternatives considered

- **A worker for the header probe and the backup reader:** it would follow the family's rule to the letter. It would also give this SDK the family's whole worker machinery (an inlined copy, a self-hosted copy, a version handshake, their budgets and tests) for two small readers that decode nothing. If a later feature needs a real parser, such as handwriting recognition, the worker arrives with it and these can move in.
- **Decoding first and checking the bitmap:** a small file can declare a huge image, and the decoder would allocate it before the check.
- **Accepting SVG through `<img>`:** safe to show, but it can't be drawn to an exported PDF as vectors without parsing it.

## Consequences

- No picture reaches a decoder before its size is known and within the limit.
- This SDK parses two things on the page, both bounded and tested. That's a narrow reading of the family's rule, recorded here so it's a decision and not an oversight.
- A notebook already stored that's over a limit still opens: limits stop growth, they never hide the user's own notes.
