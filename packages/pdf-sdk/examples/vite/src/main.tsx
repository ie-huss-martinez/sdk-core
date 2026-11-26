import { PdfEditor, type PdfEditorHandle, type PdfEditorProps } from "@hussmartinez/pdf-sdk/react";
import { type EditorPreferences, readEditorPreferences } from "@hussmartinez/ui";
import "@hussmartinez/ui/styles.css";
import "@hussmartinez/pdf-sdk/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";

declare global {
  interface Window {
    /** For the end-to-end tests: the editor's handle, and any CSP violations. */
    pdfSdk: { editor: PdfEditorHandle | null; violations: string[] };
  }
}

window.pdfSdk = { editor: null, violations: [] };
document.addEventListener("securitypolicyviolation", (event) => {
  window.pdfSdk.violations.push(`${event.effectiveDirective} ${event.blockedURI}`);
});

const params = new URLSearchParams(location.search);

// The self-hosted page serves the package's dist/assets/ under /pdf-sdk/.
const selfHosted = document.body.dataset["assets"] === "self-hosted";
const assetsUrl = selfHosted ? new URL("/pdf-sdk/", location.href).href : undefined;

// For the screenshot tests: ?save=fail stands for a host whose own saving
// fails, so the editor's save failure can be seen (docs/adr/0009).
const failSave = params.get("save") === "fail";
const refuseToSave = async () => {
  throw new Error("This test host refuses to save.");
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
const PREFERENCES = "editor-prefs:pdf-example";

function readStored(): EditorPreferences {
  let stored: unknown = null;
  try {
    stored = JSON.parse(localStorage.getItem(PREFERENCES) ?? "null");
  } catch {
    stored = null;
  }
  return readEditorPreferences(stored, { mode: "easy" });
}

const shared: PdfEditorProps = {
  ...(assetsUrl ? { assetsUrl } : {}),
  ...(failSave ? { onExport: refuseToSave } : {}),
};

const attach = (editor: PdfEditorHandle | null) => {
  window.pdfSdk.editor = editor;
};

function App() {
  const [preferences, setPreferences] = useState(readStored);
  return (
    <PdfEditor
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

// The host's layout: the editor fills the viewport below the heading, or
// the whole viewport as an app. React sets these through the DOM, which
// style-src 'self' allows.
const root = document.getElementById("root") as HTMLElement;
for (const element of [document.documentElement, document.body, root]) {
  element.style.height = "100%";
  element.style.margin = "0";
}

createRoot(root).render(
  <main
    style={{
      height: "100%",
      display: "grid",
      gridTemplateRows: APP ? "minmax(0, 1fr)" : "auto minmax(0, 1fr)",
    }}
  >
    {APP ? null : (
      <h1 style={{ margin: 0, padding: "0.5rem 1rem", fontSize: "1.25rem" }}>
        {selfHosted ? "Self-hosted assets" : "Inlined assets"}
      </h1>
    )}
    {APP ? (
      <App />
    ) : (
      <PdfEditor
        {...shared}
        ref={attach}
        {...(MODE ? { defaultPreferences: { mode: MODE } } : {})}
      />
    )}
  </main>,
);
