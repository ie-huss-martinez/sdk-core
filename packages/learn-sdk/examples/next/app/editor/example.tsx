"use client";

import { LearnEditor, type LearnEditorHandle } from "@hussmartinez/learn-sdk/react";
import { useRef, useState } from "react";

/** The editor, saving through its handle (ADR 0008), as in the Vite example. */
export function Example({ content }: { readonly content: unknown }) {
  const editor = useRef<LearnEditorHandle>(null);
  const [valid, setValid] = useState(true);
  const [saved, setSaved] = useState("");
  return (
    <>
      <div className="example-editor">
        <LearnEditor
          ref={editor}
          initialContent={content}
          profile={{ code: "th", direction: "ltr" }}
          onChange={(_, problems) => setValid(problems.valid)}
        />
      </div>
      <button
        type="button"
        disabled={!valid}
        onClick={() => setSaved(JSON.stringify(editor.current?.getContent(), null, 2))}
      >
        Save
      </button>
      <output aria-label="Saved content">{saved}</output>
    </>
  );
}
