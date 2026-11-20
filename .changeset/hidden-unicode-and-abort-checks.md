---
"@hussmartinez/sdk-config": minor
---

Add two source checks for the whole family (sdk-core ADR 0052). Both are on as soon as you update, through the lint-staged and Biome presets, so this is a minor release: take it in a pull request of its own, and expect to fix or list what it finds.

**What to expect when you update:**

- **Commits are checked for hidden characters** at once, by the lint-staged preset. `pnpm lint` checks the whole repository once you add the command to it.
- **`biome check` may report `"abort"` listeners** you have today, through the preset's new plugin.
- **Repositories with hidden characters on 2026-11-21:** image-sdk (19: its conformance vectors, two regular expressions in `src/core`, and three layer tests) and learn-sdk (130: its conformance vectors and two test generators). pdf-sdk, audio-sdk, video-sdk, ui, editor-apps and chat-example have none.
- **How to settle each finding:** in source and tests, write the character as an escape, which changes nothing at run time. Conformance vectors and other test data that must hold the characters go in `.hm-hidden-unicode-ignore`, or their generator writes escapes.

**`hm-check-hidden-unicode`,** a new command. It fails when a tracked text file of any type holds a character that an editor and a diff don't show, or that reorders the text around it: bidirectional formatting characters, zero-width and other invisible characters, line and paragraph separators, and tag characters. Each is reported with its place, its name and the escape to write instead:

```text
src/names.ts:12:27: hidden character U+202E RIGHT-TO-LEFT OVERRIDE. Write it as the escape \u202E, or remove it.
```

Add it to your `lint` script: `"lint": "biome check . && hm-check-hidden-unicode"`. Write such characters as escapes in source. Test data that must hold them is listed, by glob, in `.hm-hidden-unicode-ignore` at the repository's root.

**The lint-staged preset now runs `hm-check-hidden-unicode`** on staged files, after the secret scan. This starts as soon as you update: a commit that stages a file with a hidden character is refused until the character is written as an escape, or the file's path is in `.hm-hidden-unicode-ignore`.

**The Biome preset now includes a plugin, `noUncheckedAbortListener`.** An `"abort"` listener added to a signal that has already aborted never fires. The rule reports `signal.addEventListener("abort", …)` unless a function around it also reads the same signal's `aborted`, calls its `throwIfAborted()`, or passes it to a `throwIfAborted()` helper. This also starts as soon as you update, so `biome check` may report listeners you have today. For each one: check `signal.aborted` first, use `AbortSignal.any()` instead of listening, or, when a caller already guarantees the signal isn't aborted, say so:

```ts
// biome-ignore lint/plugin/noUncheckedAbortListener: call() refuses an aborted signal first.
signal.addEventListener("abort", onAbort, { once: true });
```
