# The conformance vectors

notes-sdk's language-neutral tests ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), section 5). A port in another language runs the same files this SDK's own tests run, so it's shown to behave like the TypeScript SDK, not just believed to.

| File | Subject | A case's input | Its expected result |
|---|---|---|---|
| [`conformance/hm-notes-documents.json`](../../conformance/hm-notes-documents.json) | `hm-notes-documents` | `{ as, document }` | The document as a reader writes it back, or the rejection |
| [`conformance/hm-notes-commands.json`](../../conformance/hm-notes-commands.json) | `hm-notes-commands` | `{ state, command, limits? }` | `{ state, inverse }`, or the rejection |

Each file is an `hm-conformance` document: `{ "format": "hm-conformance", "version": 1, "subject", "description", "cases" }`, and a case is `{ "name", "input", "expected" }`. The files stay in the repository. They aren't published with the package.

## Rejections

An expected rejection is `{ "error": { "code", "reason" } }`. A port compares the code and the reason, never a message:

```json
{ "error": { "code": "INVALID_DOCUMENT", "reason": "duplicate-id" } }
```

A limit's rejection has a code and no reason: `{ "error": { "code": "TOO_MANY_ITEMS" } }`.

When several things are wrong with an input, the vectors still expect one reason. Each hand-written case has one fault, so a port doesn't have to check in the same order as this SDK, with one exception: a document's `format` and `version` are checked before anything else.

## `hm-notes-documents`

`input.as` names the format to read `input.document` as: `hm-notes-notebook`, `hm-notes-page`, `hm-notes-library` or `hm-notes-backup`. `input.document` is any JSON value.

A case, shortened to one item:

```json
{
  "name": "page: refuses a pressure over 1,000",
  "input": {
    "as": "hm-notes-page",
    "document": {
      "format": "hm-notes-page",
      "version": 1,
      "id": "p1",
      "items": [
        { "id": "s1", "type": "stroke", "tool": "pen", "color": "#1a1a1a", "size": 200, "points": [0, 0, 1001] }
      ]
    }
  },
  "expected": { "error": { "code": "INVALID_DOCUMENT", "reason": "invalid-points" } }
}
```

For a document the reader accepts, `expected` is the document as the reader writes it back. That's the input itself, except that negative zero reads as zero: the files write it as `-0`, which is valid JSON.

What the cases cover, for each of the four formats:

- **The header:** another format's name, none, a later version, version 0, a version as text and a fractional one.
- **Strictness:** an unknown field at the top and in every object inside, a missing field, and a value of the wrong type.
- **Names of `Object.prototype`'s properties:** `__proto__`, `constructor` and `toString` as valid ids, titles and text, which must read; as unknown fields, which must be refused; as values where one of a fixed set is expected, such as a cover; and as a page or a folder that isn't listed, which must not be found.
- **Numbers:** each bound and one past it, a fraction where a whole number is required, a number as text, and negative zero.
- **Text:** each length limit with characters outside the BMP, which are one code point and two UTF-16 units, and lone surrogates.
- **Ids, colours and asset names** that end with a line break, which a pattern's `$` matches before in some languages.
- **The whole document:** duplicate ids, an outline entry to an unknown page, a folder in an unknown folder, a folder inside itself, and rings of folders.
- **Assets:** names that aren't a SHA-256, sizes that aren't a whole number of bytes, and media types the field doesn't allow, such as `image/svg+xml` for a picture.

## `hm-notes-commands`

`input.command` is an [`hm-notes-command`](hm-notes-command.md): any JSON value, read as `readNotesCommandDocument` reads it, then applied.

### A state

`input.state` is a notebook with its loaded pages:

```json
{
  "notebook": { "format": "hm-notes-notebook", "version": 1, "id": "nb1", "pages": [{ "id": "p1" }, { "id": "p2" }] },
  "pages": {
    "p1": [{ "id": "s1", "type": "stroke" }]
  }
}
```

(The example leaves out most fields.)

| Field | What it holds |
|---|---|
| `notebook` | A whole [`hm-notes-notebook`](hm-notes-notebook.md) document |
| `pages` | An object keyed by page id. Each value is the list of the page's items, from the bottom to the top, as in an [`hm-notes-page`](hm-notes-page.md) document's `items` |

A page the notebook lists that isn't a key of `pages` **isn't loaded**: above, `p2`. A command on it is refused with `page-not-loaded`. Every key of `pages` is a page of the notebook. In `expected.state`, the loaded pages are in the notebook's order.

Page ids may be `__proto__`, `constructor` or `toString`, so a port must keep `pages` in a map whose keys are only data. One case's state has a page named `constructor` that isn't loaded: a lookup that finds `Object.prototype`'s own `constructor` there gets it wrong.

### Limits

`input.limits`, when present, is `{ "maxPages"?, "maxPageItems"? }`: the most pages a notebook may have, and the most items a page may have. A limit that's absent isn't checked.

### The result

For a command that applies, `expected` is `{ "state", "inverse" }`: the state after it, and the command that undoes it. A port must also check that **applying the inverse to the new state gives the state it started from**, exactly, under the same limits. The TypeScript runner does.

```json
{
  "name": "renames the notebook",
  "input": { "state": { "notebook": { "title": "Field notes" }, "pages": {} }, "command": { "type": "notes.rename", "title": "Lab book" } },
  "expected": {
    "state": { "notebook": { "title": "Lab book" }, "pages": {} },
    "inverse": { "type": "notes.rename", "title": "Field notes" }
  }
}
```

What the cases cover: every command applying, with its inverse; every reason `readNotesCommandDocument` and `applyNotesCommand` refuse a command for; both limits, at the limit and one past it; links whose page is gone; and pages and items named `__proto__`, `constructor` and `toString`, with pages and items only `Object.prototype` has, which must not be found.

## Generated cases

After the hand-written cases, each file has cases generated from the property tests' generators in [`test/arbitraries/notes.ts`](../../test/arbitraries/notes.ts), with a fixed seed: four documents of each format, two commands of each type that apply, and one of each refusal that commands with one value changed reach.

## Running them

The TypeScript runners are in [`test/conformance/run.ts`](../../test/conformance/run.ts), one for each subject: what a port implements too.

The files are written by [`test/conformance/generate.ts`](../../test/conformance/generate.ts). Each hand-written case states the outcome it's meant to show, and the generator fails if the SDK gives another. `pnpm conformance:update` rewrites the files, and the tests fail when the checked-in files differ from what the generator writes. To change a case, change the generator, never the file.

A list of numbers is on one line in the files, so a stroke's points read as a row.

## The schemas

[`test/formats.test.ts`](../../test/formats.test.ts) holds the vectors and the readers to the JSON Schemas in [`formats/`](../../formats):

- every document a reader accepts passes its schema, and so does what the reader writes back;
- every refusal a schema can express fails it. The others are listed in the test: a duplicate id, an unknown page or folder, a lone surrogate, and a stroke's points that aren't whole triples or whose pressure is out of range;
- over thousands of documents and commands with one value changed, a reader never accepts what its schema refuses, and refuses what its schema accepts only for those reasons.
