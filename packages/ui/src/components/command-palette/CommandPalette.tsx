import {
  type ChangeEvent,
  type DialogHTMLAttributes,
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type SyntheticEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { uiEditorText } from "../../messages/editor.js";
import { useAnnounce } from "../announcer/Announcer.js";
import { useUiMessagesFrom, useUiText } from "../messages/UiMessagesProvider.js";
import { useMergedRef } from "../shared/merged-ref.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";
import { type CommandPaletteItem, filterCommandPaletteItems } from "./filter.js";

export type { CommandPaletteItem } from "./filter.js";

/**
 * The parts of a command palette that `classNames` can target.
 *
 * @public
 */
export type CommandPalettePart =
  | "root"
  | "title"
  | "input"
  | "list"
  | "option"
  | "label"
  | "details"
  | "shortcut"
  | "empty";

/**
 * Props of {@link CommandPalette}.
 *
 * @public
 */
export interface CommandPaletteProps
  extends Omit<
      DialogHTMLAttributes<HTMLDialogElement>,
      "className" | "title" | "open" | "children"
    >,
    StyleProps<CommandPalettePart> {
  /** Whether the palette is open. It's always controlled. */
  readonly open: boolean;
  /** Called with `false` when the person closes it: Escape, a click outside, or running an item. */
  readonly onOpenChange: (open: boolean) => void;
  /** Everything it can find, in their natural order. */
  readonly items: readonly CommandPaletteItem[];
  /** Runs an item. The palette asks to close first. */
  readonly onRun: (id: string) => void;
  /** The palette's accessible name, read when it opens. Defaults to `commandPalette.title`. */
  readonly title?: string | undefined;
  /** The search field's accessible name. Defaults to `commandPalette.label`. */
  readonly label?: string | undefined;
  /** Defaults to `commandPalette.placeholder`. */
  readonly placeholder?: string | undefined;
  /** Shown when nothing matches. Defaults to `commandPalette.empty`. */
  readonly emptyText?: string | undefined;
}

/** How long typing has to pause before the number of results is announced. */
const ANNOUNCE_DELAY = 400;

/**
 * A search over an editor's tools, in a modal `<dialog>` (sdk-core ADR
 * 0067). It follows the ARIA combobox pattern with a listbox popup:
 *
 * - **Focus stays in the search field.** The active option is named by
 *   `aria-activedescendant`, and the arrow keys, Home and End move it.
 * - **Enter runs the active option,** unless it's disabled, and the palette
 *   asks to close first. Escape closes it, and the native dialog returns
 *   focus to what opened it.
 * - **Each option is named by its label** and described by its
 *   description, group and shortcut. The number of results is announced
 *   politely as the query changes, through `useAnnounce`.
 * - **The query starts empty** every time it opens.
 *
 * Matching is {@link filterCommandPaletteItems}'s.
 *
 * @example
 * ```tsx
 * <CommandPalette
 *   open={open}
 *   onOpenChange={setOpen}
 *   items={tools.map((tool) => ({ id: tool.id, label: messages.t(tool.label) }))}
 *   onRun={runTool}
 * />
 * ```
 *
 * @public
 */
export const CommandPalette = /* @__PURE__ */ forwardRef(function CommandPalette(
  {
    open,
    onOpenChange,
    items,
    onRun,
    title,
    label,
    placeholder,
    emptyText,
    className,
    classNames,
    unstyled,
    onCancel,
    onClose,
    onClick,
    ...props
  }: CommandPaletteProps,
  forwardedRef: ForwardedRef<HTMLDialogElement>,
): ReactElement {
  const defaultTitle = useUiText("commandPalette.title", uiEditorText);
  const [ref, setRef] = useMergedRef(forwardedRef);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      // The search field is the first focusable element, so it takes focus.
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, ref]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    onCancel?.(event);
    event.preventDefault();
    onOpenChange(false);
  };

  const handleClose = (event: SyntheticEvent<HTMLDialogElement>): void => {
    onClose?.(event);
    if (open) {
      onOpenChange(false);
    }
  };

  // A click on the backdrop lands on the dialog itself, outside its content.
  const handleClick = (event: MouseEvent<HTMLDialogElement>): void => {
    onClick?.(event);
    if (event.target === event.currentTarget) {
      onOpenChange(false);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop closes, as Escape does from the keyboard.
    <dialog
      {...props}
      ref={setRef}
      aria-labelledby={titleId}
      className={cx("hm-command-palette", classNames?.root, className)}
      data-hm-unstyled={unstyledAttribute(unstyled)}
      onCancel={handleCancel}
      onClose={handleClose}
      onClick={handleClick}
    >
      <h2 id={titleId} className={cx("hm-visually-hidden", classNames?.title)}>
        {title ?? defaultTitle}
      </h2>
      {/* Mounted only while open, so every opening starts with an empty query. */}
      {open ? (
        <Search
          items={items}
          onRun={(id) => {
            onOpenChange(false);
            onRun(id);
          }}
          label={label}
          placeholder={placeholder}
          emptyText={emptyText}
          classNames={classNames}
        />
      ) : null}
    </dialog>
  );
});

interface SearchProps {
  readonly items: readonly CommandPaletteItem[];
  readonly onRun: (id: string) => void;
  readonly label: string | undefined;
  readonly placeholder: string | undefined;
  readonly emptyText: string | undefined;
  readonly classNames: CommandPaletteProps["classNames"];
}

function Search({ items, onRun, label, placeholder, emptyText, classNames }: SearchProps) {
  const messages = useUiMessagesFrom(uiEditorText);
  const announce = useAnnounce();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (index: number): string => `${id}-option-${index}`;

  const results = useMemo(() => filterCommandPaletteItems(items, query), [items, query]);
  const current = Math.min(active, results.length - 1);

  useEffect(() => () => clearTimeout(timer.current), []);

  // The active option stays in view as the arrow keys move it.
  useEffect(() => {
    if (current < 0) {
      return;
    }
    list.current?.querySelector(`[id="${optionId(current)}"]`)?.scrollIntoView?.({
      block: "nearest",
    });
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value;
    setQuery(next);
    setActive(0);
    const count = filterCommandPaletteItems(items, next).length;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      announce(messages.t("commandPalette.results", { count }));
    }, ANNOUNCE_DELAY);
  };

  const run = (index: number): void => {
    const item = results[index];
    if (item && !item.disabled) {
      onRun(item.id);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const last = results.length - 1;
    let next: number | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = current >= last ? 0 : current + 1;
        break;
      case "ArrowUp":
        next = current <= 0 ? last : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Enter":
        event.preventDefault();
        run(current);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (last >= 0) {
      setActive(next);
    }
  };

  return (
    <>
      <input
        type="text"
        role="combobox"
        aria-label={label ?? messages.t("commandPalette.label")}
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? optionId(current) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder ?? messages.t("commandPalette.placeholder")}
        value={query}
        className={cx("hm-command-palette-input", classNames?.input)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <div
        ref={list}
        id={listId}
        role="listbox"
        aria-label={label ?? messages.t("commandPalette.label")}
        className={cx("hm-command-palette-list", classNames?.list)}
      >
        {results.map((item, index) => {
          const details = `${optionId(index)}-details`;
          const hasDetails = item.description || item.group || item.shortcut;
          return (
            // biome-ignore lint/a11y/useFocusableInteractive: focus stays in the field, which names the active option with aria-activedescendant.
            // biome-ignore lint/a11y/useKeyWithClickEvents: the field's keys move and run the options.
            <div
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              aria-disabled={item.disabled ? true : undefined}
              aria-describedby={hasDetails ? details : undefined}
              className={cx("hm-command-palette-option", classNames?.option)}
              // Keeps focus in the search field.
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => {
                if (index !== current) {
                  setActive(index);
                }
              }}
              onClick={() => run(index)}
            >
              {item.icon == null ? null : (
                <span className="hm-command-palette-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              <span className={cx("hm-command-palette-label", classNames?.label)}>
                {item.label}
              </span>
              {hasDetails ? (
                <span
                  id={details}
                  className={cx("hm-command-palette-details", classNames?.details)}
                >
                  {item.description ? (
                    <span className="hm-command-palette-description">{item.description}</span>
                  ) : null}
                  {item.group ? (
                    <span className="hm-command-palette-group">{item.group}</span>
                  ) : null}
                  {item.shortcut ? (
                    <kbd className={cx("hm-command-palette-shortcut", classNames?.shortcut)}>
                      {item.shortcut}
                    </kbd>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {results.length === 0 ? (
        <p className={cx("hm-command-palette-empty", classNames?.empty)}>
          {emptyText ?? messages.t("commandPalette.empty")}
        </p>
      ) : null}
    </>
  );
}
