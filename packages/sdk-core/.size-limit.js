import { entryFiles } from "@hussmartinez/sdk-config/size";

/**
 * Size budgets per entry point (ADR 0015, ADR 0055): the brotli size of each
 * built entry, with the chunks it loads statically. They measure the files
 * as built, a ceiling: minified, they're about a quarter less, and
 * applications ship less still, because their bundler drops what they don't
 * import. `pnpm exec hm-size dist/index.js dist/element.js` prints both.
 *
 * The build drops comments, so these measure code. Each budget leaves about
 * 20% above the size when it was set. The element entry's is tight on
 * purpose: it ships inside every SDK's standalone script (ADR 0040).
 */
export default [
  {
    name: "Headless runtime (.), with the shared code it loads",
    path: entryFiles("dist/index.js"),
    brotli: true,
    limit: "17 kB",
  },
  {
    name: "Element base (./element), with the shared code it loads",
    path: entryFiles("dist/element.js"),
    brotli: true,
    limit: "3 kB",
  },
];
