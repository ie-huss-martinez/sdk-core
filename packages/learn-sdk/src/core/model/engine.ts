/**
 * What the core needs from the JavaScript engine, asked for in one place, so
 * it runs where an engine has less than a browser's: Hermes, in React
 * Native, may have no `String.prototype.normalize` and no `structuredClone`
 * (sdk-core ADR 0069).
 */

/**
 * Text in Unicode's NFC form, so that a letter typed as one code point and
 * the same letter typed as a base and a combining mark compare equal.
 *
 * Where the engine has no `normalize`, the text is returned as it is. Then
 * only a language profile's own rules stand between two spellings of one
 * letter: the built-in profiles fold accents and marks themselves, for this
 * reason, and a host's profile should too if it's used on such an engine.
 *
 * @internal
 */
export function nfc(text: string): string {
  return typeof text.normalize === "function" ? text.normalize("NFC") : text;
}

/**
 * A deep copy of plain data: what `JSON.parse` returns. Own enumerable keys
 * only, including one named `__proto__`, which stays a key and never
 * becomes a prototype. Not for untrusted values: a reader has already
 * checked what's given here.
 *
 * @internal
 */
export function cloneData<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return value.map((entry: unknown) => cloneData(entry)) as Value;
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneData(entry)]),
    ) as Value;
  }
  return value;
}
