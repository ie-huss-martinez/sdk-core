# 0005. Backup and restore: a zip of the library's own documents

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** [ADR 0003](0003-a-library-on-the-device.md) (the library and its formats) and [ADR 0004](0004-notes-limits.md) (limits); in sdk-core, [ADR 0012](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md) (hostile input) and [ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md) (portable formats)

## Context

Notes kept only in a browser are lost if the device is, or if the browser's data is cleared. With no server, the only copy elsewhere is one the user makes. So backup and restore are in the first version, and they have to be something people can trust: a file they can keep anywhere, that a later version still reads, and that never damages the library it's restored into.

## Decision

### The file

A backup is a standard zip, which ordinary tools open:

```text
backup.json                                  the manifest (hm-notes-backup)
notebooks/<id>/notebook.json                 the notebook (hm-notes-notebook)
notebooks/<id>/pages/<pageId>.json           each page (hm-notes-page)
notebooks/<id>/assets/<64 hex digits>        each file, named by its SHA-256
```

- **The documents are the library's own,** in the same formats the store holds. There's no second format to keep in step.
- **The manifest** says when the backup was made, whether it's the whole library or chosen notebooks, and which folder each notebook is in.
- **JSON is deflated; files are stored as they are,** since PDFs, pictures and recordings are already compressed. ZIP64 records are written only when the count or a size needs them.
- **Written with our own code** and the browser's `CompressionStream`, as a `Blob` of parts, never one large buffer. The dates of the zip's entries are fixed, so the archive doesn't depend on when it's written. The manifest still says when the backup was made, so two backups of the same library are the same bytes only if they record the same time.

### Making a backup

- What's open is saved first.
- Each file is read back and checked against its reference's size and hash. A backup that silently lacked or held a damaged file would only fail when it's needed.
- **A backup restore would refuse for its size isn't handed over.** The library gives its file policy, and a backup with more entries than `maxBackupEntries`, or larger than `maxBackupSize`, fails with that limit's error while it's made. The user can then back up fewer notebooks.
- The library records when it was last backed up, and the editor reminds when notebooks have changed and two weeks have passed.

### Restoring

- **Everything is checked before anything is written.** Every document of every notebook is read with the strict readers, every referenced file must be in the archive, and each file must hash to its name. One fault refuses the whole backup, with the library untouched.
- **Restore never overwrites.** For each notebook:
  - the library doesn't have it: it's restored under its own id;
  - the library has the same notebook, unchanged: it's left alone;
  - the library has a different version: the backup's copy is restored beside it, under a new id.
- **"Unchanged" means equal contents,** not an equal time: the notebook's document and every one of its pages are compared with the backup's. A notebook's `updatedAt` doesn't move when two saves fall in one tick of the clock, or while the clock is set back, so the time alone would leave the backup's ink unrestored.
- **Folders** the library already has are reused; the others are added.
- **Writing order** is files, then pages, then the notebook's document, so an interrupted restore never leaves a notebook pointing at pages that aren't there.
- **Running the same restore again finishes an interrupted one.** A notebook that was written whole is found in the store and listed, not written again. That holds for a copy made under a new id too: when a notebook can't take its own id, restore looks through the store's other notebooks, and one that equals the backup's stands for it. So restoring one backup twice makes one copy, not two. A notebook that was half-written under its own id is written again, whole.
- **A restore writes a notebook under its own id only while it holds the store's lock on that notebook,** after reading again that the id is free. If another restore, a session or another tab holds it, or a notebook is there by then, the backup's copy goes beside it under a new id. The library also runs its restores one at a time. So two restores never write one notebook between them.

What restore doesn't do:

- **It doesn't clear what an interrupted copy left.** If a restore stops while it writes a copy under a new id, before the copy's document, the store keeps that copy's files and pages under an id no notebook has. The next restore can't know that id, and makes the copy again under another. Nothing is lost and no notebook shows them, but they take room until the store is cleared. Removing them needs the store to list what it holds that no document refers to, which the port doesn't offer yet.
- **It can't keep out a writer that doesn't take the lock.** The lock is the store's own, shared by the tabs of one origin. A host's store that grants every lock, or code that writes a notebook under an id it didn't make without taking the lock, could still write under an id while a restore does. The SDK's own writers take the lock or use a new random id.
- **A later version** of a format is refused with `UNSUPPORTED_FORMAT`, which the editor explains as "update the app".

### The reader

- **It treats the archive as hostile.** It finds the directory from the file's tail, checks every offset and length against the file's real size before reading, and refuses multi-disk archives, encrypted entries, methods other than stored and deflate, duplicate names, and names with `..`, a leading slash, a drive letter, a backslash or control characters.
- **A zip bomb fails early.** The sizes the directory declares are summed against `maxBackupSize` before any entry is read. Entries are then inflated by the browser's `DecompressionStream` while counting bytes, and reading stops when an entry exceeds its declared size, so no archive gives more than it declared. The entry count is bounded by `maxBackupEntries`. Each entry's CRC-32 is checked.
- **It runs on the page, not in a worker,** for the reasons [ADR 0004](0004-notes-limits.md) gives for the picture probe: it reads fixed-size records at checked offsets, the inflating is the platform's, and the JSON inside goes through the same strict readers as every stored document. It never slices the whole file into memory.

### What guards the format

`src/core/backup/fixtures/library-v1.zip` is a backup written by version 1, committed, with a test that restores it and checks its contents exactly. Every later version of the format must keep that test passing.

## Alternatives considered

- **A format of our own:** nothing else could open it, and people trust a backup more when they can look inside.
- **A zip library:** the reader and the writer are a few hundred lines over the platform's own inflate and deflate. A dependency would be more code to audit than they are.
- **Restore that replaces the library:** simpler, and one wrong file would destroy months of notes.
- **Merging pages of the same notebook:** there's no way to know which side the user wants. Keeping both loses nothing.
- **Backing up automatically to a folder:** a good later step, with the File System Access API where it exists. It needs a permission the user grants each session.

## Consequences

- A backup is a file anyone can open, and restoring one can only add to a library.
- Restoring a backup of a notebook that changed since leaves two notebooks, which the user sorts out.
- Restoring into a library that already holds the backup's notebooks reads every page of them to compare, so it's slower than a check of times would be. Restore is rare, and a wrong "unchanged" would leave notes unrestored.
- A backup needs room for a second copy of the library while it's written.
- The reader is our own code facing hostile input, so it carries the tests: each refusal, corrupted archives, archives from other tools, and the committed fixture.
