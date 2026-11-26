import "@hussmartinez/ui/styles.css";
import "@hussmartinez/learn-sdk/styles.css";
import "./example.css";
import { LearnEditor, type LearnEditorHandle } from "@hussmartinez/learn-sdk/react";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import content from "../../thai-basics.json" with { type: "json" };

/**
 * The editor, as a host renders it, saving through the handle (ADR 0008):
 * Save is on only while the draft is valid, and shows what `getContent()`
 * returns. `?empty` opens it with nothing to edit, read once at start-up:
 * the editor opens its content once.
 */
function Example({ empty }: { readonly empty: boolean }) {
  const editor = useRef<LearnEditorHandle>(null);
  const [valid, setValid] = useState(true);
  const [saved, setSaved] = useState("");
  return (
    <>
      <div className="example-editor">
        <LearnEditor
          ref={editor}
          initialContent={empty ? undefined : content}
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

const element = document.querySelector<HTMLElement>("#editor");
const empty = new URLSearchParams(location.search).has("empty");
if (element) createRoot(element).render(<Example empty={empty} />);
