# 0058. Heading levels in editors

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0014](0014-accessibility-and-translatable-text.md), by saying which level an editor's headings have on a page it doesn't own

## Context

An SDK's editor is a part of someone else's page. Headings give a page its outline: people who use a screen reader move through it by heading, and expect the levels to nest. The host's page has its own headings, and only the host knows where the editor sits among them. An editor that renders `<h2>` under a host's `<h3>` breaks the outline, and so does one that renders `<h1>` anywhere.

audio-sdk met this first: its inspector has a visible title, and [audio-sdk#80](https://github.com/ie-huss-martinez/audio-sdk/pull/80) gave `AudioEditor` and `AudioInspector` a `headingLevel` prop of its own type, `AudioHeadingLevel`. The next editor to render a heading would invent its own, with another name.

### What the editors render today

Read from each repository's React sources on 2026-11-21:

| Package | Heading elements in the page | How panels are labelled | A heading level option |
|---|---|---|---|
| audio-sdk | the inspector's title, at the configured level | `<section aria-labelledby>` on that title | `headingLevel?: AudioHeadingLevel`, 2 to 6, default 2, on `AudioEditor`, `AudioInspector` and the element |
| pdf-sdk | none | a `<section>` and labelled groups | none |
| video-sdk | none | `<fieldset>` with `<legend>`, and labelled sections | none |
| image-sdk | none | `<section>`s and labelled groups | none |
| learn-sdk | one `<h2>`, fixed, in `LearnPlayer` | `<fieldset>`s | none |
| ui | `Dialog`'s title, a fixed `<h2>` | | none |

- **Only audio-sdk's editor puts a heading in the page's outline with a level the host can set.** learn-sdk's is fixed at 2.
- **Most panels aren't headed at all,** and don't need to be: a group of controls is named by a `<legend>` or a label, which is the right element for it.
- **audio-sdk's, video-sdk's and image-sdk's editors open `ui`'s `Dialog`,** whose title is an `<h2>` whatever the page around it.

## Options

**A. Leave it to each SDK.** audio-sdk keeps `AudioHeadingLevel`, and the next SDK names its own. Hosts that embed two editors set two differently named options to the same value.

**B. One rule and one name: an editor that renders headings takes `headingLevel`.** The same prop, type, default and element attribute in every SDK, with the type and the heading component shared from `ui`.

**C. Have editors detect their level from the page,** by looking for the nearest heading above them. It needs no option, but it reads the host's document at run time, differs between server and client rendering, and guesses wrong whenever the outline isn't the DOM order.

**D. Use `role="heading"` with `aria-level`,** which allows any level. Native heading elements are better supported, and levels past 6 are announced inconsistently.

## Decision

**Option B: one rule and one name.**

### The rule

- **An editor that renders headings in the page takes `headingLevel`:** the level of its top headings, `2`, `3`, `4`, `5` or `6`, defaulting to `2`. It's the same name on the React component, on each exported part that renders a heading, and on the element, as the property `headingLevel` and the attribute `heading-level`.
- **The default is 2, and 1 isn't allowed,** because a page has one `<h1>`, which names the page, and that's the host's.
- **Headings nested inside the editor follow from it:** a heading under one of the editor's top headings is one level down, and so on, never past 6. The editor works its levels out from `headingLevel`; the host sets one number.
  - **A level that would pass 6 is rendered as `<h6>`.** HTML has nothing deeper, so that heading reads as a sibling of its parent rather than as nested under it. It's still a heading people can move to, which matters more than its depth.
  - **An editor with nested headings documents how many levels it renders,** so a host can pick a `headingLevel` that leaves room for them. Every value from 2 to 6 stays valid.
- **An editor that renders no heading has no such prop.** The option appears with the first heading, so no SDK carries a prop that does nothing.
- **A value that isn't one of the five is treated as the default,** with a development-only warning, as other host input is ([ADR 0019](0019-message-catalogues.md)'s overrides). The attribute arrives as text, and hosts' values aren't typed at run time.

### What is a heading

- **The visible title of a section of content is a heading,** such as an inspector's "Selection" above what it describes. Its section is labelled by it, with `aria-labelledby`.
- **The name of a group of controls isn't:** it's a `<legend>` in a `<fieldset>`, or the label of a `role="group"` or a toolbar. Most of the editors' panels are this, and stay as they are.
- **Headings are native elements,** `<h2>` to `<h6>`, never `role="heading"` with `aria-level`.

### One type and one component, from `ui`

- **`ui` exports the type `HeadingLevel`** (`2 | 3 | 4 | 5 | 6`) **and a `Heading` component** that renders the element for a level, and the level below it for nested headings. `ui` is where the family's components live, and every SDK's React layer already depends on it ([ADR 0036](0036-ui-as-a-dependency-of-the-sdks.md)).
- **Every SDK's prop is `headingLevel?: HeadingLevel`.** An SDK re-exports the type from its React entry, so a host needn't import `ui` to name it. Types named per SDK, such as `AudioHeadingLevel`, are deprecated aliases until the SDK's next breaking release.

### Dialogs keep their own outline

- **`ui`'s `Dialog` keeps a fixed `<h2>` for its title, and takes no `headingLevel`.** A modal dialog is its own context: while it's open, the page behind it is inert, and a screen reader's list of headings holds only the dialog's. Its title's level says nothing about the page's outline, so the host's number doesn't apply to it.
- **Headings inside a dialog's content start at 3,** under its title.
- **A panel that isn't modal is part of the page,** and follows `headingLevel` like the rest of the editor.

### Adoption

Each is a follow-up in its own repository:

- **`ui` adds `HeadingLevel` and `Heading`.**
- **audio-sdk** switches to them, and keeps `AudioHeadingLevel` as a deprecated alias.
- **learn-sdk** gives `LearnPlayer` the prop, in place of its fixed `<h2>`: it renders a heading, so the rule applies to it. Its default of 2 renders what it renders today.
- **pdf-sdk, video-sdk and image-sdk** change nothing now. Each adds the prop with its first heading.

This record's survey read the editors' sources. It didn't listen to them: what a screen reader announces is checked in the maintainer's manual pass with one, which comes after this record.

## Alternatives considered

Beyond the options above:

- **Allowing 1,** for a page that is nothing but the editor: the host still names its page, in its own `<h1>`, and an editor inside a host's layout can't know it's alone.
- **The type in `sdk-core`:** it has no React and renders nothing. A type there would be the only part of this decision outside `ui`, and the component that uses it would still be in `ui`.
- **A context provider instead of a prop,** so parts read the level without it being passed: it's how the editor passes the level to its own parts, but hosts set options on the editor, as props and attributes, like every other option.
- **A `headingLevel` on `Dialog`:** it would invite hosts to pass the page's level into a context where it doesn't apply.

## Consequences

- A host sets one option, with one name, on any editor that has headings, and its page's outline holds.
- An editor's first heading comes with a decision already made: the prop, its type, its default and its attribute.
- `ui` gains a small component and a type. audio-sdk and learn-sdk each have a small change; audio-sdk's is compatible, and learn-sdk's default of 2 renders what it renders today.
- Whether more of the editors' panels should have headings isn't decided here. Each SDK judges its own panels by "What is a heading" when it next changes them.
