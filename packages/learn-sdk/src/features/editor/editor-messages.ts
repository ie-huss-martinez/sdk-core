import { defineMessages, type MessageOverrides, type Messages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import { editorText } from "../../messages/editor-en.js";
import { learnMessages } from "../../messages/en.js";

/**
 * LearnEditor's one catalogue (ADR 0008, sdk-core ADR 0059): learn-sdk's
 * server-safe text, `ui`'s, and the editor's own. Override any of it with
 * `messages` on `LearnEditor`.
 *
 * @public
 */
export const learnEditorMessages = /* @__PURE__ */ defineMessages({
  ...learnMessages,
  ...uiMessages,
  ...editorText,
});

/**
 * The type of `learnEditorMessages`, from `./react`, for typing overrides with
 * `MessageOverrides<LearnEditorMessageCatalogue>`.
 *
 * @public
 */
export type LearnEditorMessageCatalogue = typeof learnMessages &
  typeof uiMessages &
  typeof editorText;

/** @internal */
export type LearnEditorMessages = Messages<LearnEditorMessageCatalogue>;

/** @internal */
export type LearnEditorMessageOverrides = MessageOverrides<LearnEditorMessageCatalogue>;
