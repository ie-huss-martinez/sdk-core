import type { MessageOverrides } from "@hussmartinez/sdk-core";
import type { EditorElementContext, MountedEditor } from "@hussmartinez/sdk-core/element";
import type { EditorPreferences, HeadingLevel } from "@hussmartinez/ui";
import type { RefCallback } from "react";
import { createRoot } from "react-dom/client";
import { NotesError } from "../../core/errors/notes-error.js";
import type { NotesFilePolicyOverrides } from "../../core/errors/notes-limits.js";
import type { NotesPdfEngine } from "../../core/ports/notes-pdf.js";
import type { NotesRecorder } from "../../core/ports/notes-recorder.js";
import type { NotesStore } from "../../core/ports/notes-store.js";
import type { NotesEditorMessageCatalogue } from "../../messages/editor.js";
import { NotesEditor, type NotesEditorHandle } from "../NotesEditor.js";
import type { NotesEditorTheme } from "../notebook/notebook-frame.js";

/**
 * The properties of `<hm-notes-editor>`. `theme`, `locale`, `tools` and
 * `headingLevel` are also attributes (`heading-level`); the others are set
 * from script. The storage properties are read once, when the element
 * connects. `preferences` and `defaultPreferences` are the editor's
 * (sdk-core ADR 0067): set `preferences` again from the
 * `hm-notes-editor-preferences` event to keep them, or leave it unset and
 * the element keeps its own.
 *
 * @public
 */
export interface NotesEditorElementProps {
  /** The colour mode: `"light"`, `"dark"` or `"system"`. */
  theme?: string;
  locale?: string;
  /** The notebook tools to offer, by id. As an attribute, separated by spaces. */
  tools?: readonly string[];
  headingLevel?: HeadingLevel;
  store?: NotesStore;
  pdfEngine?: NotesPdfEngine;
  recorder?: NotesRecorder;
  assetsUrl?: string | URL;
  filePolicy?: NotesFilePolicyOverrides;
  messages?: MessageOverrides<NotesEditorMessageCatalogue>;
  /** The person's preferences, for a host that keeps them. */
  preferences?: EditorPreferences;
  /** Preferences to start with, when `preferences` isn't set. */
  defaultPreferences?: Partial<EditorPreferences>;
}

/**
 * The methods of `<hm-notes-editor>`. Each waits for the editor's first
 * render, and rejects with `ABORTED` if the element is removed before it.
 *
 * @public
 */
export interface NotesEditorElementMethods {
  /** Opens a notebook by id, saving and closing the one that's open. */
  open(notebook: string): Promise<void>;
  /** Saves the open notebook and goes back to the library. */
  close(): Promise<void>;
}

/**
 * The events of `<hm-notes-editor>`, each dispatched as
 * `hm-notes-editor-<name>` with its value as `detail`: `view`, when the
 * editor goes from the library to a notebook or back; `settings`, when a
 * writing setting changes; `preferences`, with the whole preferences when
 * the person changes one; and `event`, the anonymous usage events.
 *
 * @public
 */
export type NotesEditorElementEvent = "view" | "settings" | "preferences" | "event";

const MODES = new Set(["light", "dark", "system"]);

const removed = (): NotesError =>
  new NotesError("ABORTED", "The element was removed before its editor was ready.", {
    details: { reason: "removed" },
  });

/** Renders the React editor into the element's light DOM (sdk-core ADR 0040). */
export function mountNotesEditor(
  host: HTMLElement,
  initial: Partial<NotesEditorElementProps>,
  context: EditorElementContext<NotesEditorElementEvent>,
): MountedEditor<Partial<NotesEditorElementProps>, NotesEditorElementMethods> {
  const root = createRoot(host);
  const handle: { current: NotesEditorHandle | null } = { current: null };
  let resolveReady: () => void = () => {};
  let rejectReady: (reason: NotesError) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A removal before the first render rejects it, whether or not a call waits.
  ready.catch(() => {});
  const setHandle: RefCallback<NotesEditorHandle> = (editor) => {
    handle.current = editor;
    if (editor) resolveReady();
  };
  const { dispatch } = context;

  const render = (values: Partial<NotesEditorElementProps>) => {
    // The colour mode is ui's attribute on the element itself, so changing it
    // never re-renders the editor.
    const { theme, ...props } = values;
    const mode = theme && MODES.has(theme) ? (theme as NotesEditorTheme) : undefined;
    if (mode) host.setAttribute("data-hm-theme", mode);
    else host.removeAttribute("data-hm-theme");
    root.render(
      <NotesEditor
        ref={setHandle}
        {...props}
        // A theme the host set hides the editor's own theme toggle and setting.
        {...(mode ? { theme: mode } : {})}
        onViewChange={(view) => dispatch("view", view)}
        onPreferencesChange={(preferences) => dispatch("preferences", preferences)}
        onSettingsChange={(settings) => dispatch("settings", settings)}
        onEvent={(event) => dispatch("event", event)}
      />,
    );
  };
  render(initial);

  const call = async <Result,>(
    method: (editor: NotesEditorHandle) => Result,
  ): Promise<Awaited<Result>> => {
    if (!handle.current) await ready;
    const editor = handle.current;
    if (!editor) throw removed();
    return await method(editor);
  };

  return {
    update: render,
    unmount: () => {
      root.unmount();
      rejectReady(removed());
    },
    handle: {
      open: (notebook) => call((editor) => editor.open(notebook)),
      close: () => call((editor) => editor.close()),
    },
  };
}
