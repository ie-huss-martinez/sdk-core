/**
 * Size budgets (docs/adr/0012). Two kinds:
 *
 * - **Per entry point** (sdk-core ADR 0015): the brotli size of each built
 *   entry, with the shared chunks it loads, unminified. An upper bound:
 *   applications ship less, because their bundler minifies and drops what
 *   they don't import.
 * - **Per import scenario**, for the React entry: what an application ships
 *   for one import, bundled and minified with esbuild, with React and
 *   sdk-core left out. These are the budgets review judges a change by. A
 *   scenario's budget is never raised for code the scenario doesn't import:
 *   if a component's change moves the floor, that's the regression to fix.
 *
 * Every budget is raised by the pull request that needs it, to its
 * measurement rounded up to the next 0.5 kB, with a table of what moved.
 * The floors are tighter (sdk-core ADR 0056): their measurement rounded up
 * to the next 0.1 kB, never raised, and the table shows them every time:
 * their names start with "the floor", which `size:table` looks for.
 *
 * The checks come from `@hussmartinez/sdk-config/size`, the family's
 * helpers for these budgets (sdk-core ADRs 0055 and 0056).
 */

import { readFileSync } from "node:fs";
import { entryBudget, exportNames, importBudget } from "@hussmartinez/sdk-config/size";

/** The React entry's exports, read from the build so no list goes stale. */
const EXPORTS = exportNames("dist/react.js");

/**
 * Every icon component, from the generated list of icon names: `zoom-in` is
 * `ZoomInIcon`. Each one ships only to the applications that import it.
 */
const ICONS = [
  ...readFileSync(new URL("src/icons/icon-name.generated.ts", import.meta.url), "utf8").matchAll(
    /^\s*\| "([a-z0-9-]+)";?$/gm,
  ),
].map(
  ([, name]) => `${name.replace(/(?:^|-)([a-z0-9])/g, (_, letter) => letter.toUpperCase())}Icon`,
);
// Both ways: every listed icon is checked against the build in scenario(),
// and every icon the build exports must be listed.
const UNLISTED = EXPORTS.filter((name) => /^[A-Z]\w*Icon$/.test(name) && !ICONS.includes(name));
if (ICONS.length === 0 || UNLISTED.length > 0) {
  throw new Error(
    `The icon scenario doesn't match the build: src/icons/icon-name.generated.ts lists ${ICONS.length} icons, and dist/react.js also exports ${UNLISTED.join(", ") || "nothing else"}.`,
  );
}

/**
 * An editor: the components and icons that at least three of the five SDKs
 * import (docs/adr/0012). Fixed, not any one SDK's list; review changes it
 * when the family's editors change shape.
 */
const EDITOR = [
  "AnnouncerProvider",
  "UiMessagesProvider",
  "Button",
  "IconButton",
  "Toolbar",
  "ToolbarGroup",
  "Dialog",
  "Field",
  "NumberField",
  "TextField",
  "Slider",
  "SegmentedControl",
  "FileDropZone",
  "ProgressBar",
  "UndoIcon",
  "RedoIcon",
  "ZoomInIcon",
  "ZoomOutIcon",
  "FitIcon",
  "CloseIcon",
  "OpenIcon",
  "DownloadIcon",
  "DeleteIcon",
  "RotateLeftIcon",
  "RotateRightIcon",
  "ChevronLeftIcon",
];

/**
 * One import from the React entry, as an application's production build
 * bundles it. `importBudget` leaves out React and the family's packages,
 * which are the host's own, bundles an ES module with development checks
 * dropped, and counts only the imported names the bundle uses (sdk-core
 * ADR 0056).
 */
function scenario(name, names, limit) {
  // A name the parse missed would shrink the scenario and still pass, so fail
  // instead: the export list's format changed, or a component was renamed.
  const missing = names.filter((exported) => !EXPORTS.includes(exported));
  if (missing.length > 0) {
    throw new Error(`Size scenario "${name}": dist/react.js doesn't export ${missing.join(", ")}.`);
  }
  return importBudget({
    name: `Import: ${name}`,
    entry: "dist/react.js",
    imports: `{ ${names.join(", ")} }`,
    limit,
  });
}

/** The native entry's exports, read from its build, as the React entry's are. */
const NATIVE_EXPORTS = exportNames("dist/native.js");

/** Every icon's data: `zoom-in` is `zoomInIcon`. */
const NATIVE_ICONS = ICONS.map((name) => `${name[0].toLowerCase()}${name.slice(1)}`);

/**
 * One import from the native entry, as {@link scenario} measures the React
 * entry's, with the host's `react-native` and `react-native-svg` left out
 * beside React and the family's packages.
 */
function nativeScenario(name, names, limit) {
  const missing = names.filter((exported) => !NATIVE_EXPORTS.includes(exported));
  if (missing.length > 0) {
    throw new Error(
      `Size scenario "${name}": dist/native.js doesn't export ${missing.join(", ")}.`,
    );
  }
  return importBudget({
    name: `Native import: ${name}`,
    entry: "dist/native.js",
    imports: `{ ${names.join(", ")} }`,
    ignore: ["react-native", "react-native/*", "react-native-svg"],
    limit,
  });
}

export default [
  entryBudget({
    name: "Server-safe entry (.), with the shared code it loads",
    entry: "dist/index.js",
    // 14.5 kB; 14.19 kB with the tag's 18 component tokens and the link's
    // new-tab text (docs/adr/0015); 14.06 kB with the card's nine component
    // tokens before them (docs/adr/0014).
    // Before, 14 kB; 13.98 kB with the editor frame (sdk-core ADR 0067): about
    // 1.2 kB of new text in `uiMessages` and 0.9 kB of token metadata for the
    // new components' tokens. Before, 12 kB; 11.6 kB with the button's
    // component tokens. Each
    // module compressed on its own, in kB:
    //   theme/css-value.ts      2.6  the injection allowlist and type grammars
    //   tokens/definitions.ts   2.5  token metadata behind the `tokens` export;
    //                                it grows with every component's tokens
    //   theme/color.ts          1.6  colour parsing and WCAG contrast
    //   theme/css-writer.ts     1.5  the selector allowlist and CSS writer
    //   theme/create-theme.ts   1.5  validation, extends, built-in themes
    //   tokens/themes.ts        0.9  built-in semantic values
    //   tokens/base.ts          0.7  built-in base values
    //   the rest                1.2  contrast pairs and check, messages,
    //                                errors, registry, themeToCss
    // An application using only the built-in themes ships none of this: see
    // the ThemeProvider tree-shaking test in build.test.ts.
    limit: "14.5 kB",
  }),
  entryBudget({
    name: "React entry (./react), with the shared code it loads",
    entry: "dist/react.js",
    // 44.5 kB; 44.49 kB with Tabs (docs/adr/0016), 1.43 kB to an application
    // that imports it, with the heading it shows before it's ready.
    // Before, 44 kB; 43.81 kB with Tag, TagList and ButtonLink (docs/adr/0015) and
    // 14 icons for pages (docs/adr/0005, amended), which the every-icon
    // scenario measures. The scenarios that leave them out ship the same code
    // as before. Before, 42.5 kB; 42.43 kB with Card and startMorphTransition
    // (docs/adr/0014),
    // which the last two scenarios measure. Before, 42 kB; 41.73 kB with
    // ThemeToggle's `inherit`, which reads the theme its
    // element inherits and follows its ancestors' changes. Before, 41.5 kB;
    // 41.05 kB with the editor frame's eleven components and the
    // colour picker (sdk-core ADR 0067, docs/adr/0013), which the two
    // scenarios at the end measure. Before, 26 kB; 25.53 kB once ReorderableList kept focus on its cells and
    // entered at its Tab stop under NVDA (sdk-core#201, #202), +0.60 kB of it
    // in the ReorderableList import below. Before, 25 kB; 24.71 kB with
    // Heading and HeadingLevelProvider (sdk-core ADR 0058), which only the
    // Dialog and editor scenarios import, through Dialog's context for its
    // content's headings. Every component counts here, though no
    // application ships them all, so a component's pull request raises it as
    // expected growth; review reads the import scenarios below to judge it.
    limit: "44.5 kB",
  }),
  entryBudget({
    name: "Stylesheet (./styles.css)",
    entry: "dist/styles.css",
    // 16 kB; 15.59 kB with the tabs' rules (docs/adr/0016).
    // Before, 15.5 kB; 15.07 kB with the tag's and the tag list's rules, five tones
    // among them, and a link's one (docs/adr/0015).
    // Before, 15 kB; 14.66 kB with the card and the morph's rules (docs/adr/0014).
    // Before, 14 kB; 13.71 kB with the editor frame's components, the colour
    // picker (with its right-to-left strips) and the reduced-motion and
    // theme blocks of the new tokens.
    // Before, 9.5 kB; 9.05 kB with lanes that let presses through;
    // the lanes before them took it from 8.5 kB to 9 kB. Raised as the React
    // entry's is: to the measurement, rounded up to the next 0.5 kB. Every
    // application loads the whole stylesheet, so this one is the cost of
    // every component.
    limit: "16 kB",
  }),
  // A floor: 0.6 kB; 0.56 kB, counting only the React names it uses
  // (sdk-config 0.12.1). A leak into every component shows here first.
  scenario("the floor, Button", ["Button"], "0.6 kB"),
  // A floor: 0.9 kB; 0.88 kB. The floor for a toolbar's buttons.
  scenario("the floor, IconButton with one icon", ["IconButton", "UndoIcon"], "0.9 kB"),
  // 2 kB; 1.86 kB.
  scenario("Dialog", ["Dialog"], "2 kB"),
  // 3.5 kB; 3.06 kB once focus stayed on cells and entered at the Tab stop
  // under NVDA (sdk-core#201, #202), with names that follow each control's
  // state, native checkboxes included, and text fields that keep focus.
  scenario("ReorderableList", ["ReorderableList", "ReorderableListItem"], "3.5 kB"),
  // 9.5 kB; 9.16 kB once the clips announce a clip added to the selection or
  // taken out of it (sdk-core#204), which brings in ui's messages and the
  // announcer. The SDKs' editors load both already. The largest component.
  scenario(
    "the Timeline with lanes",
    ["Timeline", "TimelineClips", "TimelinePlayhead", "TimelineLane"],
    "9.5 kB",
  ),
  // 4 kB; 3.88 kB for 84 icons, about 0.05 kB each, with the 14 for pages
  // (docs/adr/0005, amended). Before, 3.5 kB; 3.21 kB for 70.
  scenario("every icon", ICONS, "4 kB"),
  // 7.5 kB; 7.40 kB.
  scenario("an editor", EDITOR, "7.5 kB"),
  // 11 kB; 10.56 kB with ThemeToggle's `inherit`, for an editor that takes
  // its page's theme until one is chosen. Before, 10.5 kB; 10.35 kB, with the frame's own panel toggles and their tooltips, and the palette's and toasts' own live regions for
  // when a modal dialog makes the page's announcer inert. Everything an SDK
  // editor renders through (sdk-core ADR
  // 0067): the frame, its tools, the mode switch, the theme toggle, the tab
  // bar, the settings, the command palette, toasts and progress. Their text
  // is its own part of ui's catalogue, so the components above don't ship it.
  scenario(
    "the editor frame",
    [
      "EditorFrame",
      "ToolList",
      "ModeSwitch",
      "ThemeToggle",
      "TabBar",
      "SettingsPanel",
      "CommandPalette",
      "ToastProvider",
      "useToast",
      "ProgressOverlay",
    ],
    "11 kB",
  ),
  // 6 kB; 5.86 kB, with its colour names (docs/adr/0013).
  scenario("ColorPicker", ["ColorPicker", "addRecentColor"], "6 kB"),
  // 1 kB; 0.61 kB, with the heading level's context (docs/adr/0014).
  scenario("Card", ["Card"], "1 kB"),
  // 2.5 kB; 2.48 kB: a card, its dialog and the view transition between them.
  scenario(
    "a Card that morphs into a Dialog",
    ["Card", "Dialog", "startMorphTransition"],
    "2.5 kB",
  ),
  // The React Native entry (sdk-core ADR 0069), built on its own, so nothing
  // above moved when it was added.
  entryBudget({
    name: "React Native entry (./native)",
    entry: "dist/native.js",
    // 10 kB; 9.73 kB. Each part compressed with the rest, in kB:
    //   the icons' shapes        3.6  84 icons, about 0.04 kB each; it grows
    //                                 with every icon the set gains
    //   the two themes           1.1  every token, resolved, twice
    //   the components           2.6  provider, Text, Button, ChoiceList, Icon, Dir
    //   the rest                 2.3  createNativeTheme, preferences, direction
    // Metro ships the whole file unless the application turns tree shaking
    // on, so this one is what most native applications pay.
    limit: "10 kB",
  }),
  // A floor: 0.4 kB; 0.34 kB, the lists of right-to-left languages and
  // scripts. The cheapest import a native application makes.
  nativeScenario("the floor, isRTL", ["isRTL"], "0.4 kB"),
  // 1.5 kB; 1.09 kB.
  nativeScenario("the native themes", ["lightNativeTheme", "darkNativeTheme"], "1.5 kB"),
  // 4 kB; 3.58 kB for 84 icons.
  nativeScenario("every icon's data", NATIVE_ICONS, "4 kB"),
  // 5 kB; 4.72 kB: what an application with a themed, right-to-left
  // multiple-choice screen imports.
  nativeScenario(
    "a native screen",
    [
      "NativeUiProvider",
      "Dir",
      "Text",
      "Button",
      "ChoiceList",
      "Icon",
      "announce",
      "useReducedMotion",
      "readNativePreferences",
      "createNativeTheme",
      "undoIcon",
      "chevronRightIcon",
    ],
    "5 kB",
  ),
];
