# 0010. React Native, memory exercises and forgiving answers

- **Status:** Accepted
- **Date:** 2026-11-27
- **Amends:** [ADR 0004](0004-dependencies-validators-and-fsrs.md), whose grading no longer needs `String.prototype.normalize`, and [ADR 0007](0007-player-and-editor-sessions.md), since a built-in type now rates its own items

## Context

learn-sdk's first application was a language course in a browser. Its second is Remindable, a React Native application that trains memory, in Spanish, English and Arabic, for older adults and people recovering from a brain injury. [sdk-core ADR 0069](../../../../docs/adr/0069-react-native-entry-points.md) says how a package of the family serves React Native. This record is what learn-sdk does about it, and what Remindable needed that the SDK lacked:

- **The core didn't run on Hermes.** Grading called `String.prototype.normalize`, the in-memory progress store called `structuredClone`, the `localStorage` adapter called `TextEncoder`, `loadClip` used `Blob`, and the editor session made ids with `crypto.getRandomValues`. An engine without one of them failed with a `TypeError`.
- **No way to keep progress on a phone.** The only adapter that persists is for `localStorage`, which is synchronous. React Native's AsyncStorage answers with promises.
- **Grading was exact.** That suits a quiz. It doesn't suit a person with word-finding problems who says "I think it's an apple", or types "aple": for them the question is whether they found the word.
- **No exercise for remembering.** The quiz types test what a learner knows now. Spaced retrieval, remembering a face's name or where the keys are kept over growing intervals, needs a type that rates its own items, and nothing computed which items are due.
- **`./react` can't be used there.** It reaches the DOM components, and Metro ships what an entry reaches.

## Decision

### The core runs on Hermes

Every use of a feature Hermes may lack is either replaced by plain ECMAScript or checked first:

| Was | Now |
|---|---|
| `normalize("NFC")` in grading and in comparing choices | Used where it exists. Without it, text is compared as typed, and a language profile's own rules do the work |
| `structuredClone` of progress snapshots | A plain deep copy of JSON data |
| `TextEncoder` to measure stored progress | The pure UTF-8 count the readers already used |
| `Blob` in `loadClip` | Checked: `UNSUPPORTED_ENVIRONMENT`, with `details.feature` `"Blob"` |
| `structuredClone` of an untrusted command | Checked: `UNSUPPORTED_ENVIRONMENT`, `"structuredClone"` |
| `crypto.getRandomValues` for a new exercise's id | Checked: `UNSUPPORTED_ENVIRONMENT`, `"crypto.getRandomValues"`. `newId` makes ids another way |

- **Leaving NFC out is a fallback, not a failure,** because failing would make grading unusable on such an engine, and the alternative is a rare wrong grade for one letter typed two ways. The built-in profiles below close that gap themselves. A host's own profile on such an engine should fold what its language needs.
- **`AbortController` is the one thing the core takes from React Native itself,** which sets it up beside Hermes. The player uses it to stop its saves.
- **A test runs the built core in a realm with the ECMAScript language and nothing else,** through sdk-config's `runInBareRealm`: reading content, grading, a whole session with FSRS-7 and the async store, and each `UNSUPPORTED_ENVIRONMENT` above. The helper was `ui`'s own test in ADR 0069; learn-sdk is the second package to need it, so it moved to sdk-config, as that record said it would.

### ts-fsrs on Hermes

`createFsrsScheduler` is unchanged. What's known about it on Hermes:

- **It runs in the bare realm,** with no `Intl`, no `normalize` and no host globals, and gives exactly the schedule Node gives, compared without a tolerance.
- **Hermes compiles it:** the Expo test application imports it, and `expo export` turns the bundle into Hermes bytecode.
- **It hasn't been executed on a Hermes virtual machine.** The workspace has Hermes's compiler and no runtime. ts-fsrs is arithmetic on numbers and `Date`, so the remaining risk is floating point that differs between engines. The scheduling conformance vectors compare within `1e-9` for that reason, and a device run of them is part of the check that takes `./native` out of experimental.

### `createAsyncProgressStore`

A `ProgressStore` over a storage the host passes in, of AsyncStorage's shape: `getItem`, `setItem` and `removeItem`, each returning a promise. learn-sdk depends on no storage package.

- **It behaves as the `localStorage` adapter does:** the same keys, `hm-learn-progress` documents, untrusted on the way back in, discarded with a reason when unreadable, and refused when too large to read back.
- **Saves to one scope take turns.** Each save reads, changes and writes. Two that overlapped would both read the same progress, and the second write would drop the first's change. A write that fails doesn't hold up the next.
- **It's in the core entry, not `./native`.** It uses nothing of React Native, and a web host with an asynchronous storage can use it too. ADR 0069 keeps in `.` what both platforms can use.

### Three language profiles

`spanishProfile`, `englishProfile` and `arabicProfile` are built in. Each is a `LanguageProfile` whose `normalizeAnswer` makes answers that a person would call the same compare equal:

- **Spanish and English:** without case, accents, apostrophes, punctuation or extra spaces. `ñ` reads as `n`, as a keyboard without it types.
- **Arabic:** without tashkeel or tatweel, and with the letters people write one for another unified: the forms of alef, ta marbuta and ha, alef maqsura and ya, and hamza on waw or ya as its seat.
- **They're tables and string operations, and nothing else** ([ADR 0004](0004-dependencies-validators-and-fsrs.md)): no `Intl`, no `normalize`, and no `toLowerCase`, whose tables are the engine's. Accented letters fold through a fixed table, and an accent typed as a combining mark is removed, so the result is the same with or without NFC. Letters outside the tables stay as they are.
- **They're forgiving on purpose.** A course that teaches where the accent goes shouldn't grade with them; it uses the default profile, or its own.

A profile may also carry `articles` and `stem`, which only the tolerant matcher reads.

### A tolerant matcher, which a host opts into

`matchTolerantly(given, accepted, { profile, maxDistance, others })` answers whether what a person said or typed contains an accepted answer, within an edit distance:

- **Every run of the answer's words is tried,** from one word fewer to one more than the accepted answer has, so a word wrapped in a sentence is found.
- **Articles are dropped and words stemmed** when the profile has `articles` and `stem`: conservative plural and ending rules, and for Arabic the attached article.
- **Distance is Levenshtein's, in code points, over the longer length.** The default limit is 0.25: one slip in four letters, so a word of three letters must be exact.
- **A rival wins.** With `others`, such as the other choices on screen, an answer that's closer to one of them isn't a match: "cat" doesn't pass for "cart" when "cat" was on offer.
- **A long answer stays cheap.** A run whose length alone puts it out of reach is never compared, so the cost follows the answer's length, not its square. Answers are untrusted and may be 2,000 code points.
- **Exact grading is untouched.** No exercise type matches tolerantly unless a host makes one that does. It's deterministic, so a server and a device still agree.
- **Alias lists stay with the application.** Which regional words name a picture is content, not a rule: an application lists them as accepted answers.

### Two exercise types

Both are data in `hm-learn-content` version 1, with their payloads in its schema, and conformance vectors.

**`recall`** is things to remember: items of `{ id, cue, answers, choices? }`, answered by picking, typing or saying.

- **It rates its own items.** `reviewItems` gives each item `good` when it was remembered and `again` when it wasn't, so with a scheduler the player keeps a card for each. [ADR 0007](0007-player-and-editor-sessions.md) kept ratings out of the quiz types, where a grade isn't a memory signal. Here remembering is the whole exercise, and there's no partial answer to map.
- **An item's `id` is its card's key.** It's unique in its exercise, which is checked. A scope has one card per id, so ids should be unique in everything a learner studies, which only the application can know.
- **`createRecallType({ tolerance })`** makes one that grades with the tolerant matcher, with the item's other choices as rivals. `recall` itself is exact. A host registers the same one on its server as on the device.

**`sequence-recall`** is the Corsi block-tapping task: `{ tiles, sequence, backward? }`, a board of 2 to 30 tiles and the order some of them light up in, each once. The answer is the tiles tapped back, forwards or in reverse.

- **Content holds the sequence,** so a session is graded the same anywhere. An application generates sequences and draws the board: where a tile sits, how long it's lit and how the span adapts are the application's.
- **Each tap in the right place scores,** and `grade.items` says which, so an application can replay the path from the first slip.
- **It rates no items.** It trains a span and holds nothing to remember later.

**Neither has a web player or editor block yet.** `LearnPlayer` and `LearnEditor` don't list them among their built-in types, so content with them reads there as an unknown type, as any host type does. Their blocks, with the keyboard, screen-reader and visual checks of [ADR 0005](0005-accessible-exercise-types.md), come when a web application needs them.

### `dueItems`

`dueItems(progress, now, { limit })` returns the cards due at `now`, longest overdue first, and cards due at the same moment in the order of their ids by code unit, so every runtime gives the same list.

### The `./native` entry

`@hussmartinez/learn-sdk/native` holds what needs React and can't come from `./react`:

- **`useLearnPlayer(options)`** creates the headless player for a component, disposes it with the component, and returns `{ player, snapshot, current, error, restart }`. The session is made again only when its content or settings change; its callbacks may change freely.
- **`usePlayerSnapshot(player)`** is the snapshot alone.
- **It draws nothing and has no text.** An application draws the current exercise with `@hussmartinez/ui/native` or its own views.
- **It imports nothing from `react-native`,** so learn-sdk doesn't list it as a peer. The entry is named for where it's used: it's the React layer that's safe there.
- **It's built on its own, and holds no copy of the core.** Its source imports the core entry, and the build leaves that as an import of the built `./index.js` beside it. An application imports both, and runs one copy of the session's code.
- **It's experimental,** as ADR 0069 says of every native entry, until an application has run it on a device.

## Alternatives considered

- **Fail with `UNSUPPORTED_ENVIRONMENT` when `normalize` is missing:** honest, and it would stop every exercise on such an engine for the sake of a letter typed two ways.
- **Make every type tolerant, with a setting:** a quiz would then pass spelling it was written to test. Tolerance is a property of the exercise an application builds, so the type takes it.
- **Tolerance as a field in the content:** it would travel with the content, but an author could then loosen grading that a host's server is meant to decide.
- **Keep the profiles in Remindable:** every application in those languages would copy the tables, and a server port would have nothing to conform to. They're small, and conformance vectors now pin them.
- **Use `Intl.Collator` or NFD for folding:** neither is on every engine, and collation differs between ICU versions ([ADR 0004](0004-dependencies-validators-and-fsrs.md)).
- **Put the async store in `./native`:** nothing in it is native.
- **Ship native player components:** they'd need text, and an opinion about how an exercise looks on a phone. The hooks and `ui`'s primitives are enough for the first application.
- **Bundle the core into the native entry,** as `ui`'s native entry bundles its few shared modules: an application would then hold two copies of the session and of ts-fsrs's caller.

## Consequences

- A React Native application can read content, grade it, schedule reviews and keep progress with learn-sdk, with no polyfill beyond what React Native sets up.
- The core entry grows from 16.6 to 20.3 kB, and its ceiling with it. An application ships what it imports: the import budgets for the existing scenarios move by a new message's 20 bytes and the guards' few dozen.
- `LanguageProfile` gains two optional members, `articles` and `stem`. A host's existing profile is unchanged.
- `LearnIssueCode` gains `repeated-tile`, with its text in the catalogue. A host that lists every code, such as in a test, adds it.
- Two more conformance subjects, `hm-learn-matching` and `hm-learn-due-items`, for a port to pass.
- The profiles' rules are frozen by those vectors: changing what one folds changes grades, and is reviewed as a change in behaviour.
- A screen-reader pass for the new types' web blocks is owed when those blocks are written, not now.
