# 0055. What the size budgets measure

- **Status:** Accepted
- **Date:** 2026-11-21
- **Refines:** [ADR 0015](0015-verification-and-releases.md)'s "bundle budgets: `size-limit`, per entry point", which doesn't say what is measured

## Context

[ADR 0015](0015-verification-and-releases.md) gives every package a size budget per entry point. Every repository implements it the same way: the brotli size of the entry's built file and the chunks it loads, as the build writes them. The builds are unminified on purpose, so that a host's bundler can tree-shake and minify them, so the budgets count unminified code.

The question came from review of [image-sdk#79](https://github.com/ie-huss-martinez/image-sdk/pull/79), which raised three budgets by 3 kB each: do the budgets count things that never reach a user, such as comments and long names, and should they measure minified code instead? That pull request measured its core at 23.57 kB as built and 18.00 kB minified.

Everything below was measured for this record, from each repository's local build, without changing it.

### Minified is a steady fifth less, in every package

Each entry with the chunks it loads statically, compressed with brotli at quality 11, as `size-limit` sums them. "Minified" is each file through esbuild's minifier.

| Package | Entry | As built | Whitespace removed | Minified | Minified is |
|---|---|---|---|---|---|
| sdk-core | headless | 15.57 kB | 14.24 kB | 12.18 kB | 22% less |
| sdk-core | element | 2.78 kB | 2.45 kB | 2.20 kB | 21% less |
| ui | server-safe | 11.43 kB | 10.58 kB | 9.27 kB | 19% less |
| ui | React | 24.28 kB | 22.10 kB | 20.42 kB | 16% less |
| pdf-sdk | core | 14.78 kB | 13.54 kB | 11.92 kB | 19% less |
| pdf-sdk | React | 23.51 kB | 21.25 kB | 18.87 kB | 20% less |
| audio-sdk | core | 23.36 kB | 21.17 kB | 18.66 kB | 20% less |
| audio-sdk | React | 38.83 kB | 35.13 kB | 31.48 kB | 19% less |
| audio-sdk | element | 39.88 kB | 35.99 kB | 32.20 kB | 19% less |
| video-sdk | core | 20.67 kB | 18.89 kB | 16.99 kB | 18% less |
| video-sdk | React | 34.55 kB | 31.44 kB | 27.95 kB | 19% less |
| video-sdk | element | 35.75 kB | 32.42 kB | 28.76 kB | 20% less |
| image-sdk | core | 27.14 kB | 25.00 kB | 21.57 kB | 21% less |
| image-sdk | React | 53.94 kB | 48.93 kB | 43.39 kB | 20% less |
| image-sdk | element | 54.94 kB | 49.72 kB | 44.05 kB | 20% less |
| learn-sdk | core | 15.68 kB | 14.18 kB | 12.44 kB | 21% less |
| learn-sdk | React | 14.28 kB | 12.81 kB | 11.37 kB | 20% less |

The as-built numbers reproduce each repository's own `size-limit` output where it has one, such as sdk-core's 15.57 kB and audio-sdk's 23.36 kB. They were measured at sdk-core 6eadcfe, ui 917a4a9, pdf-sdk b992a00, audio-sdk 785d2fc, video-sdk 6cafcc7, image-sdk d97a998 and learn-sdk e2afec8.

- **The ratio barely varies:** 16% to 22% across 17 entries of very different size and content. About 8 points of it are whitespace, and the rest is local names and syntax.
- **So the two measures move together.** image-sdk#79's growth was 3.08 kB as built and 2.27 kB minified, 26% less. A change that grows one grows the other in proportion, and a budget on either catches the same changes.

### Comments don't count

The build already drops them. A comment added to sdk-core's source in [#134](https://github.com/ie-huss-martinez/sdk-core/pull/134) isn't in the built file, and neither is any TSDoc. The only comment lines in a built file are the bundler's own markers, one per source module, such as `// src/messages/intl.ts`: 27 lines of sdk-core's 1,711. Removing every comment from the built files changes the sizes above by 0% to 3%.

So the premise that documentation counts against a budget is wrong for these builds. image-sdk's 3 kB was code.

### What the as-built measure does count, that users never get

- **Indentation and line breaks,** which the bundler writes itself. They're about 8% of every entry, and no source change affects them.
- **The module markers,** a few hundred bytes.
- **The length of local names.** Renaming one local variable in sdk-core's worker client from `current` to `currentWorkerConnection` grew the headless entry by 62 bytes as built, and by nothing minified (12,183 bytes before and after).

The last is the only way the measure can push code the wrong way: a contributor near a budget could shorten names to fit. It costs tens of bytes a name, against budgets raised in steps of 0.5 kB or 1 kB.

### What applications ship is a different question

No application ships a whole entry. Its bundler keeps what it imports. `ui`'s [ADR 0012](https://github.com/ie-huss-martinez/ui/blob/main/docs/adr/0012-size-budgets-per-import.md) measured that: the largest editor ships 39% of what `ui`'s React entry budget counts, and it noted that "the minified whole-entry number has the same blind spot as the unminified one". `ui` and audio-sdk already have a second kind of budget for it: an application's import, bundled and minified. Those are minified today.

## Options

**A. Keep measuring the built files, and write down what that means.** The entry budget is a ceiling: an upper bound on anything an application can ship from the entry, about a fifth above its minified size. No repository changes. The cost is the name-length effect above, and a number that isn't what ships.

**B. Measure the entries minified.** `sdk-config` would provide a helper that minifies each built file and hands `size-limit` the copies, and every repository would switch to it and reset its budgets, to about 80% of today's.
- **Gain:** the number is what a host that imported the whole entry would ship, and names stop counting.
- **Cost:** every budget in every repository is reset in a pull request each, and a minifier becomes part of the measurement, so an esbuild update can move every number by a few bytes with no change of ours. The budgets would catch exactly what they catch today.

**C. Measure the entries bundled and minified,** with `@size-limit/esbuild`. It's what the import budgets do. For a whole entry it also bundles the entry's dependencies unless each is listed to ignore, so the number changes meaning as well as size, and it differs from B only where the entry's own chunks tree-shake against each other.

**D. Budget the built files, and report the minified size beside them.** The ceiling stays as it is. A pull request that raises one quotes both numbers, as image-sdk#79 did by hand, from a shared command instead of each author's script.

## Decision

**Option A: the budgets keep measuring the built files, and this record says what that counts. Two additions come with it.**

The question assumed that comments count against a budget. They don't: the build drops them. What separates the built size from the minified one is a constant factor that every entry shares. Switching measures (B) would change every number and catch nothing new, for a pull request in each repository and a minifier in the loop.

- **An entry budget is a ceiling, measured on the built files:** the brotli size of the entry and the chunks it loads statically. It bounds what any application can ship from that entry, and is about a fifth above the entry's minified size. Lazy chunks have budgets of their own.
- **A budget is never met by shortening names or restructuring for the measure.** A pull request that needs more raises the budget, with a table of before and after and the reason, as today.
- **Size is judged where applications feel it:** in budgets for what an application imports, bundled and minified, as `ui` and audio-sdk have. Bringing those to every repository is the next decision, an amendment to ADR 0015 from `ui`'s ADR 0012 and audio-sdk's experience. It's the change that would have told image-sdk#79's reviewers what its 3 kB cost an application.

Two additions, in one `sdk-config` change:

1. **`sdk-config` provides the list of files an entry loads.** Three repositories carry the same function for it, `loadedFiles`, copied with a comment saying so. One shared helper for `.size-limit.js` ends the copies.
2. **`sdk-config` prints an entry's minified size,** for a pull request's table when the comparison helps. It's information only: it's never a budget, and it fails nothing.

## Alternatives considered

- **Dropping the entry budgets for import budgets only:** an import budget covers what its scenario imports. The ceiling is the only number that covers everything in an entry, including code no scenario reaches.
- **Building minified:** it would make the measure exact and the packages smaller on disk, but hosts' bundlers minify anyway, and unminified packages are readable in a debugger and in `node_modules`.
- **Counting gzip instead of brotli:** a different constant factor, for the same reasons.

## Consequences

- Nothing changes in any repository's budgets, and no budget is reset.
- The family's documents stop saying, or implying, that documentation costs size.
- The ceiling keeps overstating what ships by about a fifth, and a longer local name still costs it tens of bytes. Both are recorded here.
- Three repositories replace their copy of `loadedFiles` with `sdk-config`'s helper, when they next touch their size configuration.
