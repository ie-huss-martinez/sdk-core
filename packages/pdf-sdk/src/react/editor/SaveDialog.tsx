import { Button, Dialog, SegmentedControl } from "@hussmartinez/ui/react";
import { type ReactNode, useId, useRef, useState } from "react";
import { usePdfMessages } from "../hooks.js";

interface SaveDialogProps {
  readonly open: boolean;
  /** Saves the document, keeping its password or not. */
  readonly onSave: (options: { readonly keepPassword: boolean }) => void;
  readonly onCancel: () => void;
}

type Choice = "keep" | "remove";

/**
 * What the download tool asks before it saves a document that needed a
 * password to open (docs/adr/0013): whether the copy keeps the password,
 * which it does unless the person chooses otherwise, with a line saying
 * what each choice gives. Documents without a password save at once, with
 * no dialog (docs/adr/0009).
 */
export function SaveDialog({ open, onSave, onCancel }: SaveDialogProps): ReactNode {
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={messages.t("save.title")}
      description={messages.t("save.description")}
      size="small"
      // The safe choice is one key press away.
      initialFocus={confirm}
      className="hm-pdf-save"
      footer={
        <>
          <Button onClick={onCancel}>{messages.t("editor.cancelSave")}</Button>
          <Button
            ref={confirm}
            variant="primary"
            onClick={() => onSave({ keepPassword: choice === "keep" })}
          >
            {messages.t("tools.download")}
          </Button>
        </>
      }
    >
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
      </p>
    </Dialog>
  );
}
