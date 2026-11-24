import { uiColorPickerText } from "./color-picker.js";
import { uiCoreText } from "./core.js";
import { uiEditorText } from "./editor.js";

/** Joins the parts. A pure call with plain arguments, so bundlers can drop it. */
function allText(): typeof uiCoreText & typeof uiEditorText & typeof uiColorPickerText {
  return { ...uiCoreText, ...uiEditorText, ...uiColorPickerText };
}

/**
 * English text for `@hussmartinez/ui`'s components and error codes. Applications and SDKs
 * spread it into their catalogue, next to `sdkCoreMessages`, so
 * `messages.error()` can describe a `UiError`. It joins the parts in
 * `core.ts`, `editor.ts` and `color-picker.ts`.
 *
 * @example
 * ```ts
 * export const en = defineMessages({ ...sdkCoreMessages, ...uiMessages });
 * ```
 *
 * @public
 */
export const uiMessages = /* @__PURE__ */ allText();
