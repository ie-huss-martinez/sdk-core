import { entryBudget, importBudget } from "@hussmartinez/sdk-config/size";

/**
 * Size budgets (ADR 0015), of two kinds.
 *
 * - **Entry ceilings** (ADR 0055): the brotli size of each built entry, with
 *   the chunks it loads statically. They measure the files as built: minified,
 *   they're about a quarter less, and applications ship less still, because
 *   their bundler drops what they don't import. The build drops comments, so
 *   these measure code. Each leaves about 20% above the size when it was set.
 *   The element entry's is tight on purpose: it ships inside every SDK's
 *   standalone script (ADR 0040).
 * - **Import budgets** (ADR 0056): what an application ships for one import,
 *   bundled and minified. These are the budgets review judges a change by.
 *   The floor is the cheapest import a host makes; if it moves, code has
 *   leaked into everything, which is a regression to fix, never a budget to
 *   raise. The others are each export over about 2 kB on its own. A budget is
 *   never raised for code its import doesn't use.
 *
 * Every budget is raised by the pull request that needs it, with a table of
 * what moved: the floor to its size rounded up to the next 0.1 kB, the others
 * to the next 0.5 kB. `pnpm exec hm-size --exports dist/index.js` prints what
 * every export costs.
 *
 * size-limit labels every check "with all dependencies, minified and
 * brotlied" once its esbuild plugin is installed. For the two ceilings that's
 * only a label: they measure the built files, with the plugin turned off.
 */
export default [
  entryBudget({
    name: "Headless runtime (.), with the shared code it loads",
    entry: "dist/index.js",
    limit: "17 kB",
  }),
  entryBudget({
    name: "Element base (./element), with the shared code it loads",
    entry: "dist/element.js",
    limit: "3 kB",
  }),
  // Measured 0.31 kB: the error class every SDK extends, with the check
  // that only one copy of sdk-core is loaded (ADR 0047).
  importBudget({
    name: "Import: the floor, SdkError",
    entry: "dist/index.js",
    imports: "{ SdkError }",
    limit: "0.4 kB",
  }),
  // Measured 3.30 kB: the worker client, with error rebuilding and transfer.
  importBudget({
    name: "Import: createWorkerClient",
    entry: "dist/index.js",
    imports: "{ createWorkerClient }",
    limit: "3.5 kB",
  }),
  // Measured 2.16 kB: the worker's side of the same protocol.
  importBudget({
    name: "Import: exposeWorker",
    entry: "dist/index.js",
    imports: "{ exposeWorker }",
    limit: "2.5 kB",
  }),
  // Measured 2.13 kB: the shortcut registry, with chords and platforms.
  importBudget({
    name: "Import: createShortcutRegistry",
    entry: "dist/index.js",
    imports: "{ createShortcutRegistry }",
    limit: "2.5 kB",
  }),
  // Measured 2.78 kB: the messages helper with sdk-core's own catalogue, as
  // every SDK uses them together.
  importBudget({
    name: "Import: createMessages with sdkCoreMessages",
    entry: "dist/index.js",
    imports: "{ createMessages, sdkCoreMessages }",
    limit: "3 kB",
  }),
  // Measured 1.21 kB: what every SDK's element entry builds on.
  importBudget({
    name: "Import: createEditorElement",
    entry: "dist/element.js",
    imports: "{ createEditorElement }",
    limit: "1.5 kB",
  }),
];
