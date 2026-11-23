import { Button, Dialog, NumberField } from "@hussmartinez/ui/react";
import { type ReactNode, useState } from "react";
import { useNotes } from "../context.js";

export interface LinkDialogProps {
  readonly open: boolean;
  /** How many pages the notebook has. */
  readonly pageCount: number;
  /** The page the link is drawn on, counted from 1. */
  readonly fromPage: number;
  readonly onClose: () => void;
  /** Called with the number of the page the link leads to, counted from 1. */
  readonly onCreate: (page: number) => void;
}

/** Asks which page a new link leads to. */
export function LinkDialog(props: LinkDialogProps): ReactNode {
  const { messages } = useNotes();
  const { pageCount, fromPage } = props;
  const [page, setPage] = useState(fromPage < pageCount ? fromPage + 1 : 1);
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      size="small"
      title={messages.t("link.title")}
      description={messages.t("link.description", { count: pageCount })}
      closeLabel={messages.t("dialog.close")}
      footer={
        <>
          <Button variant="quiet" onClick={props.onClose}>
            {messages.t("link.cancel")}
          </Button>
          <Button variant="primary" onClick={() => props.onCreate(page)}>
            {messages.t("link.create")}
          </Button>
        </>
      }
    >
      <NumberField
        label={messages.t("link.page")}
        min={1}
        max={pageCount}
        step={1}
        value={page}
        onValueChange={(value) => setPage(Math.min(pageCount, Math.max(1, Math.round(value))))}
      />
    </Dialog>
  );
}
