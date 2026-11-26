import {
  AddIcon,
  Button,
  DeleteIcon,
  IconButton,
  ReorderableList,
  ReorderableListItem,
} from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import { EditorField, issueText } from "../editor/EditorField.js";
import { defineEditorBlock, type EditorBlockProps } from "../editor/editor-block.js";
import { useFocusAfter } from "../editor/focus-after.js";
import { IssueList } from "../editor/IssueList.js";
import { type IssuePath, issueAt, issuesUnder, unclaimed } from "../editor/issues.js";
import { TextList } from "../editor/TextList.js";
import { followTiles, tilePositions } from "./follow-tiles.js";
import type { WordOrderItem, WordOrderPayload } from "./word-order.js";

const newItem = (): WordOrderItem => ({ tiles: ["", ""], translation: "" });

const itemsOf = (payload: WordOrderPayload | undefined): readonly WordOrderItem[] =>
  Array.isArray(payload?.items) ? payload.items : [];
const listOf = <T,>(value: unknown): readonly T[] => (Array.isArray(value) ? (value as T[]) : []);

const withItem = (
  payload: WordOrderPayload,
  index: number,
  change: (item: WordOrderItem) => WordOrderItem,
) => ({
  ...payload,
  items: itemsOf(payload).map((item, at) => (at === index ? change(item) : item)),
});

/** Without the alternatives when there are none: an empty list is a problem, a missing one isn't. */
function withAlternatives(
  item: WordOrderItem,
  alternatives: readonly (readonly string[])[],
): WordOrderItem {
  const { alternatives: _old, ...rest } = item;
  return alternatives.length === 0 ? rest : { ...rest, alternatives };
}

const movedTo = <T,>(values: readonly T[], from: number, to: number): T[] => {
  const next = [...values];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry as T);
  return next;
};

/** Another right order: the tiles' texts as rows that move with Alt+↑ and Alt+↓. */
function Alternative({
  tiles,
  order,
  number,
  label,
  onOrder,
  onRemove,
  removeLabel,
  error,
}: {
  readonly tiles: readonly string[];
  readonly order: readonly string[];
  readonly number: number;
  readonly label: string;
  readonly onOrder: (order: readonly string[]) => void;
  readonly onRemove: () => void;
  readonly removeLabel: string;
  readonly error: string | undefined;
}): ReactNode {
  // Each row's id is its tile's position in the right order, which moves keep.
  const positions = tilePositions(tiles, order);
  const ids = order.map((_, index) =>
    positions[index] === null ? `x${index}` : `t${positions[index]}`,
  );
  return (
    <div className="hm-learn-editor-alternative" data-hm-focus-key={`alt${number}`}>
      <ReorderableList
        label={label}
        onMove={(id, to) => {
          const from = ids.indexOf(id);
          if (from >= 0) onOrder(movedTo(order, from, to));
        }}
      >
        {order.map((text, index) => (
          <ReorderableListItem key={ids[index]} id={ids[index] as string} label={text} />
        ))}
      </ReorderableList>
      {error && <p className="hm-learn-editor-error">{error}</p>}
      <IconButton variant="quiet" icon={<DeleteIcon />} label={removeLabel} onClick={onRemove} />
    </div>
  );
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
}: EditorBlockProps<WordOrderPayload> & {
  readonly item: WordOrderItem;
  readonly index: number;
  readonly count: number;
  readonly focusAfter: (key: string) => void;
}): ReactNode {
  const number = index + 1;
  const mine = issuesUnder(issues, ["items", index]);
  const tiles = listOf<string>(item.tiles);
  const alternatives = listOf<readonly string[]>(item.alternatives);
  const change = (update: (item: WordOrderItem) => WordOrderItem) =>
    onPayload((current) => withItem(current, index, update));
  return (
    <fieldset className="hm-learn-editor-group" data-hm-focus-key={`i${index}`}>
      <legend>{messages.t("wordOrder.item", { number })}</legend>
      <TextList
        legend={messages.t("wordOrder.tiles")}
        values={tiles}
        onChange={(update) =>
          change((current) => {
            const before = listOf<string>(current.tiles);
            const after = update(before);
            // The other right orders follow the tiles' changes.
            const others = listOf<readonly string[]>(current.alternatives).map((order) =>
              followTiles(before, after, order),
            );
            return withAlternatives({ ...current, tiles: after }, others);
          })
        }
        issues={issuesUnder(mine, ["tiles"])}
        messages={messages}
        taught={profile}
        itemLabel={(n) => messages.t("wordOrder.tile", { number: n })}
        removeLabel={(n) => messages.t("wordOrder.removeTile", { number: n })}
        addLabel={messages.t("wordOrder.addTile")}
        moveLabels={{
          earlier: (n) => messages.t("wordOrder.moveTileUp", { number: n }),
          later: (n) => messages.t("wordOrder.moveTileDown", { number: n }),
        }}
        focusKey={`i${index}-t`}
        focusAfter={focusAfter}
      />
      <fieldset className="hm-learn-editor-list" lang={profile.code} dir={profile.direction}>
        <legend lang="">{messages.t("wordOrder.alternatives")}</legend>
        <p className="hm-learn-editor-description" lang="">
          {messages.t("wordOrder.alternativesHelp")}
        </p>
        {alternatives.map((order, at) => (
          <Alternative
            // biome-ignore lint/suspicious/noArrayIndexKey: orders are identified by position
            key={at}
            tiles={tiles}
            order={order}
            number={at + 1}
            label={messages.t("wordOrder.alternative", { number: at + 1 })}
            onOrder={(next) =>
              change((current) =>
                withAlternatives(
                  current,
                  listOf<readonly string[]>(current.alternatives).map((old, i) =>
                    i === at ? next : old,
                  ),
                ),
              )
            }
            onRemove={() => {
              change((current) =>
                withAlternatives(
                  current,
                  listOf<readonly string[]>(current.alternatives).filter((_, i) => i !== at),
                ),
              );
              focusAfter(`i${index}`);
            }}
            removeLabel={messages.t("wordOrder.removeAlternative", { number: at + 1 })}
            error={issueText(messages, issueAt(mine, ["alternatives", at]))}
          />
        ))}
        <Button
          variant="secondary"
          startIcon={<AddIcon />}
          onClick={() => {
            // A new order starts from the right one, for the teacher to rearrange.
            change((current) =>
              withAlternatives(current, [
                ...listOf<readonly string[]>(current.alternatives),
                listOf<string>(current.tiles),
              ]),
            );
            focusAfter(`alt${alternatives.length + 1}`);
          }}
        >
          {messages.t("wordOrder.addAlternative")}
        </Button>
      </fieldset>
      <EditorField
        label={messages.t("wordOrder.translation")}
        description={messages.t("wordOrder.translationHelp")}
        value={item.translation ?? ""}
        onCommit={(translation) => change((current) => ({ ...current, translation }))}
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
          {messages.t("wordOrder.removeItem", { number })}
        </Button>
      )}
    </fieldset>
  );
}

const fieldsOf = (items: readonly WordOrderItem[]): IssuePath[] =>
  items.flatMap((item, index) => [
    ["items", index, "tiles"],
    ["items", index, "translation"],
    ...listOf(item.tiles).map((_, at): IssuePath => ["items", index, "tiles", at]),
    ...listOf(item.alternatives).map((_, at): IssuePath => ["items", index, "alternatives", at]),
  ]);

/**
 * The editor of word-order exercises (ADR 0008).
 *
 * @public
 */
export const wordOrderEditor = /* @__PURE__ */ defineEditorBlock<WordOrderPayload>({
  create: () => ({ items: [newItem()] }),
  edit: function WordOrderEditor(props): ReactNode {
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
          {messages.t("wordOrder.addItem")}
        </Button>
      </div>
    );
  },
});
