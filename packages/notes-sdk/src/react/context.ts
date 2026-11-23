import type { Messages } from "@hussmartinez/sdk-core";
import type { IconComponent } from "@hussmartinez/ui/react";
import { createContext, useContext } from "react";
import type { NotesFilePolicy } from "../core/errors/notes-limits.js";
import type { NotesPdfEngine } from "../core/ports/notes-pdf.js";
import type { NotesRecorder } from "../core/ports/notes-recorder.js";
import type { NotesLibrary } from "../core/session/library.js";
import type { NotesEditorMessageCatalogue } from "../messages/editor.js";

/** What the editor shares with every notes component below it. */
export interface NotesContextValue {
  readonly library: NotesLibrary;
  readonly messages: Messages<NotesEditorMessageCatalogue>;
  readonly icons: Readonly<Record<string, IconComponent>>;
  readonly pdf: NotesPdfEngine | undefined;
  readonly recorder: NotesRecorder;
  readonly newId: () => string;
  readonly policy: NotesFilePolicy;
  /** Hands a file the user asked for to the host, or to the browser as a download. */
  readonly saveFile: (file: Blob, name: string, kind: "pdf" | "backup") => Promise<void>;
}

export const NotesContext = /* @__PURE__ */ createContext<NotesContextValue | undefined>(undefined);

/** The editor's shared values. Throws outside an editor or a `NotesProvider`. */
export function useNotes(): NotesContextValue {
  const value = useContext(NotesContext);
  if (!value) {
    throw new Error("Notes components must be rendered inside <NotesEditor> or <NotesProvider>.");
  }
  return value;
}
