/**
 * A Server Component. It imports the server-safe entry, which must not touch
 * the browser, and renders the editor from the client entry directly, which
 * only works if its "use client" directive survived the build (ADR 0007 in
 * sdk-core).
 */
import { notesLimits } from "@hussmartinez/notes-sdk";
import { NotesEditor } from "@hussmartinez/notes-sdk/react";
import { Hydrated } from "./Hydrated";

export default function Page() {
  return (
    <main style={{ height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" }}>
      <h1 style={{ margin: 0, padding: "0.5rem 1rem", fontSize: "1.25rem" }}>
        Notebooks of up to{" "}
        <span data-testid="max-pages">
          {notesLimits.definitions.maxPages.default.toLocaleString("en")}
        </span>{" "}
        pages
      </h1>
      <NotesEditor />
      <Hydrated />
    </main>
  );
}
