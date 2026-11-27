import type { LanguageProfile } from "./language-profile.js";

/**
 * Built-in language profiles for Spanish, English and Arabic (ADR 0010):
 * forgiving rules for people who type or say an answer, written as plain
 * string operations on fixed tables. They use no `Intl`, no
 * `String.prototype.normalize` and no engine's case mapping, so they give
 * the same result on a server, in every browser and on Hermes.
 */

/**
 * Latin letters with a mark, each as the plain lowercase letter it's read
 * as. A table, because NFD isn't available on every engine. `ñ` is read as
 * `n`, as a keyboard without it types.
 */
const LATIN: Readonly<Record<string, string>> = {
  á: "a",
  à: "a",
  ä: "a",
  â: "a",
  ã: "a",
  å: "a",
  é: "e",
  è: "e",
  ë: "e",
  ê: "e",
  í: "i",
  ì: "i",
  ï: "i",
  î: "i",
  ó: "o",
  ò: "o",
  ö: "o",
  ô: "o",
  õ: "o",
  ú: "u",
  ù: "u",
  ü: "u",
  û: "u",
  ñ: "n",
  ç: "c",
  Á: "a",
  À: "a",
  Ä: "a",
  Â: "a",
  Ã: "a",
  Å: "a",
  É: "e",
  È: "e",
  Ë: "e",
  Ê: "e",
  Í: "i",
  Ì: "i",
  Ï: "i",
  Î: "i",
  Ó: "o",
  Ò: "o",
  Ö: "o",
  Ô: "o",
  Õ: "o",
  Ú: "u",
  Ù: "u",
  Ü: "u",
  Û: "u",
  Ñ: "n",
  Ç: "c",
};
const LATIN_MARKED = /[À-ÅÇ-ÏÑ-ÖÙ-Üà-åç-ïñ-öù-ü]/g;

/** Combining marks of Latin script: what's left of an accent typed as a separate mark. */
const LATIN_MARKS = /[̀-ͯ]/g;

/**
 * Arabic marks that don't change which word it is: tashkeel, the Quranic
 * annotation marks and the superscript alef.
 */
const ARABIC_MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

/** Apostrophes, removed so that a contraction stays one word. */
const APOSTROPHES = /['‘’]/g;

/** Punctuation, Latin and Arabic, read as a space. */
const PUNCTUATION = /[.,;:!?¡¿"“”«»()[\]{}\-–—_/\\…،؛؟*&%$#@+=<>|~^`]/g;

const SPACES = /\s+/g;

/** A to Z as a to z, by code, so no engine's case tables are asked. */
const lowerAscii = (text: string): string =>
  text.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));

/** Punctuation out, spaces single, none at either end. */
const tidy = (text: string): string =>
  text.replace(APOSTROPHES, "").replace(PUNCTUATION, " ").replace(SPACES, " ").trim();

/** Lowercase, without accents, punctuation or extra spaces. */
function foldLatin(text: string): string {
  return tidy(
    lowerAscii(text.replace(LATIN_MARKED, (letter) => LATIN[letter] ?? letter)).replace(
      LATIN_MARKS,
      "",
    ),
  );
}

/**
 * Without tashkeel or tatweel, with the letters people write one for
 * another unified: the forms of alef, ta marbuta as ha, alef maqsura as ya,
 * and hamza on waw or ya as its seat. Latin text in it, such as a name, is
 * folded as in Spanish and English.
 */
function foldArabic(text: string): string {
  return foldLatin(
    text
      .replace(ARABIC_MARKS, "")
      .replace(/ـ/g, "")
      .replace(/[أإآٱ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/ؤ/g, "و")
      .replace(/ئ/g, "ي"),
  );
}

/** Plural and common endings only, so "manzanas" is "manzana". Deliberately conservative. */
function stemSpanish(word: string): string {
  if (word.length > 4 && word.endsWith("ces")) {
    return `${word.slice(0, -3)}z`;
  }
  if (word.length > 4 && /[^aeiou]es$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/** Plural and common endings only, so "grapes" is "grape". Deliberately conservative. */
function stemEnglish(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.length > 5 && word.endsWith("ing")) {
    return word.slice(0, -3);
  }
  if (word.length > 4 && /(?:ses|xes|ches|shes)$/.test(word)) {
    return word.slice(0, -2);
  }
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** The definite article with what attaches before it, longest first. */
const ARABIC_PREFIXES = ["وال", "بال", "كال", "فال", "لل", "ال"];
/** Plural, dual and possessive endings. */
const ARABIC_SUFFIXES = ["ات", "ون", "ين", "ان", "ها", "هم", "كم"];

/**
 * The attached article, a leading waw, one common ending and a final ha
 * (the folded ta marbuta), each only when a word is left. Deliberately
 * conservative.
 */
function stemArabic(word: string): string {
  let stem = word;
  const prefix = ARABIC_PREFIXES.find(
    (candidate) => stem.startsWith(candidate) && stem.length - candidate.length >= 2,
  );
  if (prefix !== undefined) {
    stem = stem.slice(prefix.length);
  }
  if (stem.length > 3 && stem.startsWith("و")) {
    stem = stem.slice(1);
  }
  const suffix = ARABIC_SUFFIXES.find(
    (candidate) => stem.endsWith(candidate) && stem.length - candidate.length >= 3,
  );
  if (suffix !== undefined) {
    stem = stem.slice(0, -suffix.length);
  }
  return stem.length > 3 && stem.endsWith("ه") ? stem.slice(0, -1) : stem;
}

/**
 * Spanish: answers compare without case, accents, punctuation or extra
 * spaces, so "¿Qué tal?" and "que tal" are the same answer. `ñ` is read as
 * `n`. Its `articles` and `stem` are for {@link matchTolerantly} only.
 *
 * @public
 */
export const spanishProfile: LanguageProfile = /* @__PURE__ */ Object.freeze({
  code: "es",
  direction: "ltr",
  normalizeAnswer: foldLatin,
  articles: /* @__PURE__ */ Object.freeze([
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "unos",
    "unas",
    "lo",
  ]),
  stem: stemSpanish,
});

/**
 * English: answers compare without case, accents, apostrophes, punctuation
 * or extra spaces, so "Don't!" and "dont" are the same answer. Its
 * `articles` and `stem` are for {@link matchTolerantly} only.
 *
 * @public
 */
export const englishProfile: LanguageProfile = /* @__PURE__ */ Object.freeze({
  code: "en",
  direction: "ltr",
  normalizeAnswer: foldLatin,
  articles: /* @__PURE__ */ Object.freeze(["the", "a", "an"]),
  stem: stemEnglish,
});

/**
 * Arabic, right to left: answers compare without tashkeel, tatweel,
 * punctuation or extra spaces, and with the letters people write one for
 * another unified: every form of alef, ta marbuta and ha, alef maqsura and
 * ya, and hamza on its seat. Its `stem`, for {@link matchTolerantly} only,
 * also takes off the attached article.
 *
 * @public
 */
export const arabicProfile: LanguageProfile = /* @__PURE__ */ Object.freeze({
  code: "ar",
  direction: "rtl",
  normalizeAnswer: foldArabic,
  stem: stemArabic,
});
