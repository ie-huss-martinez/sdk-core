import { defineMessages } from "@hussmartinez/sdk-core";

/**
 * English text for `@hussmartinez/ui`'s error codes. Applications and SDKs
 * spread it into their catalogue, next to `sdkCoreMessages`, so
 * `messages.error()` can describe a `UiError`. Components add their
 * text here as they arrive.
 *
 * @example
 * ```ts
 * export const en = defineMessages({ ...sdkCoreMessages, ...uiMessages });
 * ```
 *
 * @public
 */
export const uiMessages = /* @__PURE__ */ defineMessages({
  "colorField.swatches": "swatches",
  "dialog.close": "Close",
  "fileDropZone.choose": "Choose a file",
  "fileDropZone.chooseMultiple": "Choose files",
  "fileDropZone.hint": "or drop it here",
  "fileDropZone.hintMultiple": "or drop them here",
  "progress.label": "Progress",
  "reorderableList.moved": "{label} moved to position {position} of {count}",
  "reorderableList.control.checked": "{label}, checked",
  "reorderableList.control.notChecked": "{label}, not checked",
  "reorderableList.control.pressed": "{label}, pressed",
  "reorderableList.control.notPressed": "{label}, not pressed",
  "spinner.label": "Loading",
  "timelineClips.selected": "{label}, selected",
  "timelineClips.notSelected": "{label}, not selected",
  "errors.INVALID_THEME_TOKEN": "The theme setting {token} has a value that can't be used.",
  "errors.INVALID_THEME_SELECTOR": "The theme can't be applied to the selector {selector}.",
});
