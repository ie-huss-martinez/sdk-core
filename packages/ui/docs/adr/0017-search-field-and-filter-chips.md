# 0017. A search field in a box, and filter chips from toggle buttons

- **Status:** Accepted
- **Date:** 2026-11-26
- **Builds on:** [ADR 0003](0003-component-contract.md), the component contract, and [ADR 0015](0015-tag-and-button-link.md) and [ADR 0016](0016-tabs.md), which brought `ui` to static pages

## Context

Fish Memory's library is searched from one box and narrowed by a row of category chips. Both are its own markup today:

- **The search box** is a `<div>` drawn as a field, with a search icon, an `<input type="search">` and a hint of the shortcut that focuses it. Clearing it is left to the browser, which offers a button in Chromium and Safari and nothing in Firefox.
- **The chips** are buttons with `aria-pressed` in a `role="group"`, one pressed at a time, with "All" for none.

`ui` has `TextField`, whose `type` can be `search`, and `ToggleButton`. The question for each is whether what's there does the job, or whether pages need a component.

## Decision

### `SearchField`: a component, because a field with things inside it needs a box

`TextField` is its `<input>`: its ref, its classes and its props are the input's. An icon, a clear button and a hint inside the field's border need an element around the input, and adding one to `TextField` would change what every caller's ref and `className` reach.

- **`SearchField` is a box that looks like a text field,** holding a decorative search icon, a native `<input type="search">`, a clear button while there's text, and `end`, a slot for what follows, such as a shortcut hint.
- **The input is the field.** `label`, native props and the ref go to it, so a shortcut can focus it; `className` goes to the box. In a `Field`, it takes the field's label, description and error, as `TextField` does.
- **It's a text field to the eye, with a text field's tokens,** as `TextArea` is: `--hm-text-field-*` set its height, padding, colours and radius, so a page that restyles its fields restyles this one. Two tokens are its own, `--hm-search-field-gap` and `--hm-search-field-icon-fg`.
- **The focus ring goes around the box** when the input has focus, because the box is what looks like the field. The clear button keeps its own ring.
- **Clearing:** the button is an `IconButton` named by `clearLabel`, or by `searchField.clear` in `uiMessages`, "Clear search". It empties the field, reports `""` through `onValueChange`, and returns focus to the input, since the button itself is gone. It isn't there while the field is empty or disabled.
- **Before it hydrates, the browser's clear button stays.** The field's own needs JavaScript, so it's rendered only once the component runs in a browser, by the test `Tabs` uses ([ADR 0016](0016-tabs.md)). Until then, and on a page that never hydrates it, the browser's own affordance is left alone; after, it's hidden, so there aren't two.
- **Text is controlled or kept:** `value` with `onValueChange`, or `defaultValue`.
- **It holds text and nothing else.** It doesn't search, debounce, list results or announce them, and it isn't a landmark. The host puts it in a `<search>` element or a `<form role="search">` with its results' controls, and says how many results there are, with `useAnnounce` or a `role="status"` element. Each is a decision about the host's page that a field can't make.

### Filter chips: `ToggleButton`s in a named group, and no component

A chip is a button that's on or off. `ToggleButton` is that: it carries `aria-pressed`, its small size is chip-sized, its pressed look has a border as well as a fill, and its corners are round. A row of them needs a container with `role="group"` and a name, and a line of layout.

- **`ui` adds no `FilterChips` and no `ToggleButtonGroup`.** The pattern is documented in the README, shown in the catalogue as a story, and its speech is tested with the virtual screen reader: each chip is heard with its state.
- **The group is the host's element:** `<div role="group" aria-label="…">`, laid out with the host's own CSS. Its name says what the chips filter.
- **Every chip is a Tab stop.** That's a toggle button's ordinary behaviour, and what a row of independent filters should have.
- **Which chips are pressed is the host's state.** For filters that combine, each chip keeps or is given its own. For one at a time, the host presses "All" when none applies. For a few choices of which exactly one always applies, `SegmentedControl` is the better control: it's a radio group, and says so.

## Alternatives considered

- **`startIcon`, `endIcon` and a clear button on `TextField`:** one field component. `TextField`'s root would become a box, which breaks every caller's ref, `className` and `classNames`, for a need only search has so far.
- **`TextField type="search"` and nothing else:** no code. It leaves the icon, the box and clearing in Firefox to every page, which is what Fish Memory wrote by hand.
- **Always the field's own clear button, from the server:** one look everywhere. Before hydration it would be a button that does nothing.
- **Always the browser's clear button:** nothing to build. Firefox has none, its look can't follow the theme, and its name isn't the host's to translate.
- **Escape to clear:** Chromium and Safari already do it in a search input, and a field inside a dialog or a palette needs Escape for closing. The button is the way that works everywhere.
- **`role="search"` on the box:** a landmark from the component. A search landmark holds the form and what belongs to it, not one input, and a page with two fields would get two.
- **A `FilterChips` component that takes options and a selection:** less to write for the common case. It would have to choose between one and many, own "All", and still couldn't lay itself out for every page; and it would be a third way, after `SegmentedControl` and a toolbar of toggle buttons, to pick from a row.
- **A `ToggleButtonGroup` that renders the group:** it would make the name required. It's one element and one attribute, and the pattern can become a component later without breaking anyone, once more than one site has written it.
- **Chips in a `Toolbar`:** one Tab stop and arrow keys between chips, which suits a long row. A toolbar is drawn as a bar, and its role says "tools"; a page that wants its keys can use one today, with `ToggleButton`s inside.

## Consequences

- A page gets a search box whose focus ring, clear button and static form are decided and tested once: unit tests of the server markup, browser tests on three engines, and a virtual screen-reader test of what's heard.
- **One export, two component tokens and one message,** `searchField.clear`. It's additive for callers who spread `uiMessages` into their catalogue; a hand-written object of that type must add the key.
- **`SearchField` ships `IconButton`, `Button` and two icons** for its clear button, so it costs more than `TextField`.
- **Restyling text fields restyles search fields,** because they share tokens. A page that wants only its search box different sets the tokens on the box, or on an element around it.
- **Filter chips stay three lines of the host's markup,** and nothing checks that the group is named. The story and the README are the reference.
- **Follow-up, if asked for:** a `ToggleButtonGroup`, once a second site repeats the pattern.
