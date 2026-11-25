import "@hussmartinez/ui/styles.css";
import "@hussmartinez/image-sdk/styles.css";
import type { ImageCommand } from "@hussmartinez/image-sdk";
import {
  ImageEditor,
  type ImageEditorHandle,
  type ImageEditorProps,
} from "@hussmartinez/image-sdk/react";
import { type EditorPreferences, readEditorPreferences } from "@hussmartinez/ui";
import { useState } from "react";
import { createRoot } from "react-dom/client";

/** The editor, as a host renders it: ui's stylesheet first, then the SDK's (sdk-core ADR 0036). */
const handle: { current: ImageEditorHandle | null } = { current: null };

/**
 * The editor's handle, once it has mounted. React commits the editor in a
 * task of its own, which can run after the page's `load` event: a test that
 * opens a file as soon as the page has loaded would otherwise find no editor
 * yet, and its file would be dropped without a word.
 */
let mount: (editor: ImageEditorHandle) => void = () => {};
const mounted = new Promise<ImageEditorHandle>((resolve) => {
  mount = resolve;
});
const attach = (editor: ImageEditorHandle | null) => {
  handle.current = editor;
  if (editor) mount(editor);
};

/**
 * Text much longer than English, as a translation can be, for the visual
 * tests' long-text states (sdk-core ADR 0048): `?long-text`. `?dir=rtl` lays
 * the page out right to left.
 */
const LONG_TEXT: NonNullable<ImageEditorProps["messages"]> = {
  "editor.empty":
    "Öffnen Sie ein Bild, um mit der Bearbeitung zu beginnen. Es bleibt jederzeit auf diesem Gerät.",
  "editor.choose": "Ein Bild von diesem Gerät auswählen",
  "inspector.adjust": "Anpassungen",
  "inspector.filters": "Bildfilter",
  "inspector.info": "Informationen",
  "develop.temperature": "Farbtemperatur (Weißabgleich)",
  "develop.highlights": "Lichter und sehr helle Bildbereiche",
  "develop.resetAll": "Alle Anpassungen zurücksetzen",
  "export.title": "Bild als Datei exportieren",
  "export.fields": "Angaben, die in die Datei geschrieben werden",
  "export.removed": "Aus der exportierten Datei entfernte Metadaten",
  "export.confirm": "Jetzt exportieren",
  "export.cancel": "Abbrechen",
};
const params = new URLSearchParams(location.search);
if (params.get("dir") === "rtl") document.documentElement.dir = "rtl";
const messages = params.has("long-text") ? LONG_TEXT : undefined;

declare global {
  interface Window {
    /** The editor's handle, for the end-to-end tests. */
    imageEditor: {
      /** Opens a file, waiting for the editor to mount first: a call is never dropped. */
      open(bytes: ArrayBuffer): Promise<void>;
      status(): string;
      plan(): unknown;
      /** Runs commands as a host does, such as inserting layers. */
      execute(commands: unknown): void;
    };
  }
}

window.imageEditor = {
  open: async (bytes) => (await mounted).open(new Blob([bytes])),
  status: () => handle.current?.session.getSnapshot().status ?? "empty",
  plan: () => handle.current?.session.getSnapshot().plan ?? null,
  execute: (commands) => {
    // Commands need an open image, so the editor has mounted: fail loudly otherwise.
    if (!handle.current) throw new Error("The editor hasn't mounted yet.");
    handle.current.execute(commands as ImageCommand[]);
  },
};

const element = document.querySelector("#editor");
/**
 * `?app` makes the page behave as the family's apps do (sdk-core ADR 0067):
 * the editor fills the window, opens a first visit in Easy mode, and the
 * page keeps the person's preferences in `localStorage`, never a cookie.
 * Without it, the editor is embedded with its own defaults, as the tests
 * expect.
 */
const APP = params.has("app");
/** `?mode=easy|advanced|expert` starts the embedded editor in that mode. */
const MODE = (["easy", "advanced", "expert"] as const).find((mode) => params.get("mode") === mode);
const PREFERENCES = "editor-prefs:image-example";

function readStored(): EditorPreferences {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PREFERENCES) ?? "null");
  } catch {
    stored = null;
  }
  return readEditorPreferences(stored, { mode: "easy" });
}

function App() {
  const [preferences, setPreferences] = useState(readStored);
  return (
    <ImageEditor
      ref={attach}
      preferences={preferences}
      onPreferencesChange={(next) => {
        setPreferences(next);
        try {
          localStorage.setItem(PREFERENCES, JSON.stringify(next));
        } catch {
          // Storage full or blocked: the preferences last until the page closes.
        }
      }}
      {...(messages ? { messages, locale: "de" } : {})}
    />
  );
}

if (element) {
  if (APP) document.body.classList.add("app");
  createRoot(element).render(
    <div style={{ height: APP ? "100dvh" : "70vh" }}>
      {APP ? (
        <App />
      ) : (
        <ImageEditor
          ref={attach}
          {...(messages ? { messages, locale: "de" } : {})}
          {...(params.has("failure") ? { assetsUrl: "/image-sdk-failure/" } : {})}
          {...(MODE ? { defaultPreferences: { mode: MODE } } : {})}
        />
      )}
    </div>,
  );
}
