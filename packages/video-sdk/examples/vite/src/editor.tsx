import "@hussmartinez/ui/styles.css";
import "@hussmartinez/video-sdk/styles.css";
import "./example.css";
import { type EditorPreferences, readEditorPreferences } from "@hussmartinez/ui";
import { VideoEditor } from "@hussmartinez/video-sdk/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

const params = new URLSearchParams(location.search);

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
const PREFERENCES = "editor-prefs:video-example";

function readStored(): EditorPreferences {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PREFERENCES) ?? "null");
  } catch {
    stored = null;
  }
  return readEditorPreferences(stored, { mode: "easy" });
}

function App({ assetsUrl }: { readonly assetsUrl: string | undefined }) {
  const [preferences, setPreferences] = useState(readStored);
  return (
    <VideoEditor
      {...(assetsUrl ? { assetsUrl } : {})}
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

/**
 * The editor, as a host renders it: ui's stylesheet first, then the SDK's
 * (sdk-core ADR 0036). The self-hosted page names where it serves the
 * package's assets; the inline page starts the workers from blob: URLs.
 */
const element = document.querySelector<HTMLElement>("#editor");
if (element) {
  const assetsUrl = element.dataset["assetsUrl"];
  // As an app, the page is the editor: example.css drops the heading and fills the window.
  if (APP) document.documentElement.dataset["app"] = "";
  createRoot(element).render(
    <div className="example-frame">
      {APP ? (
        <App assetsUrl={assetsUrl} />
      ) : (
        <VideoEditor
          {...(assetsUrl ? { assetsUrl } : {})}
          {...(MODE ? { defaultPreferences: { mode: MODE } } : {})}
        />
      )}
    </div>,
  );
}
