# `hm-notes-backup`, version 1

One of notes-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), [ADR 0005](../adr/0005-backup-and-restore.md)). A port in another language reads and writes it, and proves it reads the manifest as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-notes-backup` 1 | [`formats/hm-notes-backup/v1.schema.json`](../../formats/hm-notes-backup/v1.schema.json) | A backup's manifest: the notebooks the backup holds, and the folders they're in |

A backup is one file a person can keep anywhere: a zip archive of the library's own documents and files. Its manifest is the archive's first entry. It says what the archive holds, so a reader knows what to look for before it reads anything else.

`readNotesBackupManifest(json)` reads a manifest. `createNotesBackup` writes a whole backup and `restoreNotesBackup` reads one. [Loading the schemas](hm-notes-command.md#loading-the-schemas) shows how a host validates with the schema.

## The archive

```text
backup.json                                  the manifest (hm-notes-backup)
notebooks/<id>/notebook.json                 the notebook (hm-notes-notebook)
notebooks/<id>/pages/<pageId>.json           each page (hm-notes-page)
notebooks/<id>/assets/<64 hex digits>        each file, named by its SHA-256
```

- **A standard zip,** which ordinary tools open. Entries are stored or deflated, and nothing else: no encryption, no other method, one disk. ZIP64 records are present when the number of entries or a size needs them.
- **`backup.json` comes first.** JSON entries are UTF-8, and this SDK writes them deflated.
- **`<id>` is the notebook's id,** as the manifest lists it and as its `notebook.json` holds it. `<pageId>` is the page's id, as the notebook lists it and as the page's document holds it. Ids use only `A-Z`, `a-z`, `0-9`, `_` and `-`, so they're safe as names.
- **Each file is named by its hash:** the 64 hexadecimal digits of its asset name, without `sha256:`. This SDK stores files as they are, since PDFs, pictures and recordings are already compressed. A file two pages use is in the archive once for each notebook that uses it.
- **Everything a notebook refers to is there:** every page it lists, and every PDF, picture and recording they refer to, with the size its reference gives and the SHA-256 its name gives.
- **Entries the manifest doesn't lead to are ignored.**

The documents are the same ones the library keeps, in the same formats: [`hm-notes-notebook`](hm-notes-notebook.md) and [`hm-notes-page`](hm-notes-page.md). There's no second form of them for a backup.

## The manifest

```json
{
  "format": "hm-notes-backup",
  "version": 1,
  "createdAt": 1700000500000,
  "scope": "library",
  "folders": [
    { "id": "f1", "name": "Courses", "parent": null, "createdAt": 1700000000000 },
    { "id": "f2", "name": "Physics", "parent": "f1", "createdAt": 1700000000000 }
  ],
  "notebooks": [
    { "id": "nb1", "folder": "f2" },
    { "id": "nb2", "folder": null }
  ]
}
```

Every field is required. Every number is a whole number.

| Field | Type | Unit and bounds |
|---|---|---|
| `format` | text | `"hm-notes-backup"` |
| `version` | number | `1` |
| `createdAt` | time | When the backup was made, in milliseconds since the Unix epoch, from 0 to 8,640,000,000,000,000 |
| `scope` | text | `"library"` for the whole library, or `"notebooks"` for the notebooks chosen |
| `folders` | list | Up to 100,000 folders: those the notebooks are in, with the folders those are in |
| `folders[].id` | id | 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. Unique among the folders |
| `folders[].name` | text | Up to 200 code points |
| `folders[].parent` | id or `null` | The folder it's in, or `null` at the top |
| `folders[].createdAt` | time | Milliseconds since the Unix epoch |
| `notebooks` | list | Up to 100,000 notebooks |
| `notebooks[].id` | id | The notebook's id, and its folder's name in the archive. Unique among the notebooks |
| `notebooks[].folder` | id or `null` | The folder it's in, or `null` at the top |

A folder is the same as in the [library's index](hm-notes-library.md). The manifest holds nothing else of a notebook: its title and the rest are in its own `notebook.json`.

Lengths count Unicode code points, and text never holds half of a surrogate pair on its own. Ids are data: `__proto__`, `constructor` and `toString` are valid ids, and the vectors use each of them.

## Beyond the schema

Reading the manifest checks what a schema can't say:

- folder ids are unique, and so are notebook ids;
- every folder's `parent` is a folder the manifest lists, and so is every notebook's `folder`;
- no folder is inside itself, directly or through other folders;
- no name holds a lone surrogate.

Reading the archive checks the rest, before anything is restored ([ADR 0005](../adr/0005-backup-and-restore.md)): every entry the manifest leads to is there, every document is read by its own strict reader, a notebook's document has the id of its folder in the archive and a page's the id of its file, and every file has the size and the hash its reference gives.

**Strict:** an unknown field anywhere in the manifest is refused, never dropped.

## Rejections

A refusal is compared by its code and `details.reason`, never its message.

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT`, from the manifest | `malformed-document`, `invalid-id`, `duplicate-id`, `unknown-folder`, `invalid-time`, `text-too-long` |
| `INVALID_DOCUMENT`, from the archive | `malformed-archive`: not a zip this format allows, or one that's damaged. `missing-entry`: a document or a file the backup should hold isn't there. `asset-mismatch`: a file hasn't the size or the hash its reference gives |
| `BACKUP_TOO_LARGE`, `TOO_MANY_BACKUP_ENTRIES` | The file policy's limits on a backup ([ADR 0004](../adr/0004-notes-limits.md)) |

The vectors cover the manifest. The archive's own refusals are checked by this SDK's tests of its zip reader and of restore, and by a backup written by version 1 that's kept with them.

## Changing the format

A breaking change is a new version, with its schema beside this one and a migration from version 1, so every earlier version stays readable (sdk-core ADR 0045, section 1). That holds for the manifest and for the archive's layout: a backup made today must restore in every later release. Because readers are strict, adding a field to the manifest is a breaking change too. A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`, which the editor explains as "update the app".
