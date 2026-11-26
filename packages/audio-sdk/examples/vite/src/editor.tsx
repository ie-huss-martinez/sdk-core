import "@hussmartinez/ui/styles.css";
import "@hussmartinez/audio-sdk/styles.css";
import type { AudioEditorMessageCatalogue, AudioPlan } from "@hussmartinez/audio-sdk";
import {
  AudioEditor,
  type AudioEditorHandle,
  type AudioEditorProps,
} from "@hussmartinez/audio-sdk/react";
import type { MessageOverrides } from "@hussmartinez/sdk-core";
import { type EditorPreferences, readEditorPreferences } from "@hussmartinez/ui";
import { useState } from "react";
import { createRoot } from "react-dom/client";

/** The editor, as a host renders it: ui's stylesheet first, then the SDK's (sdk-core ADR 0036). */
let latest: AudioPlan | null = null;

/**
 * The editor's handle, once it has mounted. React commits the editor in a
 * task of its own, which can run after the page's `load` event, so a test
 * waits for it rather than finding no editor yet.
 */
let mount: (editor: AudioEditorHandle) => void = () => {};
const mounted = new Promise<AudioEditorHandle>((resolve) => {
  mount = resolve;
});

/**
 * Text much longer than English, as a translation can be, for the visual
 * tests' long-text states (sdk-core ADR 0048): `?long-text`.
 */
const LONG_TEXT: MessageOverrides<AudioEditorMessageCatalogue> = {
  "editor.empty":
    "Ziehen Sie eine Audiodatei hierher oder wählen Sie eine aus. Sie bleibt jederzeit auf diesem Gerät.",
  "timeline.track": "Tonspur Nummer {index}",
  "track.mute": "Stummschalten",
  "track.solo": "Allein wiedergeben",
  "track.gain": "Lautstärke der Spur",
  "rename.title": "Die Tonspur umbenennen",
  "rename.name": "Name der Tonspur",
  "rename.description": "Lassen Sie das Feld leer, wenn die Spur keinen Namen haben soll.",
  "rename.save": "Umbenennen",
  "inspector.recording": "Aufnahme und ihre Eigenschaften",
  "inspector.length": "Gesamtlänge",
  "inspector.sampleRate": "Abtastrate der Aufnahme",
  "inspector.tracks": "Anzahl der Tonspuren",
  "inspector.masterGain": "Gesamtlautstärke",
  "inspector.masterGainExact": "Gesamtlautstärke, in Dezibel",
  "inspector.channels": "Kanäle",
  "inspector.mono": "Mono, ein Kanal",
  "inspector.stereo": "Stereo, zwei Kanäle",
  "metadata.title": "Titel des Stücks",
  "metadata.artist": "Interpretin oder Interpret",
  "export.title": "Aufnahme als Datei exportieren",
  "export.description": "Schreiben Sie die Aufnahme als WAV-Datei auf dieses Gerät.",
  "export.noMetadata": "In die Datei werden keine Metadaten geschrieben.",
  "export.private":
    "Nur die Mischung und diese Metadaten werden geschrieben. Nichts verlässt Ihr Gerät.",
  "export.cancel": "Abbrechen",
  "export.confirm": "Jetzt exportieren",
};
/**
 * A right-to-left host, as a Hebrew page is: `?lang=he` sets the page's
 * `lang` and `dir` and passes these overrides. The rest stays English. The
 * Hebrew is illustrative, for layout, not a reviewed translation.
 */
const HEBREW: MessageOverrides<AudioEditorMessageCatalogue> = {
  "timeline.summary": {
    $plural: "count",
    one: "רצועה אחת, באורך {duration}.",
    two: "שתי רצועות, באורך {duration}.",
    other: "{count} רצועות, באורך {duration}.",
  },
  "timeline.track": "רצועה {index}",
  "timeline.lane.muted": "{track}, מושתקת",
  "timeline.selection": "בחירה מ-{start} עד {end}, {tracks}",
  "track.mute": "השתקה",
  "track.solo": "סולו",
  "track.gain": "עוצמה",
  "inspector.clip": "קטע ב{track}",
  "inspector.recording": "הקלטה",
  "inspector.selection": "בחירה",
  "inspector.selectionGain": "עוצמת הבחירה, בדציבלים",
  "inspector.start": "התחלה",
  "inspector.gain": "עוצמה",
  "inspector.gainExact": "עוצמה, בדציבלים",
  "inspector.fadeIn": "הגברה הדרגתית, בשניות",
  "inspector.fadeOut": "החלשה הדרגתית, בשניות",
  "inspector.curve.linear": "ליניארי",
  "inspector.curve.equalPower": "הספק שווה",
};

/**
 * `?dir=rtl` lays the page out right to left with only `dir`, and English
 * text, so nothing that keys on a right-to-left `lang` can stand in for it.
 */
const params = new URLSearchParams(location.search);
const hebrew = params.get("lang") === "he";
if (hebrew) document.documentElement.lang = "he";
if (hebrew || params.get("dir") === "rtl") document.documentElement.dir = "rtl";
const translation = params.has("long-text")
  ? { messages: LONG_TEXT, locale: "de" }
  : hebrew
    ? { messages: HEBREW, locale: "he" }
    : undefined;

declare global {
  interface Window {
    /** The editor, for the end-to-end tests. */
    audioEditor: {
      /** Opens a recording, waiting for the editor to mount first. */
      open(bytes: ArrayBuffer): Promise<void>;
      /** Adds a recording on a track of its own. */
      insert(bytes: ArrayBuffer): Promise<void>;
      /** The latest plan, from `onChange`, or `null` before one opens. */
      plan(): AudioPlan | null;
    };
  }
}

window.audioEditor = {
  open: async (bytes) => (await mounted).open(new Blob([bytes], { type: "audio/wav" })),
  insert: async (bytes) => (await mounted).insert(new Blob([bytes], { type: "audio/wav" })),
  plan: () => latest,
};

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
const PREFERENCES = "editor-prefs:audio-example";

function readStored(): EditorPreferences {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PREFERENCES) ?? "null");
  } catch {
    stored = null;
  }
  return readEditorPreferences(stored, { mode: "easy" });
}

const shared: AudioEditorProps = {
  ...translation,
  onChange: (plan) => {
    latest = plan;
  },
};

const attach = (editor: AudioEditorHandle | null) => {
  if (editor) mount(editor);
};

function App() {
  const [preferences, setPreferences] = useState(readStored);
  return (
    <AudioEditor
      {...shared}
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
    />
  );
}

const element = document.querySelector<HTMLElement>("#editor");
if (element) {
  if (APP) {
    // The app fills the window: the page's heading steps aside. React sets
    // these through the DOM, which style-src 'self' allows.
    document.querySelector("h1")?.remove();
    for (const each of [document.documentElement, document.body, element]) {
      each.style.height = "100%";
      each.style.margin = "0";
    }
    const main = element.parentElement;
    if (main) main.style.height = "100%";
  }
  createRoot(element).render(
    APP ? (
      <App />
    ) : (
      <div style={{ height: "80vh" }}>
        <AudioEditor
          {...shared}
          ref={attach}
          {...(MODE ? { defaultPreferences: { mode: MODE } } : {})}
        />
      </div>
    ),
  );
}
