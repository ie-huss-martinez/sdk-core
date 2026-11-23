"use client";

/**
 * React editor of the notes SDK: `NotesEditor`, its building blocks and
 * hooks.
 *
 * @remarks
 * A client entry: it starts with `"use client"`, which the build keeps
 * (sdk-core ADR 0007). React and React DOM 18.3 or later are optional peer
 * dependencies.
 *
 * @packageDocumentation
 */

export type {
  NotesEraserMode,
  NotesInkSettings,
  NotesPointerTool,
  NotesTool,
  NotesToolContext,
  NotesToolState,
} from "./features/tool-types.js";
export { DEFAULT_INK_SETTINGS } from "./features/tool-types.js";
export { notesTools } from "./features/tools.js";
export { notesEditorMessages } from "./react/editor-messages.js";
export {
  useNotesLibrary,
  useNotesLibrarySnapshot,
  useNotesMessages,
  useNotesSession,
} from "./react/hooks.js";
export { notesIcons } from "./react/icons.js";
export type { NotesLibraryViewProps } from "./react/library/NotesLibraryView.js";
export { NotesLibraryView } from "./react/library/NotesLibraryView.js";
export type {
  NotesEditorHandle,
  NotesEditorPart,
  NotesEditorProps,
  NotesEditorView,
} from "./react/NotesEditor.js";
export { NotesEditor } from "./react/NotesEditor.js";
export type { NotesProviderProps, NotesSavedFileInfo } from "./react/NotesProvider.js";
export { NotesProvider } from "./react/NotesProvider.js";
export type { NotesToolbarProps } from "./react/notebook/NotebookToolbar.js";
export { NotesToolbar } from "./react/notebook/NotebookToolbar.js";
export type { NotesNotebookHandle, NotesNotebookProps } from "./react/notebook/NotesNotebook.js";
export { NotesNotebook } from "./react/notebook/NotesNotebook.js";
