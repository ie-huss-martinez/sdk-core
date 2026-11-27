# learn-sdk

A learning SDK: exercise types with their grading logic, a player and a teacher editor for each, spaced repetition, and course-based access, for language learning and beyond. Learners' answers and progress stay with the host application; the SDK makes no network requests of its own. It offers a headless core that also runs on servers, React components (`LearnPlayer`, `LearnEditor`) and the editor's `<hm-learn-editor>` custom element.

It's published as **`@hussmartinez/learn-sdk`**, from `packages/learn-sdk` in the family's repository. It follows the family standards in [`sdk-core`'s `STANDARDS.md`](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md), and in particular the decisions on [hostile input and no network](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md), [ports and adapters](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md) and [accessibility and translatable text](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0014-accessibility-and-translatable-text.md).

> Status: `0.x`, so the API may still change between minor versions. The package root, `@hussmartinez/learn-sdk`, has the headless core (such as `createLearnEditor` and `gradeAnswer`); the React entry, `@hussmartinez/learn-sdk/react`, has the player (`LearnPlayer`) and the editor (`LearnEditor`); the element entry, `@hussmartinez/learn-sdk/element`, has the editor's custom element. The player's element is still to come. `@hussmartinez/learn-sdk/native` has the player as hooks for [React Native](#react-native), and is experimental.

## Teacher's editor

`LearnEditor`, from `@hussmartinez/learn-sdk/react`, lets teachers write exercises ([ADR 0008](docs/adr/0008-learn-editor.md)). It renders through `@hussmartinez/ui`'s editor frame, so import ui's stylesheet first, then this package's, and give the editor a height in your CSS.

```tsx
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/learn-sdk/styles.css";
import { isLearnError } from "@hussmartinez/learn-sdk";
import { LearnEditor, type LearnEditorHandle } from "@hussmartinez/learn-sdk/react";
import { useEffect, useRef, useState } from "react";

const thai = { code: "th", direction: "ltr" } as const;

export function Editor({ content, save }: { content: unknown; save: (c: unknown) => Promise<void> }) {
  const editor = useRef<LearnEditorHandle>(null);
  // Save starts off, and turns on once the content opened: onChange reports edits, not the opening.
  const [valid, setValid] = useState(false);
  useEffect(() => {
    try {
      editor.current?.getContent();
      setValid(true);
    } catch {
      // The editor couldn't open the content, and shows why.
    }
  }, []);
  const [saveFailed, setSaveFailed] = useState(false);
  return (
    <>
      <LearnEditor ref={editor} initialContent={content} profile={thai} onChange={(_, problems) => setValid(problems.valid)} />
      <button
        type="button"
        disabled={!valid}
        onClick={async () => {
          let saved: unknown;
          try {
            saved = editor.current?.getContent();
          } catch (error) {
            // Content the editor couldn't open, or a draft with problems: the editor shows why.
            if (!isLearnError(error)) throw error;
            return;
          }
          try {
            await save(saved);
            setSaveFailed(false);
          } catch {
            setSaveFailed(true); // your own storage failed: say so, and keep the editor open
          }
        }}
      >
        Save
      </button>
      {saveFailed && <p role="alert">Saving failed. Try again.</p>}
    </>
  );
}
```

- **Saving stays yours.** `onChange(draft, { issues, valid })` reports every edit, undo and redo, not the opening: the example turns Save on once a first `getContent()` succeeds, which it does for any content the editor opened. The draft may be invalid while a teacher writes; save through the handle's `getContent()`, which commits any typing and returns validated `hm-learn-content`, or throws a `LearnError`: `INVALID_DOCUMENT` with every issue, a limit's code such as `TOO_MANY_CHOICES`, or the error that kept the editor from opening its content. Report your own storage's failures yourself, as the example does.
- **One exercise at a time:** with `single`, the editor edits a document of exactly one exercise, with no outline and no adding or removing. Empty content opens on a card per exercise type. A host that stores exercises one per row wraps a row in a one-exercise document and stores `getContent().exercises[0]`.
- **The language being taught:** `profile` gives its fields `lang` and `dir`, with spellcheck and autocorrect off. Typing is committed as one undo step per burst, after a pause that waits for an input method to finish composing. Commits that can't wait, such as `getContent()` and `flush()`, commit the text as it stands, so a host that saves mid-composition can get unfinished text.
- **Your own exercise types:** pass an editor block per type in `blocks`, made with `defineEditorBlock({ edit, create })`. `edit` builds the whole payload; `create` is a new exercise's payload.
- **Preferences** (mode, theme, panels) are the frame's, controlled with `preferences` and `onPreferencesChange` or left to the editor, as in every family editor (sdk-core ADR 0067).
- **Text** comes from `learnEditorMessages`; override any of it with `messages`, typed as `MessageOverrides<LearnEditorMessageCatalogue>`.

### The `<hm-learn-editor>` element

For a page without React of its own, `@hussmartinez/learn-sdk/element` has the same editor as a custom element ([ADR 0009](docs/adr/0009-learn-editor-element.md)). React and React DOM are still needed, as the package's optional peer dependencies. Importing the entry registers nothing: call `defineLearnEditorElement()` once.

```ts
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/learn-sdk/styles.css";
import {
  defineLearnEditorElement,
  type LearnEditorChangeDetail,
  type LearnEditorElementMethods,
  type LearnEditorElementProps,
} from "@hussmartinez/learn-sdk/element";

type LearnEditorElement = HTMLElement & LearnEditorElementProps & LearnEditorElementMethods;

defineLearnEditorElement();
const editor = document.querySelector<LearnEditorElement>("hm-learn-editor");
if (editor) {
  editor.profile = { code: "th", direction: "ltr" };
  editor.initialContent = content;
  editor.addEventListener("hm-learn-editor-change", (event) => {
    saveButton.disabled = !(event as CustomEvent<LearnEditorChangeDetail>).detail.valid;
  });
  saveButton.addEventListener("click", async () => save(await editor.getContent()));
}
```

- **Attributes:** `theme`, `locale`, `heading-level`, and `single` as a boolean attribute. Everything else, such as `initialContent`, `profile`, `limits`, `blocks` and `preferences`, is a property.
- **Other content:** setting `initialContent`, `single`, `types`, `limits` or `newId` to another value opens the editor afresh, with no history, as a new `key` does in React.
- **Methods:** `getContent()` returns a promise, unlike the React handle's: it waits for the editor to render, then resolves with the content or rejects with the same errors. `flush()`, `undo()` and `redo()` are as in React.
- **Events:** `hm-learn-editor-change` with `{ draft, issues, valid }`, `-event`, `-error` with `{ code, details }` for a refused command, and `-preferences`.

## React Native

learn-sdk's core runs on Hermes, React Native's engine, so an application there reads content, grades answers, schedules reviews and keeps progress with the same code as a server ([ADR 0010](docs/adr/0010-react-native-and-memory-training.md)). It needs no polyfill beyond what React Native sets up itself.

> **Experimental.** `@hussmartinez/learn-sdk/native` builds and passes learn-sdk's own checks, which run the built package in a realm with no `Intl`, no `String.prototype.normalize` and no DOM, and compile it with Hermes in an Expo application. It hasn't been run on a device yet. Until an application has, its API may change in any release, and this note stays.

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createAsyncProgressStore,
  createExerciseTypes,
  createFsrsScheduler,
  recall,
  type RecallPayload,
  spanishProfile,
} from "@hussmartinez/learn-sdk";
import { useLearnPlayer } from "@hussmartinez/learn-sdk/native";
import { ChoiceList } from "@hussmartinez/ui/native";

// Made once: a new one would start a new session.
const types = createExerciseTypes([recall]);
const progressStore = createAsyncProgressStore({ namespace: "my-app", storage: AsyncStorage });
const scheduler = createFsrsScheduler();

export function Session({ content, learnerId }) {
  const { player, current, error } = useLearnPlayer({
    content,
    types,
    profile: spanishProfile,
    progressStore,
    scope: learnerId,
    scheduler,
  });
  if (!player || !current) return <Problem error={error} />;
  const [item] = (current.exercise.payload as RecallPayload).items;
  // This content gives choices to pick from. An item without them is typed
  // or spoken: draw a text field, and pass what was typed the same way.
  if (!item.choices) return <TypedAnswer item={item} player={player} />;
  return (
    <ChoiceList
      accessibilityLabel={item.cue}
      choices={item.choices.map((choice) => ({ key: choice, label: choice }))}
      correctKey={current.status === "checked" ? item.answers[0] : undefined}
      onValueChange={(choice) => {
        player.answer({ recalled: [choice] });
        player.check();
      }}
    />
  );
}
```

- **`useLearnPlayer(options)`,** from `./native`, takes what `createLearnPlayer` takes and returns `{ player, snapshot, current, error, restart }`. It creates the session once for its content and settings, keeps `snapshot` and `current`, the exercise the learner is on, up to date, and disposes the session with the component. It draws nothing and has no text: use `@hussmartinez/ui/native` or your own views. `usePlayerSnapshot(player)` is the snapshot alone. Neither needs `react-native`, only React.
- **`createAsyncProgressStore({ namespace, storage })`** keeps progress in any storage of AsyncStorage's shape: `getItem`, `setItem` and `removeItem`, each returning a promise. learn-sdk depends on no storage package. It reads back what it stored as untrusted, as the `localStorage` adapter does, and saves to one scope take turns, so two that overlap lose nothing.
- **`dueItems(progress, now, { limit })`** returns the cards due for review, longest overdue first.
- **Language profiles:** `spanishProfile`, `englishProfile` and `arabicProfile` compare answers without case, accents, punctuation or extra spaces, and in Arabic without tashkeel and with the forms of alef, ta marbuta and alef maqsura unified. They're fixed tables, with no `Intl`, so they grade the same on every engine. They're forgiving on purpose: a course that teaches where an accent goes should use its own profile.
- **`matchTolerantly(given, accepted, { profile, maxDistance, others })`** finds an accepted answer inside what someone said or typed, forgiving an article, a plural or one slip in four letters, and refusing an answer that's closer to one of `others`. No exercise type uses it unless you ask: `createRecallType({ tolerance: DEFAULT_MATCH_DISTANCE })`.
- **Two exercise types for memory:**
  - **`recall`:** items of `{ id, cue, answers, choices? }`, answered by picking, typing or saying. With a scheduler, the player keeps a card per item, rated `good` when it was remembered and `again` when it wasn't.
  - **`sequenceRecall`:** `{ tiles, sequence, backward? }`, the Corsi block-tapping task. The answer is `{ taps }`, and `expectedTaps(payload)` is the order to tap in. Your application draws the board and makes the sequences.

  Neither has a block in `LearnPlayer` or `LearnEditor` yet.
- **What isn't there on Hermes says so:** `loadClip`, the `localStorage` adapter, `applyLearnCommand` and the editor session's default ids need `Blob`, `localStorage`, `structuredClone` and `crypto.getRandomValues`. Where one is missing, they throw `LearnError` with `UNSUPPORTED_ENVIRONMENT` and `details.feature` naming it.
- **`ts-fsrs` there:** `createFsrsScheduler` gives exactly Node's schedule in learn-sdk's bare-realm test, and Hermes compiles it. It hasn't been executed on a Hermes runtime in learn-sdk's own checks.

## Development

This folder is the published package, laid out as in the family's [standard layout](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md#repository-layout): the source is in [`src`](src). It also holds the test applications ([ADR 0039](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0039-test-applications-in-each-repository.md)): [`examples/vite`](examples/vite) and [`examples/next`](examples/next), which run the built player under a strict Content Security Policy, the second rendered on the server, and the [`e2e`](e2e) Playwright suite that tests them. They're also where the [screen-reader pass](docs/testing/screen-reader-pass.md) is done before a release.

You need Node 24 (see [`.node-version`](.node-version)) and pnpm. The exact pnpm version is pinned in `package.json`, and pnpm switches to it automatically.

```sh
pnpm install       # also installs the git hooks
pnpm verify:fast   # the subset the pre-push hook runs
pnpm verify        # everything CI runs; it needs Docker for the browser tests
```

Browser tests, the end-to-end tests and the screenshots run in the pinned browser image of `ci/Dockerfile`, as CI's do, through `hm-in-image` ([sdk-core ADR 0049](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0049-local-browser-tests-in-the-pinned-image.md)), so they need Docker and no browsers on the machine. `CI=1 pnpm verify` or `pnpm test:browser:all` runs all three engines, as CI does.

`pnpm verify` runs, in order:

| Step | Script | Tool |
|---|---|---|
| Format, lint and hidden characters | `lint` | Biome, with the family's abort-listener rule, and `hm-check-hidden-unicode` |
| CSS rules | `lint:css` | stylelint, with the `hm-` namespace and token rules |
| Types | `typecheck` | TypeScript |
| Dependency rules | `lint:deps` | dependency-cruiser, through `hm-lint-deps` |
| Build | `build` | Vite, then api-extractor for the type declarations |
| Unit tests | `test` | Vitest |
| Browser tests | `test:browser` | Vitest in Chromium, and in Firefox and WebKit too in CI |
| Example builds | `build:examples` | Vite and Next.js, on the workspace's build of the package |
| End-to-end tests | `test:e2e` | Playwright, against the built examples, in Chromium, and all three engines in CI |
| Screenshots | `test:visual` | Playwright, the player's states in light and dark, compact and comfortable, in the pinned image ([ADR 0048](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0048-visual-regression-for-sdk-editors.md)), compared strictly: a pixel fails when its colour is further from the baseline's than one level (1/255) on every channel, by Playwright's perceived-colour (YIQ) distance, and pixels Playwright classifies as anti-aliasing aren't compared ([ADR 0054](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0054-visual-comparison-tolerance.md)); `pnpm test:visual:update` rewrites only the baselines that changed |
| Size budgets | `check:size` | size-limit: a ceiling for each entry point, and budgets for what an application ships when it imports part of one, bundled and minified ([ADR 0056](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0056-size-budgets-for-what-applications-import.md)) |
| API reports | `check:api` | api-extractor, one report per entry point in [`api`](api) |
| Package checks | `check:package` | publint and Are the Types Wrong? |

The configuration extends the shared presets in [`@hussmartinez/sdk-config`](https://www.npmjs.com/package/@hussmartinez/sdk-config). The git hooks ([ADR 0016](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0016-git-hooks-and-merge-guards.md)) run automatically: a secret scan, a hidden-character check and lint of staged files on commit, a Conventional Commits check of the message, and `pnpm verify:fast` on push. The hooks are the local bar, and CI, which runs the full `pnpm verify` on every push, is the merge gate ([ADR 0053](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0053-ci-is-the-merge-gate.md)).

When a change alters the public API on purpose, update the reports with `pnpm api:update` and commit them.

## Contributing

Read [`CONTRIBUTING.md`](../../CONTRIBUTING.md) before opening a pull request. Coding agents also start with [`AGENTS.md`](../../AGENTS.md). Everyone taking part follows the [code of conduct](../../CODE_OF_CONDUCT.md). Report vulnerabilities privately, as described in the [security policy](../../SECURITY.md).

## License

[Apache-2.0](LICENSE)
