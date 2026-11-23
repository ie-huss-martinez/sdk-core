import { createMemoryNotesStore, type NotesLibraryEvent } from "@hussmartinez/notes-sdk";
import {
  NotesEditor,
  type NotesEditorHandle,
  type NotesEditorView,
} from "@hussmartinez/notes-sdk/react";
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/notes-sdk/styles.css";
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

// The host's layout: the editor fills the viewport. React sets these through
// the DOM, which style-src 'self' allows.
const root = document.getElementById("root") as HTMLElement;
for (const element of [document.documentElement, document.body, root]) {
  element.style.height = "100%";
  element.style.margin = "0";
}

createRoot(root).render(
  <main style={{ height: "100%", display: "grid", gridTemplateRows: "minmax(0, 1fr)" }}>
    <NotesEditor
      {...(store ? { store } : {})}
      onEvent={(event) => window.notesSdk.events.push(event)}
      onViewChange={(view) => window.notesSdk.views.push(view)}
      ref={(editor) => {
        window.notesSdk.editor = editor;
      }}
    />
  </main>,
);
