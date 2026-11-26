/**
 * A `javascript:` URL as a browser reads one: after leading control
 * characters and spaces, and with tabs and line breaks anywhere inside the
 * scheme, all of which it ignores. The pattern React 19 blocks.
 */
const SCRIPT_URL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: browsers skip these characters, so the check must too.
  /^[\u0000-\u001f ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;

/**
 * Whether following a link's `href` would run script instead of navigating.
 * A link's address often comes from data, such as a profile's website, and
 * React 18 renders such a URL as it is.
 */
export function isScriptUrl(href: string): boolean {
  return SCRIPT_URL.test(href);
}
