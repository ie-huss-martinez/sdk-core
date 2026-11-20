import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, matchesGlob, relative, resolve, sep } from "node:path";

/** Exit code when no file has a hidden character. */
export const EXIT_OK = 0;
/** Exit code when a file has a hidden character. */
export const EXIT_FAILED = 1;
/** Exit code for usage errors, or a repository this can't read. */
export const EXIT_USAGE = 2;

/** The file, at the repository's root, that lists paths allowed to hold hidden characters. */
export const IGNORE_FILE = ".hm-hidden-unicode-ignore";

/**
 * An error the user can fix, reported as a message without a stack trace.
 */
export class UsageError extends Error {
  /** @override */
  name = "UsageError";
}

/**
 * The characters this reports, with their names (sdk-core ADR 0052). They're
 * invisible in an editor and a diff, or they reorder the text around them, so
 * a reviewer can't see what a line really holds:
 *
 * - bidirectional formatting characters, behind "Trojan Source" attacks;
 * - zero-width and other invisible characters, including the soft hyphen;
 * - line and paragraph separators, which break lines in some tools only;
 * - tag characters, which can carry text nobody sees.
 *
 * Source writes them as escapes, such as `\u202E`.
 *
 * @type {ReadonlyMap<number, string>}
 */
export const HIDDEN_CHARACTERS = new Map([
  [0x00ad, "SOFT HYPHEN"],
  [0x061c, "ARABIC LETTER MARK"],
  [0x180e, "MONGOLIAN VOWEL SEPARATOR"],
  [0x200b, "ZERO WIDTH SPACE"],
  [0x200c, "ZERO WIDTH NON-JOINER"],
  [0x200d, "ZERO WIDTH JOINER"],
  [0x200e, "LEFT-TO-RIGHT MARK"],
  [0x200f, "RIGHT-TO-LEFT MARK"],
  [0x2028, "LINE SEPARATOR"],
  [0x2029, "PARAGRAPH SEPARATOR"],
  [0x202a, "LEFT-TO-RIGHT EMBEDDING"],
  [0x202b, "RIGHT-TO-LEFT EMBEDDING"],
  [0x202c, "POP DIRECTIONAL FORMATTING"],
  [0x202d, "LEFT-TO-RIGHT OVERRIDE"],
  [0x202e, "RIGHT-TO-LEFT OVERRIDE"],
  [0x2060, "WORD JOINER"],
  [0x2061, "FUNCTION APPLICATION"],
  [0x2062, "INVISIBLE TIMES"],
  [0x2063, "INVISIBLE SEPARATOR"],
  [0x2064, "INVISIBLE PLUS"],
  [0x2066, "LEFT-TO-RIGHT ISOLATE"],
  [0x2067, "RIGHT-TO-LEFT ISOLATE"],
  [0x2068, "FIRST STRONG ISOLATE"],
  [0x2069, "POP DIRECTIONAL ISOLATE"],
  [0xfeff, "ZERO WIDTH NO-BREAK SPACE (byte order mark)"],
]);

/** Tag characters, U+E0000 to U+E007F: invisible copies of ASCII. */
const isTag = (/** @type {number} */ codePoint) => codePoint >= 0xe0000 && codePoint <= 0xe007f;

/** A cheap first pass: most files have none. Kept in step with the table by a test. */
const ANY_HIDDEN =
  /[\u00AD\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;

/**
 * @typedef {object} HiddenCharacter
 * @property {number} line The line, from 1.
 * @property {number} column The column, from 1, in code points.
 * @property {string} codePoint As `U+202E`.
 * @property {string} name The character's Unicode name.
 * @property {string} escape How to write it in source, such as `\u202E`.
 */

/**
 * Finds every hidden character in a text.
 *
 * @param {string} text
 * @returns {HiddenCharacter[]}
 */
export function findHiddenCharacters(text) {
  if (!ANY_HIDDEN.test(text)) {
    return [];
  }
  /** @type {HiddenCharacter[]} */
  const found = [];
  // Only a line feed starts a line here, as in git's diffs and editors'
  // line numbers. U+2028 and U+2029 are reported, not counted as breaks.
  text.split("\n").forEach((line, index) => {
    let column = 0;
    for (const character of line) {
      column += 1;
      const codePoint = /** @type {number} */ (character.codePointAt(0));
      const name = HIDDEN_CHARACTERS.get(codePoint) ?? (isTag(codePoint) ? "TAG CHARACTER" : "");
      if (name !== "") {
        const hex = codePoint.toString(16).toUpperCase().padStart(4, "0");
        found.push({
          line: index + 1,
          column,
          codePoint: `U+${hex}`,
          name,
          escape: codePoint > 0xffff ? `\\u{${hex}}` : `\\u${hex}`,
        });
      }
    }
  });
  return found;
}

/**
 * Reads a file as text, if it is text: a regular file of valid UTF-8 without
 * a NUL byte, which is how git tells binary files too. Images, fonts and
 * archives aren't checked. Nor is anything else git can track: a submodule
 * is a folder, and a symbolic link's target is checked where it lives, or
 * is outside the repository.
 *
 * @param {string} path
 * @returns {string | undefined} The text, or `undefined` for a binary file
 *   or an entry that isn't a regular file.
 */
export function readText(path) {
  if (!lstatSync(path).isFile()) {
    return undefined;
  }
  const bytes = readFileSync(path);
  if (bytes.includes(0)) {
    return undefined;
  }
  try {
    // ignoreBOM keeps a byte order mark in the text, so it's reported.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * Reads the globs in the repository's `.hm-hidden-unicode-ignore`, if it has
 * one: a glob per line, relative to the root, with `#` comments.
 *
 * @param {string} root The repository.
 * @returns {string[]}
 */
export function readIgnoreFile(root) {
  const file = join(root, IGNORE_FILE);
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/**
 * @typedef {object} CheckHiddenUnicodeOptions
 * @property {string} root The repository's root, which paths and globs are
 *   relative to.
 * @property {string[]} [files] The files to check, absolute or relative to
 *   the root. Without it, every file git tracks.
 * @property {string[]} [ignore] Globs of paths that may hold hidden
 *   characters, such as test fixtures. `.hm-hidden-unicode-ignore`'s by
 *   default.
 */

/**
 * @typedef {object} CheckHiddenUnicodeResult
 * @property {number} exitCode {@link EXIT_OK} or {@link EXIT_FAILED}.
 * @property {string[]} problems One line per hidden character:
 *   `path:line:column: message`.
 * @property {number} checked How many text files were read.
 */

/**
 * Checks files for hidden characters (sdk-core ADR 0052).
 *
 * @param {CheckHiddenUnicodeOptions} options
 * @returns {CheckHiddenUnicodeResult}
 * @throws {UsageError} When git can't list the repository's files, or a
 *   given file is outside the root or can't be read.
 */
export function checkHiddenUnicode({ root, files, ignore = readIgnoreFile(root) }) {
  const paths = (files ?? trackedFiles(root)).map((file) => {
    // Resolved first, so a path that climbs out through ".." is seen as outside.
    const path = relative(root, resolve(root, file)).split(sep).join("/");
    if (path === ".." || path.startsWith("../") || isAbsolute(path)) {
      throw new UsageError(`${file} is outside ${root}.`);
    }
    return path;
  });
  /** @type {string[]} */
  const problems = [];
  let checked = 0;
  for (const path of paths) {
    if (ignore.some((glob) => matchesGlob(path, glob))) {
      continue;
    }
    /** @type {string | undefined} */
    let text;
    try {
      text = readText(join(root, path));
    } catch (error) {
      // A file git tracks but the working tree no longer has, such as one
      // deleted and not yet committed, has nothing to check.
      if (files === undefined && /** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
        continue;
      }
      throw new UsageError(
        `Can't read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (text === undefined) {
      continue;
    }
    checked += 1;
    for (const found of findHiddenCharacters(text)) {
      problems.push(
        `${path}:${found.line}:${found.column}: hidden character ${found.codePoint} ${found.name}. Write it as the escape ${found.escape}, or remove it.`,
      );
    }
  }
  return { exitCode: problems.length === 0 ? EXIT_OK : EXIT_FAILED, problems, checked };
}

/**
 * @param {string} root
 * @returns {string[]} Every file git tracks, relative to the root.
 * @throws {UsageError} Outside a git repository.
 */
function trackedFiles(root) {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter((path) => path !== "");
  } catch {
    throw new UsageError(
      "git can't list this folder's files; run this from the repository's root, or give the files to check.",
    );
  }
}
