# Standards for the `@hussmartinez` SDK family

These rules apply to `sdk-core`, `ui`, `ai-core` and every `<kind>-sdk` repository. Each rule links to the architecture decision record (ADR) that explains it. When a rule and an ADR disagree, the newest accepted ADR wins, and this file must be corrected.

## Repositories and packages ([ADR 0002](docs/adr/0002-one-repository-per-sdk.md), [ADR 0024](docs/adr/0024-github-organisation-for-the-sdk-family.md), [ADR 0035](docs/adr/0035-ai-core-and-host-configured-network.md))

| Repository | Publishes | Role |
|---|---|---|
| `ie-huss-martinez/sdk-core` | `@hussmartinez/sdk-core` | Headless shared runtime: worker messaging, errors, session primitives, tool registry, custom-element base, file policy, messages helper |
| | `@hussmartinez/sdk-config` | Shared tsconfig, Biome, stylelint, dependency-cruiser, api-extractor, commitlint, lint-staged and secretlint presets |
| `ie-huss-martinez/ui` | `@hussmartinez/ui` | Design system: tokens, themes, base styles, shared React components |
| `ie-huss-martinez/ai-core` | `@hussmartinez/ai-core` | Headless AI provider layer: message model, provider adapters, errors, server handler and browser transport. Renders nothing, and is the only package with network code |
| `ie-huss-martinez/<kind>-sdk` | `@hussmartinez/<kind>-sdk` | One kind: media such as `pdf`, `image`, `video` and `audio`, or another product area such as `chat` |
| `ie-huss-martinez/sdk-ci` | (none: GitHub Actions) | The family's shared CI and release steps, as versioned composite actions ([ADR 0026](docs/adr/0026-share-ci-steps-from-sdk-ci.md)) |

The repositories live in the `ie-huss-martinez` GitHub organisation, and the npm scope is `@hussmartinez`. `pnpm create-sdk-repo <name>` in `sdk-core` creates a repository and keeps its GitHub settings, environments, branch protection and required checks to the family's (CONTRIBUTING.md, "Setting up a new repository"). Everything specific to one kind stays in that SDK. `sdk-core` and `ui` stay small and stable. AI provider code lives in `ai-core`, never in `sdk-core`.

## Naming ([ADR 0003](docs/adr/0003-hm-namespace.md))

| What | Pattern | Example |
|---|---|---|
| Package | `@hussmartinez/<kind>-sdk` | `@hussmartinez/pdf-sdk` |
| React editor | `<Kind>Editor` | `PdfEditor` |
| Core contracts | `<Kind>Engine`, `<Kind>Processor`, `<Kind>Error` | `PdfProcessor` |
| Custom element | `<hm-<kind>-editor>` | `<hm-pdf-editor>` |
| DOM events | `hm-<kind>-editor-<name>` | `hm-pdf-editor-change` |
| Root class | `.hm-<kind>-editor` | `.hm-pdf-editor` |
| SDK classes | `.hm-<kind>-<part>`, variants `--<variant>` | `.hm-pdf-thumb--selected` |
| Shared `ui` classes | `.hm-<part>` | `.hm-button` |
| Custom properties | `--hm-*`, SDK-specific `--hm-<kind>-*` | `--hm-color-accent` |
| Data attributes | `data-hm-*` | `data-hm-theme` |
| Error codes | `SCREAMING_SNAKE_CASE`, stable once released | `FILE_TOO_LARGE` |

Everything that reaches the page starts with `hm-`. States use ARIA attributes, then `data-hm-*`. Never use generic state classes such as `.is-active`.

## Package shape ([ADR 0004](docs/adr/0004-entry-points-and-module-format.md), [ADR 0036](docs/adr/0036-ui-as-a-dependency-of-the-sdks.md))

| Entry | Contents |
|---|---|
| `.` | Headless core. No React, no DOM access on import, server-safe |
| `./react` | Editor, building blocks and hooks. Starts with `"use client"` |
| `./element` | `define<Kind>EditorElement()`, built with `sdk-core/element`'s `createEditorElement`. Registers nothing on import, and renders into the light DOM ([ADR 0040](docs/adr/0040-editor-element-base.md)) |
| `./styles.css` | All styles. Imported once by the application |
| `./standalone` | Self-contained script for plain HTML pages. Adopts one shared copy of `ui`'s styles per `ui` minor ([ADR 0040](docs/adr/0040-editor-element-base.md)) |

- **Module format:** ESM only, with `"type": "module"`, `types` first in every `exports` condition, and `"sideEffects": ["**/*.css"]`.
- **Peer dependencies:** `react` and `react-dom` are optional, `>=18.3`.
- **`@hussmartinez/ui`:** a regular dependency of every SDK, on the current minor (`^0.N.0` during `0.x`), imported only by `features/`, `react/` and `element/`. Applications that use `ui` themselves depend on the same minor, so there's one copy; `ui` warns in development when there are two.
- **No CSS from JavaScript:** library code never imports CSS.

## React API

Every SDK offers four layers:

| Layer | Example |
|---|---|
| Full editor | `<PdfEditor />` |
| Building blocks | `<PdfViewer>`, `<PdfThumbnails>`, `<PdfToolbar>` |
| Hooks | `usePdfSession()`, `usePdfDocument()` |
| Headless core | No React |

Every editor accepts the same configuration props:

| Prop | Purpose |
|---|---|
| `file` + `onChange`, or `initialFile` | Controlled or uncontrolled document |
| `onEvent` | Anonymous usage events. Never file names or contents |
| `engine`, `processor` | Replace the default adapters |
| `assetsUrl` | Where the host serves the package's `dist/assets/`, to self-host workers and WebAssembly ([ADR 0011](docs/adr/0011-worker-messaging-and-assets.md), [ADR 0038](docs/adr/0038-self-hosted-assets-and-worker-version.md)). In an SDK that maps the `hm-self-hosted` resolve condition, which its README says, a host that sets it in its bundler builds without the inlined copies ([ADR 0060](docs/adr/0060-leaving-inlined-workers-out-of-a-self-hosted-build.md)) |
| `filePolicy` | Resource limits ([ADR 0012](docs/adr/0012-hostile-input-and-no-network.md)) |
| `tools`, `toolbar`, `features` | Which tools exist, their order and grouping, and which capabilities are on |
| `theme` | Theme object or `"light"`, `"dark"` or `"system"` |
| `className`, `classNames` | Extra classes on the root and on each named part |
| `unstyled` | Drop visual styles, keeping layout and accessibility |
| `messages`, `locale` | Text overrides and formatting locale |
| `icons` | Replace any or all icons |

Programmatic control goes through a ref handle, such as `open(file)`, `export()` and `undo()`. Refs use `forwardRef`.

## Styling and theming ([ADR 0005](docs/adr/0005-plain-css-with-cascade-layers.md), [ADR 0006](docs/adr/0006-design-tokens-and-theming.md), [ADR 0036](docs/adr/0036-ui-as-a-dependency-of-the-sdks.md))

- **Plain CSS** in the layer order `@layer hm.tokens, hm.base, hm.components, hm.sdk;`. SDKs write only into `hm.sdk`.
- **One copy of `ui`'s stylesheet:** hosts import `@hussmartinez/ui/styles.css` once, before the SDKs' stylesheets. It's required for every surface that renders `ui`'s components, whose focus rings and target sizes live there. An SDK's `styles.css` never bundles or `@import`s it, and a custom element never ships its own copy.
- **No global selectors.** Nothing targets `html`, `body`, `*` or bare elements outside a component root.
- **No literal values.** Colours, lengths, durations, shadows, z-indexes and font values come from `--hm-*` tokens. stylelint enforces this.
- **Three token levels:** base scale, then semantic, then component. Components use only semantic and component tokens.
- **Theming:**
  - built-in themes follow the system by default;
  - `data-hm-theme` and `data-hm-density` attributes override per subtree;
  - `createTheme`, `ThemeProvider` and `themeToCss` handle custom themes;
  - applications can override every token.
- **Responsive layout:** container queries rather than viewport media queries.
- **Motion:** a reduced-motion fallback for every animation.
- **Icons:** they use `currentColor`.
- **Fonts:** never fetched.

## Server rendering ([ADR 0007](docs/adr/0007-server-rendering-and-nextjs.md))

- No browser APIs at import time or during render. Heavy dependencies load with dynamic `import()` after mount.
- Server and client render identical markup: IDs come from `useId`, and nothing in render depends on time or randomness.
- `"use client"` is kept in built React entries, and a test verifies it.
- Every repository's end-to-end tests run against its own Next.js and Vite applications in `examples/`, required before its first release with a React layer or custom element ([ADR 0039](docs/adr/0039-test-applications-in-each-repository.md)).

## Architecture ([ADR 0008](docs/adr/0008-ports-adapters-and-session.md), [ADR 0009](docs/adr/0009-features-as-tools.md), [ADR 0010](docs/adr/0010-edits-as-commands.md), [ADR 0011](docs/adr/0011-worker-messaging-and-assets.md), [ADR 0017](docs/adr/0017-core-errors-and-shared-runtime-imports.md))

- **Ports and adapters:**
  - the core defines ports, such as `PdfEngine` and `PdfProcessor`;
  - an SDK that needs AI defines its own provider port, such as `AiProvider` with `complete()` and `stream()` taking an `AbortSignal`, with a fake and contract tests; hosts pass a provider from `ai-core` or their own backend ([ADR 0035](docs/adr/0035-ai-core-and-host-configured-network.md));
  - adapters implement them and run in workers;
  - every core layer may import `@hussmartinez/sdk-core`, but never `@hussmartinez/ui`, `react` or `react-dom`, and neither may `adapters/` or `workers/`. Nothing the `.` entry reaches may import React or `ui`'s React entry, even as types; it may reach `ui`'s server-safe root entry through `features/` ([ADR 0036](docs/adr/0036-ui-as-a-dependency-of-the-sdks.md));
  - `core/errors` is a leaf: it imports only `core/model` and `@hussmartinez/sdk-core`, and every layer may import it;
  - the dependency rules are enforced with `dependency-cruiser`.
- **Framework-agnostic session:** the store exposes `getSnapshot()`, `subscribe()` and commands. React binds with `useSyncExternalStore`, and the element binds to the same store. Sessions build on `sdk-core`'s `createStore`, `createHistory` and `Reducer` ([ADR 0029](docs/adr/0029-session-store-and-history.md)).
- **Tools:**
  - every feature is a folder under `src/features/<feature>/`, registered with `defineTool`;
  - toolbars, menus and shortcuts are built from the registered tools, with `createToolRegistry` and `createShortcutRegistry` from `sdk-core`, and unknown tool ids fail when the editor is created ([ADR 0030](docs/adr/0030-tools-and-keyboard-shortcuts.md)).
- **Commands:**
  - every edit is a serialisable command;
  - the session provides undo, redo and grouping within a memory budget, with `sdk-core`'s history and each SDK's own memory policy ([ADR 0029](docs/adr/0029-session-store-and-history.md));
  - destructive actions offer undo instead of confirmation.
- **Workers** ([ADR 0018](docs/adr/0018-worker-rpc-protocol.md)):
  - typed, versioned RPC from `sdk-core`, with cancellation, progress and error codes preserved;
  - caller buffers are copied unless `transfer: true`, and results are transferred, except views into part of a buffer, which are copied;
  - a call that can't be stopped terminates its worker, other calls on it fail with `WORKER_TERMINATED`, and none are retried automatically;
  - `exposeWorker` runs before any heavy initialisation, and WebAssembly loads lazily;
  - an engine's own worker protocol, such as pdf.js's, is allowed when it can't be replaced, if its adapter gives callers the same guarantees: copied inputs, abort, time limits, termination, error codes and managed lifetimes, with contract tests for each ([ADR 0028](docs/adr/0028-third-party-engines.md)).
- **Errors:** one `SdkError` subclass per SDK, with a stable `code`, `details` and `cause`. User-facing text comes from messages, never from error text.
- **Contract tests:** every adapter passes the contract-test suite for its port.

## Portable formats and conformance ([ADR 0045](docs/adr/0045-portable-formats-and-conformance-vectors.md))

- **Formats:** every persisted or exchanged format is versioned JSON, `{ "format": "hm-<kind>-<thing>", "version": N, … }`, with a JSON Schema at `formats/<format>/v<N>.schema.json`. A breaking change bumps the version and ships a migration, so every earlier version stays readable.
- **Binary data** is a content-addressed asset reference (`sha256:`), never inline. Source names are recorded only if the user opts in.
- **Numbers:** integers wherever the model uses them, fixed integer grids for fractional positions, exact copies of floats that are only copied, and stated tolerances for computed floats. Anything hashed across languages uses RFC 8785 JSON canonicalisation.
- **Conformance vectors:** each SDK keeps `conformance/`, JSON cases of its deterministic logic that its own tests run. Rejections are checked by error code and `details.reason`, never message text.
- **Shared rejection codes:** `UNSUPPORTED_FORMAT` (`unknown-format`, `unknown-format-version`), `INVALID_DOCUMENT` and `INVALID_COMMAND`. Schemas and readers are strict, refusing unknown fields, and vectors include hostile keys (`__proto__`, `constructor`, `toString`). `formats/` ships in each package; `conformance/` doesn't. Length limits count Unicode code points (`[...text].length`, as `maxLength` does), never UTF-16 units.

## Security and privacy ([ADR 0012](docs/adr/0012-hostile-input-and-no-network.md), [ADR 0020](docs/adr/0020-file-policy.md), [ADR 0028](docs/adr/0028-third-party-engines.md), [ADR 0035](docs/adr/0035-ai-core-and-host-configured-network.md), [ADR 0051](docs/adr/0051-clean-file-names.md))

- **Treat every file as hostile** ([ADR 0020](docs/adr/0020-file-policy.md)):
  - parse only in workers, except with a browser decoder that only exists on the page, such as `decodeAudioData`, and then only for files a worker has probed and bounded, with the decoded output checked against that bound ([ADR 0031](docs/adr/0031-platform-decoders-on-the-page.md));
  - enforce limits on size, count, pixels, decoded size and time, with `defineLimits` from `sdk-core`, extending `coreLimits` with the SDK's own;
  - check before or while decoding, failing with specific error codes and `details` naming the limit, and warning from each limit's warning threshold;
  - hosts configure limits through `filePolicy`, and unknown limit names are an error.
- **Harden parsers:**
  - no code is generated from file data: a build test fails if any built engine chunk contains `eval(` or `new Function`, and the documented CSP never needs `'unsafe-eval'` ([ADR 0028](docs/adr/0028-third-party-engines.md));
  - engine options that enable code generation or scripting are off, such as pdf.js's scripting and XFA;
  - link protocols are allowlisted;
  - links get `rel="noopener noreferrer"`.
- **Never insert file-derived strings as HTML.** Sanitise SVG, or display it only through `<img>`.
- **A file's name is hostile input too** ([ADR 0051](docs/adr/0051-clean-file-names.md)):
  - clean it once, where it enters the SDK, with `cleanFileName` from `sdk-core`, and store and expose only the clean name;
  - a name a host gives, such as a download name, is cleaned the same way;
  - a clean name is text content or a download's name, never markup, a parsed attribute or part of a URL, and it never reaches `onEvent`. A test opens files with distinctive names and asserts that no event contains them.
- **No network requests** by default. End-to-end tests fail on any request to an origin the test didn't configure.
  - No `@hussmartinez` SDK, and neither `sdk-core` nor `ui`, makes any request.
  - None of them imports `@hussmartinez/ai-core`, for code or types: the `sdk-config` dependency-cruiser preset forbids it, with no opt-in. An SDK that needs AI defines its own provider port, and the host passes a provider ([ADR 0035](docs/adr/0035-ai-core-and-host-configured-network.md)).
  - `ai-core` is the only package with network code. It requests only endpoints the host configures, and only for calls the host or the user started. A unit test proves that nothing is requested on import, event callbacks never carry prompts, outputs or keys, and the documented CSP limits `connect-src` to the host's endpoint.
- **AI secrets stay on the server** ([ADR 0035](docs/adr/0035-ai-core-and-host-configured-network.md)):
  - `ai-core`'s provider adapters run behind the host's request handler, and the browser talks only to the host's endpoint;
  - an adapter refuses to run in a browser unless the host passes `dangerouslyAllowBrowser: true`;
  - keys never reach an error's `message`, `details` or `cause`, serialised errors, event payloads or logs; `cause` never holds a request, headers or a raw response; request and response bodies stay out of `details`; a sentinel test covers every adapter's failure paths.
- **Provider responses and model output are hostile input** ([ADR 0035](docs/adr/0035-ai-core-and-host-configured-network.md)):
  - an SDK treats whatever its provider port returns as hostile, whichever provider the host passed;
  - `ai-core` limits response size, stream duration and idle time with `defineLimits`, failing with `RESPONSE_TOO_LARGE`, `STREAM_TIMEOUT` and `STREAM_IDLE`, and hosts set them through `limits`;
  - model output is displayed as text, or as a strict formatting subset rendered to elements, never as HTML, with no remote resources by default;
  - tool calls are never executed automatically: running one needs a host handler for its name, and a `maxSteps` limit;
  - `ai-core`'s tests replay recorded provider responses, SDKs test against their fake provider, and CI never calls a provider.
- **Third-party engines are proven offline** ([ADR 0028](docs/adr/0028-third-party-engines.md)): every data file an engine needs, such as character maps, fonts, colour profiles, decoders or models, comes from the SDK's asset provider, never from the engine's default URLs; fallbacks that load code by URL aren't bundled; unknown asset requests fail closed; and end-to-end fixtures exercise every data path the engines have.
- **A bundled engine is declared** ([ADR 0061](docs/adr/0061-bundled-engines-declared-to-the-dependency-rules.md)): an engine built into the package is an exactly pinned `devDependency` and nothing else. The SDK names it, and the one folder under `src/adapters/` or `src/workers/` that may import it, as a value or a type, with `sdk-config`'s `defineDependencyRules`, and runs `hm-check-bundled-engines` in `verify`.
- **Supply chain:**
  - minimal, justified dependencies;
  - committed lockfiles and allowlisted install scripts;
  - licence checks;
  - GitHub Actions pinned to commit SHAs;
  - trusted publishing with provenance;
  - `SECURITY.md` in every repository.

## Platform ([ADR 0013](docs/adr/0013-browser-and-react-support.md))

- **Browsers:** the last two major versions of Chrome, Edge, Firefox and Safari, on desktop and mobile. Builds target ES2022 and ship no polyfills.
- **Feature detection:** missing platform features fail with `UNSUPPORTED_ENVIRONMENT`, naming the feature.
- **React:** `>=18.3`, avoiding React 19-only APIs.

## Accessibility and text ([ADR 0014](docs/adr/0014-accessibility-and-translatable-text.md))

- **WCAG 2.2 AA:**
  - full keyboard support, with a keyboard alternative for every drag-and-drop;
  - visible focus;
  - native `<dialog>` with `showModal()`;
  - `aria-live` announcements for results;
  - target sizes of at least 24 px, and 44 px on touch;
  - an editor that renders headings in the page takes `headingLevel`, 2 to 6 and 2 by default, on its component, each exported part that renders a heading, and its element (`heading-level`), with `ui`'s `HeadingLevel` type and `Heading` component. Headings nested inside follow from it, one level down each and never past `<h6>`. A dialog's title keeps its own `<h2>`, with headings in its content from 3 ([ADR 0058](docs/adr/0058-heading-levels-in-editors.md)).
- **No inline text** ([ADR 0019](docs/adr/0019-message-catalogues.md), [ADR 0046](docs/adr/0046-ui-text-through-the-sdk.md), [ADR 0050](docs/adr/0050-error-text-by-reason-and-warning-text.md), [ADR 0059](docs/adr/0059-interface-text-outside-the-server-safe-entry.md)):
  - every visible string and accessible name comes from a typed message catalogue in `src/messages`, declared with `defineMessages`;
  - `<kind>Messages`, from `.`, includes `sdkCoreMessages` and holds only text for what code importing only `.` can produce and hands a host to show: errors, warnings, and any other such results the SDK's own record names. A test fails if it gains any other key;
  - interface text, tool labels included, lives in `src/messages/editor-en.ts`. `<kind>EditorMessages`, from `./react`, is the components' catalogue: `<kind>Messages`, `uiMessages` and the interface text. Its type, `<Kind>EditorMessageCatalogue`, is exported from `.`. A surface that isn't an editor uses its own name in both, such as `learnPlayerMessages` and `LearnPlayerMessageCatalogue`;
  - messages are plain text with `{name}` and `{name, format}` placeholders, plurals are `{ "$plural": … }` objects, and output is never markup;
  - hosts override them with `messages`, and numbers, sizes and dates use `Intl` for the `locale` the host passes;
  - an SDK that renders `ui`'s components builds one `Messages` object from that catalogue and passes it to `UiMessagesProvider`, so a host's overrides reach `ui`'s strings too; a test checks that the SDK's own keys don't collide with `sdkCoreMessages` or `uiMessages`;
  - error text comes from `messages.error()`, never from `error.message`: `errors.<CODE>.<reason>` when the error's `details.reason` has text of its own, and otherwise `errors.<CODE>`;
  - warnings have the shape `{ type: "limit", limit, actual }` or `{ type: <other> }`, and their text comes from `messages.warning()`: `warnings.<limit>` or `warnings.<type>`. SDKs add no text helpers of their own.
- **Automated checks:** `@axe-core/playwright` runs in every end-to-end suite.

## UX

- **Long operations** show progress, can be cancelled, and recover from errors with a clear next step.
- **Designed states:** empty, loading, error and success states are designed, never blank.
- **Shared shortcuts:** keyboard shortcuts are consistent across SDKs, through the shared shortcut registry ([ADR 0030](docs/adr/0030-tools-and-keyboard-shortcuts.md)). Shortcuts never take a field's or a control's own keys, and never the browser's page zoom (`Mod+=`, `Mod+-`, `Mod+0`).
- **Previews before downloads:** irreversible outputs, such as downloads of transformed files, show a preview or summary first when the result isn't obvious.

## Repository layout

Every `<kind>-sdk` repository follows this structure:

```text
<kind>-sdk/
├─ src/
│  ├─ core/
│  │  ├─ model/          domain types
│  │  ├─ operations/     commands
│  │  ├─ ports/          engine and processor interfaces
│  │  ├─ session/        store, history, events
│  │  └─ errors/
│  ├─ adapters/          port implementations, one folder each
│  ├─ workers/           worker entry points only
│  ├─ features/
│  │  └─ <feature>/      <feature>.operation.ts  <Feature>Tool.tsx
│  │                     <feature>.css  <feature>.messages.ts  *.test.ts
│  ├─ react/             editor shell, building blocks, hooks, providers
│  ├─ element/           custom element
│  ├─ messages/          en.ts  editor-en.ts
│  ├─ index.ts           core entry
│  ├─ react.ts           React entry
│  └─ element.ts         element entry
├─ e2e/                  Playwright suites
├─ examples/             next/  vite/  html/
├─ docs/adr/             SDK-specific decisions
├─ api/                  api-extractor report
├─ AGENTS.md
├─ SECURITY.md
├─ CONTRIBUTING.md
└─ README.md
```

- **Tests:** unit tests sit next to the code they test, as `*.test.ts`.
- **File names:** kebab-case for modules and PascalCase for React component files.
- **Exports:** one public entry file per subpath export. Deep imports into `src/` are not part of the API.

## Tooling

- **Runtime and package manager:** Node 24 and pnpm 12.
- **Build and language:** Vite 8 and TypeScript in strict mode.
- **Code checks:** Biome, stylelint and `dependency-cruiser`.
- **Source checks of the family's own** ([ADR 0052](docs/adr/0052-source-checks-for-hidden-characters-and-abort-listeners.md)), both from `sdk-config`:
  - no tracked text file holds a hidden character, such as a bidirectional override or a zero-width space: `hm-check-hidden-unicode` runs in `lint` and on every commit. Source writes them as escapes, and only test data is listed in `.hm-hidden-unicode-ignore`;
  - an `"abort"` listener is added only where the same function also checks the signal's `aborted`, because a listener on an aborted signal never fires: the Biome preset's `noUncheckedAbortListener` reports the rest. Prefer `AbortSignal.any()` to listening.
- **Tests:** Vitest, Playwright and `@axe-core/playwright`.
- **Playwright is pinned exactly to the browser test image's version:** `playwright` and `@playwright/test` move together with `ci/Dockerfile`, in one pull request, and `hm-check-playwright-image` runs in `verify` and `verify:fast` ([ADR 0025](docs/adr/0025-one-browser-test-image-in-one-place.md)).
- **Browser tests run in the pinned browser test image,** locally as in CI, through `sdk-config`'s `hm-in-image`, such as `"test:browser": "hm-in-image vitest run --project browser"`. On a host, Docker's network changes abort Chromium's requests ([ADR 0049](docs/adr/0049-local-browser-tests-in-the-pinned-image.md)).
  - every configuration that starts a browser lists `sdk-config`'s `testing/require-image` global setup: the browser project of `vitest.config.ts`, and `e2e/playwright.config.ts`. It refuses to start outside the image unless `CI` is set, and never runs for a unit project. `HM_ALLOW_HOST_BROWSER=1` lets a developer debug a headed browser on the host, and is never set by a script, a hook or a workflow;
  - `hm-in-image` passes only a fixed list of environment variables into the container, so a suite that reads another one asks for it in `sdk-config`.
- **Packaging and API:** `size-limit`, `api-extractor`, `publint` and `@arethetypeswrong/cli`.
  - Size budgets are ceilings, one per entry point, on the brotli size of the built entry and the chunks it loads statically, written with `sdk-config`'s `entryBudget`. They measure the files as built, which weigh a fifth to a quarter less minified. A budget is raised in the pull request that needs it, with a table, and never met by shortening names ([ADR 0055](docs/adr/0055-what-the-size-budgets-measure.md)).
  - Core and React entries also have import budgets, written with `sdk-config`'s `importBudget`: a floor (the cheapest real import), each export over about 2 kB on its own, and what a typical application imports, bundled and minified without `react`, the family's packages and lazy chunks. Review judges size by these. A floor is never raised, and no budget is raised for code its import doesn't use ([ADR 0056](docs/adr/0056-size-budgets-for-what-applications-import.md)).
  - Every entry point's api-extractor configuration extends `sdk-config`'s preset. A package with more than one entry point runs `hm-check-api-reports` after api-extractor, and never turns `ae-forgotten-export` off ([ADR 0033](docs/adr/0033-api-reports-for-several-entry-points.md)).
- **Visual regression:** every SDK's editor and element are compared with committed screenshots of their designed states, in light and dark and both densities, on Chromium inside the pinned browser test image. `pnpm test:visual` runs them and `pnpm test:visual:update` rewrites them, both only in that image, and an intentional visual change commits its new screenshots in the same pull request ([ADR 0048](docs/adr/0048-visual-regression-for-sdk-editors.md)).
  - no pixel may differ, and a pixel differs when its colour is further from the baseline's than one level on every channel is, by Playwright's perceived-colour distance: the preset's `threshold` is `0.0038`, never raised to make a test pass ([ADR 0054](docs/adr/0054-visual-comparison-tolerance.md));
  - `pnpm test:visual:update` keeps unchanged baselines byte for byte, so every changed image in a pull request is one its test calls different.
- **Component catalogue (`ui`):** Storybook 10 with the React and Vite builder, axe checks and stories run as Vitest browser tests ([ADR 0022](docs/adr/0022-storybook-for-the-component-catalogue.md)).
- **Test timeouts** ([ADR 0057](docs/adr/0057-test-timeouts.md)): every test configuration takes its limits from `sdk-config`'s `testing/timeouts`: 30 s for unit tests and their hooks, 60 s in Vitest's browser mode, and 60 s with 10 s assertions in Playwright. A timeout only catches a hang, so timing is asserted with the test's own clock. A test carries a limit of its own only for genuinely long work, with a comment saying why.
- **Git hooks:** Husky with lint-staged.

Each repository extends the presets in `@hussmartinez/sdk-config` instead of copying configuration.

## Workflow ([ADR 0015](docs/adr/0015-verification-and-releases.md), [ADR 0016](docs/adr/0016-git-hooks-and-merge-guards.md), [ADR 0021](docs/adr/0021-version-and-release-with-changesets.md), [ADR 0023](docs/adr/0023-verify-releases-in-an-unprivileged-job.md), [ADR 0053](docs/adr/0053-ci-is-the-merge-gate.md))

- **Verification:**
  - `pnpm verify` runs code checks, build, unit tests, browser tests, end-to-end and visual tests, size budgets, the API report and package checks;
  - `pnpm verify:fast` runs the one-minute subset: types, unit tests, dependency rules and the API report.
- **Git hooks** (Husky; budgets in ADR 0016):
  - `pre-commit` lints staged files, scans them for secrets and checks them for hidden characters;
  - `commit-msg` checks Conventional Commits;
  - `pre-push` runs `pnpm verify:fast`;
  - `--no-verify` is never used.
- **The hooks are the local bar, and CI is the merge gate** ([ADR 0053](docs/adr/0053-ci-is-the-merge-gate.md)):
  - a pull request needs nothing run locally beyond the hooks. The full `pnpm verify` and the browser suites are run locally to diagnose a failure, to reproduce one from CI, or to capture screenshots, not as a step before every pull request;
  - a pull request is ready when it's up to date with `main`, every required check is green on its current head, the automated review of that head has finished, and no review thread is open;
  - a failure that only shows in CI is real until its cause is found. It's never answered with a looser assertion, a retry or a rerun;
  - the description says what was run locally and what was left to CI.
- **CI:**
  - every pull request and push to `main` runs `pnpm verify`, with browser tests on Chromium, Firefox and WebKit, in the pinned Playwright image, read from its only copy in `ci/Dockerfile` ([ADR 0023](docs/adr/0023-verify-releases-in-an-unprivileged-job.md), [ADR 0025](docs/adr/0025-one-browser-test-image-in-one-place.md));
  - `verify` and `pr-title` are required checks, and branches must be up to date;
  - actions are pinned to commit SHAs, with least-privilege permissions, `pull_request` events only, and no secrets in pull request workflows.
  - the CI and release steps come from `sdk-ci`'s composite actions, pinned by SHA and updated by Dependabot. Each repository keeps its own job skeleton, with its permissions and environments, and `sdk-ci`'s `check-workflows` keeps it identical to the pinned version ([ADR 0026](docs/adr/0026-share-ci-steps-from-sdk-ci.md)).
- **Pull requests:**
  - every change goes through a small, focused pull request describing what changed, why, and how it was tested;
  - squash merges only, with linear history on `main`;
  - Conventional Commits, and pull request titles become commit titles;
  - commits are signed;
  - the author never merges: a separate reviewer checks the full diff against `STANDARDS.md` and the ADRs, requires green CI on the current head, and merges nothing "almost right";
  - CodeRabbit reviews every pull request, and again after each push. Its review of the current head has finished, and each thread it opened is fixed or answered, then resolved, before the merge;
  - coding agents open one pull request at a time, stop and report once it's green and its threads are resolved, and never review or merge their own; author and reviewer are always different sessions.
- **Agents' state** ([ADR 0053](docs/adr/0053-ci-is-the-merge-gate.md)):
  - the state of the task in hand lives in `.local/HANDOFF.md` in the checkout, which git ignores, kept current after every step so that another agent can take over;
  - what outlives the task lives in the maintainer's knowledge base, in the family's agent memory, not in a tool's private memory and not in the repository.
- **ADRs:** significant decisions get an ADR in the owning repository.
- **Versioning** ([ADR 0021](docs/adr/0021-version-and-release-with-changesets.md)):
  - semver, with `0.x` until the API settles, and each package versioned on its own;
  - during `0.x`, a change that breaks existing callers bumps the minor; additive API and fixes bump the patch:
    - adding a member to an interface that the package creates and callers only receive, such as `Messages`, counts as additive, and the changeset says that a hand-written object of that type, such as a test double, must add it;
    - adding a required member to an interface that hosts implement and pass in, such as `WorkerLike`, breaks them, and bumps the minor;
  - every pull request that changes a published package's source or `package.json` adds a changeset, unless only `package.json`'s dev-only fields changed: `devDependencies`, `scripts`, `packageManager` and `devEngines` ([ADR 0027](docs/adr/0027-dev-only-package-json-changes-need-no-changeset.md)) with `pnpm changeset`, describing the change for users; a required `changeset` check enforces it;
  - Conventional Commits stay for history and pull request titles, but don't drive versions;
  - the release workflow keeps a `chore: version packages` pull request open with the pending changesets; merging it publishes;
  - the same workflow then runs `pnpm verify` in its own read-only job, which also packs and checks the tarballs. Only after it passes does the publish job publish exactly those tarballs to npm, with trusted publishing and provenance, and create a GitHub Release per package ([ADR 0023](docs/adr/0023-verify-releases-in-an-unprivileged-job.md), [ADR 0041](docs/adr/0041-publish-the-verified-tarballs.md));
  - the tarball, standalone scripts and checksums are attached to the GitHub Release, with artifact attestations.
- **Licence:** Apache-2.0, with a `NOTICE` file crediting bundled third-party code whose licence requires it.
