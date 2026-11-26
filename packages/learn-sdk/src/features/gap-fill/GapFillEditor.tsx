import { AddIcon, Button, DeleteIcon } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { EditorField } from "../editor/EditorField.js";
import { defineEditorBlock, type EditorBlockProps } from "../editor/editor-block.js";
import { useFocusAfter } from "../editor/focus-after.js";
import { IssueList } from "../editor/IssueList.js";
import { type IssuePath, issueAt, issuesUnder, unclaimed } from "../editor/issues.js";
import { TextList } from "../editor/TextList.js";
import type { GapFillItem, GapFillPayload } from "./gap-fill.js";

const newItem = (): GapFillItem => ({ sentence: "", answers: [""] });

const itemsOf = (payload: GapFillPayload | undefined): readonly GapFillItem[] =>
  Array.isArray(payload?.items) ? payload.items : [];
const listOf = (value: unknown): readonly string[] => (Array.isArray(value) ? value : []);

const withItem = (
  payload: GapFillPayload,
  index: number,
  change: (item: GapFillItem) => GapFillItem,
) => ({
  ...payload,
  items: itemsOf(payload).map((item, at) => (at === index ? change(item) : item)),
});

/** An optional field: left out when empty, since an empty one is a problem and a missing one isn't. */
function optional<T extends object, K extends keyof T>(
  item: T,
  key: K,
  value: T[K] | undefined,
  empty: boolean,
): T {
  const { [key]: _old, ...rest } = item;
  return (empty ? rest : { ...rest, [key]: value }) as T;
}

function Item({
  item,
  index,
  count,
  onPayload,
  issues,
  profile,
  messages,
  focusAfter,
}: EditorBlockProps<GapFillPayload> & {
  readonly item: GapFillItem;
  readonly index: number;
  readonly count: number;
  readonly focusAfter: (key: string) => void;
}): ReactNode {
  const number = index + 1;
  const mine = issuesUnder(issues, ["items", index]);
  const change = (update: (item: GapFillItem) => GapFillItem) =>
    onPayload((current) => withItem(current, index, update));
  return (
    <fieldset className="hm-learn-editor-group" data-hm-focus-key={`i${index}`}>
      <legend>{messages.t("gapFill.item", { number })}</legend>
      <EditorField
        label={messages.t("gapFill.sentence")}
        description={messages.t("gapFill.sentenceHelp")}
        value={item.sentence ?? ""}
        onCommit={(sentence) => change((current) => ({ ...current, sentence }))}
        issue={issueAt(mine, ["sentence"])}
        messages={messages}
        taught={profile}
        multiline
      />
      <TextList
        legend={messages.t("gapFill.answers")}
        values={listOf(item.answers)}
        onChange={(update) =>
          change((current) => ({ ...current, answers: update(listOf(current.answers)) }))
        }
        issues={issuesUnder(mine, ["answers"])}
        messages={messages}
        taught={profile}
        itemLabel={(n) => messages.t("gapFill.answer", { number: n })}
        removeLabel={(n) => messages.t("gapFill.removeAnswer", { number: n })}
        addLabel={messages.t("gapFill.addAnswer")}
        focusKey={`i${index}-a`}
        focusAfter={focusAfter}
      />
      <TextList
        legend={messages.t("gapFill.options")}
        description={messages.t("gapFill.optionsHelp")}
        values={listOf(item.options)}
        onChange={(update) =>
          change((current) => {
            const options = update(listOf(current.options));
            return optional(current, "options", options, options.length === 0);
          })
        }
        issues={issuesUnder(mine, ["options"])}
        messages={messages}
        taught={profile}
        itemLabel={(n) => messages.t("gapFill.option", { number: n })}
        removeLabel={(n) => messages.t("gapFill.removeOption", { number: n })}
        addLabel={messages.t("gapFill.addOption")}
        focusKey={`i${index}-o`}
        focusAfter={focusAfter}
      />
      <EditorField
        label={messages.t("gapFill.translation")}
        description={messages.t("gapFill.translationHelp")}
        value={item.translation ?? ""}
        onCommit={(text) =>
          change((current) => optional(current, "translation", text, text === ""))
        }
        issue={issueAt(mine, ["translation"])}
        messages={messages}
      />
      {count > 1 && (
        <Button
          variant="quiet"
          startIcon={<DeleteIcon />}
          onClick={() => {
            onPayload((current) => ({
              ...current,
              items: itemsOf(current).filter((_, at) => at !== index),
            }));
            focusAfter(`i${Math.max(0, index - 1)}`);
          }}
        >
          {messages.t("gapFill.removeItem", { number })}
        </Button>
      )}
    </fieldset>
  );
}

const fieldsOf = (items: readonly GapFillItem[]): IssuePath[] =>
  items.flatMap((item, index) => [
    ["items", index, "sentence"],
    ["items", index, "answers"],
    ["items", index, "options"],
    ["items", index, "translation"],
    ...listOf(item.answers).map((_, at): IssuePath => ["items", index, "answers", at]),
    ...listOf(item.options).map((_, at): IssuePath => ["items", index, "options", at]),
  ]);

/**
 * The editor of gap-fill exercises (ADR 0008).
 *
 * @public
 */
export const gapFillEditor = /* @__PURE__ */ defineEditorBlock<GapFillPayload>({
  create: () => ({ items: [newItem()] }),
  edit: function GapFillEditor(props): ReactNode {
    const { exercise, onPayload, issues, messages } = props;
    const { ref, focusAfter } = useFocusAfter<HTMLDivElement>();
    const items = itemsOf(exercise.payload);
    return (
      <div ref={ref} className="hm-learn-editor-block">
        <IssueList issues={unclaimed(issues, fieldsOf(items))} messages={messages} />
        {items.map((item, index) => (
          <Item
            // biome-ignore lint/suspicious/noArrayIndexKey: items are identified by position
            key={index}
            {...props}
            item={item}
            index={index}
            count={items.length}
            focusAfter={focusAfter}
          />
        ))}
        <Button
          variant="secondary"
          startIcon={<AddIcon />}
          onClick={() => {
            onPayload((current) => ({ ...current, items: [...itemsOf(current), newItem()] }));
            focusAfter(`i${items.length}`);
          }}
        >
          {messages.t("gapFill.addItem")}
        </Button>
      </div>
    );
  },
});
