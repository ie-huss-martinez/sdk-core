# 0065. Screen-reader tests with a virtual screen reader

- **Status:** Accepted
- **Date:** 2026-11-23
- **Refines:** [ADR 0015](0015-verification-and-releases.md)'s browser tests, with a check of what a screen reader says

## Context

The family's components are built for keyboard and screen-reader users, and their records say what a screen reader should say: a row and its position, a move announced through ui's announcer, a clip's place in its lane. Nothing automated checks it. The tests check ARIA attributes and run axe, which find a missing name or a wrong role, not what a person hears while they work a component.

What's heard has been left to a manual pass. ui's [`docs/testing/manual-pass.md`](../../packages/ui/docs/testing/manual-pass.md) scripts one for `ReorderableList` and `Timeline`: about 20 minutes with NVDA in two browsers and VoiceOver in Safari. ADR 0009 and ADR 0011 in ui stay Proposed until someone does it. Every change to those components can break what it checked, and nobody hears it until the next pass.

A virtual screen reader computes what a screen reader would say from the page itself, from the accessibility tree that the ARIA specifications define, and logs it. [`@guidepup/virtual-screen-reader`](https://github.com/guidepup/virtual-screen-reader) does that in a browser test. It listens as a screen reader does, to focus moving by any means and to live regions changing, so a test can press real keys and read what was said.

### What it hears, tried on the manual pass

Each step of the manual pass's list and lanes tables, and part 1's moves, was played in the pinned browser test image with real keys, on Chromium, Firefox and WebKit. Each engine said the same:

| It says | Example |
|---|---|
| What focus lands on, with its role, name and state | `gridcell, Photo`; `button, Show Photo, pressed` |
| A slider's value when focus reaches it | `slider, Voice gain, …, current value 0 decibels` |
| An option's place in its listbox | `option, Voice 1, clip 1 of 3, not selected, position 1, set size 3` |
| What the announcer says | `polite: Shape moved to position 4 of 4` |
| Nothing for a move that can't happen | Alt+↑ on the first row |

And what NVDA and VoiceOver say that it doesn't:

| It doesn't say | Example from the manual pass |
|---|---|
| The containers focus enters | the grid "Layers", the group and toolbar "Track 1, Voice", the region "Timeline" |
| A row's selection and place, when focus is on its cell | "selected", "row 2 of 4" |
| A change to the focused control's own state or value | Space on the eye button; → on the playhead |
| Anything about browse mode, or how a screen reader passes keys to a `grid` or a `listbox` | NVDA switching to focus mode |

The trial also found one thing the manual pass asked about: a clip's place is said twice, as "clip 1 of 3" in its name and again as "position 1, set size 3", because a listbox counts its options itself.

## Decision

**Browser tests assert what a virtual screen reader says, step by step, for the interactions a manual pass scripts.**

- **One entry, `@hussmartinez/sdk-config/testing/screen-reader`,** wraps `@guidepup/virtual-screen-reader`. `startScreenReader()` returns a reader whose `spoken(step)` runs a step, waits until speech has stopped, and returns the phrases spoken since the previous step. `stop()` ends it.
  - **It waits for speech to stop,** 150 ms without a new phrase by default, rather than a fixed time. ui's announcer speaks one animation frame after a change. A step that never stops speaking fails after 3 seconds instead of hanging.
  - **An emptied live region says nothing.** The announcer empties its region before each message, and the library logs that as a phrase with no text. A screen reader says nothing for it, and the tests would otherwise depend on frame timing.
  - **One reader at a time:** the library has one instance, so a second start fails, naming what to do.
- **The library is an optional peer dependency of `sdk-config`,** pinned exactly in the catalog, like ESLint for the React lint ([ADR 0063](0063-a-lint-for-what-react-components-do-while-rendering.md)). Only the packages with these tests install it. It's MIT-licensed, and adds three packages to the lockfile, none with an install script.
- **The tests play the stories a manual pass opens,** through Storybook's portable stories, so they hear what a person would. Each step is the pass's own: what to press, and the phrases expected after it. A step where a real screen reader says more has a comment that says what, so the gap stays visible.
- **The tests assert phrases exactly.** The library's wording follows the specifications, not any one screen reader, and it's pinned, so a phrase changes only when the component or the pinned version does.
- **They run with the other browser tests, on all three engines in CI.** The engines decide focus and keys, which is where a component can differ between them.

### The pilot

ui's catalogue gets a `screen-reader` project with tests for `ReorderableList` and `Timeline`. They play the manual pass's list and lanes tables and part 1's moves. They run in the catalogue's `test:browser`, which ui's `verify` runs.

### What stays manual

**The manual pass stays, and so does each record's condition for acceptance.** The virtual screen reader proves that focus lands where it should, that what's there is named and placed as designed, and that moves are announced in the words the messages give. It can't prove how NVDA or VoiceOver treat a `grid` or a `listbox`, whether they pass the arrow keys through, or what they say about containers and changing state. Those are what the manual pass is for, and what part 2 of this work, real screen readers in CI, is to automate.

## Alternatives considered

- **Leave it to the manual pass:** it's the only check of real screen readers, and it stays. On its own it runs rarely, by hand, and a change between passes goes unheard.
- **Assert the accessibility tree instead,** such as with Playwright's ARIA snapshots: it checks the same names and roles, but not what's said when, such as an announcement after a move, or nothing at the end of a list. The manual pass is a script of steps, and its expectations are spoken phrases.
- **Real screen readers on every pull request:** NVDA and VoiceOver need Windows and macOS runners, take minutes to start and are slower and less steady than a browser test. That's part 2's scheduled workflow, not a check on every change.
- **Write our own speech from the accessibility tree:** a smaller dependency, and a second, untested reading of the specifications that the library already implements and tests.
- **Assert parts of each phrase, such as the name alone:** less to update when wording changes, and less caught. The wording comes from a pinned version, so exact phrases cost little.

## Consequences

- What a person hears while working `ReorderableList` and `Timeline` is checked on every pull request that touches ui, on three engines. A component that stops announcing its moves fails its test at the step, naming it.
- The phrase log is in the tests, readable as a script: it's what to listen for in the manual pass.
- **A pinned version to keep up:** an update to the library can change wording, and then expected phrases change with it, in the update's pull request.
- **It isn't a proof of accessibility.** A test that passes says the page announces what it was designed to, not that a screen reader user can work it.
- **Follow-up:** each SDK with an editor can add the same tests for its own interactions. Part 2, real screen readers on a schedule, is its own record.
