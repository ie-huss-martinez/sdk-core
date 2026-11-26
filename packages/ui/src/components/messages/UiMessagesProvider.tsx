import { createMessages, type Messages, sdkCoreMessages } from "@hussmartinez/sdk-core";
import { createContext, type ReactElement, type ReactNode, useContext } from "react";
import { checkSingleCopy } from "../../internal/single-copy.js";
import { uiCoreText } from "../../messages/core.js";
import { uiMessages } from "../../messages/en.js";

/**
 * Messages that include `ui`'s text: any sdk-core `Messages` object whose
 * catalogue spreads `uiMessages`.
 *
 * @public
 */
export type UiMessages = Messages<typeof uiMessages>;

const UiMessagesContext = /* @__PURE__ */ createContext<UiMessages | undefined>(undefined);

/** English text by the part of the catalogue it holds. */
type EnglishPart = Readonly<Record<string, unknown>>;

let english: WeakMap<EnglishPart, UiMessages> | undefined;

/**
 * English text for one part of the catalogue, created on first use so
 * importing this module does nothing. Without a provider, a component ships
 * only the part it uses (docs/adr/0012).
 */
function defaultMessages(part: EnglishPart): UiMessages {
  english ??= new WeakMap();
  let messages = english.get(part);
  if (!messages) {
    messages = createMessages({
      ...sdkCoreMessages,
      ...uiCoreText,
      ...part,
    }) as unknown as UiMessages;
    english.set(part, messages);
  }
  return messages;
}

/**
 * Props of {@link UiMessagesProvider}.
 *
 * @public
 */
export interface UiMessagesProviderProps {
  /** Your catalogue's messages, created with sdk-core's `createMessages`. */
  readonly messages: UiMessages;
  readonly children?: ReactNode;
}

/**
 * Gives `ui`'s components their text (ADR 0014). SDKs and applications pass
 * their message catalogue once, here; a component's own text props still win.
 * Without a provider, components use English.
 *
 * @example
 * ```tsx
 * const messages = createMessages({ ...sdkCoreMessages, ...uiMessages, ...en }, { locale });
 * <UiMessagesProvider messages={messages}>{editor}</UiMessagesProvider>
 * ```
 *
 * @public
 */
export function UiMessagesProvider({ messages, children }: UiMessagesProviderProps): ReactElement {
  checkSingleCopy();
  return <UiMessagesContext.Provider value={messages}>{children}</UiMessagesContext.Provider>;
}

/**
 * The messages from the closest {@link UiMessagesProvider}, or English.
 *
 * @public
 */
export function useUiMessages(): UiMessages {
  checkSingleCopy();
  return useContext(UiMessagesContext) ?? defaultMessages(uiMessages);
}

/**
 * {@link useUiMessages} for ui's own components: without a provider, English
 * from only the part of the catalogue the component uses.
 */
export function useUiMessagesFrom(part: EnglishPart): UiMessages {
  checkSingleCopy();
  return useContext(UiMessagesContext) ?? defaultMessages(part);
}

/** Keys of `uiMessages` whose English text has no placeholders. */
type PlainMessageKey = {
  [Key in keyof typeof uiMessages]: (typeof uiMessages)[Key] extends string
    ? (typeof uiMessages)[Key] extends `${string}{${string}`
      ? never
      : Key
    : never;
}[keyof typeof uiMessages];

/**
 * A component's text for a message without placeholders: from the closest
 * {@link UiMessagesProvider}, or the English text as it is. Unlike
 * {@link useUiMessages}, it doesn't create a messages object when there's no
 * provider, so components using only English don't ship the formatter.
 */
export function useUiText(key: PlainMessageKey, part: EnglishPart = uiCoreText): string {
  checkSingleCopy();
  const messages = useContext(UiMessagesContext);
  return messages ? messages.t(key) : (part[key] as string);
}

/**
 * {@link useUiText} for a component whose text is a part of its own. It
 * names the part, and nothing here falls back to the core part for it, so
 * the component doesn't ship the other components' text.
 */
export function useUiPartText<Part extends EnglishPart>(
  part: Part,
  key: keyof Part & PlainMessageKey,
): string {
  checkSingleCopy();
  const messages = useContext(UiMessagesContext);
  return messages ? messages.t(key as PlainMessageKey) : (part[key] as string);
}

/**
 * Like {@link useUiText}, for a component that looks up many keys, or keys
 * chosen at render: one hook call, and a function for every key.
 */
export function useUiTextLookup(part: EnglishPart = uiCoreText): (key: PlainMessageKey) => string {
  checkSingleCopy();
  const messages = useContext(UiMessagesContext);
  return (key) => (messages ? messages.t(key) : (part[key] as string));
}

/**
 * The locale of the enclosing `UiMessagesProvider`, or `"en"` without one.
 * It doesn't create the default messages, so components that only need the
 * locale don't ship them.
 */
export function useUiLocale(): string {
  checkSingleCopy();
  return useContext(UiMessagesContext)?.locale ?? "en";
}
