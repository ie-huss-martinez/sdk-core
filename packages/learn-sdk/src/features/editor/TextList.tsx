import {
  AddIcon,
  Button,
  DeleteIcon,
  IconButton,
  MoveDownIcon,
  MoveUpIcon,
} from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import type { LearnIssue } from "../../core/errors/learn-issues.js";
import type { LanguageProfile } from "../../core/model/language-profile.js";
import { EditorField, issueText } from "./EditorField.js";
import type { LearnEditorMessages } from "./editor-messages.js";
import { issueAt } from "./issues.js";

/** The props of {@link TextList}. */
export interface TextListProps {
  /** The list's name, as its legend. */
  readonly legend: string;
  readonly description?: string | undefined;
  readonly values: readonly string[];
  /** Replaces the list, given the list as it is in the draft when the edit is made. */
  readonly onChange: (change: (current: readonly string[]) => readonly string[]) => void;
  /** Issues with paths relative to the list: `[]` for the list, `[index]` for an entry. */
  readonly issues: readonly LearnIssue[];
  readonly messages: LearnEditorMessages;
  readonly taught?: LanguageProfile | undefined;
  readonly itemLabel: (number: number) => string;
  readonly removeLabel: (number: number) => string;
  readonly addLabel: string;
  /** Labels for moving an entry earlier and later; without them, entries don't move. */
  readonly moveLabels?: {
    readonly earlier: (n: number) => string;
    readonly later: (n: number) => string;
  };
  /** The prefix of each entry's `data-hm-focus-key`, followed by its index. */
  readonly focusKey: string;
  readonly focusAfter: (key: string, control?: string) => void;
}

const moved = (values: readonly string[], from: number, to: number): string[] => {
  const next = [...values];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry as string);
  return next;
};

/**
 * A list of short texts, such as a gap's accepted answers or a sentence's
 * words, each its own field with buttons to remove it and, for an ordered
 * list, to move it. Every action is a button, never only a drag (ADR 0005).
 */
export function TextList({
  legend,
  description,
  values,
  onChange,
  issues,
  messages,
  taught,
  itemLabel,
  removeLabel,
  addLabel,
  moveLabels,
  focusKey,
  focusAfter,
}: TextListProps): ReactNode {
  const id = useId();
  const listIssue = issueAt(issues, []);
  return (
    <fieldset
      className="hm-learn-editor-list"
      aria-describedby={
        [description ? `${id}-description` : "", listIssue ? `${id}-error` : ""]
          .filter(Boolean)
          .join(" ") || undefined
      }
    >
      <legend>{legend}</legend>
      {description && (
        <p id={`${id}-description`} className="hm-learn-editor-description">
          {description}
        </p>
      )}
      {values.map((value, index) => (
        // Entries have no ids; their position is their identity here.
        // biome-ignore lint/suspicious/noArrayIndexKey: entries are identified by position
        <div key={index} data-hm-focus-key={`${focusKey}${index}`}>
          <EditorField
            label={itemLabel(index + 1)}
            value={value}
            onCommit={(text) =>
              onChange((current) => current.map((old, at) => (at === index ? text : old)))
            }
            issue={issueAt(issues, [index])}
            messages={messages}
            taught={taught}
            actions={
              <span className="hm-learn-editor-actions">
                {moveLabels && (
                  <>
                    <IconButton
                      variant="quiet"
                      icon={<MoveUpIcon />}
                      label={moveLabels.earlier(index + 1)}
                      data-hm-focus-control="earlier"
                      disabled={index === 0}
                      focusableWhenDisabled
                      onClick={() => {
                        onChange((current) => moved(current, index, index - 1));
                        focusAfter(`${focusKey}${index - 1}`, "earlier");
                      }}
                    />
                    <IconButton
                      variant="quiet"
                      icon={<MoveDownIcon />}
                      label={moveLabels.later(index + 1)}
                      data-hm-focus-control="later"
                      disabled={index === values.length - 1}
                      focusableWhenDisabled
                      onClick={() => {
                        onChange((current) => moved(current, index, index + 1));
                        focusAfter(`${focusKey}${index + 1}`, "later");
                      }}
                    />
                  </>
                )}
                <IconButton
                  variant="quiet"
                  icon={<DeleteIcon />}
                  label={removeLabel(index + 1)}
                  onClick={() => {
                    onChange((current) => current.filter((_, at) => at !== index));
                    // The neighbour, or the Add button once the list is empty.
                    focusAfter(
                      values.length > 1 ? `${focusKey}${Math.max(0, index - 1)}` : `${focusKey}add`,
                    );
                  }}
                />
              </span>
            }
          />
        </div>
      ))}
      {listIssue && (
        <p id={`${id}-error`} className="hm-learn-editor-error">
          {issueText(messages, listIssue)}
        </p>
      )}
      <Button
        data-hm-focus-key={`${focusKey}add`}
        variant="secondary"
        startIcon={<AddIcon />}
        onClick={() => {
          onChange((current) => [...current, ""]);
          focusAfter(`${focusKey}${values.length}`);
        }}
      >
        {addLabel}
      </Button>
    </fieldset>
  );
}
