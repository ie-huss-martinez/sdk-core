# 0002. The ink engine: pointer events, two canvases, and a pen that writes while fingers move the page

- **Status:** Accepted
- **Date:** 2026-11-23
- **Builds on:** in sdk-core, [ADR 0010](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0010-edits-as-commands.md) (edits as commands) and [ADR 0013](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0013-browser-and-react-support.md) (browsers)

## Context

People judge a handwriting app by how closely the line follows the pen. That depends on three things: how many of the pen's samples reach the line, how soon the line is drawn after each one, and whether the hand resting on the screen disturbs it.

The first device is an Android tablet with an active stylus, in Chrome. Safari on iPad and desktop browsers follow.

## Decision

### Input

- **Pointer events,** listened to on the scrolling viewport, outside React. A stroke becomes a command, and React state, only when it ends.
- **Every sample counts.** Each `pointermove` is read through `getCoalescedEvents()`, which holds the samples the browser gathered since the last frame. Where it's missing or empty, the event itself is the sample.
- **Predicted samples** from `getPredictedEvents()` are drawn ahead of the pen and never kept.
- **Pressure** is the pen's own, from 0 to 1, stored as an integer from 0 to 1000. A mouse and a finger write at half pressure.
- **`touch-action: none`** on the viewport. The engine handles every touch itself, so the browser never takes a pen stroke for a scroll.

### Who writes

- **A pen or a mouse writes** with the tool in hand.
- **Fingers pan and pinch to zoom.** One finger scrolls, with a short coast after a flick. Two fingers zoom about the point between them: while they move, the pages are scaled with a CSS transform, and when they lift, the zoom becomes real and the pages are redrawn sharp.
- **A finger can write** when the user turns that on, for devices without a pen. A second finger then turns the stroke into a pinch.
- **A pen's barrel button, or its eraser end, erases while held** (`buttons` 2 or 32), where the pen reports it. The tool in hand doesn't change.

### The palm

A touch is the palm, and is ignored until it lifts, when:
- the pen is down;
- the pen was down or hovering in the last 700 milliseconds;
- it was already down when the pen landed;
- a pen has been used and the touch is wider or taller than 40 CSS pixels.

A pen stroke the system cancels is kept: it's still ink. A cancelled finger stroke is dropped.

### Drawing

- **Outlines from `perfect-freehand`** (MIT), a runtime dependency of about 2 kB: the stroke's samples and pressures become one filled outline. A pen's width follows pressure; a highlighter's and a straightened shape's don't.
- **Two canvases per page.** The wet canvas, created with `desynchronized: true`, holds only the stroke being drawn and is redrawn once a frame. The dry canvas holds finished ink, and is repainted when the page's items change. Each finished stroke's path is built once and cached.
- **Highlighter ink is drawn first,** at 40% opacity with the multiply blend, so it sits under what's written over it. The exported PDF draws in the same order.
- **Only pages near the view are mounted,** so a long notebook costs a few canvases, not hundreds. A canvas holds at most 12 million pixels; beyond that it's drawn at a lower density.

### Tools on the page

- **Eraser:** whole strokes, or only the part it passes over. The second cuts a stroke where the eraser's circle crosses it and keeps the pieces in the stroke's place. One pass is one undoable step.
- **Lasso:** a loop selects the strokes mostly inside it and the boxes whose centre is; a tap selects what's under it. The selection moves, resizes from its corners, takes a colour, duplicates and deletes. While it moves, its items are on the wet canvas, which the browser shifts and scales without repainting.
- **Shapes:** a stroke is straightened into a line, a rectangle, an ellipse or a triangle when the pen rests for half a second at its end, or always when the user turns that on. Recognition is strict, so handwriting never turns into shapes.
- **Text, pictures and links** are items like strokes, added with their own tools.

### Tests

- **Chromium's protocol sends real pen input.** `Input.dispatchMouseEvent` with `pointerType: "pen"` and `force` goes through the browser's own input pipeline, so the page receives pen events with pressure, as from a stylus. The browser tests and the end-to-end tests use it to cover writing, both ways of erasing, the barrel button, and undo.
- **Firefox and WebKit have no such protocol.** There the same samples are dispatched as pointer events on the page, which still covers the engine's logic.
- **How the ink feels is judged by hand,** on the tablet, before each release that touches the engine.

## Alternatives considered

- **Native scrolling with `touch-action: pan-x pan-y`:** the browser then decides whether a pen drag is a scroll, and Chrome on Android scrolls with the pen. Handling touches ourselves costs a pan, a pinch and a coast, and makes the pen always write.
- **One canvas:** every sample would repaint all the finished ink under it, or need dirty rectangles. Two canvases keep the per-sample work to one stroke.
- **SVG paths:** thousands of path elements per page are slow to lay out and scroll.
- **A whiteboard library:** the candidates have an endless canvas instead of pages, or need a licence key in production.
- **An ink library of our own in place of `perfect-freehand`:** its outlines are what people already find natural, in 2 kB.

## Consequences

- The pen writes with the samples and the pressure the device gives, a frame at most behind it, and a resting hand does nothing.
- The engine owns scrolling and zooming on touch screens, so their feel is ours to tune.
- Very high zoom shows a soft page until tiles are drawn, which is a later step.
- `desynchronized` is a hint. Where a browser ignores it, the wet canvas is an ordinary one, and nothing else changes.
