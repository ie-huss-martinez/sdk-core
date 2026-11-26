import { createMemoryNotesStore, type NotesLibraryEvent } from "@hussmartinez/notes-sdk";
import {
  NotesEditor,
  type NotesEditorHandle,
  type NotesEditorView,
} from "@hussmartinez/notes-sdk/react";
import { type EditorPreferences, readEditorPreferences } from "@hussmartinez/ui";
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/notes-sdk/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    /** For the end-to-end tests: the editor's handle, what it reported, and any CSP violations. */
    notesSdk: {
      editor: NotesEditorHandle | null;
      events: NotesLibraryEvent[];
      views: NotesEditorView[];
      saved: { name: string; kind: string; size: number }[];
      violations: string[];
    };
  }
}

window.notesSdk = { editor: null, events: [], views: [], saved: [], violations: [] };
document.addEventListener("securitypolicyviolation", (event) => {
  window.notesSdk.violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
});

const query = new URLSearchParams(location.search);
// ?store=memory keeps nothing, so each screenshot starts from the same empty library.
const store = query.get("store") === "memory" ? createMemoryNotesStore() : undefined;

/**
 * `?app` makes the page behave as the family's apps do (sdk-core ADR 0067):
 * it opens a first visit in Easy mode, with the notebook's tools in their
 * dock, and keeps the person's preferences in `localStorage`, never a
 * cookie. Without it, the editor is embedded with its own defaults, as the
 * tests expect.
 */
const APP = query.has("app");
/** `?mode=easy|advanced|expert` starts the embedded editor in that mode. */
const MODE = (["easy", "advanced", "expert"] as const).find((mode) => query.get("mode") === mode);
const PREFERENCES = "editor-prefs:notes-example";

function readStored(): EditorPreferences {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PREFERENCES) ?? "null");
  } catch {
    stored = null;
  }
  // The notebook's own default layout is the dock (docs/adr/0008): a host
  // that keeps preferences passes it as a default too.
  return readEditorPreferences(stored, { mode: "easy", toolsLayout: "dock" });
}

function Editor() {
  const [preferences, setPreferences] = useState(readStored);
  return (
    <NotesEditor
      {...(store ? { store } : {})}
      {...(APP
        ? {
            preferences,
            onPreferencesChange: (next: EditorPreferences) => {
              setPreferences(next);
              try {
                localStorage.setItem(PREFERENCES, JSON.stringify(next));
              } catch {
                // Storage full or blocked: the preferences last until the page closes.
              }
            },
          }
        : {})}
      {...(MODE ? { defaultPreferences: { mode: MODE } } : {})}
      onEvent={(event) => window.notesSdk.events.push(event)}
      onViewChange={(view) => window.notesSdk.views.push(view)}
      ref={(editor) => {
        window.notesSdk.editor = editor;
      }}
    />
  );
}

// The host's layout: the editor fills the viewport. React sets these through
// the DOM, which style-src 'self' allows.
const root = document.getElementById("root") as HTMLElement;
for (const element of [document.documentElement, document.body, root]) {
  element.style.height = "100%";
  element.style.margin = "0";
}

createRoot(root).render(
  <main style={{ height: "100%", display: "grid", gridTemplateRows: "minmax(0, 1fr)" }}>
    <Editor />
  </main>,
);
