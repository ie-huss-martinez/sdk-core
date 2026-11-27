import {
  AnnouncerProvider,
  Button,
  Dialog,
  Field,
  TextField,
  useAnnounce,
} from "@hussmartinez/ui/react";
import { type FormEvent, type ReactNode, type RefObject, useEffect, useId, useRef } from "react";
import { usePdfMessages } from "../hooks.js";
import type { PasswordPromptState } from "./use-password-prompt.js";

interface PasswordDialogProps extends PasswordPromptState {
  readonly onSubmit: (password: string) => void;
  readonly onCancel: () => void;
}

interface FormProps extends PasswordDialogProps {
  readonly id: string;
  readonly field: RefObject<HTMLInputElement | null>;
}

/**
 * The dialog's form. It's inside the dialog's own announcer: a modal dialog
 * makes everything outside it inert, the editor's live regions included, so
 * what the form says is said from regions inside the dialog.
 */
function PasswordForm(props: FormProps): ReactNode {
  const { id, field, checking, incorrect, onSubmit } = props;
  const messages = usePdfMessages();
  const announce = useAnnounce();
  const wrong = incorrect ? messages.error(incorrect) : undefined;

  // A wrong password is said at once. Each failure is its own error object,
  // so the same sentence is said again for a second wrong password.
  useEffect(() => {
    if (incorrect) announce(messages.error(incorrect), { politeness: "assertive" });
  }, [incorrect, announce, messages]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input = field.current;
    if (!input || checking) return;
    // Focus stays in the field while the password is tried, so the answer
    // is heard from there, whichever way the form was sent.
    input.focus();
    if (input.value === "") return;
    announce(messages.t("password.checking"));
    // Straight from the field to the session: never state (docs/adr/0013).
    onSubmit(input.value);
  };

  return (
    <form id={id} className="hm-pdf-password-form" onSubmit={submit}>
      <Field label={messages.t("password.label")} error={checking ? undefined : wrong}>
        <TextField
          ref={field}
          type="password"
          name="password"
          autoComplete="current-password"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          readOnly={checking}
        />
      </Field>
      <p className="hm-pdf-password-status">{checking ? messages.t("password.checking") : null}</p>
    </form>
  );
}

/**
 * Asks for the password of a PDF that needs one to open, on ui's modal
 * dialog (docs/adr/0013). The field takes focus when it opens. A wrong
 * password is shown at the field and announced, and the person tries again
 * or cancels: Escape, the close button and Cancel all cancel. Closing gives
 * focus back to where it was.
 *
 * The field is uncontrolled, so the password is never in React's state. A
 * password manager may fill it (`autocomplete="current-password"`).
 */
export function PasswordDialog(props: PasswordDialogProps): ReactNode {
  const { asking, checking, incorrect, onCancel } = props;
  const messages = usePdfMessages();
  const form = useId();
  const field = useRef<HTMLInputElement>(null);

  // A wrong password empties the field, with focus in it to type another.
  useEffect(() => {
    if (!incorrect || !field.current) return;
    field.current.value = "";
    field.current.focus();
  }, [incorrect]);

  // Nothing typed outlives the dialog.
  useEffect(() => {
    if (!asking && field.current) field.current.value = "";
  }, [asking]);

  return (
    <Dialog
      open={asking}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={messages.t("password.title")}
      description={messages.t("password.description")}
      size="small"
      initialFocus={field}
      className="hm-pdf-password"
      footer={
        <>
          <Button onClick={onCancel}>{messages.t("password.cancel")}</Button>
          <Button
            variant="primary"
            type="submit"
            form={form}
            disabled={checking}
            // It keeps focus while the password is tried.
            focusableWhenDisabled
          >
            {messages.t("password.submit")}
          </Button>
        </>
      }
    >
      <AnnouncerProvider>
        <PasswordForm {...props} id={form} field={field} />
      </AnnouncerProvider>
    </Dialog>
  );
}
