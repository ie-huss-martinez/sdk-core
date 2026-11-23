import type { Messages } from "@hussmartinez/sdk-core";
import { useSyncExternalStore } from "react";
import type { NotesLibrary, NotesLibrarySnapshot } from "../core/session/library.js";
import type { NotesSession, NotesSessionSnapshot } from "../core/session/notebook-session.js";
import type { NotesEditorMessageCatalogue } from "../messages/editor.js";
import { useNotes } from "./context.js";

/**
 * The library of the closest `NotesEditor` or `NotesProvider`.
 *
 * @public
 */
export function useNotesLibrary(): NotesLibrary {
  return useNotes().library;
}

/**
 * The library's state, which re-renders the component when it changes.
 *
 * @public
 */
export function useNotesLibrarySnapshot(): NotesLibrarySnapshot {
  const { library } = useNotes();
  return useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
}

/**
 * An open notebook's state, which re-renders the component when it changes.
 *
 * @public
 */
export function useNotesSession(session: NotesSession): NotesSessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}

/**
 * The SDK's text, with the host's locale and overrides.
 *
 * @public
 */
export function useNotesMessages(): Messages<NotesEditorMessageCatalogue> {
  return useNotes().messages;
}
