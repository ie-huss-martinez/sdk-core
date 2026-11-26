---
"@hussmartinez/ui": patch
---

Add `Card` and `startMorphTransition` to `@hussmartinez/ui/react`.

`Card` is an `<article>` for something the user opens, such as a notebook, a lesson or a recent file. Put your link or button in `title`: it covers the whole card, so a click anywhere follows it, with one Tab stop and the focus ring around the card. It takes `eyebrow` (a short label above the title), `media` (shown at the top, read after the title), `children` for the body and `footer`. Buttons and links in the footer keep their own clicks. The heading's level comes from `HeadingLevelProvider` or `headingLevel`. A card has no effects, so an `<a href>` card renders completely on the server and needs no hydration.

```tsx
<Card title={<a href="/notebooks/1">Travel</a>} eyebrow="Notebook" footer={<span>12 notes</span>} />
```

`startMorphTransition({ from, to, update })` runs your state change in a view transition, so the card grows into the dialog it opens, and shrinks back when you call it with `from` and `to` swapped. With reduced motion, or without the View Transitions API, it just runs `update`.

```tsx
<Card ref={card} title={<button onClick={() => startMorphTransition({ from: card, to: dialog, update: () => setOpen(true) })}>Fractions</button>} />
<Dialog ref={dialog} open={open} title="Fractions" onOpenChange={(next) => startMorphTransition({ from: dialog, to: card, update: () => setOpen(next) })} />
```

New component tokens: `--hm-card-bg`, `--hm-card-fg`, `--hm-card-border-color`, `--hm-card-border-color-hover`, `--hm-card-shadow-hover`, `--hm-card-radius`, `--hm-card-padding`, `--hm-card-gap` and `--hm-card-title-font-size`.
