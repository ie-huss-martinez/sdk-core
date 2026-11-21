# 0059. Interface text stays out of the server-safe entry

- **Status:** Proposed
- **Date:** 2026-11-21
- **Refines:** [ADR 0019](0019-message-catalogues.md) and [ADR 0046](0046-ui-text-through-the-sdk.md), by saying which entry point exports which text

## Context

[ADR 0019](0019-message-catalogues.md) gives each SDK a typed English catalogue, and [ADR 0046](0046-ui-text-through-the-sdk.md) spreads `ui`'s text into it, so one `Messages` object and one `messages` prop cover an editor's whole interface. Neither says which entry point exports the catalogue.

`.` is the server-safe, headless entry ([ADR 0004](0004-entry-points-and-module-format.md)). Every SDK first exported its whole catalogue from it, interface text included. A server or a headless host then ships text that nothing in `.` shows, and that text counts against `.`'s size budget ([ADR 0015](0015-verification-and-releases.md)). Each new tool adds strings.

pdf-sdk met this first: `.` measured 14.96 kB against a budget of 15 kB, and its next tool took it over. [pdf-sdk#57](https://github.com/ie-huss-martinez/pdf-sdk/pull/57) moved its interface text to a second catalogue in the React entry, recorded it as a deliberate step ahead of the family, and proposed it as a family rule. image-sdk and audio-sdk have followed since, each in its own way.

### What the SDKs export today

Counted from each repository's `main`, on 2026-11-21. "Own keys" leaves out `sdkCoreMessages`. The cost is what an application pays for importing only the catalogue from `.`, measured on each SDK's built entry with `hm-size --import "{ <kind>Messages }" dist/index.js` ([ADR 0056](0056-size-budgets-for-what-applications-import.md)).

| Package | Own keys in `.` | For errors and warnings | Other keys in `.` | Cost of the `.` catalogue |
|---|---|---|---|---|
| pdf-sdk | 12 | 12 | none | 0.81 kB |
| image-sdk | 20 | 20 | none | 0.90 kB |
| audio-sdk | 20 | 20 | none | 1.13 kB |
| video-sdk | 175 | 36 | 139 of interface text | 3.48 kB |
| learn-sdk | 49 | 21 | `validation.*` (17), `tools.*` (8), `content.*` (3) | 1.50 kB |

And the catalogue their components use:

| Package | Interface keys | The catalogue | Its type | The type's entry |
|---|---|---|---|---|
| pdf-sdk | 45 | `pdfEditorMessages`, from `./react` | `PdfEditorMessageCatalogue` | `./react` |
| image-sdk | 314 | `imageEditorMessages`, from `./react` | `ImageEditorMessageCatalogue` | `./react` |
| audio-sdk | 163 | `audioEditorMessages`, from `./react` | `AudioEditorMessageCatalogue` | `.` |
| video-sdk | 139, in `.` | `editorCatalogue`, not exported | `VideoEditorCatalogue` | `.` |
| learn-sdk | 25, and 11 more in `.` | `playerCatalogue`, from `./react` | none; `LearnPlayerMessages` is the `Messages` type | `./react` |

Three things follow from the tables:

- **The split pays.** video-sdk, the one SDK that hasn't split, ships three to four times the text of the others from its headless entry.
- **"Errors and warnings" is too narrow a rule.** learn-sdk's `validation.<code>` is text for the issues its headless validator returns. A headless host shows it, so it belongs in `.`. Its `tools.*` and `content.*` are only shown by its player.
- **The names have drifted.** The catalogue has three names, its type has three, and the type comes from two different entries.

## Options

| | Option | In short |
|---|---|---|
| A | Leave it to each SDK | The state above, drifting further with each SDK |
| **B** | **One rule: what `.` holds, and the names** | **Recommended** |
| C | A third entry point, `./messages`, for the interface text | One more entry for hosts to learn and the API reports to cover |
| D | Load interface text on demand, per locale | Text arrives after the first render; a different design from ADR 0019's |

## Decision

**Recommended: B. The reviewer rules before any code is written.**

### What the server-safe catalogue holds

The rule is about what the headless entry needs, not a list of categories:

- **`<kind>Messages`, from `.`, holds only text for what the headless API hands a host to show.** The test for a key is whether code that imports only `.` can produce the thing the text describes. Today that's:
  - `sdkCoreMessages`;
  - `errors.<CODE>` and `errors.<CODE>.<reason>`, and `warnings.<limit>` and `warnings.<type>` ([ADR 0050](0050-error-text-by-reason-and-warning-text.md));
  - any other family of keys for a result the headless API returns, which the SDK's own decision record names. learn-sdk's `validation.<code>` is one.
- **Everything else is interface text,** and lives outside `.`: labels, titles, announcements, and the labels of tools. A tool's `label` is a message key ([ADR 0030](0030-tools-and-keyboard-shortcuts.md)), and only an interface shows it.
- **Interface text still lives in `src/messages`,** in `editor-en.ts`, as an internal catalogue that no entry point exports by itself.

### The editor's catalogue

- **`<kind>EditorMessages`, from `./react`, is the one catalogue of [ADR 0046](0046-ui-text-through-the-sdk.md):**

  ```ts
  export const pdfEditorMessages = defineMessages({ ...pdfMessages, ...uiMessages, ...pdfEditorText });
  ```

- **Every component, provider and hook builds its `Messages` from it,** and so does the element. `use<Kind>Messages()` returns it.
- **Its type is `<Kind>EditorMessageCatalogue`.** Hosts type overrides with `MessageOverrides<<Kind>EditorMessageCatalogue>`.
- **The type is exported from `.`,** as audio-sdk and video-sdk do. It costs no bytes there, and both `./react` and `./element` use it, which [ADR 0033](0033-api-reports-for-several-entry-points.md) only allows without a copy when `.` exports it.
- **An SDK whose surface isn't an editor uses the surface's name:** `learnPlayerMessages` and `LearnPlayerMessageCatalogue`.

### Tests

Each SDK has three unit tests:

- **`.` stays clean:** every key of `<kind>Messages` is one of `sdkCoreMessages`' or starts with `errors.`, `warnings.` or a prefix the SDK's record names.
- **Interface text stays out of those:** no key of the interface text starts with one of those prefixes.
- **No collisions,** as [ADR 0046](0046-ui-text-through-the-sdk.md) requires: the SDK's keys in both catalogues don't overlap each other, `sdkCoreMessages` or `uiMessages`.

### Adoption

Each is a follow-up in its own repository, and a minor release before 1.0 where a name changes:

- **pdf-sdk and image-sdk** already follow the rule. They export the type from `.` as well, and their own records point here.
- **audio-sdk** already follows it.
- **video-sdk** moves its 139 interface keys out of `videoMessages`, exports `videoEditorMessages` from `./react`, and renames `VideoEditorCatalogue` to `VideoEditorMessageCatalogue`, keeping the old name as a deprecated alias.
- **learn-sdk** moves `tools.*` into its player's text, and names `validation.` in its own record. Its three `content.*` strings describe content that can't be read, which only its player words today: they move with the player's text, or become `errors.<CODE>` text if its headless reader reports those cases as errors. It renames `playerCatalogue` to `learnPlayerMessages`, keeping the old name as a deprecated alias. It adds `LearnPlayerMessageCatalogue`.

## Alternatives considered

- **A, leave it to each SDK:** it's how the names drifted, and how video-sdk still ships 139 strings to servers.
- **C, a third entry point for interface text:** hosts would learn another entry and the API reports would cover it, when `./react` is already where the interface lives.
- **D, loading interface text on demand:** the editor would render before its text arrives, or wait for it. [ADR 0019](0019-message-catalogues.md) chose a catalogue that's there at the first render, and hosts already load their own locale's overrides as they like.
- **Only `errors.*` and `warnings.*` in `.`,** as pdf-sdk's proposal had it: it would push learn-sdk's validation text into its player, away from the headless validator that returns the issues.
- **Tool labels in `.`,** because tool definitions are headless: a label is only ever shown by an interface, and three of the four SDKs with tools keep them with the interface text already.
- **A shared helper for the three tests:** each is a few lines over `Object.keys`. A helper would be a public API for less code than its documentation.

## Consequences

- A server or a headless host ships only the text it can show, and `.`'s budget stops growing with each tool's strings.
- A host finds the editor's catalogue and its type under the same names in every SDK.
- **Breaking, before 1.0,** for video-sdk's and learn-sdk's hosts: a host that typed overrides of interface keys with `VideoMessageCatalogue` or `LearnMessageCatalogue` uses the editor's or the player's type instead. Keys and text don't change, and `messages` props work as before.
- A host that builds its own interface on `.` alone has no labels from `.`. It imports the editor's catalogue from `./react`, or writes its own text.
- **Follow-up work:** the adoptions above. `STANDARDS.md` gains the rule when this record is accepted.
