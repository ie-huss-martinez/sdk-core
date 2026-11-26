/**
 * The longest file name {@link cleanFileName} keeps, in Unicode code points.
 *
 * @public
 */
export const MAX_FILE_NAME_LENGTH = 128;

/** Control characters (Unicode category Cc: C0, DEL and C1). */
const CONTROL = /\p{Cc}/gu;
/** Half a surrogate pair. With the `u` flag, a whole pair doesn't match. */
const LONE_SURROGATE = /\p{Cs}/gu;
/** Bidirectional formatting characters, which can disguise an extension. */
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
/** Characters Windows refuses in file names. Separators are handled first. */
const REFUSED = /[<>:"|?*]/gu;

/**
 * Cleans a file name, which is chosen by whoever made the file and so is
 * hostile input like its bytes (ADR 0051). Clean a name once, where it
 * enters the SDK, and keep and expose only the result.
 *
 * The result is one path segment of well-formed Unicode in NFC, with no
 * control or bidirectional formatting characters, none of the characters
 * Windows refuses (`< > : " | ? *`), no leading dots, no whitespace at
 * either end, and at most {@link MAX_FILE_NAME_LENGTH} code points. Cleaning
 * a clean name returns it unchanged. On an engine without
 * `String.prototype.normalize`, as Hermes can be, the name keeps the form it
 * came in, clean in every other way (ADR 0069).
 *
 * It's safe as text content and as a download's name. It isn't escaped for
 * anything else: never put it in markup, a URL, or a usage event.
 *
 * @example
 * ```ts
 * cleanFileName("C:\\Users\\me\\report.pdf"); // "report.pdf"
 * cleanFileName("invoice\u202Efdp.exe");       // "invoicefdp.exe", no longer shown as "invoiceexe.pdf"
 * cleanFileName("../..");                      // undefined
 * const name = cleanFileName(options.name ?? (blob instanceof File ? blob.name : undefined));
 * ```
 *
 * @param raw - The name, such as `File.name`. Anything that isn't a string
 *   gives no name.
 * @returns The clean name, or `undefined` when nothing is left.
 * @public
 */
export function cleanFileName(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  let name = raw.replace(CONTROL, "").replace(LONE_SURROGATE, "").replace(BIDI, "");
  name = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
  // Normalised after the removals, which could leave a base letter and its
  // combining mark side by side.
  name = name.replace(REFUSED, "");
  // An engine without `normalize`, as Hermes can be (ADR 0069), keeps the
  // name in the form it came in: clean, and only not composed.
  if (typeof name.normalize === "function") {
    name = name.normalize("NFC");
  }
  // Leading dots would hide the file on some systems, or leave only an
  // extension; whitespace at either end is never meant.
  name = name.replace(/^[\s.]+/u, "").trimEnd();
  // Array.from splits by code points, so no surrogate pair is cut in half.
  const points = Array.from(name);
  if (points.length > MAX_FILE_NAME_LENGTH) {
    name = points.slice(0, MAX_FILE_NAME_LENGTH).join("").trimEnd();
  }
  return name === "" ? undefined : name;
}
