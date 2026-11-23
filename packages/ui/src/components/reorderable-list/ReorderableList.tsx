import {
  createContext,
  type FocusEvent,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import { useLatest } from "../../react/use-latest.js";
import { useAnnounce } from "../announcer/Announcer.js";
import { useUiMessages } from "../messages/UiMessagesProvider.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";
import { items as focusableItems } from "../toolbar/roving-focus.js";

/**
 * Props of {@link ReorderableList}.
 *
 * @public
 */
export interface ReorderableListProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "role">,
    StyleProps<"root"> {
  /** The list's accessible name, such as "Layers". Required. */
  readonly label: string;
  /** The selected item's `id`, or `null` for none. */
  readonly selectedId?: string | null | undefined;
  /** Called with an item's `id` when the user selects it. */
  readonly onSelectedChange?: ((id: string) => void) | undefined;
  /**
   * Called when the user moves an item with Alt+↑ or Alt+↓ (Option on
   * macOS), with its `id` and the position it should have, counted from 0.
   * Render the items in the new order, or leave them when the move isn't
   * allowed. Without it, the list doesn't reorder.
   */
  readonly onMove?: ((id: string, toIndex: number) => void) | undefined;
  /**
   * Called when the user presses Delete or Backspace on an item, with its
   * `id`. Render the items without it. Without it, the keys do nothing.
   */
  readonly onRemove?: ((id: string) => void) | undefined;
  /**
   * Whether the list announces a move to screen readers, through the
   * closest `AnnouncerProvider`. Defaults to `true`; pass `false` when you
   * announce it in your own words.
   */
  readonly announceMoves?: boolean | undefined;
  /** The items: {@link ReorderableListItem} elements, in the order shown. */
  readonly children?: ReactNode;
}

/**
 * The parts of a reorderable list's item that `classNames` can target.
 *
 * @public
 */
export type ReorderableListItemPart = "root" | "item" | "control";

/**
 * Props of {@link ReorderableListItem}.
 *
 * @public
 */
export interface ReorderableListItemProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "role" | "id">,
    StyleProps<ReorderableListItemPart> {
  /** Identifies the item in `selectedId`, `onMove` and `onRemove`. Unique in the list. */
  readonly id: string;
  /**
   * The item's accessible name, such as a layer's name. Start it with the
   * text the item shows, if it shows any.
   */
  readonly label: string;
  /**
   * The item's controls, such as a visibility toggle: one focusable control
   * each, in its own cell. A control that can't act should stay focusable,
   * as `focusableWhenDisabled` makes a button.
   */
  readonly controls?: readonly ReactNode[] | undefined;
  /** What the item shows. */
  readonly children?: ReactNode;
}

interface ListContext {
  readonly selectedId: string | null | undefined;
}

const ReorderableListContext = /* @__PURE__ */ createContext<ListContext | undefined>(undefined);

/** A change asked for from the keyboard, whose focus is restored once it renders. */
interface Pending {
  readonly kind: "move" | "remove";
  readonly id: string;
  /** The item's position when the key was pressed. */
  readonly index: number;
  /** The focused cell's position in its row. */
  readonly cell: number;
  /** The items' ids when the key was pressed. */
  readonly order: string;
}

/** Keys that never act inside text fields, where they edit text. */
function editsText(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement &&
        !["button", "checkbox", "radio", "reset", "submit"].includes(target.type)))
  );
}

/** The list's rows, in the order shown. */
function rowsOf(list: HTMLElement): HTMLElement[] {
  return [...list.children].filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.getAttribute("role") === "row",
  );
}

/** Cells that `focusReorderableListItem` asked to focus, which keep focus from outside. */
const requested = new WeakSet<HTMLElement>();

/**
 * Focuses an item of a {@link ReorderableList} from outside it, and so
 * selects it, as focus on an item does. Focus that comes from outside the
 * list otherwise goes to its Tab stop, the selected item, whichever cell
 * it was given: that's where a keyboard user enters it, and NVDA's browse
 * mode can give focus to any cell (#201).
 *
 * @param list - The list's element, its `ref`.
 * @param id - The item's `id`.
 * @returns Whether the item now has focus.
 *
 * @public
 */
export function focusReorderableListItem(list: HTMLElement | null, id: string): boolean {
  const row = list ? rowsOf(list).find((candidate) => idOf(candidate) === id) : undefined;
  const cell = row ? cellsOf(row)[0] : undefined;
  if (!cell) {
    return false;
  }
  requested.add(cell);
  cell.focus();
  requested.delete(cell);
  return document.activeElement === cell;
}

/** A control cell's control. */
const controlOf = (cell: HTMLElement): HTMLElement | undefined => focusableItems(cell)[0];

/**
 * A row's focus targets: the item's cell, then each control's cell. Focus
 * stays on cells, never on the controls inside them: NVDA, by default,
 * leaves focus mode for its browse mode when focus lands on a button, even
 * inside a grid, and then keeps the arrow keys and Alt with them for itself
 * (#202). On a cell it stays in focus mode.
 */
function cellsOf(row: HTMLElement): HTMLElement[] {
  const targets: HTMLElement[] = [];
  for (const cell of row.children) {
    if (!(cell instanceof HTMLElement)) {
      continue;
    }
    if (cell.dataset["hmCell"] === "item" || controlOf(cell)) {
      targets.push(cell);
    }
  }
  return targets;
}

/** A control's name, as far as the cell needs it: its label, the elements that label it, or its text. */
function nameOf(control: HTMLElement): string {
  const labelledBy = control
    .getAttribute("aria-labelledby")
    ?.split(/\s+/)
    .map((id) => control.ownerDocument.getElementById(id)?.textContent?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
  return (control.getAttribute("aria-label") || labelledBy || control.textContent || "").trim();
}

/** The words for a control's state, from its `aria-pressed` or `aria-checked`. */
type ControlWords = (
  state: "pressed" | "notPressed" | "checked" | "notChecked" | null,
  label: string,
) => string;

/**
 * Makes each control cell stand for its control: the control leaves the Tab
 * order, and the cell's name is the control's name with its state, since
 * the cell, not the control, has focus.
 */
function syncControlCells(list: HTMLElement, words: ControlWords): void {
  for (const cell of list.querySelectorAll<HTMLElement>('[data-hm-cell="control"]')) {
    const control = controlOf(cell);
    if (!control) {
      continue;
    }
    control.dataset["hmRoving"] = "";
    control.tabIndex = -1;
    const label = nameOf(control);
    const pressed = control.getAttribute("aria-pressed");
    // A native checkbox or radio states its checkedness itself.
    const native =
      control instanceof HTMLInputElement &&
      (control.type === "checkbox" || control.type === "radio")
        ? String(control.checked)
        : null;
    const checked = control.getAttribute("aria-checked") ?? native;
    const state =
      pressed === "true"
        ? "pressed"
        : pressed === "false"
          ? "notPressed"
          : checked === "true"
            ? "checked"
            : checked === "false"
              ? "notChecked"
              : null;
    const name = words(state, label);
    if (cell.getAttribute("aria-label") !== name) {
      cell.setAttribute("aria-label", name);
    }
  }
}

const idOf = (row: HTMLElement | undefined): string => row?.dataset["hmId"] ?? "";
const orderOf = (rows: HTMLElement[]): string => JSON.stringify(rows.map(idOf));
const selectedRow = (rows: HTMLElement[]): HTMLElement | undefined =>
  rows.find((row) => row.getAttribute("aria-selected") === "true");

/**
 * Makes one cell the list's only Tab stop: `active` when it's a cell, else
 * the cell that already is, else the selected row's item, else the first.
 */
function syncTabStop(list: HTMLElement, active?: Element | null): void {
  const rows = rowsOf(list);
  const all = rows.flatMap(cellsOf);
  const current =
    all.find((cell) => cell === active) ??
    all.find((cell) => cell.dataset["hmTabStop"] !== undefined) ??
    cellsOf(selectedRow(rows) ?? rows[0] ?? list)[0];
  for (const cell of all) {
    const isStop = cell === current;
    // Marks a control the list manages, so it still counts at tabindex -1.
    cell.dataset["hmRoving"] = "";
    cell.tabIndex = isStop ? 0 : -1;
    if (isStop) {
      cell.dataset["hmTabStop"] = "";
    } else {
      delete cell.dataset["hmTabStop"];
    }
  }
}

/**
 * A list whose items the user selects, reorders and removes, with one Tab
 * stop and room for controls in each row (docs/adr/0009). It's a WAI-ARIA
 * grid with one column of rows.
 *
 * - **↑ and ↓** move between rows and select; with Ctrl or ⌘, they move
 *   without selecting. The selection follows focus however it reaches an
 *   item: the keys, a click, or a `focus()` from inside the list. Focus on
 *   a control's cell never changes it.
 * - **Focus from outside enters at the Tab stop,** the selected item,
 *   without selecting, whichever cell it was given; a pointer press keeps
 *   the cell it pressed. To focus another item from outside, call
 *   {@link focusReorderableListItem}, which selects it, or set `selectedId`
 *   first. **← and →**, Home and End move between
 *   a row's cells. Ctrl or ⌘ with Home or End goes to the first or last
 *   row. Space or Enter on an item selects it, and on a control's cell
 *   presses its control.
 * - **Focus stays on cells.** A control is part of its cell: the cell takes
 *   focus, is named after the control and its `aria-pressed` or
 *   `aria-checked` state, and passes Space, Enter and clicks to it. Screen
 *   readers then stay in the mode that sends keys to the list.
 * - **Alt+↑ and Alt+↓** (Option on macOS) move the focused item, through
 *   `onMove`. **Delete and Backspace** remove it, through `onRemove`.
 * - **You own the order.** The list calls `onMove` and `onRemove`, and you
 *   render the result. Focus stays with a moved item, and goes to the next
 *   one after a removal.
 * - **Offer buttons too.** The keys are an addition: also render buttons
 *   that move the selected item, for touch and for people who don't know
 *   the keys, and name the keys on them with `aria-keyshortcuts`.
 *
 * @example
 * ```tsx
 * <ReorderableList
 *   label={t("layers.label")}
 *   selectedId={selected}
 *   onSelectedChange={setSelected}
 *   onMove={(id, toIndex) => session.moveLayer(id, toIndex)}
 *   onRemove={(id) => session.deleteLayer(id)}
 * >
 *   {layers.map((layer) => (
 *     <ReorderableListItem
 *       key={layer.id}
 *       id={layer.id}
 *       label={layer.name}
 *       controls={[
 *         <ToggleButton
 *           key="visible"
 *           variant="quiet"
 *           label={t("layers.visible")}
 *           icon={<VisibleIcon />}
 *           pressed={layer.visible}
 *           onPressedChange={(visible) => session.showLayer(layer.id, visible)}
 *         />,
 *       ]}
 *     >
 *       {layer.name}
 *     </ReorderableListItem>
 *   ))}
 * </ReorderableList>
 * ```
 *
 * @public
 */
export const ReorderableList = /* @__PURE__ */ forwardRef<HTMLDivElement, ReorderableListProps>(
  function ReorderableList(
    {
      label,
      selectedId,
      onSelectedChange,
      onMove,
      onRemove,
      announceMoves = true,
      className,
      classNames,
      unstyled,
      onKeyDown,
      onPointerDown,
      onClick,
      onFocus,
      onBlur,
      children,
      ...props
    },
    ref,
  ) {
    const list = useRef<HTMLDivElement | null>(null);
    const pending = useRef<Pending | undefined>(undefined);
    const lastSelected = useRef(selectedId);
    // Set while the list moves focus itself, when that focus mustn't select.
    const quiet = useRef(false);
    // Set from a pointer press in the list until the focus it causes, which
    // keeps the cell it pressed. On touch, focus comes when the finger lifts,
    // however long it was held, so it's state, not a time.
    const pressing = useRef(false);
    // Removes the listeners that end the current press, if one is waiting.
    const endPress = useRef<(() => void) | undefined>(undefined);
    useEffect(() => () => endPress.current?.(), []);
    const announce = useAnnounce();
    const messages = useUiMessages();
    // How a control cell names its control's state, in the current messages.
    // Read only in effects, the observer's included, which run after it updates.
    const words = useLatest<ControlWords>((state, controlLabel) =>
      state === null
        ? controlLabel
        : messages.t(`reorderableList.control.${state}`, { label: controlLabel }),
    );

    // A control can change its own state without the list rendering, such as
    // a toggle that keeps its state itself, so its cell follows the DOM.
    useEffect(() => {
      const element = list.current;
      if (!element || typeof MutationObserver === "undefined") {
        return;
      }
      const sync = (): void => syncControlCells(element, words.current);
      const observer = new MutationObserver(sync);
      observer.observe(element, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-pressed", "aria-checked", "aria-label", "aria-labelledby"],
      });
      // A native checkbox changes its checkedness, not an attribute.
      element.addEventListener("change", sync);
      element.addEventListener("input", sync);
      return () => {
        observer.disconnect();
        element.removeEventListener("change", sync);
        element.removeEventListener("input", sync);
      };
      // `words` is the same object on every render, so this runs once.
    }, [words]);

    // After every render: one Tab stop, and the focus a move or a removal
    // asked for, once the host has rendered it.
    useEffect(() => {
      const element = list.current;
      if (!element) {
        return;
      }
      const change = pending.current;
      const rows = rowsOf(element);
      if (change && orderOf(rows) !== change.order) {
        pending.current = undefined;
        const index =
          change.kind === "move"
            ? rows.findIndex((row) => idOf(row) === change.id)
            : Math.min(change.index, rows.length - 1);
        const row = rows[index];
        // Only where focus was dropped or is still in the list: never taken
        // from wherever the user has gone since.
        const active = document.activeElement;
        const free = !active || active === document.body || element.contains(active);
        if (row && free) {
          const cells = cellsOf(row);
          const target = cells[change.cell] ?? cells[0];
          syncTabStop(element, target);
          // A moved item keeps its selection as it was; after a removal, the
          // item that took its place is focused, and selected, as any is.
          // The list's own focus, not an entry from outside, though the
          // removed row took focus with it.
          quiet.current = change.kind === "move";
          if (target) {
            requested.add(target);
          }
          try {
            target?.focus();
          } finally {
            quiet.current = false;
            if (target) {
              requested.delete(target);
            }
          }
        }
        if (row && change.kind === "move" && announceMoves) {
          announce(
            messages.t("reorderableList.moved", {
              label: cellsOf(row)[0]?.getAttribute("aria-label") ?? "",
              position: index + 1,
              count: rows.length,
            }),
          );
        }
      }
      syncControlCells(element, words.current);
      // With focus elsewhere, the Tab stop follows a selection made elsewhere,
      // such as on an editor's stage; with focus inside, it stays with focus.
      const inside = element.contains(document.activeElement);
      const reselected = lastSelected.current !== selectedId;
      lastSelected.current = selectedId;
      syncTabStop(
        element,
        inside
          ? document.activeElement
          : reselected
            ? cellsOf(selectedRow(rowsOf(element)) ?? element)[0]
            : null,
      );
    });

    const select = (id: string): void => {
      if (id !== "" && id !== selectedId) {
        onSelectedChange?.(id);
      }
    };

    // The keys focus quietly: they choose whether to select themselves, as
    // Ctrl or ⌘ with an arrow doesn't. Focusing is synchronous, so the flag
    // only covers that one call.
    const focusCell = (row: HTMLElement | undefined, cell: number): void => {
      if (!row || !list.current) {
        return;
      }
      const cells = cellsOf(row);
      const target = cells[cell] ?? cells[0];
      syncTabStop(list.current, target);
      quiet.current = true;
      try {
        target?.focus();
      } finally {
        quiet.current = false;
      }
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
      onKeyDown?.(event);
      // Whatever was asked for before, the user has moved on.
      pending.current = undefined;
      if (event.defaultPrevented || event.nativeEvent.isComposing) {
        return;
      }
      if (event.key === "Escape" && editsText(event.target)) {
        // Escape leaves a text field among a row's controls for its cell.
        const fieldCell = (event.target as HTMLElement).closest<HTMLElement>(
          '[data-hm-cell="control"]',
        );
        if (fieldCell && event.currentTarget.contains(fieldCell)) {
          event.preventDefault();
          focusQuietly(fieldCell);
        }
        return;
      }
      if (
        event.defaultPrevented ||
        event.nativeEvent.isComposing ||
        event.shiftKey ||
        editsText(event.target)
      ) {
        return;
      }
      const element = event.currentTarget;
      const rows = rowsOf(element);
      const index = rows.findIndex((row) => row.contains(event.target as Node));
      const row = rows[index];
      if (!row) {
        return;
      }
      const cells = cellsOf(row);
      // A key from inside a cell, such as from a control that has focus, is
      // its cell's.
      const cell = cells.indexOf(
        (event.target as HTMLElement).closest<HTMLElement>("[data-hm-cell]") as HTMLElement,
      );
      if (cell === -1) {
        return;
      }
      // Ctrl or ⌘ moves without selecting, as in pdf-sdk's thumbnails.
      const quiet = event.ctrlKey || event.metaKey;
      const vertical = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;

      if (event.altKey) {
        // Taken even at the first and last rows, so the page never scrolls.
        if (vertical !== 0 && !quiet && onMove) {
          event.preventDefault();
          const toIndex = index + vertical;
          if (toIndex >= 0 && toIndex < rows.length) {
            pending.current = { kind: "move", id: idOf(row), index, cell, order: orderOf(rows) };
            onMove(idOf(row), toIndex);
          }
        }
        return;
      }

      if (vertical !== 0) {
        event.preventDefault();
        const next = rows[index + vertical];
        if (next) {
          focusCell(next, cell);
          if (!quiet) {
            select(idOf(next));
          }
        }
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        if (quiet) {
          focusCell(event.key === "Home" ? rows[0] : rows[rows.length - 1], cell);
        } else {
          focusCell(row, event.key === "Home" ? 0 : cells.length - 1);
        }
        return;
      }

      if (quiet) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const rtl = getComputedStyle(element).direction === "rtl";
        const step = (event.key === "ArrowRight") === rtl ? -1 : 1;
        if (cells[cell + step]) {
          focusCell(row, cell + step);
        }
      } else if ((event.key === "Delete" || event.key === "Backspace") && onRemove) {
        event.preventDefault();
        pending.current = { kind: "remove", id: idOf(row), index, cell, order: orderOf(rows) };
        onRemove(idOf(row));
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        const target = cells[cell];
        if (cell === 0) {
          select(idOf(row));
        } else if (target) {
          // A control's cell presses its control, as the control would, or
          // puts focus in it when it takes text.
          const control = controlOf(target);
          if (editsText(control ?? null)) {
            control?.focus();
          } else {
            control?.click();
          }
        }
      }
    };

    const handleClick = (event: MouseEvent<HTMLDivElement>): void => {
      onClick?.(event);
      const target = event.target as HTMLElement;
      const row = rowsOf(event.currentTarget).find((candidate) => candidate.contains(target));
      // A press on a control only acts on the control.
      if (row && !event.defaultPrevented && target.closest('[data-hm-cell="control"]') === null) {
        select(idOf(row));
      }
    };

    // The selection follows focus however it arrives on an item: Tab, a
    // click, or a host's own `focus()`. Not on a control, whose cell never
    // changes the selection, and only when it would change.
    const focusQuietly = (cell: HTMLElement): void => {
      if (list.current) {
        syncTabStop(list.current, cell);
      }
      quiet.current = true;
      try {
        cell.focus();
      } finally {
        quiet.current = false;
      }
    };

    const handleFocus = (event: FocusEvent<HTMLDivElement>): void => {
      onFocus?.(event);
      const target = event.target as HTMLElement;
      const element = event.currentTarget;
      // Focus from outside the list enters at its Tab stop, without
      // selecting, whichever cell it was given: NVDA's browse mode can give
      // focus to any cell, and a Tab must never change the selection (#201).
      // A pointer press keeps the cell it pressed, and so does
      // focusReorderableListItem.
      const related = event.relatedTarget;
      const fromOutside = !(related instanceof Node && element.contains(related));
      const cell = target.closest<HTMLElement>("[data-hm-cell]");
      const pressed = pressing.current;
      pressing.current = false;
      // Entering is never a selection, even onto the Tab stop itself.
      const entering = fromOutside && cell !== null && !pressed && !requested.has(cell);
      if (entering) {
        const all = rowsOf(element).flatMap(cellsOf);
        const stop =
          all.find((candidate) => candidate.dataset["hmTabStop"] !== undefined) ??
          cellsOf(selectedRow(rowsOf(element)) ?? element)[0];
        if (stop && stop !== cell) {
          focusQuietly(stop);
          return;
        }
      }
      // A control that took focus, from a press for instance, hands it to
      // its cell, which stands for it. A text field keeps it, so it can be
      // typed into; Escape returns to the cell.
      const controlCell = target.closest<HTMLElement>('[data-hm-cell="control"]');
      if (controlCell && controlCell !== target && element.contains(controlCell)) {
        if (editsText(target)) {
          syncTabStop(element, controlCell);
          return;
        }
        focusQuietly(controlCell);
        return;
      }
      syncTabStop(event.currentTarget, event.target);
      if (!quiet.current && !entering && target.dataset["hmCell"] === "item") {
        const row = rowsOf(event.currentTarget).find((candidate) => candidate.contains(target));
        if (row) {
          select(idOf(row));
        }
      }
    };

    const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
      onBlur?.(event);
      // Focus went somewhere else on purpose, so nothing brings it back.
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
        pending.current = undefined;
      }
    };

    return (
      // biome-ignore lint/a11y/useSemanticElements: a table can't be a list of rows with one Tab stop; role="grid" on a div is the APG layout grid.
      <div
        {...props}
        ref={(node) => {
          list.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        role="grid"
        aria-label={label}
        className={cx("hm-reorderable-list", classNames?.root, className)}
        data-hm-unstyled={unstyledAttribute(unstyled)}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          pressing.current = true;
          // A press that focuses nothing ends with the pointer, wherever it
          // lifts; after a tick, so the focus a lift causes still counts.
          // Both listeners go when either fires, or when a new press or the
          // list's unmounting replaces them.
          endPress.current?.();
          const release = (): void => {
            endPress.current?.();
            setTimeout(() => {
              pressing.current = false;
            });
          };
          endPress.current = () => {
            window.removeEventListener("pointerup", release);
            window.removeEventListener("pointercancel", release);
            endPress.current = undefined;
          };
          window.addEventListener("pointerup", release);
          window.addEventListener("pointercancel", release);
          onPointerDown?.(event);
        }}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <ReorderableListContext.Provider value={{ selectedId }}>
          {children}
        </ReorderableListContext.Provider>
      </div>
    );
  },
);

/**
 * An item of a {@link ReorderableList}: a row with the item's content, and a
 * cell for each of its `controls`.
 *
 * @public
 */
export const ReorderableListItem = /* @__PURE__ */ forwardRef<
  HTMLDivElement,
  ReorderableListItemProps
>(function ReorderableListItem(
  { id, label, controls, className, classNames, unstyled, children, ...props },
  ref,
) {
  const selected = useContext(ReorderableListContext)?.selectedId === id;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a row of the APG layout grid; see ReorderableList.
    // biome-ignore lint/a11y/useFocusableInteractive: the row's cells take focus, not the row.
    <div
      {...props}
      ref={ref}
      role="row"
      aria-selected={selected}
      data-hm-id={id}
      className={cx("hm-reorderable-list-row", classNames?.root, className)}
      data-hm-unstyled={unstyledAttribute(unstyled)}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a cell of the APG layout grid; see ReorderableList. */}
      <div
        role="gridcell"
        aria-label={label}
        // The list keeps one Tab stop; before it runs, the selected item is it.
        tabIndex={selected ? 0 : -1}
        data-hm-cell="item"
        className={cx("hm-reorderable-list-item", classNames?.item)}
      >
        {children}
      </div>
      {controls?.map((control, index) => (
        // biome-ignore lint/a11y/useSemanticElements: a cell of the APG layout grid; see ReorderableList.
        // biome-ignore lint/a11y/useFocusableInteractive: the control inside the cell takes focus, not the cell.
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: an item's controls are static and ordered
          key={index}
          role="gridcell"
          data-hm-cell="control"
          className={cx("hm-reorderable-list-control", classNames?.control)}
        >
          {control}
        </div>
      ))}
    </div>
  );
});
