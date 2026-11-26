import {
  type ChangeEvent,
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  useCallback,
  useSyncExternalStore,
} from "react";
import { CloseIcon, SearchIcon } from "../../icons/icons.generated.js";
import { warnInDevelopment } from "../../internal/development.js";
import { uiSearchText } from "../../messages/search.js";
import { IconButton } from "../button/IconButton.js";
import { useFieldProps } from "../field/field-context.js";
import { useUiPartText } from "../messages/UiMessagesProvider.js";
import { useMergedRef } from "../shared/merged-ref.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/**
 * The parts of a search field that `classNames` can target.
 *
 * @public
 */
export type SearchFieldPart = "root" | "icon" | "input" | "clear" | "end";

/**
 * Props of {@link SearchField}. Native input props are passed through to the
 * input, and `className` goes on the box around it.
 *
 * @public
 */
export interface SearchFieldProps
  extends Omit<
      InputHTMLAttributes<HTMLInputElement>,
      "className" | "type" | "value" | "defaultValue"
    >,
    StyleProps<SearchFieldPart> {
  /**
   * The accessible name, such as "Search guides". Leave it out inside a
   * `Field`, or when a visible `<label>` points at the field's `id`, or
   * `aria-labelledby` names it. A placeholder isn't a name.
   */
  readonly label?: string | undefined;
  /** The text, when you control it. */
  readonly value?: string | undefined;
  /**
   * The text at first, when the field keeps its own. The input is then the
   * browser's to keep, so what's typed before the page's JavaScript runs
   * stays.
   */
  readonly defaultValue?: string | undefined;
  /** Called with the new text as it changes, and with `""` when it's cleared. */
  readonly onValueChange?: ((value: string) => void) | undefined;
  /** Replaces the search icon. It's decorative, and draws with `currentColor`. */
  readonly icon?: ReactNode;
  /**
   * Shown after the input, inside the box, such as a hint of the shortcut
   * that focuses the field. Hide a hint from assistive technology with
   * `aria-hidden`, and give the field `aria-keyshortcuts` instead.
   */
  readonly end?: ReactNode;
  /** The clear button's name. Defaults to `searchField.clear` from the messages ("Clear search"). */
  readonly clearLabel?: string | undefined;
}

// Whether the component runs in a browser doesn't change, so nothing to subscribe to.
const searchNeverChanges = (): (() => void) => () => undefined;
const searchInBrowser = (): boolean => true;
const searchOnServer = (): boolean => false;

/**
 * A search box: a native `<input type="search">` in a box styled like the
 * family's other fields, with a search icon before it and, while it holds
 * text, a button that clears it and returns focus to the field.
 *
 * It only holds the text. What's searched, and how results are shown and
 * announced, are yours: put it in a `<search>` element or a
 * `<form role="search">` with its results' controls, and announce how many
 * results there are, with `useAnnounce` or a `role="status"` element.
 *
 * @example
 * ```tsx
 * <SearchField
 *   label={messages.t("library.search")}
 *   placeholder={messages.t("library.searchPlaceholder")}
 *   value={query}
 *   onValueChange={setQuery}
 * />
 * ```
 *
 * @public
 */
export const SearchField = /* @__PURE__ */ forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField(
    {
      label,
      value,
      defaultValue,
      onValueChange,
      onChange,
      icon,
      end,
      clearLabel,
      disabled,
      readOnly,
      className,
      classNames,
      unstyled,
      ...props
    },
    ref,
  ) {
    const fieldProps = useFieldProps(props, label);
    if (
      label === undefined &&
      !props["aria-label"] &&
      !props["aria-labelledby"] &&
      fieldProps.id === undefined
    ) {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        warnInDevelopment(
          "SearchField needs an accessible name: pass label, or put it in a Field. Use text from your message catalogue; a placeholder isn't a name.",
        );
      }
    }
    const defaultClearLabel = useUiPartText(uiSearchText, "searchField.clear");
    // False on the server and while hydrating; true once the field can be cleared by its own button.
    const ready = useSyncExternalStore(searchNeverChanges, searchInBrowser, searchOnServer);
    const [input, setInput] = useMergedRef(ref);

    // Whether there's text to clear is read from the input, which holds it:
    // the owner's value when it's controlled, and otherwise the browser's,
    // which includes what was typed before the page's JavaScript arrived.
    const startsWithText = (value ?? defaultValue ?? "") !== "";
    const onInput = useCallback(
      (notify: () => void) => {
        const field = input.current;
        field?.addEventListener("input", notify);
        return () => field?.removeEventListener("input", notify);
      },
      [input],
    );
    const inputHoldsText = useSyncExternalStore(
      onInput,
      () => (input.current ? input.current.value !== "" : startsWithText),
      () => startsWithText,
    );
    const holdsText = value === undefined ? inputHoldsText : value !== "";

    const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
      onChange?.(event);
      onValueChange?.(event.currentTarget.value);
    };
    const clear = (): void => {
      const field = input.current;
      // A field that keeps its own text holds it in the input, so it's
      // emptied there; one that's controlled is emptied by its owner.
      if (field && value === undefined) {
        field.value = "";
        // Setting the value says nothing; this tells what watches the input, above.
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      onValueChange?.("");
      // The button is about to go: focus returns to the field it cleared.
      field?.focus();
    };

    return (
      <div
        className={cx("hm-search-field", classNames?.root, className)}
        data-hm-unstyled={unstyledAttribute(unstyled)}
        data-hm-ready={ready ? "" : undefined}
      >
        <span className={cx("hm-search-field-icon", classNames?.icon)} aria-hidden="true">
          {icon ?? <SearchIcon />}
        </span>
        <input
          {...props}
          {...fieldProps}
          ref={setInput}
          type="search"
          // Controlled only when the owner holds the text. Otherwise the
          // input keeps it, text typed before hydration included.
          {...(value === undefined ? { defaultValue } : { value })}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={label ?? props["aria-label"]}
          className={cx("hm-search-field-input", classNames?.input)}
          onChange={handleChange}
        />
        {ready && holdsText && !disabled && !readOnly ? (
          <IconButton
            variant="quiet"
            size="small"
            label={clearLabel ?? defaultClearLabel}
            icon={<CloseIcon />}
            unstyled={unstyled}
            className={cx("hm-search-field-clear", classNames?.clear)}
            onClick={clear}
          />
        ) : null}
        {end == null ? null : (
          <span className={cx("hm-search-field-end", classNames?.end)}>{end}</span>
        )}
      </div>
    );
  },
);
