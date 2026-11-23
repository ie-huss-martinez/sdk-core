import { createMessages, type MessageOverrides } from "@hussmartinez/sdk-core";
import type { IconComponent } from "@hussmartinez/ui/react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createOpfsNotesStore } from "../adapters/opfs-store/opfs-store.js";
import { createNotesPdfEngine } from "../adapters/pdf/pdf-engine.js";
import { createMediaNotesRecorder } from "../adapters/recorder/media-recorder.js";
import { type NotesFilePolicyOverrides, notesLimits } from "../core/errors/notes-limits.js";
import { createNotesId } from "../core/model/ids.js";
import type { NotesPdfEngine } from "../core/ports/notes-pdf.js";
import type { NotesRecorder } from "../core/ports/notes-recorder.js";
import type { NotesStore } from "../core/ports/notes-store.js";
import {
  createNotesLibrary,
  type NotesLibrary,
  type NotesLibraryEvent,
} from "../core/session/library.js";
import type { NotesEditorMessageCatalogue } from "../messages/editor.js";
import { NotesContext, type NotesContextValue } from "./context.js";
import { notesEditorMessages } from "./editor-messages.js";
import { download } from "./files.js";
import { notesIcons } from "./icons.js";

/**
 * What a file handed to the host is.
 *
 * @public
 */
export interface NotesSavedFileInfo {
  /** The name the browser download would have had, cleaned as a file name. */
  readonly name: string;
  /** An exported PDF, or a backup of notebooks. */
  readonly kind: "pdf" | "backup";
}

/**
 * Props for {@link NotesProvider}. The storage props are read once, when the
 * provider first renders.
 *
 * @public
 */
export interface NotesProviderProps {
  /**
   * Where the library is kept. Defaults to this device, in the browser's
   * private file system with an index in IndexedDB (docs/adr/0003).
   */
  readonly store?: NotesStore;
  /** The PDF engine. Defaults to `@hussmartinez/pdf-sdk`'s, in workers. */
  readonly pdfEngine?: NotesPdfEngine;
  /** What records sound. Defaults to the browser's microphone. */
  readonly recorder?: NotesRecorder;
  /**
   * Where your application serves `@hussmartinez/pdf-sdk`'s `dist/assets/`,
   * for the default PDF engine. By default, its workers are inlined.
   */
  readonly assetsUrl?: string | URL;
  /** File limits (docs/adr/0004). */
  readonly filePolicy?: NotesFilePolicyOverrides;
  /** Anonymous usage events. They never carry titles, text, ink or file names. */
  readonly onEvent?: (event: NotesLibraryEvent) => void;
  /**
   * Receives a file the user asked for, an exported PDF or a backup, in
   * place of the browser downloading it. If it throws or rejects, the
   * editor says the file couldn't be written.
   */
  readonly onSaveFile?: (file: Blob, info: NotesSavedFileInfo) => void | Promise<void>;
  /**
   * Text overrides, typed against the editor's English catalogue, which
   * includes ui's text for the ui components it renders (sdk-core ADR 0046).
   */
  readonly messages?: MessageOverrides<NotesEditorMessageCatalogue>;
  /** The locale for numbers, dates and plurals. Defaults to `"en"`. */
  readonly locale?: string;
  /** Icon components by name, over the SDK's own. */
  readonly icons?: Readonly<Record<string, IconComponent>>;
  /** The components that use the library, such as `NotesLibraryView`. */
  readonly children?: ReactNode;
}

interface Owned {
  readonly library: NotesLibrary;
  readonly pdf: NotesPdfEngine;
  readonly recorder: NotesRecorder;
  pending?: ReturnType<typeof setTimeout>;
  dispose(): void;
}

/**
 * Creates what the provider owns. Nothing touches the browser, and nothing
 * is held, until the library loads: so this is safe during server rendering
 * (sdk-core ADR 0007), and an instance React makes and drops, as its
 * development mode does, leaves nothing behind.
 */
function own(props: NotesProviderProps): Owned {
  const store = props.store ?? createOpfsNotesStore();
  const pdf =
    props.pdfEngine ??
    createNotesPdfEngine(props.assetsUrl === undefined ? {} : { assetsUrl: props.assetsUrl });
  const library = createNotesLibrary({
    store,
    pdf,
    ...(props.filePolicy ? { filePolicy: props.filePolicy } : {}),
    ...(props.onEvent ? { onEvent: props.onEvent } : {}),
  });
  return {
    library,
    pdf,
    recorder: props.recorder ?? createMediaNotesRecorder(),
    dispose() {
      // The notebooks still open are saved first: the store closes only once
      // nothing is left to write to it.
      void library.close().finally(() => {
        // A store or an engine the host passed is the host's to close.
        if (!props.store) store.close();
        if (!props.pdfEngine) void pdf.destroy().catch(() => undefined);
      });
    },
  };
}

/**
 * Makes a library and the SDK's text available to the components and hooks
 * below it, such as `NotesLibraryView` and `useNotesLibrary` (sdk-core
 * ADR 0008). `NotesEditor` includes one.
 *
 * @example
 * ```tsx
 * <NotesProvider locale="de" messages={{ "library.title": "Notizbücher" }}>
 *   <NotesLibraryView onOpen={open} />
 * </NotesProvider>
 * ```
 *
 * @public
 */
export function NotesProvider(props: NotesProviderProps): ReactNode {
  const { messages: overrides, locale = "en", icons, onSaveFile, filePolicy, children } = props;
  const [owned] = useState(() => own(props));

  useEffect(() => {
    // React's development mode unmounts and mounts again at once, so the
    // disposal waits a tick, and a remount cancels it.
    if (owned.pending !== undefined) clearTimeout(owned.pending);
    return () => {
      owned.pending = setTimeout(() => owned.dispose(), 0);
    };
  }, [owned]);

  const messages = useMemo(
    () => createMessages(notesEditorMessages, { locale, ...(overrides ? { overrides } : {}) }),
    [locale, overrides],
  );
  const policy = useMemo(() => notesLimits.resolve(filePolicy), [filePolicy]);
  const value: NotesContextValue = useMemo(
    () => ({
      library: owned.library,
      messages,
      icons: { ...notesIcons, ...icons },
      pdf: owned.pdf,
      recorder: owned.recorder,
      newId: createNotesId,
      policy,
      saveFile: async (file, name, kind) => {
        if (onSaveFile) await onSaveFile(file, { name, kind });
        else download(file, name);
      },
    }),
    [owned, messages, icons, policy, onSaveFile],
  );
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}
