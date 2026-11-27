---
"@hussmartinez/learn-sdk": patch
---

learn-sdk runs on React Native, and gains what a memory-training application needs. Everything is additive.

- **The core runs on Hermes.** Grading no longer needs `String.prototype.normalize`: without it, text is compared as typed, and the language profile's rules do the work. The in-memory and `localStorage` progress stores no longer need `structuredClone` or `TextEncoder`. `loadClip`, `applyLearnCommand` and the editor session's default ids now throw `LearnError` with `UNSUPPORTED_ENVIRONMENT`, and `details.feature` naming it, where `Blob`, `structuredClone` or `crypto.getRandomValues` is missing.
- **`@hussmartinez/learn-sdk/native`,** experimental: `useLearnPlayer(options)` and `usePlayerSnapshot(player)`, the headless player as hooks, with no DOM and no text. They need React only.
- **`createAsyncProgressStore({ namespace, storage })`** keeps progress in a storage of AsyncStorage's shape, passed in.
- **`dueItems(progress, now, { limit })`** returns the cards due for review.
- **`spanishProfile`, `englishProfile` and `arabicProfile`:** language profiles that compare answers without case, accents, punctuation or, in Arabic, tashkeel and letter variants, with no `Intl`.
- **`matchTolerantly`, `editDistance` and `DEFAULT_MATCH_DISTANCE`:** forgiving matching, which no exercise type uses unless you ask for it.
- **Two exercise types,** in `hm-learn-content` version 1's schema: `recall`, which rates its own items for spaced repetition, with `createRecallType({ tolerance })` for forgiving grading, and `sequenceRecall`, with `expectedTaps`. `LearnPlayer` and `LearnEditor` have no blocks for them yet.

`LanguageProfile` gains two optional members, `articles` and `stem`, which only `matchTolerantly` reads. `LearnIssueCode` gains `repeated-tile`, with its text in `learnMessages`: a hand-written list of every code, such as in a test, must add it.
