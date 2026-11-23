# `hm-notes-library`, version 1

One of notes-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), [ADR 0003](../adr/0003-a-library-on-the-device.md)). A port in another language reads and writes it, and proves it reads as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-notes-library` 1 | [`formats/hm-notes-library/v1.schema.json`](../../formats/hm-notes-library/v1.schema.json) | A library's index: its folders, what it shows of each notebook, and when it was last backed up |

The index is what the library's screen needs without opening a notebook: each notebook's title, cover, paper and page count, and the folder it's in. Each notebook's own document is an [`hm-notes-notebook`](hm-notes-notebook.md).

`readNotesLibraryDocument(json)` reads a document, and `toNotesLibraryDocument(index)` writes one, ready for `JSON.stringify`. [Loading the schemas](hm-notes-command.md#loading-the-schemas) shows how a host validates with the schema.

## Example

```json
{
  "format": "hm-notes-library",
  "version": 1,
  "folders": [
    { "id": "f1", "name": "Courses", "parent": null, "createdAt": 1700000000000 },
    { "id": "f2", "name": "Physics", "parent": "f1", "createdAt": 1700000000000 }
  ],
  "notebooks": [
    {
      "id": "nb1",
      "title": "Field notes",
      "cover": "blue",
      "template": "lined",
      "folder": "f2",
      "pageCount": 3,
      "createdAt": 1700000000000,
      "updatedAt": 1700000360000,
      "deletedAt": null
    }
  ],
  "lastBackupAt": 1700000200000,
  "lastChangeAt": 1700000360000
}
```

## Fields

Every field is required: one that may be empty holds `null`, and is never left out. Every number is a whole number.

| Field | Type | Unit and bounds |
|---|---|---|
| `format` | text | `"hm-notes-library"` |
| `version` | number | `1` |
| `folders` | list | Up to 100,000 folders, in any order |
| `folders[].id` | id | 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. Unique among the folders |
| `folders[].name` | text | Up to 200 code points |
| `folders[].parent` | id or `null` | The folder it's in, or `null` at the top |
| `folders[].createdAt` | time | Milliseconds since the Unix epoch |
| `notebooks` | list | Up to 100,000 notebooks, with those in the bin |
| `notebooks[].id` | id | Unique among the notebooks. It's the id of the notebook's own document |
| `notebooks[].title` | text | Up to 200 code points |
| `notebooks[].cover` | text | `"blue"`, `"green"`, `"amber"`, `"red"` or `"gray"` |
| `notebooks[].template` | text | The paper of its first page, drawn on its cover: `"blank"`, `"lined"`, `"grid"` or `"dotted"` |
| `notebooks[].folder` | id or `null` | The folder it's in, or `null` at the top |
| `notebooks[].pageCount` | number | From 1 to 100,000 |
| `notebooks[].createdAt`, `notebooks[].updatedAt` | time | Milliseconds since the Unix epoch |
| `notebooks[].deletedAt` | time or `null` | When it was moved to the bin, or `null` |
| `lastBackupAt` | time or `null` | When the whole library was last backed up, or `null` |
| `lastChangeAt` | time or `null` | When a notebook last changed, or `null` for an empty library |

A time is from 0 to 8,640,000,000,000,000 milliseconds since the Unix epoch, the last time a date holds. `-0` reads as `0`.

Lengths count Unicode code points, as the schema's `maxLength` does (sdk-core ADR 0045, section 8), and text never holds half of a surrogate pair on its own.

Ids are data. `__proto__`, `constructor` and `toString` are valid ids, and the vectors use each of them as a folder's and as a notebook's. A folder and a notebook may share an id: they're different kinds.

## Beyond the schema

A reader checks what depends on the whole document, which a schema can't say:

- folder ids are unique, and so are notebook ids;
- every folder's `parent` is a folder the index lists, and so is every notebook's `folder`;
- no folder is inside itself, directly or through other folders. A folder may be listed before the folder it's in;
- no name or title holds a lone surrogate.

A folder in an unknown folder and a ring of folders are both refused with `unknown-folder`: neither has a way to the top.

It doesn't check a notebook's summary against the notebook's own document, which is the record of the notebook.

**Strict:** an unknown field anywhere is refused, never dropped.

## Rejections

A refusal is compared by its code and `details.reason`, never its message. `details.at` gives the path of the value, such as `$.folders[1].parent`.

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT` | `malformed-document`, `invalid-id`, `duplicate-id`, `unknown-folder`, `invalid-time`, `text-too-long` |

## Changing the format

A breaking change is a new version, with its schema beside this one and a migration from version 1, so every earlier version stays readable (sdk-core ADR 0045, section 1). Because readers are strict, adding a field is a breaking change too. A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
