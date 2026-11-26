# learn-sdk

A learning SDK: exercise types with their grading logic, a player and a teacher editor for each, spaced repetition, and course-based access, for language learning and beyond. Learners' answers and progress stay with the host application; the SDK makes no network requests of its own. It offers a headless core that also runs on servers, React components (`LearnPlayer`, `LearnEditor`) and a `<hm-learn-player>` custom element.

It's published as **`@hussmartinez/learn-sdk`**, from `packages/learn-sdk` in the family's repository. It follows the family standards in [`sdk-core`'s `STANDARDS.md`](https://github.com/ie-huss-martinez/sdk-core/blob/main/STANDARDS.md), and in particular the decisions on [hostile input and no network](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0012-hostile-input-and-no-network.md), [ports and adapters](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0008-ports-adapters-and-session.md) and [accessibility and translatable text](https://github.com/ie-huss-martinez/sdk-core/blob/main/docs/adr/0014-accessibility-and-translatable-text.md).

> Status: `0.x`, so the API may still change between minor versions. The player and the headless core are published; the editor is in progress.

## Teacher's editor

`LearnEditor`, from `@hussmartinez/learn-sdk/react`, lets teachers write exercises ([ADR 0008](docs/adr/0008-learn-editor.md)). It renders through `@hussmartinez/ui`'s editor frame, so import ui's stylesheet first, then this package's, and give the editor a height in your CSS.

```tsx
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/learn-sdk/styles.css";
import { isLearnError } from "@hussmartinez/learn-sdk";
import { LearnEditor, type LearnEditorHandle } from "@hussmartinez/learn-sdk/react";
import { useRef, useState } from "react";

const thai = { code: "th", direction: "ltr" } as const;

export function Editor({ content, save }: { content: unknown; save: (c: unknown) => Promise<void> }) {
  const editor = useRef<LearnEditorHandle>(null);
  // The editor opens valid content only, so it starts valid; onChange reports every edit after.
  const [valid, setValid] = useState(true);
  return (
    <>
      <LearnEditor ref={editor} initialContent={content} profile={thai} onChange={(_, problems) => setValid(problems.valid)} />
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          try {
            void save(editor.current?.getContent());
          } catch (error) {
            // Content the editor couldn't open, or a draft with problems: the editor shows why.
            if (!isLearnError(error)) throw error;
          }
        }}
      >
        Save
      </button>
    </>
  );
}
```

- **Saving stays yours.** `onChange(draft, { issues, valid })` reports every edit, undo and redo. The draft may be invalid while a teacher writes; save through the handle's `getContent()`, which commits any typing and returns validated `hm-learn-content`, or throws `INVALID_DOCUMENT` with every issue.
- **One exercise at a time:** with `single`, the editor edits a document of exactly one exercise, with no outline and no adding or removing. Empty content opens on a card per exercise type. A host that stores exercises one per row wraps a row in a one-exercise document and stores `getContent().exercises[0]`.
- **The language being taught:** `profile` gives its fields `lang` and `dir`, with spellcheck and autocorrect off. Typing is committed as one undo step per burst, and never while an input method is composing.
- **Your own exercise types:** pass an editor block per type in `blocks`, made with `defineEditorBlock({ edit, create })`. `edit` builds the whole payload; `create` is a new exercise's payload.
- **Preferences** (mode, theme, panels) are the frame's, controlled with `preferences` and `onPreferencesChange` or left to the editor, as in every family editor (sdk-core ADR 0067).
- **Text** comes from `learnEditorMessages`; override any of it with `messages`, typed as `MessageOverrides<LearnEditorMessageCatalogue>`.

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
