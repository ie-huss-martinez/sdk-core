# 0003. A library on the device: the model, its formats, commands and stores

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** in sdk-core, [ADR 0008](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md) (ports and sessions), [ADR 0010](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0010-edits-as-commands.md) (edits as commands), [ADR 0029](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0029-session-store-and-history.md) (store and history) and [ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md) (portable formats)

## Context

The family's other editors open a file, edit it and export it, and keep nothing. A notes app is a library people come back to for months. There's no account and no server, so the notes live in the browser, and losing them is the worst thing this SDK can do.

That needs a model that reads back exactly as it was written, storage that never leaves a half-written notebook, saving that asks nothing of the user, and a way for a host to keep the library somewhere else.

## Decision

### The model

- **Units:** every position and length is an integer, 100 units to a PDF point (1/72 inch), from the page's top-left corner with y growing downwards. Integers read back exactly, in any language.
- **A notebook** has a title, a cover, its pages in order, an outline and its recordings. Each page has a size, a paper template and, for a page of an imported PDF, the PDF page under it.
- **A page's contents** are its items, from the bottom up: strokes, text boxes, pictures and links.
- **A stroke** holds its tool, colour, width and its path as `x, y, pressure` triples, with pressure from 0 to 1000.
- **Files** (PDFs, pictures, recordings) are referenced by their SHA-256, never inline.
- **Identifiers** are 22 random characters from `crypto.getRandomValues`, at most 64 characters of `A-Z a-z 0-9 _ -`.

### Formats

Four documents, each versioned JSON with a JSON Schema in `formats/` and a strict reader that refuses unknown fields:

| Format | Holds |
|---|---|
| `hm-notes-notebook` | A notebook: title, cover, pages, outline, recordings |
| `hm-notes-page` | One page's items |
| `hm-notes-library` | The library's index: folders, notebook summaries, when it was last backed up |
| `hm-notes-backup` | A backup's manifest ([ADR 0005](0005-backup-and-restore.md)) |

A command is its own document, described by `hm-notes-command`. A breaking change bumps a version and ships a migration, so every earlier version stays readable. `conformance/` holds the cases the readers and the commands must pass.

### Commands

- **Every edit is one of twelve commands,** plain data: add, remove, restore and replace items; add, remove, restore and reorder pages; set templates, the outline, the title and the recordings.
- **`applyNotesCommand` returns the new state and the inverse command.** A command that doesn't apply changes nothing and throws `INVALID_COMMAND` with a reason.
- **A page is its own document,** loaded when it's first shown, so opening a long notebook reads only its first pages. A command on a page that isn't loaded is refused.
- **Undo and redo** use sdk-core's history, up to 500 steps. Several commands executed together are one step.

### Sessions

- **`createNotesLibrary`** holds the index: folders, notebooks, the bin, import, backup, restore, search and export.
- **`openNotesSession`** holds one open notebook. It takes the notebook for its tab, so two tabs never write the same one: the second gets `NOTEBOOK_IN_USE`.
- **It saves as you write.** 400 milliseconds after a change, the changed pages are written, then the notebook's own document, last, so it never lists a page that isn't stored. The React editor also saves when the tab is hidden and when the page goes away.
- **A failed save loses nothing.** The changes stay in memory, the snapshot says `failed` with the error, and the next change or `flush()` tries again.
- **Deleting is undoable.** A notebook goes to the bin, from where it's restored. Only deleting from the bin is for good, and that asks first.

### Storage

- **`NotesStore` is the port.** It holds whole documents and never interprets them. A write resolves once the data is safely stored, and replaces the earlier document as a whole or not at all.
- **`createOpfsNotesStore`** is the store on the device:
  - notebooks in the origin private file system, as `notebooks/<id>/notebook.json`, `pages/<pageId>.json` and `assets/<hash>`, written through `createWritable()`, which replaces a file only when it closes;
  - an uppercase letter in a file name is written as `~` and its lowercase, because some disks fold case;
  - the index and the search text in IndexedDB;
  - the Web Locks API for a notebook's lock, and a `BroadcastChannel` so a second tab sees the library change.
- **The index can be rebuilt.** If it's missing, the library lists the notebooks the store holds.
- **`createMemoryNotesStore`** keeps everything in memory, for tests and for hosts that want no persistence. Both stores pass one contract suite.
- **The store says whether the browser will keep the data,** and the library can ask it to (`navigator.storage.persist()`). The editor shows a notice until it's granted.
- **Missing platform features fail with `UNSUPPORTED_ENVIRONMENT`,** naming the feature, on first use and never at creation, so the store can be created on a server.

### Search

Each page's typed text, and the text of the PDF page under it, are kept in the store's index. Search compares without case or line breaks and returns the page with the words around the match. Handwriting isn't searched.

## Alternatives considered

- **One file per notebook:** every stroke would rewrite the whole notebook, and one bad write would lose all of it.
- **Everything in IndexedDB:** large PDFs and recordings as blobs in IndexedDB are slow to write and copied on every read in some browsers. Files are what the origin private file system is for.
- **`localStorage`:** five megabytes, synchronous, and strings only.
- **An append-only log of commands:** smaller writes, but reading a page means replaying its history, and compaction is another way to lose data.
- **A server, for sync:** it means accounts and a backend that holds private notes, against the family's promise that files never leave the device.
- **Floats for positions:** they don't round-trip through every JSON library, and equal documents would differ.

## Consequences

- A notebook costs one small write per changed page, and survives a crash at any point: it's either the old page or the new one.
- The browser can still clear a site's storage. The notice, `persist()`, installing the app and backups are the defences, in that order.
- A host can pass its own `NotesStore`, such as one that syncs to a folder the user chooses.
- Files a notebook no longer refers to stay in its folder until the notebook is deleted. Collecting them is a later step.
