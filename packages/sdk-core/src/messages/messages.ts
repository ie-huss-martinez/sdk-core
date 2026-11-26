import { isSdkError } from "../errors/sdk-error.js";
import { warnInDevelopment } from "../internal/development.js";
import { checkSingleCopy } from "../internal/single-copy.js";
import {
  canonicalLocale,
  dateTimeFormat,
  formatDuration,
  formatFileSize,
  numberFormat,
  pluralRules,
} from "./intl.js";
import {
  type CompiledMessage,
  compileMessage,
  type Format,
  parameterNames,
  type Template,
} from "./parse.js";
import type {
  CheckedOverrides,
  MessageArgs,
  MessageCatalogue,
  MessageOverrides,
  MessageValue,
  MessageWarning,
  PluralCategory,
} from "./types.js";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/**
 * Declares a message catalogue, keeping its literal types so that
 * placeholders become typed parameters. Use it for each SDK's English
 * catalogue, in `src/messages/en.ts` (ADR 0014).
 *
 * @example
 * ```ts
 * export const en = defineMessages({
 *   ...sdkCoreMessages,
 *   "toolbar.rotate": "Rotate",
 *   "result.saved": "Saved {size, fileSize}",
 *   "pages.selected": plural("count", { one: "{count} page selected", other: "{count} pages selected" }),
 * });
 * ```
 *
 * @param catalogue - Message keys and their English text.
 * @returns The same catalogue.
 * @public
 */
export function defineMessages<const Catalogue extends MessageCatalogue>(
  catalogue: Catalogue,
): Catalogue {
  return catalogue;
}

/**
 * Builds a {@link PluralMessage}, the same plain object a translator's JSON
 * file contains, with typed forms.
 *
 * @param selector - The numeric parameter that selects the form.
 * @param forms - The text for each plural category. `other` is required.
 * @public
 */
export function plural<
  const Selector extends string,
  const Forms extends { readonly other: string } & {
    readonly [Category in Exclude<PluralCategory, "other">]?: string;
  },
>(selector: Selector, forms: Forms): { readonly $plural: Selector } & Forms {
  return { $plural: selector, ...forms };
}

/**
 * Options for {@link createMessages}.
 *
 * @typeParam Overrides - The host's overrides.
 * @public
 */
export interface CreateMessagesOptions<Overrides> {
  /**
   * The locale for plurals, numbers, file sizes and dates, such as `"de"`.
   * Defaults to `"en"`. Pass the host's `locale` explicitly: reading the
   * browser's language would make server and client render different text
   * (ADR 0007). An invalid locale falls back to `"en"`.
   */
  readonly locale?: string;
  /**
   * The host's `messages`: any subset of the catalogue. They're validated
   * once. Unknown keys are ignored, and a malformed message, or one that uses
   * a placeholder the English message doesn't have, falls back to English.
   * Both cases log a development-only warning.
   */
  readonly overrides?: Overrides;
}

/**
 * The text of a catalogue, ready to render.
 *
 * @typeParam Catalogue - The SDK's catalogue.
 * @public
 */
export interface Messages<Catalogue extends MessageCatalogue> {
  /** The locale in use. */
  readonly locale: string;
  /**
   * Renders a message as plain text. Never throws. A parameter missing at
   * runtime renders as an empty string, with a development-only warning.
   *
   * The result is a string, never markup. Render it as text, so that
   * parameters derived from files, such as file names, can't inject HTML.
   *
   * @param key - The message key.
   * @param args - The message's parameters, if it has placeholders.
   */
  t<Key extends keyof Catalogue & string>(key: Key, ...args: MessageArgs<Catalogue[Key]>): string;
  /**
   * The user-facing text for an error, looked up by its `SdkError` code, with
   * the error's `details` as parameters. The first of these the catalogue
   * has is used (ADR 0050):
   *
   * 1. `errors.<CODE>.<reason>`, when `details.reason` is a string, for a
   *    code whose text depends on why it happened;
   * 2. `errors.<CODE>`;
   * 3. `errors.UNKNOWN`, which anything that isn't an `SdkError` gets too.
   *
   * The error's own `message` is never shown, because it's for developers
   * and may contain file-derived text.
   *
   * @param error - Any caught value.
   */
  error(error: unknown): string;
  /**
   * The user-facing text for a warning in the family's shape (ADR 0050),
   * with the warning's own fields as parameters:
   *
   * - `{ type: "limit", limit, actual }`, a value at or above a limit's
   *   warning threshold, gets `warnings.<limit>`;
   * - any other `{ type }` gets `warnings.<type>`.
   *
   * The catalogue must have the key, which the types check. Like `t()`, it
   * never throws: a warning without text renders as its key, with a
   * development-only warning.
   *
   * @example
   * ```ts
   * for (const warning of snapshot.warnings) announce(messages.warning(warning));
   * ```
   *
   * @param warning - The warning.
   */
  warning<Warning extends MessageWarning<Catalogue>>(warning: Warning): string;
}

/**
 * Creates the text for one catalogue, locale and set of host overrides
 * (ADR 0014, ADR 0019). Formatting uses `Intl` only, and formatters are
 * cached per locale.
 *
 * Plain text and placeholders given text need no `Intl`. A plural, a
 * number, or a placeholder with a format, such as `{size, fileSize}`, needs
 * the `Intl` constructor behind it, which an engine such as Hermes, in React
 * Native, may lack: `t()` then throws an `SdkError` with the code
 * `UNSUPPORTED_ENVIRONMENT`, and `details.feature` names it, such as
 * `Intl.PluralRules` (ADR 0069). Where the engine can't canonicalise a
 * locale, a well-formed tag is used as given.
 *
 * @example
 * ```ts
 * const messages = createMessages(en, { locale: props.locale, overrides: props.messages });
 * messages.t("result.saved", { size: 1_300_000 }); // "Saved 1.3 MB"
 * messages.error(error); // "This file is 73.4 MB. The limit is 50 MB."
 * ```
 *
 * @param catalogue - The SDK's English catalogue. It must contain
 *   `errors.UNKNOWN`, which `sdkCoreMessages` provides.
 * @param options - The locale and the host's overrides.
 * @throws `TypeError` if the catalogue itself contains a malformed message.
 * @public
 */
export function createMessages<
  const Catalogue extends MessageCatalogue & { readonly "errors.UNKNOWN": MessageValue },
  const Overrides extends MessageOverrides<Catalogue> = Record<never, never>,
>(
  catalogue: Catalogue,
  options: CreateMessagesOptions<Overrides & CheckedOverrides<Catalogue, Overrides>> = {},
): Messages<Catalogue> {
  checkSingleCopy();
  const locale = resolveLocale(options.locale);
  const compiled = new Map<string, CompiledMessage>();

  for (const [key, value] of Object.entries(catalogue)) {
    const message = compileMessage(value);
    if (message === undefined) {
      throw new TypeError(`The catalogue message "${key}" is malformed.`);
    }
    compiled.set(key, message);
  }

  const overrides: unknown = options.overrides;
  if (typeof overrides === "object" && overrides !== null) {
    for (const [key, value] of Object.entries(overrides)) {
      const english = compiled.get(key);
      if (english === undefined || !Object.hasOwn(catalogue, key)) {
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          warnInDevelopment(
            `Ignoring the message override "${key}": the catalogue has no such key.`,
          );
        }
        continue;
      }
      const message = compileMessage(value);
      if (message === undefined) {
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          warnInDevelopment(
            `Ignoring the message override "${key}": it's malformed. Using English.`,
          );
        }
        continue;
      }
      const allowed = parameterNames(english);
      const unknown = [...parameterNames(message)].filter((name) => !allowed.has(name));
      if (unknown.length > 0) {
        if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
          warnInDevelopment(
            `Ignoring the message override "${key}": it uses ${unknown.map((name) => `{${name}}`).join(", ")}, which the English message doesn't have. Using English.`,
          );
        }
        continue;
      }
      compiled.set(key, message);
    }
  }

  const render = (key: string, params: unknown): string => {
    const message = compiled.get(key);
    if (message === undefined) {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        warnInDevelopment(`There's no message "${key}".`);
      }
      return key;
    }
    if (message.kind === "text") {
      return renderTemplate(key, message.template, params, locale);
    }
    const count = readParam(params, message.selector);
    if (typeof count !== "number" || !Number.isFinite(count)) {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        warnInDevelopment(
          `The message "${key}" needs the number "${message.selector}" to choose a plural form.`,
        );
      }
      // One warning per mistake: the selector renders as empty, not as a
      // second missing parameter.
      const withSelector = {
        ...(typeof params === "object" ? params : {}),
        [message.selector]: "",
      };
      return renderTemplate(key, message.forms.other, withSelector, locale);
    }
    const category = pluralRules(locale).select(count) as PluralCategory;
    return renderTemplate(key, message.forms[category] ?? message.forms.other, params, locale);
  };

  return {
    locale,
    t: (key, ...args) => render(key, args[0]),
    error(error) {
      if (isSdkError(error)) {
        const details = error.details ?? {};
        const key = `errors.${error.code}`;
        const reason = readParam(details, "reason");
        if (typeof reason === "string" && compiled.has(`${key}.${reason}`)) {
          return render(`${key}.${reason}`, details);
        }
        if (compiled.has(key)) {
          return render(key, details);
        }
      }
      return render("errors.UNKNOWN", {});
    },
    warning(warning) {
      const limit = readParam(warning, "limit");
      const name =
        readParam(warning, "type") === "limit" && typeof limit === "string"
          ? limit
          : readParam(warning, "type");
      return render(`warnings.${typeof name === "string" ? name : ""}`, warning);
    },
  };
}

/**
 * @param locale - The requested locale.
 * @returns The canonical locale, or `"en"` when none or an invalid one is given.
 */
function resolveLocale(locale: string | undefined): string {
  if (locale === undefined) {
    return "en";
  }
  const canonical = canonicalLocale(locale);
  if (canonical !== undefined) {
    return canonical;
  }
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    warnInDevelopment(`"${locale}" isn't a valid locale. Using "en".`);
  }
  return "en";
}

/**
 * Reads a parameter as an own property, so that a placeholder named, say,
 * `constructor` can't read from the prototype chain.
 */
function readParam(params: unknown, name: string): unknown {
  return typeof params === "object" && params !== null && Object.hasOwn(params, name)
    ? (params as Record<string, unknown>)[name]
    : undefined;
}

function renderTemplate(key: string, template: Template, params: unknown, locale: string): string {
  let text = "";
  for (const part of template) {
    if (typeof part === "string") {
      text += part;
      continue;
    }
    const value = readParam(params, part.name);
    const formatted =
      value === undefined || value === null ? undefined : formatValue(value, part.format, locale);
    if (formatted === undefined) {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        warnInDevelopment(`The message "${key}" is missing a valid "${part.name}" parameter.`);
      }
      continue;
    }
    text += formatted;
  }
  return text;
}

function formatValue(value: unknown, format: Format, locale: string): string | undefined {
  switch (format) {
    case "default":
      if (typeof value === "number") {
        return numberFormat(locale).format(value);
      }
      return typeof value === "string" ? value : String(value);
    case "number":
      return typeof value === "number" ? numberFormat(locale).format(value) : undefined;
    case "fileSize":
      return typeof value === "number" && Number.isFinite(value)
        ? formatFileSize(locale, value)
        : undefined;
    case "megapixels":
      return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? numberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000_000)
        : undefined;
    case "duration":
      return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? formatDuration(locale, value)
        : undefined;
    case "date":
    case "time": {
      const date =
        value instanceof Date ? value : typeof value === "number" ? new Date(value) : undefined;
      if (date === undefined || Number.isNaN(date.getTime())) {
        return undefined;
      }
      const options: Intl.DateTimeFormatOptions =
        format === "date" ? { dateStyle: "medium" } : { timeStyle: "short" };
      return dateTimeFormat(locale, options).format(date);
    }
  }
}
