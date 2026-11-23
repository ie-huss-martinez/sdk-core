import { defineMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import type { NotesEditorMessageCatalogue } from "../messages/editor.js";
import { notesEditorText } from "../messages/editor-en.js";
import { notesMessages } from "../messages/en.js";

/**
 * The English message catalogue of the SDK's components: `notesMessages`,
 * with sdk-core's text, errors and warnings; `@hussmartinez/ui`'s, for the
 * ui components the editor renders (sdk-core ADR 0046); and the text of the
 * library, the open notebook, its tools and its dialogs.
 *
 * `NotesEditor` and `NotesProvider` each build one `Messages` object from
 * it, with the host's locale and overrides, and give the same object to the
 * SDK's components and to ui's. Override any of its keys through their
 * `messages` prop, typed with `NotesEditorMessageCatalogue`.
 *
 * It's defined in the React entry, so the server-safe `.` entry and its
 * `notesMessages` carry no interface text (sdk-core ADR 0059).
 *
 * @public
 */
export const notesEditorMessages: NotesEditorMessageCatalogue = /* @__PURE__ */ (() =>
  defineMessages({
    ...notesMessages,
    ...uiMessages,
    ...notesEditorText,
  }))();
