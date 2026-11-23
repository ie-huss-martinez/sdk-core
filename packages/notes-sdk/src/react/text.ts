/**
 * `value` cut to at most `max` characters, counted as the documents count
 * them: by code point. An input's own `maxLength` counts UTF-16 units, so it
 * would stop a title of emoji at half the length the notebook allows.
 */
export function clipToLength(value: string, max: number): string {
  if (value.length <= max) return value;
  const characters = [...value];
  return characters.length <= max ? value : characters.slice(0, max).join("");
}
