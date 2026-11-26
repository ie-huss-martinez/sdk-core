# 0015. A static tag, and a link that looks like a button

- **Status:** Accepted
- **Date:** 2026-11-26
- **Builds on:** [ADR 0003](0003-component-contract.md), the component contract, and [ADR 0005](0005-icon-set.md), amended in the same pull request for the icons these pages use

## Context

`ui` was built for the SDKs' editors. Two sites that are pages, not editors, now use its tokens and want its components: Fish Memory and the maintainer's portfolio. Both are static Astro sites, rendered at build time, with React only where a page needs it. Both write their own:

- **chips:** a guide's category, the technologies of a project, the error codes a guide covers. Short labels, often several in a row, that do nothing when pressed;
- **links that look like buttons:** "Browse the guides", "Source code". Today that's `class="hm-button"` on an `<a>` by hand, which works because `hm-` classes are API, but nothing checks it or says how to do it well.

Three things constrain both:

- **No client JavaScript.** An Astro component without a `client:` directive is rendered once, at build time. Whatever a component needs must be in its markup and in `styles.css`.
- **The page's own CSS wins.** A site's unlayered CSS beats every `hm` layer ([ADR 0005 of the family](../../../../docs/adr/0005-plain-css-with-cascade-layers.md)), whatever its specificity. That's by design, and it means a bare `a { color: … }` rule on a site restyles a link from `ui`.
- **`Button`'s floor.** What an application ships for `Button` alone is a floor that's never raised ([ADR 0012](0012-size-budgets-per-import.md)). Code a button doesn't need can't go into it.

## Decision

### `Tag`: one component, and no `Badge`

- **A tag is text.** `Tag` renders a `<span>` with `tone`, an optional decorative `icon`, and its text in a label. It has no role, takes no focus, and has no hover or pressed state. Parts: `root`, `icon` and `label`.
- **`tone`** is `neutral` (the default), `accent`, `success`, `warning` or `danger`. Each pairs a quiet background with a text colour that every theme already has to keep at 4.5:1 on it (`contrastPairs`), so a custom theme that passes `checkContrast` has readable tags. **Colour never says a state alone** (WCAG 1.4.1): the tag's text does, and the icon can.
- **Only the neutral tone colours its border.** The others keep a transparent one, so tones line up and forced-colours mode, which drops backgrounds, still draws a tag's outline.
- **Text too long for its line wraps inside the tag.** A tag can't be focused or hovered for a tooltip, so text cut with an ellipsis would be lost to everyone.
- **There's no `Badge`.** A badge is a count or a dot attached to something else, such as unread messages on a button. It needs a name that includes what it counts, changes while the page is open, and may need announcing. Nothing in the family needs one yet, and a second component for "a small coloured label" would leave callers guessing which to use. When a count is needed, it gets its own record.
- **`TagList` is the list.** It renders `<ul role="list">`, and a `Tag` inside it renders as the `<li>`, through context, so the markup is valid without the caller writing list items, and a screen reader says how many tags there are. The role is written out because Safari treats a list without markers as no list, and VoiceOver then says nothing of it. It wraps, takes `className`, and has no `unstyled`, because it only lays out.
- **`as="li"` is for where context doesn't reach.** An `.astro` file renders each React component on its own and hands a parent its children as markup, so a `Tag` written inside a `TagList` there never sees the list, and would be a `<span>` in a `<ul>`. `as` takes `span` or `li` and wins over the context. It also serves a tag in the caller's own `<ul>`.
- **Removable and pressable tags are out.** A tag that does something is a button or a toggle, with a name, a target size and a focus ring. Filter chips will be `ToggleButton`s in a group, in their own pull request.

### `ButtonLink`: a component of its own

- **A native `<a href>` with the button's classes,** plus `hm-button-link`. `variant`, `size`, `startIcon`, `endIcon`, `classNames` and `unstyled` are `Button`'s; every other prop is the anchor's own.
- **A link stays a link.** No `role="button"`, and no Space handler: Enter follows it, Space scrolls the page, and the browser's own link behaviour stays, such as the address on hover, opening in a new tab from the context menu or with a modifier, and copying the address. A screen reader says "link", so the user knows that it navigates.
- **It has no `disabled` and no `pressed`.** HTML has no disabled link, and a link has no pressed state. Where navigation isn't available, don't render the link.
- **`target="_blank"` is made safe and said.** `rel` defaults to `noopener noreferrer`, as [`STANDARDS.md`](../../../../STANDARDS.md) asks of links; a `rel` the caller passes wins. The link's accessible name gains "(opens in a new tab)", in text hidden on screen, so the change of context isn't a surprise (WCAG technique G201). The text is `newTabHint`, falling back to `buttonLink.newTab` in `uiMessages`; `""` leaves it out, for a link whose own text says it. A name the caller gives with `aria-label` or `aria-labelledby` replaces the link's text, so the hint joins that name instead: an icon-only link to another site says it too. The keyword is matched in any case, as HTML matches it. The visible sign is the caller's icon, such as `ExternalLinkIcon` as `endIcon`: icon slots are hidden from assistive technology, so the icon alone would tell a screen reader nothing.
- **A `javascript:` URL is refused.** A link's address often comes from data, such as a profile's website, and React 18 renders such a URL as it is. `ButtonLink` renders the link without an `href`, so it does nothing and leaves the Tab order, and warns in development. The check is React 19's own pattern.
- **It's a refusal of one scheme, not an allowlist.** `STANDARDS.md` allowlists the protocols of links that come out of files, where an SDK's parser decides what a document may link to. A design system's link can't know its host's schemes: `mailto:`, `tel:`, an application's own, or the `blob:` address of a download. So `ButtonLink` refuses the one scheme that runs script in the page, and a host that takes addresses from users checks them where they enter.
- **The new-tab text is a part of the catalogue of its own,** `src/messages/link.ts`, read through a hook that names its part. A link ships that one string, not the other components' text, and no other component ships it.

### Static pages

Both components are complete in their server-rendered markup: no effect, no state and no handler. Their tests render them with `renderToStaticMarkup`, as a static site does, load `styles.css`, and check the result in a browser without hydrating: tones, wrapping, the link's look, focus ring, Enter and Space.

A site's unlayered CSS still wins. **A bare `a { color: … }` or `a { text-decoration: … }` rule restyles a `ButtonLink`,** so a site scopes such rules to its own links, such as `a:not(.hm-button)`, or puts them in a layer below `hm`. The README says so.

## Alternatives considered

- **`href` on `Button`:** one component to learn. But its ref and props would become a union of a button's and a link's, which breaks callers' types today; `pressed`, `disabled`, `type` and `focusableWhenDisabled` would be accepted on a link and mean nothing; and the link's branch, with its new-tab text and URL check, would ship to every application that uses a button, moving a floor that's never raised.
- **`asChild`, or an `as` prop:** the caller's element takes the button's props and classes. It's flexible, and it's how a `<div>` ends up with a button's look and none of its behaviour. It also needs the element cloned and its props and refs merged, which is code and a class of bugs `ui` doesn't have. Ruled out when the work was agreed.
- **Documenting `class="hm-button"` on an `<a>` and nothing else:** no code at all, and it stays possible. It leaves the new-tab `rel`, the hint and the underline to every caller.
- **A `Link` component for text links too:** a different component, with its own questions about visited colours and underlines. Not needed by either site yet.
- **`Tag` and `Badge` as two components now:** see above; nothing needs the second.
- **Only an `as="li"` prop on `Tag`, and no context:** one mechanism, and it lets a `<span>` into a `<ul>` whenever it's forgotten. With the context, a list in a React tree is valid without it; `as` is left for the places context can't reach.
- **An allowlist of link protocols in `ButtonLink`:** see above. It would refuse legitimate links until every host extended it.
- **Cutting long tags with an ellipsis:** tidier, and it hides text nobody can then read.
- **A `size` for `Tag`:** nothing needs two. `--hm-tag-padding-y`, `--hm-tag-padding-x` and `--hm-tag-font-size` change it per page or per subtree.

## Consequences

- Pages get chips and button-like links from `ui`, with the accessibility decisions made once: what a tag is to a screen reader, what a link says when it opens a tab, and what happens to a hostile address.
- **Three exports and 18 component tokens,** `--hm-tag-*`. `Tag` costs an application 0.47 kB, `Tag` with `TagList` 0.53 kB and `ButtonLink` 0.90 kB, minified and compressed. `Button`'s floor doesn't move.
- **`uiMessages` gains `buttonLink.newTab`.** It's additive for callers who spread `uiMessages` into their catalogue; a hand-written object of that type must add the key.
- **`ButtonLink` shares `Button`'s CSS,** so a change to a button's look reaches links too, and the browser test that compares the two per variant fails if they drift.
- **A tag becomes a list item in two ways:** inside a `TagList` in a React tree, or with `as="li"`. A `Tag` inside a `TagList` must be its direct item, and in an `.astro` file the list is only valid with `as`, which nothing checks.
- **Follow-up work,** each in its own pull request: tabs, a search field, and filter chips as a group of `ToggleButton`s.
