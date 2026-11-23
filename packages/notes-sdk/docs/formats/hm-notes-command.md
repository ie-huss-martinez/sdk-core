# `hm-notes-command`, version 1

One of notes-sdk's portable formats ([sdk-core ADR 0045](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0045-portable-formats-and-conformance-vectors.md), [ADR 0003](../adr/0003-a-library-on-the-device.md)). A port in another language reads it, and proves it applies commands as this SDK does by passing the vectors in [`conformance/`](../../conformance).

| Format | Schema | What it holds |
|---|---|---|
| `hm-notes-command` 1 | [`formats/hm-notes-command/v1.schema.json`](../../formats/hm-notes-command/v1.schema.json) | One edit of a notebook |

Every edit of a notebook is a command: plain data that says what changes. Applying one gives the new state and the command that undoes it, so undo and redo are commands too.

`readNotesCommandDocument(json)` reads a command from untrusted JSON, and `JSON.stringify(command)` writes one. `applyNotesCommand(state, command, limits)` applies it.

## A command has no header

A command is its own document, with no `format` or `version` field. Its `type` names it, and **its version is the schema's version.** A change that breaks a command is a new version of the schema, at `formats/hm-notes-command/v2.schema.json`. A host that stores commands records the version beside them.

```json
{
  "type": "notes.addItems",
  "page": "p1",
  "items": [
    {
      "id": "s2",
      "type": "stroke",
      "tool": "pen",
      "color": "#1a1a1a",
      "size": 200,
      "points": [10000, 12000, 400, 10400, 12300, 650]
    }
  ]
}
```

## Loading the schemas

The schemas ship with the package, under `@hussmartinez/notes-sdk/formats/`, so a host validates against the version that matches its installed reader (sdk-core ADR 0045, section 8). The readers already check everything the schemas do and more, so a host needs the schemas only to validate elsewhere, such as on a server that stores documents, or in another tool.

```ts
import { Ajv2020 } from "ajv/dist/2020.js";
import notebookSchema from "@hussmartinez/notes-sdk/formats/hm-notes-notebook/v1.schema.json" with { type: "json" };
import pageSchema from "@hussmartinez/notes-sdk/formats/hm-notes-page/v1.schema.json" with { type: "json" };
import commandSchema from "@hussmartinez/notes-sdk/formats/hm-notes-command/v1.schema.json" with { type: "json" };

const ajv = new Ajv2020({ strict: true });
// The command schema refers to the page and notebook schemas by their $id, so compile those first.
const isNotebook = ajv.compile(notebookSchema);
const isPage = ajv.compile(pageSchema);
const isCommand = ajv.compile(commandSchema);

if (!isCommand(JSON.parse(text))) console.error(isCommand.errors);
```

The four document schemas each stand alone. A definition with one name, such as `id` or `time`, means the same in every schema.

## The commands

An item is as in an [`hm-notes-page`](hm-notes-page.md) document. A page's `info`, an outline and a recording are as in an [`hm-notes-notebook`](hm-notes-notebook.md) document. An index is a whole number from 0 to 1,000,000, and a list holds up to 1,000,000 entries, or 2,000 for an outline and for recordings.

| Command | Fields | What it does | Its inverse |
|---|---|---|---|
| `notes.addItems` | `page`, `items`, `index` (optional) | Adds items to a page, on top of its others, or with the first at `index` from the bottom | `notes.removeItems` |
| `notes.removeItems` | `page`, `ids` | Removes items from a page | `notes.restoreItems` |
| `notes.restoreItems` | `page`, `entries`: each `{ index, item }` | Puts items back, each at its index, in ascending order | `notes.removeItems` |
| `notes.replaceItems` | `page`, `items` | Replaces items by others of the same kind with the same ids, each in its place: a move, a resize, a new colour or new text | `notes.replaceItems` |
| `notes.addPages` | `at`, `pages`: each `{ info, items }` | Adds pages, with their contents, so the first is at index `at` | `notes.removePages` |
| `notes.removePages` | `pages` | Removes pages, with the outline entries that led to them | `notes.restorePages` |
| `notes.restorePages` | `entries`: each `{ index, info, items }`, `outline` | Puts pages back, each at its index, in ascending order, with the outline as it was | `notes.removePages` |
| `notes.reorderPages` | `order` | Puts the pages in a new order: every page's id, once | `notes.reorderPages` |
| `notes.setTemplates` | `templates`: each `{ page, template }` | Changes the paper of pages | `notes.setTemplates` |
| `notes.setOutline` | `outline` | Replaces the notebook's outline | `notes.setOutline` |
| `notes.rename` | `title` | Renames the notebook | `notes.rename` |
| `notes.setRecordings` | `recordings` | Replaces the notebook's list of recordings | `notes.setRecordings` |

Unlike some formats of the family, the inverses are part of this one: `notes.restoreItems` and `notes.restorePages` are commands like the others, and the vectors give each case's inverse. Applying a command and then its inverse restores the state exactly.

### What a command changes

A command applies to a **state**: a notebook, and the contents of the pages that are loaded. A command on a page that isn't loaded is refused with `page-not-loaded`, so a session loads a page before it edits or removes it.

### Indexes

- `notes.addItems`' `index` is from 0 to the number of items on the page. Without it, the items go on top.
- `notes.restoreItems`' and `notes.restorePages`' indexes are where each entry is once all are back, so they ascend, and each is at most the list's length when its entry goes in. `[{ "index": 0 }, { "index": 2 }]` on a list of one gives new, old, new.
- `notes.addPages`' `at` is from 0 to the number of pages.

### Links to pages that are gone

`notes.addItems` and `notes.addPages` refuse a link to a page the notebook doesn't have, with `unknown-page`. A page added by the same command counts, so new pages may link to each other.

Removing a page leaves the links that led to it. So the commands that put items back as they were, `notes.restoreItems`, `notes.replaceItems` and `notes.restorePages`, take a link whose page is gone: otherwise removing such a link, or moving it, couldn't be undone. An anchor's recording is never checked, for the same reason: `notes.setRecordings` may remove a recording that ink was written during.

### `notes.restorePages`' outline

Its `outline` is the notebook's outline once the pages are back: the notebook's own entries, unchanged and in order, with entries for the pages it restores among them. Any other outline is refused with `malformed-command`, because the inverse, `notes.removePages`, removes the pages with their entries and nothing else, and couldn't bring another outline back.

## Beyond the schema

**The schema describes what `readNotesCommandDocument` reads.** The reader also checks what the page's and the notebook's readers check of an item and an outline, which a schema can't say: a stroke's points are whole triples with each pressure from 0 to 1,000, no text holds a lone surrogate, and an outline's ids are unique.

**Applying a command checks it against the notebook,** which a schema can't see:

- the page it names is in the notebook and loaded, and the items and pages it names are there;
- its lists aren't empty, and don't name an item or a page twice;
- a new item's id isn't on the page, a new page's id isn't in the notebook, and a new page's items have distinct ids;
- its indexes fit the list;
- a replacement is of the same kind as the item it replaces;
- an outline leads to pages the notebook has, and recordings have distinct ids;
- a notebook keeps at least one page;
- the result is within the limits it's given, `maxPages` and `maxPageItems` ([ADR 0004](../adr/0004-notes-limits.md)).

A refused command changes nothing. `applyNotesCommand` never changes the state it's given.

**Strict:** an unknown field anywhere is refused, never dropped.

## Rejections

A refusal is compared by its code and `details.reason`, never its message.

| Code | Reasons | From |
|---|---|---|
| `INVALID_COMMAND` | `malformed-command`, `unknown-command`, `invalid-id`, `duplicate-id`, `invalid-position`, `invalid-size`, `invalid-color`, `invalid-points`, `too-many-points`, `text-too-long`, `invalid-asset`, `invalid-time` | Reading |
| `INVALID_COMMAND` | `unknown-page`, `page-not-loaded`, `unknown-item`, `duplicate-id`, `duplicate-page`, `last-page`, `invalid-index`, `invalid-order`, `malformed-command`, `unknown-command` | Applying |
| `TOO_MANY_PAGES`, `TOO_MANY_ITEMS` | None. `details` names the `limit`, its `maximum`, the `actual` value and the `unit` | Applying |

A value a document's reader would refuse as `malformed-document` is `malformed-command` here, and its other reasons keep their names. The error's `cause` is the reader's own error, whose `details.at` gives the path of the value.

`NotesCommandRejection` also holds the reasons of documents that a command never gives: `unknown-format`, `unknown-format-version`, `malformed-archive`, `missing-entry`, `asset-mismatch` and `unknown-folder`.

## Changing the format

A breaking change is a new version of the schema, with a migration from version 1, so commands stored by an earlier release still apply (sdk-core ADR 0045, section 1). Because readers are strict, adding a field or a command is a breaking change for a reader of version 1, which refuses it with `malformed-command` or `unknown-command`. A change to an item or to a page's entry changes the page's or the notebook's format, and this one with it.
