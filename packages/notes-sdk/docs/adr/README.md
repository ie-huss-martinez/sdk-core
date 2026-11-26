# Architecture decision records

Decisions specific to `@hussmartinez/notes-sdk`. Decisions for the whole SDK family live in [`sdk-core`'s `docs/adr`](https://github.com/ie-huss-martinez/sdk-core/tree/main/docs/adr); the records here build on them and never contradict them. To change a family decision, write a record in `sdk-core`.

Each record captures one significant decision: the context that forced it, what we chose, the alternatives we rejected and the consequences we accept. Records are numbered and immutable. To change a decision, write a new record that supersedes the old one and link the two.

Use [`template.md`](template.md) for new records. Name files `NNNN-short-title.md`, taking the next free number.

| # | Decision | Status |
|---|---|---|
| [0001](0001-a-familiar-layout-with-our-own-assets.md) | A familiar layout, with assets of our own | Accepted; its open notebook and design values refined by [0008](0008-the-notebook-on-ui-s-frame.md) |
| [0002](0002-the-ink-engine.md) | The ink engine: pointer events, two canvases, and a pen that writes while fingers move the page | Accepted |
| [0003](0003-a-library-on-the-device.md) | A library on the device: the model, its formats, commands and stores | Accepted |
| [0004](0004-notes-limits.md) | Notes limits, and checking pictures before they're decoded | Accepted |
| [0005](0005-backup-and-restore.md) | Backup and restore: a zip of the library's own documents | Accepted |
| [0006](0006-pdfs-under-the-ink-and-as-export.md) | PDFs under the ink, and export with the ink as vector paths | Accepted |
| [0007](0007-sound-alongside-the-ink.md) | Sound recorded alongside the ink | Accepted |
| [0008](0008-the-notebook-on-ui-s-frame.md) | The notebook on ui's frame: the dock, the blue bar, levels, start cards, toasts and preferences | Accepted; refines [0001](0001-a-familiar-layout-with-our-own-assets.md) |
