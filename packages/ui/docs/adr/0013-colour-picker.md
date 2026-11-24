# 0013. A colour picker drawn in SVG, with an accessible slider for each axis

- **Status:** Accepted
- **Date:** 2026-11-24
- **Builds on:** [ADR 0008](0008-colour-input-without-the-native-picker.md), which left a full picker, alpha and an eyedropper for later

## Context

`ColorField` ([ADR 0008](0008-colour-input-without-the-native-picker.md)) gives the family a hex input and fixed swatches. That was enough for preset colours, but the maintainer asked on 2026-11-22 for a real picker for image-sdk's layers, drawing and redaction, and pdf-sdk's annotations next:

- swatches and the colours used recently;
- a two-dimensional saturation and brightness area with a hue slider, and optional alpha;
- a hex input, and the browser's eyedropper where there is one;
- full keyboard and screen-reader support, with spoken values and colour names;
- a contrast hint when the colour is for text;
- and a palette-only option for hosts that want no more than swatches.

ADR 0008's reasons for not using `<input type="color">` still hold, and so do its constraints: no `style` attributes in server-rendered markup, colours only from one parser, and every colour with a border that doesn't depend on its own contrast.

A two-dimensional area is the hard part. ARIA has no two-dimensional slider role, and an area that's one focusable element with four arrow keys says nothing useful to a screen reader.

## Decision

- **`ColorPicker` is a new component beside `ColorField`,** which stays as it is. It's inline, like `ColorField`; a button that opens it in a popover can come with `ui`'s `Popover`.
- **`variant="full"`** (the default) has the area, the hue slider, an optional alpha slider, the hex input, the eyedropper, the recent colours and the swatches. **`variant="palette"`** has only the swatches, the recent colours and the hex input.
- **Each axis is a native range input.** The area holds two visually hidden `<input type="range">`, one for saturation and one for brightness, and the hue and alpha sliders are visible ones. Each is a Tab stop with its own name, so a screen reader announces "Saturation, 40 %, dark blue" and the arrow keys, Page Up and Down, and Home and End work as every engine already makes them work. Dragging in the area sets both at once. The thumb shows which input has focus.
- **Drawn in SVG, positioned by attributes.** The area is an SVG: a rectangle filled with the hue, a white-to-clear gradient across and a clear-to-black one down. The hue strip is an SVG gradient with a stop every 60°, and the alpha strip a checkerboard pattern under a clear-to-colour gradient. Thumbs are SVG circles placed with `cx` and `cy`. Every colour and position is a presentation attribute written from the parser's output, so the server-rendered picker is complete under a strict Content Security Policy.
- **The value is lowercase `#rrggbb`, or `#rrggbbaa` with `alpha`.** Internally the picker keeps hue, saturation and brightness, so the hue survives dragging to grey or black and back.
- **Colour names are messages.** The spoken name is built from the hue's family (red, orange, yellow, green, cyan, blue, purple, pink), its lightness (light, dark) and its saturation (greyish, or grey alone), each a key in `uiMessages`, so they can be translated. A name is an aid, not a value: the hex is always available too.
- **Recent colours are the host's.** The picker shows `recentColors`, and reports each committed colour through `onValueCommit`, for `addRecentColor`: the pointer let go, a key on a slider, Enter in the hex input, a swatch or the eyedropper. `onValueChange` reports intermediate colours too, while dragging, so it isn't the one to keep. `addRecentColor(list, colour)` keeps a list of eight, newest first, without duplicates. Where the list is kept is the host's choice, as with every preference ([sdk-core ADR 0067](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0067-editor-frame-modes-and-host-owned-preferences.md)).
- **The eyedropper is feature-detected after mount.** Its button appears only where `window.EyeDropper` exists (Chromium today), never during render, so server and client render the same markup. A cancelled pick changes nothing.
- **The contrast hint is opt-in.** With `contrastWith`, the colour the picked one will sit on, the picker shows the ratio and whether it meets 4.5:1, with `ui`'s own contrast maths. It's a hint, not a block.
- **Swatches and recent colours are radio groups** with one Tab stop each, as in `ColorField`.

## Alternatives considered

- **One focusable area with four arrow keys:** compact, but a screen reader hears one value for two dimensions, or none, and there's no native behaviour to lean on for Page Up, Home or touch screen readers.
- **Custom `role="slider"` elements:** they work, but every engine already gives range inputs the keys, the touch gestures of mobile screen readers and the value announcements. Re-implementing them adds code and risk for nothing.
- **CSS gradients for the area and strips:** the colours would have to be literal values in CSS, which the family's stylelint forbids, or `style` attributes, which a strict policy blocks.
- **Keeping recent colours in `localStorage`:** an SDK component would write storage a host didn't ask for.

## Consequences

- SDKs replace their fixed swatch lists with one picker, with the same keys and text everywhere.
- Two Tab stops for the area is one more than a mouse user sees. It's the price of announcing each axis on its own, and screen-reader tests cover it.
- The eyedropper is Chromium-only for now; elsewhere the picker simply has no such button.
- `ColorField` stays for hosts that want a small hex input with presets.
