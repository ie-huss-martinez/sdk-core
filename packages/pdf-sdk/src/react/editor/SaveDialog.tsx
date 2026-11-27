import { Button, Dialog, SegmentedControl } from "@hussmartinez/ui/react";
import { type ReactNode, useId, useRef, useState } from "react";
import { usePdfMessages } from "../hooks.js";

interface SaveDialogProps {
  readonly open: boolean;
  /** Whether the document needed a password, which the copy can keep. */
  readonly passwordProtected: boolean;
  /**
   * Whether the copy, keeping the password or not, would lose restrictions
   * the original has: it would be built, and the original is restricted.
   */
  readonly losesRestrictions: (keepPassword: boolean) => boolean;
  /** Saves the document, keeping its password or not. */
  readonly onSave: (options: { readonly keepPassword: boolean }) => void;
  readonly onCancel: () => void;
}

type Choice = "keep" | "remove";

/**
 * What the download tool says before it saves a copy that won't be what
 * the original was (docs/adr/0013):
 *
 * - **A document that needed a password:** whether the copy keeps it, which
 *   it does unless the person chooses otherwise, with a line saying what
 *   each choice gives.
 * - **A document with restrictions,** such as on printing or copying, whose
 *   copy is built: that the copy doesn't keep them. Nothing is removed
 *   without the person being told.
 *
 * Every other document saves at once, with no dialog (docs/adr/0009).
 */
export function SaveDialog(props: SaveDialogProps): ReactNode {
  const { open, passwordProtected, losesRestrictions, onSave, onCancel } = props;
  const messages = usePdfMessages();
  const [choice, setChoice] = useState<Choice>("keep");
  const summary = useId();
  const confirm = useRef<HTMLButtonElement>(null);

  // Each time it opens, it starts from keeping the password: set while
  // rendering, as React advises for state that follows a prop.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setChoice("keep");
  }

  const keepPassword = !passwordProtected || choice === "keep";
  const restrictions =
    open && losesRestrictions(keepPassword) ? messages.t("save.restrictions") : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={messages.t(passwordProtected ? "save.title" : "save.restricted.title")}
      // Without a password there's no choice to make, only this to say.
      description={passwordProtected ? messages.t("save.description") : restrictions}
      size="small"
      // The safe choice is one key press away.
      initialFocus={confirm}
      className="hm-pdf-save"
      footer={
        <>
          <Button onClick={onCancel}>{messages.t("editor.cancelSave")}</Button>
          <Button ref={confirm} variant="primary" onClick={() => onSave({ keepPassword })}>
            {messages.t("tools.download")}
          </Button>
        </>
      }
    >
      {passwordProtected ? (
        <>
          <SegmentedControl
            label={messages.t("password.label")}
            aria-describedby={summary}
            value={choice}
            onValueChange={setChoice}
            options={[
              { value: "keep", label: messages.t("save.keep") },
              { value: "remove", label: messages.t("save.remove") },
            ]}
          />
          <p id={summary} className="hm-pdf-save-summary">
            {messages.t(choice === "keep" ? "save.keep.summary" : "save.remove.summary")}
            {restrictions ? ` ${restrictions}` : null}
          </p>
        </>
      ) : null}
    </Dialog>
  );
}
