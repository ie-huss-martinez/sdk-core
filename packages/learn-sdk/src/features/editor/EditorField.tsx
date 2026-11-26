import { Field, TextArea, TextField } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import type { LearnIssue } from "../../core/errors/learn-issues.js";
import type { LanguageProfile } from "../../core/model/language-profile.js";
import { useCommittedText } from "./committed-text.js";
import type { LearnEditorMessages } from "./editor-messages.js";

/** The props of {@link EditorField}. */
export interface EditorFieldProps {
  readonly label: string;
  readonly description?: string | undefined;
  /** The draft's value. */
  readonly value: string;
  /** Called with the new text once typing is committed (ADR 0008). */
  readonly onCommit: (value: string) => void;
  /** The problem at this field, if any: shown as its error. */
  readonly issue?: LearnIssue | undefined;
  readonly messages: LearnEditorMessages;
  /**
   * The language being taught, for a field of content in it: its `lang` and
   * `dir`, with spellcheck, autocorrect and autocapitalize off (ADR 0008).
   * Leave it out for text in the teacher's language.
   */
  readonly taught?: LanguageProfile | undefined;
  readonly multiline?: boolean | undefined;
  /** Shown before the input, in its row, such as a radio button. */
  readonly leading?: ReactNode;
  /** Shown after the input, in its row, such as its Remove button. */
  readonly actions?: ReactNode;
}

/** A problem's text, from `validation.<code>` (ADR 0002). */
export function issueText(
  messages: LearnEditorMessages,
  issue: LearnIssue | undefined,
): string | undefined {
  if (!issue) return undefined;
  // Each `validation.<code>` message takes the issue's numbers, such as `minimum`.
  const key = `validation.${issue.code}` as "validation.too-few";
  return messages.t(key, { minimum: 0, ...issue.details });
}

/**
 * A text field of the editor: `ui`'s `Field` with a `TextField` or
 * `TextArea`, committing a burst of typing as one edit, and tying its problem
 * to it with `aria-invalid` and `aria-describedby`.
 */
export function EditorField({
  label,
  description,
  value,
  onCommit,
  issue,
  messages,
  taught,
  multiline = false,
  leading,
  actions,
}: EditorFieldProps): ReactNode {
  const text = useCommittedText(value, onCommit, { multiline });
  const language = taught
    ? {
        lang: taught.code,
        dir: taught.direction,
        spellCheck: false,
        autoCorrect: "off",
        autoCapitalize: "off",
      }
    : {};
  return (
    // The input and its buttons share a row, so they line up with the input,
    // and the problem, below the row, never pushes them out of line.
    <Field
      className="hm-learn-editor-field"
      label={label}
      description={description}
      error={issueText(messages, issue)}
    >
      <div className="hm-learn-editor-control">
        {leading}
        {multiline ? (
          <TextArea rows={2} {...language} {...text} />
        ) : (
          <TextField {...language} {...text} />
        )}
        {actions}
      </div>
    </Field>
  );
}
