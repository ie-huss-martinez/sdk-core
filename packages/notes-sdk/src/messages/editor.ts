import type { uiMessages } from "@hussmartinez/ui";
import type { notesEditorText } from "./editor-en.js";
import type { notesMessages } from "./en.js";

/**
 * The shape of the editor's catalogue, `notesEditorMessages`, from the React
 * entry: the SDK's errors and warnings, `@hussmartinez/ui`'s text for the ui
 * components the editor renders (sdk-core ADR 0046), and the text of the
 * library, the open notebook, its tools and its dialogs. Type a host's
 * overrides with `MessageOverrides<NotesEditorMessageCatalogue>`.
 *
 * It's a type only, so the server-safe entry that exports it carries no
 * interface text (sdk-core ADR 0059).
 *
 * @public
 */
export type NotesEditorMessageCatalogue = typeof notesMessages &
  typeof uiMessages &
  typeof notesEditorText;
