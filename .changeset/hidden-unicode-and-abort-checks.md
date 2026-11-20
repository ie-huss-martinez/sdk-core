---
"@hussmartinez/sdk-config": patch
---

Add two source checks for the whole family (sdk-core ADR 0052).

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
