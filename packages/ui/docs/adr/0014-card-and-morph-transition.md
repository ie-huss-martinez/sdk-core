# 0014. A card whose title is its action, and a morph into a dialog through view transitions

- **Status:** Accepted
- **Date:** 2026-11-26

## Context

The SDKs' editors and their applications list things the user opens: notebooks and notes in notes-sdk, lessons in learn-sdk, recent files in the others. Each draws its own tile today, so `ui` should have one component for them. The maintainer also asked for the tile to grow into the dialog it opens, so the user sees where the dialog came from, after reviewing a third-party demo that did it with a motion library. We take the idea only, not that code.

A card has to:

- **Work from the keyboard and with a screen reader.** A clickable `<div>` does neither. A card that is itself one big link or button reads all of its content as one long accessible name, and it can't hold other actions.
- **Fit the component contract** ([ADR 0003](0003-component-contract.md)): plain CSS and tokens, `unstyled`, `classNames`, and no text of its own.
- **Leave the host's routing to the host.** An application may need a router's `<Link>`, a native `<a href>`, or a `<button>` that opens a dialog.

The transition has to:

- **Add no dependency.** A motion library such as Motion or Framer Motion costs tens of kilobytes for one effect, against the React entry's budget ([ADR 0012](0012-size-budgets-per-import.md)).
- **Keep the dialog native.** `Dialog` is a `<dialog>` in the top layer, opened with `showModal()`. That's where its focus trap, inert page and focus return come from.
- **Respect a strict Content Security Policy,** as overlays do ([ADR 0006](0006-overlays-in-the-top-layer.md)): no `style` attributes in server-rendered markup.
- **Offer a reduced-motion fallback,** as `STANDARDS.md` requires of every animation.

## Decision

### Card

- **An `<article>` labelled by its title.** The title is a native heading, at the level of the closest `HeadingLevelProvider`, or at `headingLevel` (sdk-core ADR 0058).
- **The title holds the card's one main action.** The host puts its own link or button inside `title`. CSS stretches that element's `::after` over the whole card, so a click anywhere on the card follows it. Its accessible name is just the title. Other interactive elements in the card, such as a footer's buttons and links, sit above the stretched area and keep their own clicks. Everything else, such as a footer's tags, follows the main action. This is the "block link" pattern, done without JavaScript.
- **Focus shows on the whole card.** When the title's link or button has `:focus-visible`, the card draws the focus ring through `:has()`, and the link itself doesn't. That rule is part of the layout, so `unstyled` keeps it.
- **The eyebrow and media are read after the title.** In the source, `eyebrow` (a short label such as a category) and `media` come after the heading, so a screen reader starts with the card's name. CSS shows the media at the top of the card, then the eyebrow, then the title. Images in the media are the host's, along with their `alt` text.
- **Static on the server.** A card has no effects and no state, so a card whose title is an `<a href>` renders completely on the server and needs no hydration.
- **Parts:** `root`, `title`, `eyebrow`, `media`, `body` and `footer`, with component tokens that fall back to semantic ones.

### Morphing an element into another

- **`startMorphTransition({ from, to, update })`** in the React entry. It runs `update` inside `document.startViewTransition()`, and wraps it in `flushSync` so React commits before the browser takes its "after" snapshot. The browser then animates `from`'s box into `to`'s, such as a card into its dialog, and back again when the host swaps them.
- **Names exist only while it runs.** Before the transition starts, it gives `from` a `view-transition-name`, unique to this call, through the CSSOM. In the update, it moves the name to `to`, and it removes the name when the transition finishes. Nothing is in the markup, so a strict CSP is satisfied, and two elements never hold the same name at once, which would make the browser skip the transition.
- **The dialog opens inside the update.** `Dialog` calls `showModal()` in an effect. React runs the effects of a `flushSync` render before `flushSync` returns, in React 18.3 and 19 alike, so the dialog is in the top layer when the browser takes its snapshot. A browser test checks this on all three engines.
- **One animation at a time.** While a morph runs, `<html>` carries `data-hm-morph`. Under it, `Dialog`'s own fade and rise are off, and the morph uses the panel motion tokens.
- **No animation when there's nothing to animate.** Without the View Transitions API, without `from`, or when the user prefers reduced motion, `update` runs directly and the dialog opens as it always has. The browsers in [sdk-core ADR 0013](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0013-browser-and-react-support.md)'s range all have same-document view transitions, so the first case is for test environments and future browsers.
- **It's not tied to `Card` or `Dialog`.** Any element can morph into another, such as a thumbnail into a full-size view. `Card` and `Dialog` take refs, and need nothing else.

## Alternatives considered

- **A motion library's shared layout animation:** smooth and well tested, but a large runtime dependency for every application. It also animates by moving elements with transforms during React renders, which fights the top layer that `Dialog` lives in.
- **The FLIP technique by hand** (measure, invert, animate with the Web Animations API): no dependency, but `ui` would own the measuring, the clipping and the cross-fade, which the browser does natively, with better performance, in view transitions.
- **A whole card that is a `<button>` or `<a>`:** simple, but its accessible name becomes everything inside it, and a card can't then have other actions without invalid nested interactive elements.
- **A `Card` with `href` and `onClick` props:** `ui` would decide what the action renders as, which breaks client-side routers. Stretching whatever the host puts in the title works with any of them.
- **`view-transition-name` as a prop, in markup:** a style attribute that a strict CSP blocks. A permanent name on the card would also clash with the open dialog's.

## Consequences

- The editors and applications get one accessible card, styled and themed like every other component.
- A host opts into the morph by calling one function in its open and close handlers. Without it, `Card` and `Dialog` behave as they do alone.
- The stretched action covers the card, so its text can't be selected with the mouse. The component's documentation says so.
- The morph depends on React running effects inside `flushSync`. If React ever stops doing that, the browser test fails, and the dialog would cross-fade without moving rather than break.
