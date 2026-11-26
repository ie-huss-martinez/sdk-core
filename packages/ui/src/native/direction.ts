/**
 * The direction text and layout run in.
 *
 * @public
 */
export type Direction = "ltr" | "rtl";

/**
 * Languages written from right to left by default, as BCP 47 language
 * subtags, with the deprecated `iw` and `ji` that some systems still report.
 * A fixed list: Hermes has no `Intl.Locale`, and this never asks for one.
 */
const RTL_LANGUAGES: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "ar",
  "arc",
  "ckb",
  "dv",
  "fa",
  "he",
  "iw",
  "ji",
  "ks",
  "lrc",
  "mzn",
  "nqo",
  "pnb",
  "prs",
  "ps",
  "sd",
  "syr",
  "ug",
  "ur",
  "yi",
]);

/** Scripts written from right to left, as ISO 15924 codes in lower case. */
const RTL_SCRIPTS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "adlm",
  "arab",
  "hebr",
  "mand",
  "nkoo",
  "rohg",
  "samr",
  "syrc",
  "thaa",
]);

/**
 * Whether a locale is written from right to left, such as `ar`, `he-IL` or
 * `az-Arab`. A script subtag decides when the tag has one, so `ur-Latn` is
 * left to right; otherwise the language does. Extensions and private-use
 * subtags don't count: `ar-u-nu-latn` is Arabic with Latin digits. Anything it can't read is
 * left to right.
 *
 * It uses no `Intl`, so it gives the same answer on every engine.
 *
 * @param locale - A BCP 47 language tag. Underscores are read as hyphens.
 * @public
 */
export function isRTL(locale: string): boolean {
  if (typeof locale !== "string") {
    return false;
  }
  const [language = "", ...rest] = locale.toLowerCase().split(/[-_]/);
  // A script comes straight after the language and its extended language
  // subtags, which are three letters each. Further on, four letters are a
  // variant, an extension's value, such as the numbering system in
  // `ar-u-nu-latn`, or private use.
  const script = rest.find((subtag) => !/^[a-z]{3}$/.test(subtag));
  return script !== undefined && /^[a-z]{4}$/.test(script)
    ? RTL_SCRIPTS.has(script)
    : RTL_LANGUAGES.has(language);
}
