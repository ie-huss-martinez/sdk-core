# `hm-notes-page`, version 1

One of notes-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), [ADR 0003](../adr/0003-a-library-on-the-device.md)). A port in another language reads and writes it, and proves it reads as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-notes-page` 1 | [`formats/hm-notes-page/v1.schema.json`](../../formats/hm-notes-page/v1.schema.json) | The contents of one page: its items, from the bottom to the top |

A page's size and paper are in its [notebook's document](hm-notes-notebook.md). This document holds what's on the page: strokes of ink, boxes of text, pictures and links. It's the document that changes with every stroke, so it's kept on its own.

`readNotesPageDocument(json)` reads a document, and `toNotesPageDocument(page)` writes one, ready for `JSON.stringify`. [Loading the schemas](hm-notes-command.md#loading-the-schemas) shows how a host validates with the schema.

## Example

```json
{
  "format": "hm-notes-page",
  "version": 1,
  "id": "p1",
  "items": [
    {
      "id": "s1",
      "type": "stroke",
      "tool": "pen",
      "color": "#1a1a1a",
      "size": 200,
      "points": [10000, 12000, 400, 10400, 12300, 650, 11000, 12500, 300],
      "audio": { "recording": "r1", "at": 12500 }
    },
    {
      "id": "t1",
      "type": "text",
      "x": 8000,
      "y": 20000,
      "width": 30000,
      "text": "Check the units",
      "size": 1200,
      "color": "#0b57d0"
    },
    {
      "id": "i1",
      "type": "image",
      "x": 5000,
      "y": 40000,
      "width": 24000,
      "height": 18000,
      "image": {
        "asset": "sha256:0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c",
        "mediaType": "image/png",
        "size": 20480
      }
    },
    { "id": "l1", "type": "link", "x": 40000, "y": 3000, "width": 12000, "height": 2400, "page": "p2" }
  ]
}
```

## Fields

Every field is required unless the table says otherwise. Every number is a whole number.

| Field | Type | Unit and bounds |
|---|---|---|
| `format` | text | `"hm-notes-page"` |
| `version` | number | `1` |
| `id` | id | The page's id, as its notebook lists it: 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-` |
| `items` | list | Up to 1,000,000 items, from the bottom to the top. A host's file policy sets a lower limit, `maxPageItems` ([ADR 0004](../adr/0004-notes-limits.md)) |

An item's `type` says which of the four kinds it is. Every item has an `id`, unique on its page.

### Positions and sizes

Positions and lengths are whole **units, 100 to a PDF point** (`NOTES_UNITS_PER_POINT`). A position is counted from the page's top-left corner, with `y` growing downwards.

| What | Bounds |
|---|---|
| A position: `x`, `y`, and the positions in a stroke's `points` | -1,440,000 to 2,880,000 |
| A length: `width`, `height` | 1 to 2,880,000 |

An item may reach up to 1,440,000 units outside its page on every side (`NOTES_PAGE_MARGIN`). Ink that runs off the paper is kept, but a position far away is a damaged document. The reader doesn't know the page's size, so it doesn't check that an item is on it. `-0` reads as `0`.

### `stroke`

One stroke of ink.

| Field | Type | Unit and bounds |
|---|---|---|
| `tool` | text | `"pen"`, which follows pressure, or `"highlighter"`, which is translucent and drawn under the pen's strokes |
| `color` | colour | `#rrggbb`, in lowercase |
| `size` | number | The stroke's width at full pressure, in units, from 10 to 7,200: 0.1 to 72 points (`NOTES_STROKE_SIZE_RANGE`) |
| `points` | list of numbers | The pen's path as flat `x, y, pressure` triples: 1 to 20,000 points (`NOTES_MAX_STROKE_POINTS`), so 3 to 60,000 numbers |
| `uniform` | `true`, optional | Present for a stroke of one width from end to end, as a straightened shape is. Its pressures are ignored. Never `false` |
| `audio` | anchor, optional | When it was written, if a recording was running |

In `points`, `x` and `y` are positions, and **pressure is from 0 to 1,000** (`NOTES_PRESSURE_MAX`), where 1,000 is full pressure. The list is flat to keep a page of ink small: `[x1, y1, p1, x2, y2, p2]`.

### `text`

A box of typed text. Its text wraps at the box's width, and its height follows from the text, so it has no `height`.

| Field | Type | Unit and bounds |
|---|---|---|
| `x`, `y` | position | The box's top-left corner |
| `width` | length | The width the text wraps at |
| `text` | text | Up to 20,000 code points (`NOTES_MAX_TEXT_LENGTH`). May be empty. It's drawn as text, never interpreted as markup |
| `size` | number | The font size, in units, from 400 to 28,800: 4 to 288 points (`NOTES_TEXT_SIZE_RANGE`) |
| `color` | colour | `#rrggbb`, in lowercase |
| `audio` | anchor, optional | When it was written, if a recording was running |

### `image`

A picture placed on the page.

| Field | Type | Unit and bounds |
|---|---|---|
| `x`, `y`, `width`, `height` | position, length | The picture's rectangle |
| `image` | asset | The picture's file: `image/png`, `image/jpeg`, `image/webp` or `image/gif` |

SVG is never a picture's type: it can carry scripts. An asset is `{ "asset", "mediaType", "size" }`, as [a notebook's](hm-notes-notebook.md#assets) are, and never the bytes themselves.

### `link`

An area of a page that leads to another page of the same notebook.

| Field | Type | Unit and bounds |
|---|---|---|
| `x`, `y`, `width`, `height` | position, length | The area's rectangle |
| `page` | id | The id of the page it leads to |

### An audio anchor

| Field | Type | Unit and bounds |
|---|---|---|
| `recording` | id | The id of a recording in the notebook's `recordings` |
| `at` | number | Milliseconds from the recording's start, from 0 |

### Text and ids

Lengths count Unicode code points, as the schema's `maxLength` does (sdk-core ADR 0045, section 8). The vectors check the limit with characters outside the BMP: 20,000 of them are 40,000 UTF-16 units, and fit. Text never holds half of a surrogate pair on its own.

Ids are data. `__proto__`, `constructor` and `toString` are valid ids, and the vectors use each of them.

## Beyond the schema

A reader checks what a schema can't say:

- item ids are unique on the page;
- a stroke's `points` are whole triples, and each pressure is from 0 to 1,000. The schema bounds the list's length from 3 to 60,000 and every number as a position, because JSON Schema has no way to say "a multiple of three" or "every third number". So `[0, 0, 500, 100]` and `[0, 0, 1001]` pass the schema, and the reader refuses both with `invalid-points`;
- no text holds a lone surrogate.

A page is read on its own, so the reader **doesn't** check that a link's `page` is a page of the notebook, or that an anchor's `recording` is one of its recordings. A link can outlive its page: removing a page leaves the links that led to it. An interface shows such a link as leading nowhere.

**Strict:** an unknown field anywhere is refused, never dropped.

## Rejections

A refusal is compared by its code and `details.reason`, never its message. `details.at` gives the path of the value, such as `$.items[3].points[5]`.

| Code | Reasons |
|---|---|
| `UNSUPPORTED_FORMAT` | `unknown-format`, `unknown-format-version` |
| `INVALID_DOCUMENT` | `malformed-document`, `invalid-id`, `duplicate-id`, `invalid-position`, `invalid-size`, `invalid-color`, `invalid-points`, `too-many-points`, `text-too-long`, `invalid-asset`, `invalid-time` |

`invalid-points` covers everything wrong with a stroke's points but their count: no points, a list that isn't whole triples, and a number out of range or off the grid. More than 20,000 points is `too-many-points`.

## Changing the format

A breaking change is a new version, with its schema beside this one and a migration from version 1, so every earlier version stays readable (sdk-core ADR 0045, section 1). Because readers are strict, adding a field or a kind of item is a breaking change too. A reader refuses a later version with `UNSUPPORTED_FORMAT` and `unknown-format-version`.
