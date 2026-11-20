# 0052. Source checks for hidden characters and abort listeners

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0015](0015-verification-and-releases.md)'s `lint` step and [ADR 0016](0016-git-hooks-and-merge-guards.md)'s `pre-commit` hook, by adding two checks of the family's own to them

## Context

Two defects reached review in the SDKs that no existing check could see. Both are invisible in a diff.

**Hidden characters.** Some characters don't show in an editor or a diff, or reorder the text around them: bidirectional formatting characters, zero-width characters, tag characters. They're a known attack ("Trojan Source": code that reads differently from what runs), and the family handles them as hostile input in file names ([ADR 0051](0051-clean-file-names.md)). In our repositories they arrived by accident instead. The tools agents use to write files sometimes turn an escape such as `\u202E` into the character itself, so a test that should hold an escape held an invisible character, and still passed. `pdf-sdk` added `tools/check-hidden-unicode.ts` after it found some. The other repositories have no check, and a scan on 2026-11-21 found such characters in `image-sdk`. While this record's own check was being written, the same thing happened to the regular expression inside it.

**Abort listeners.** `signal.addEventListener("abort", …)` does nothing when the signal has already aborted: the event has fired, and it doesn't fire again. Code that only listens then never stops, and nothing reports it. `video-sdk` shipped an export that couldn't be cancelled this way. A sweep of `sdk-core` found two test helpers with the same shape and one narrow gap in the worker client ([#133](https://github.com/ie-huss-martinez/sdk-core/pull/133), [#134](https://github.com/ie-huss-martinez/sdk-core/pull/134)). A sweep finds today's cases; only a check stops the next one.

## Decision

Both checks ship in `sdk-config`, so every repository gets the same ones.

### `hm-check-hidden-unicode`: no hidden characters in tracked text

- **What's refused:**
  - bidirectional formatting: U+061C, U+200E, U+200F, U+202A–U+202E, U+2066–U+2069;
  - invisible characters: U+00AD (soft hyphen), U+180E, U+200B–U+200D, U+2060–U+2064, U+FEFF (the byte order mark);
  - line and paragraph separators, U+2028 and U+2029, which only some tools break lines at;
  - tag characters, U+E0000–U+E007F, invisible copies of ASCII.
- **Every tracked text file is checked,** not only code: Markdown, YAML, JSON and configuration are read by reviewers and by agents too. Binary files, meaning those with a NUL byte or that aren't valid UTF-8, are skipped, and so is anything that isn't a regular file: a submodule's folder, or a symbolic link, whose target is checked where it lives.
- **Source writes these characters as escapes,** such as `\u202E`, or builds them with `String.fromCodePoint()`. That includes emoji joined with U+200D.
- **Only test data may hold them,** listed by path in `.hm-hidden-unicode-ignore` at the repository's root. There's no default list and no inline marker: an exception is a reviewed line in one file.
- **It runs in two places:** in each repository's `lint` script, so `pnpm verify` and CI fail on it, and in the lint-staged preset, so a commit that adds one is refused where it's made.

### `noUncheckedAbortListener`: listen for `abort` only where the signal is checked

- **The rule,** a GritQL plugin in the Biome preset: an `addEventListener("abort", …)` call is reported unless a function that contains it also reads the same signal's `aborted`, calls its `throwIfAborted()`, or passes it to a `throwIfAborted()` helper. A check inside an abort handler doesn't count, since the handler is what never runs.
- **Prefer not to listen:** `AbortSignal.any()` combines signals, and `AbortSignal.timeout()` makes one, without listeners. [ADR 0020](0020-file-policy.md)'s `withProcessingTime` already works that way.
- **A check made by a caller is invisible to the rule.** That case takes a `biome-ignore lint/plugin/noUncheckedAbortListener` comment with the reason, which a reviewer can then hold the code to.
- **It's a plugin, not a separate command,** so it runs wherever Biome does (the editor, `lint`, the commit hook), and is suppressed the way every Biome rule is.

## Alternatives considered

- **Each repository keeps its own script,** as `pdf-sdk` did: five copies of a security check, of which four don't exist yet.
- **Checking only source files for hidden characters,** through a lint rule: Biome doesn't read Markdown or YAML for this, and has no such rule for code. Workflows and documentation are where an invisible instruction does most harm.
- **A default exception for `fixtures/` folders:** convenient, but an exception nobody wrote down is one nobody reviews.
- **Refusing every character outside ASCII:** it would catch more, and reject honest text: names, translations, test strings in other scripts, and typographic punctuation.
- **Also refusing variation selectors (U+FE00–U+FE0F):** they're invisible, but they're part of ordinary emoji such as "❇️", and carry no text.
- **A type-aware rule for abort listeners,** which knows a value is an `AbortSignal`: it would need the TypeScript compiler in a separate command. The event name `"abort"` is specific enough: other targets with that event, such as `IDBTransaction` and `XMLHttpRequest`, have no `aborted` to check, and aren't used in the family.
- **Requiring the check to come before the listener:** stricter, but listening first and checking afterwards is equally correct, and the plugin language doesn't express order.

## Consequences

- A hidden character can't be committed, or merged, in any repository that updates `sdk-config`. The commit hook starts checking as soon as a repository updates, with no change of its own.
- Repositories with hidden characters today must write them as escapes, or list test data, before their `lint` passes with the new step. `image-sdk` is one.
- Every `"abort"` listener in the family is either checked, replaced with `AbortSignal.any()`, or carries a written reason.
- The abort rule reads syntax, not types. It can report a listener that a caller has protected, which costs one comment, and it accepts a check anywhere in the enclosing functions, even one on a path that doesn't reach the listener.
- `sdk-config` gains one command and its first Biome plugin. Further family rules can be added the same way.
