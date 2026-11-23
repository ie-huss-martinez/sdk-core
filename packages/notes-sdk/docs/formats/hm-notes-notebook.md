# `hm-notes-notebook`, version 1

One of notes-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), [ADR 0003](../adr/0003-a-library-on-the-device.md)). A port in another language reads and writes it, and proves it reads as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-notes-notebook` 1 | [`formats/hm-notes-notebook/v1.schema.json`](../../formats/hm-notes-notebook/v1.schema.json) | A notebook: its title, its pages in order, its outline and its recordings |

A notebook's document lists its pages, but not what's on them. Each page's contents are an [`hm-notes-page`](hm-notes-page.md) document of their own, so writing on one page saves one small document, and a notebook of a thousand pages opens without reading them all.

`readNotesNotebookDocument(json)` reads a document, and `toNotesNotebookDocument(notebook)` writes one, ready for `JSON.stringify`. [Loading the schemas](hm-notes-command.md#loading-the-schemas) shows how a host validates with the schema.

## Example

```json
{
  "format": "hm-notes-notebook",
  "version": 1,
  "id": "nb1",
  "title": "Field notes",
  "cover": "blue",
  "createdAt": 1700000000000,
  "updatedAt": 1700000360000,
  "pages": [
    { "id": "p1", "width": 59500, "height": 84200, "template": "lined" },
    {
      "id": "p2",
      "width": 61200,
      "height": 79200,
      "template": "blank",
      "background": {
        "pdf": {
          "asset": "sha256:0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a",
          "mediaType": "application/pdf",
          "size": 48213
        },
        "pageIndex": 0
      }
    }
  ],
  "outline": [{ "id": "o1", "title": "Week 1", "page": "p1" }],
  "recordings": [
    {
      "id": "r1",
      "audio": {
        "asset": "sha256:0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
        "mediaType": "audio/webm",
        "size": 120000
      },
      "startedAt": 1700000100000,
      "duration": 95000
    }
  ]
}
```

## Fields

Every field is required unless the table says otherwise. Every number is a whole number.

| Field | Type | Unit and bounds |
|---|---|---|
| `format` | text | `"hm-notes-notebook"` |
| `version` | number | `1` |
| `id` | id | 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-` (`NOTES_MAX_ID_LENGTH`) |
| `title` | text | Up to 200 code points (`NOTES_MAX_TITLE_LENGTH`). May be empty |
| `cover` | text | `"blue"`, `"green"`, `"amber"`, `"red"` or `"gray"`: a name the interface maps to a colour of its own |
| `createdAt`, `updatedAt` | time | Milliseconds since the Unix epoch, from 0 to 8,640,000,000,000,000, the last time a date holds |
| `pages` | list | 1 to 100,000 pages, in order |
| `pages[].id` | id | Unique among the notebook's pages. It names the page's `hm-notes-page` document |
| `pages[].width`, `pages[].height` | number | Units, from 7,200 to 1,440,000: one inch to 200 inches (`NOTES_MIN_PAGE_SIDE`, `NOTES_MAX_PAGE_SIDE`) |
| `pages[].template` | text | The paper: `"blank"`, `"lined"`, `"grid"` or `"dotted"`. The SDK draws the rules ([ADR 0001](../adr/0001-a-familiar-layout-with-our-own-assets.md)) |
| `pages[].background` | object, optional | The PDF page under the ink, for a page of an imported PDF |
| `pages[].background.pdf` | asset | The PDF's file. Its media type is `application/pdf` |
| `pages[].background.pageIndex` | number | The page's zero-based index in the PDF, from 0 to 1,000,000 |
| `outline` | list | Up to 2,000 entries, in order (`NOTES_MAX_OUTLINE_ENTRIES`) |
| `outline[].id` | id | Unique among the outline's entries |
| `outline[].title` | text | Up to 200 code points |
| `outline[].page` | id | The id of a page the notebook lists. Several entries may lead to one page |
| `recordings` | list | Up to 2,000 recordings (`NOTES_MAX_RECORDINGS`) |
| `recordings[].id` | id | Unique among the recordings. An item's `audio.recording` names it |
| `recordings[].audio` | asset | The recording's file: `audio/webm`, `audio/mp4`, `audio/ogg` or `audio/wav`, with no parameter such as a codec |
| `recordings[].startedAt` | time | When it started, in milliseconds since the Unix epoch |
| `recordings[].duration` | number | Its length, in milliseconds, from 0 |

### Units

Every position and length in notes-sdk's formats is a whole number of **units, 100 to a PDF point** (`NOTES_UNITS_PER_POINT`). A point is 1/72 inch, so a unit is about 3.5 micrometres, and an A4 page is 59,500 by 84,200 units. Whole numbers on a fixed grid read back exactly in every language (sdk-core ADR 0045, section 3). JSON has no whole numbers of its own, so `1` and `1.0` are the same value, and `-0` reads as `0`.

### Assets

A file is never inline. It's a reference, `{ "asset", "mediaType", "size" }` (sdk-core ADR 0045, section 2):

| Field | Type | Unit and bounds |
|---|---|---|
| `asset` | text | `sha256:` and the SHA-256 of the file's bytes, as 64 lowercase hexadecimal digits |
| `mediaType` | text | One of the types the field allows, in lowercase, with no parameter |
| `size` | number | Bytes, from 0 to 9,007,199,254,740,991 |

The file itself is stored once under its hash, however many pages use it. A document never records a file's name.

### Text and ids

Lengths count Unicode code points, as the schema's `maxLength` does (sdk-core ADR 0045, section 8). A character outside the BMP, such as an emoji, is one code point, though JavaScript's `length` counts it as two. Text never holds half of a surrogate pair on its own: it isn't text, and can't be written as UTF-8.

Ids are data. `__proto__`, `constructor` and `toString` are valid ids, and the vectors use each of them as a notebook's, a page's, an outline entry's and a recording's.

## Beyond the schema

A reader checks what depends on the whole document, which a schema can't say:

- page ids are unique, and so are outline ids and recording ids, each among their own kind;
- every outline entry leads to a page the notebook lists;
- no title holds a lone surrogate.

It doesn't check that `updatedAt` is after `createdAt`, or that a background's `pageIndex` is within its PDF: the document doesn't hold the PDF's page count.

**Strict:** an unknown field anywhere is refused, never dropped. So a later version's document can't be misread as this one.

**Not in the format:** the pages' contents, the session's undo history, the page being shown, and the folder the notebook is in, which the [library's index](hm-notes-library.md) holds.

## Rejections

A refusal is compared by its code and `details.reason`, never its message. `details.at` gives the path of the value, such as `$.pages[2].width`, and never the value itself.

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`: another format's name, or none. `unknown-format-version`: a version after 1 |
| `INVALID_DOCUMENT` | `malformed-document`, `invalid-id`, `duplicate-id`, `unknown-page`, `invalid-size`, `invalid-time`, `text-too-long`, `invalid-asset` |

The header is checked first, so a document of another format or of a later version is refused as that, whatever else it holds. A `version` that isn't a whole number from 1 is `malformed-document`.

## Changing the format

A breaking change is a new version, with its schema beside this one and a migration from version 1, so every earlier version stays readable (sdk-core ADR 0045, section 1). Because readers are strict, adding a field is a breaking change too. A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`, which the editor explains as "update the app".
