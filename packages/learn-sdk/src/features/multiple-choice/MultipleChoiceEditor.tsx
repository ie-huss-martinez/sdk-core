import { AddIcon, Button, DeleteIcon, IconButton } from "@hussmartinez/ui/react";
import { type ReactNode, useId } from "react";
import { EditorField, issueText } from "../editor/EditorField.js";
import type { EditorBlockProps } from "../editor/editor-block.js";
import { defineEditorBlock } from "../editor/editor-block.js";
import { useFocusAfter } from "../editor/focus-after.js";
import { IssueList } from "../editor/IssueList.js";
import { type IssuePath, issueAt, issuesUnder, unclaimed } from "../editor/issues.js";
import type { MultipleChoicePayload, MultipleChoiceQuestion } from "./multiple-choice.js";

const newQuestion = (): MultipleChoiceQuestion => ({ prompt: "", choices: ["", ""], correct: 0 });

/** The questions of a draft's payload, which may not be well formed yet. */
const questionsOf = (
  payload: MultipleChoicePayload | undefined,
): readonly MultipleChoiceQuestion[] =>
  Array.isArray(payload?.questions) ? payload.questions : [];

const withQuestion = (
  payload: MultipleChoicePayload,
  index: number,
  change: (question: MultipleChoiceQuestion) => MultipleChoiceQuestion,
): MultipleChoicePayload => ({
  ...payload,
  questions: questionsOf(payload).map((question, at) =>
    at === index ? change(question) : question,
  ),
});

/** Without the explanation when it's empty: an empty one is a problem, a missing one isn't. */
const withExplanation = (
  question: MultipleChoiceQuestion,
  text: string,
): MultipleChoiceQuestion => {
  const { explanation: _old, ...rest } = question;
  return text === "" ? rest : { ...rest, explanation: text };
};

function Question({
  payload,
  index,
  count,
  onPayload,
  issues,
  profile,
  messages,
  focusAfter,
}: EditorBlockProps<MultipleChoicePayload> & {
  readonly payload: MultipleChoicePayload;
  readonly index: number;
  readonly count: number;
  readonly focusAfter: (key: string, control?: string) => void;
}): ReactNode {
  const question = questionsOf(payload)[index] as MultipleChoiceQuestion;
  const choices = Array.isArray(question.choices) ? question.choices : [];
  const name = useId();
  const number = index + 1;
  const mine = issuesUnder(issues, ["questions", index]);
  const change = (update: (question: MultipleChoiceQuestion) => MultipleChoiceQuestion) =>
    onPayload((current) => withQuestion(current, index, update));

  const removeChoice = (at: number) => {
    change((current) => ({
      ...current,
      choices: current.choices.filter((_, i) => i !== at),
      // The right answer stays on its choice; if that choice goes, the first is right.
      correct:
        current.correct === at ? 0 : current.correct > at ? current.correct - 1 : current.correct,
    }));
    // The neighbour, or the Add button once no choice is left.
    focusAfter(choices.length > 1 ? `q${index}-c${Math.max(0, at - 1)}` : `q${index}-add`);
  };

  return (
    <fieldset className="hm-learn-editor-group">
      <legend>{messages.t("multipleChoice.question", { number })}</legend>
      <EditorField
        label={messages.t("multipleChoice.prompt")}
        value={question.prompt ?? ""}
        onCommit={(prompt) => change((current) => ({ ...current, prompt }))}
        issue={issueAt(mine, ["prompt"])}
        messages={messages}
        taught={profile}
        multiline
      />
      <fieldset
        className="hm-learn-editor-choices"
        aria-describedby={issueAt(mine, ["choices"]) ? `${name}-choices-error` : undefined}
      >
        <legend>{messages.t("multipleChoice.choices")}</legend>
        {choices.map((choice, at) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: choices are identified by position
            key={at}
            className="hm-learn-editor-choice"
            data-hm-focus-key={`q${index}-c${at}`}
          >
            <EditorField
              label={messages.t("multipleChoice.choice", { number: at + 1 })}
              value={choice}
              onCommit={(text) =>
                change((current) => ({
                  ...current,
                  choices: current.choices.map((old, i) => (i === at ? text : old)),
                }))
              }
              issue={issueAt(mine, ["choices", at])}
              messages={messages}
              taught={profile}
              leading={
                <input
                  type="radio"
                  name={name}
                  className="hm-learn-editor-radio"
                  checked={question.correct === at}
                  aria-label={messages.t("multipleChoice.correctFor", { number: at + 1 })}
                  onChange={() => change((current) => ({ ...current, correct: at }))}
                />
              }
              actions={
                <IconButton
                  variant="quiet"
                  icon={<DeleteIcon />}
                  label={messages.t("multipleChoice.removeChoice", { number: at + 1 })}
                  onClick={() => removeChoice(at)}
                />
              }
            />
          </div>
        ))}
        {issueAt(mine, ["choices"]) && (
          <p id={`${name}-choices-error`} className="hm-learn-editor-error">
            {issueText(messages, issueAt(mine, ["choices"]))}
          </p>
        )}
        {issueAt(mine, ["correct"]) && (
          <p className="hm-learn-editor-error">{issueText(messages, issueAt(mine, ["correct"]))}</p>
        )}
        <Button
          data-hm-focus-key={`q${index}-add`}
          variant="secondary"
          startIcon={<AddIcon />}
          onClick={() => {
            change((current) => ({ ...current, choices: [...current.choices, ""] }));
            focusAfter(`q${index}-c${choices.length}`);
          }}
        >
          {messages.t("multipleChoice.addChoice")}
        </Button>
      </fieldset>
      <EditorField
        label={messages.t("multipleChoice.explanation")}
        description={messages.t("multipleChoice.explanationHelp")}
        value={question.explanation ?? ""}
        onCommit={(text) => change((current) => withExplanation(current, text))}
        issue={issueAt(mine, ["explanation"])}
        messages={messages}
        multiline
      />
      {count > 1 && (
        <Button
          variant="quiet"
          startIcon={<DeleteIcon />}
          onClick={() => {
            onPayload((current) => ({
              ...current,
              questions: questionsOf(current).filter((_, at) => at !== index),
            }));
            focusAfter(`q${Math.max(0, index - 1)}-c0`);
          }}
        >
          {messages.t("multipleChoice.removeQuestion", { number })}
        </Button>
      )}
    </fieldset>
  );
}

/** The fields this block shows, so issues at any other path are listed. */
const fieldsOf = (questions: readonly MultipleChoiceQuestion[]): IssuePath[] =>
  questions.flatMap((question, index) => [
    ["questions", index, "prompt"],
    ["questions", index, "choices"],
    ["questions", index, "correct"],
    ["questions", index, "explanation"],
    ...(Array.isArray(question.choices) ? question.choices : []).map(
      (_, at): IssuePath => ["questions", index, "choices", at],
    ),
  ]);

/**
 * The editor of multiple-choice exercises (ADR 0008).
 *
 * @public
 */
export const multipleChoiceEditor = /* @__PURE__ */ defineEditorBlock<MultipleChoicePayload>({
  create: () => ({ questions: [newQuestion()] }),
  edit: function MultipleChoiceEditor(props): ReactNode {
    const { exercise, onPayload, issues, messages } = props;
    const { ref, focusAfter } = useFocusAfter<HTMLDivElement>();
    const questions = questionsOf(exercise.payload);
    return (
      <div ref={ref} className="hm-learn-editor-block">
        <IssueList issues={unclaimed(issues, fieldsOf(questions))} messages={messages} />
        {questions.map((_, index) => (
          <Question
            // Questions have no ids; their position is their identity here.
            // biome-ignore lint/suspicious/noArrayIndexKey: questions are identified by position
            key={index}
            {...props}
            payload={exercise.payload}
            index={index}
            count={questions.length}
            focusAfter={focusAfter}
          />
        ))}
        <Button
          variant="secondary"
          startIcon={<AddIcon />}
          onClick={() => {
            onPayload((current) => ({
              ...current,
              questions: [...questionsOf(current), newQuestion()],
            }));
            focusAfter(`q${questions.length}-c0`);
          }}
        >
          {messages.t("multipleChoice.addQuestion")}
        </Button>
      </div>
    );
  },
});
