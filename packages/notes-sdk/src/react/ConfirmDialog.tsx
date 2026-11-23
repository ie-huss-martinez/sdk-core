import { Button, Dialog } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { useNotes } from "./context.js";

export interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly onConfirm: () => void;
}

/**
 * Asks before something that can't be undone, such as deleting a notebook
 * for good, or closing one whose changes couldn't be saved.
 */
export function ConfirmDialog(props: ConfirmDialogProps): ReactNode {
  const { messages } = useNotes();
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="small"
      title={props.title}
      description={props.body}
      closeLabel={messages.t("dialog.close")}
      footer={
        <>
          <Button variant="quiet" onClick={props.onClose}>
            {messages.t("dialogs.cancel")}
          </Button>
          <Button variant="danger" onClick={props.onConfirm}>
            {props.action}
          </Button>
        </>
      }
    />
  );
}
