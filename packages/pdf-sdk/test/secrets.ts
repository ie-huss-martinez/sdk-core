/**
 * Everything a value could hand to a log, a report or an analytics call, as
 * one string: its own and inherited fields, an error's message, stack,
 * details and cause chain, and whatever those hold, however deep. For
 * asserting that a secret, such as a document's password, is in none of it
 * (docs/adr/0013).
 */
export function everythingIn(value: unknown, seen = new Set<unknown>()): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "function") return "";
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "";
  seen.add(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "";
  const parts: string[] = [];
  if (value instanceof Error) parts.push(value.name, value.message, value.stack ?? "");
  const keys = new Set<string>();
  for (let object: object | null = value; object && object !== Object.prototype; ) {
    for (const key of Object.getOwnPropertyNames(object)) keys.add(key);
    object = Object.getPrototypeOf(object) as object | null;
  }
  for (const key of keys) {
    let field: unknown;
    try {
      field = (value as Record<string, unknown>)[key];
    } catch {
      continue;
    }
    parts.push(key, everythingIn(field, seen));
  }
  return parts.join("\n");
}
