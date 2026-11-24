import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { uiEditorText } from "../../messages/editor.js";
import { Button } from "../button/Button.js";
import { useUiText } from "../messages/UiMessagesProvider.js";
import { ProgressBar } from "../progress-bar/ProgressBar.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";

/**
 * The parts of a progress overlay that `classNames` can target.
 *
 * @public
 */
export type ProgressOverlayPart =
  | "root"
  | "content"
  | "scrim"
  | "card"
  | "title"
  | "bar"
  | "detail"
  | "cancel";

/**
 * Props of {@link ProgressOverlay}.
 *
 * @public
 */
export interface ProgressOverlayProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "title">,
    StyleProps<ProgressOverlayPart> {
  /** Whether the work is in progress, and the overlay shows. */
  readonly open: boolean;
  /** What's happening, such as "Exporting". It names the progress bar too. */
  readonly title: string;
  /** A line under the bar, such as "Encoding on this device…". */
  readonly detail?: ReactNode;
  /** How much is done, from 0 to `max`. Leave it out while it's unknown. */
  readonly value?: number | null | undefined;
  /** Defaults to 100. */
  readonly max?: number | undefined;
  /** The value as words, such as "Page 3 of 12", read instead of a percentage. */
  readonly valueText?: string | undefined;
  /** Stops the work. Without it, there's no Cancel button. */
  readonly onCancel?: (() => void) | undefined;
  /** Defaults to `progressOverlay.cancel` from the messages. */
  readonly cancelLabel?: string | undefined;
  /** What the overlay covers: the stage. */
  readonly children?: ReactNode;
}

/**
 * Progress over the stage while long work runs (sdk-core ADR 0067): a card
 * with a title, a progress bar, a line of detail and Cancel, over a scrim.
 *
 * - **What's behind is `inert`** while it shows, so it can't be clicked,
 *   focused or edited half-way through.
 * - **Focus moves to Cancel,** or to the card, when it opens while focus
 *   was in the content, and goes back there when it closes.
 *
 * @example
 * ```tsx
 * <ProgressOverlay open={exporting} title={messages.t("export.progress")} value={done} onCancel={cancel}>
 *   <Stage />
 * </ProgressOverlay>
 * ```
 *
 * @public
 */
export const ProgressOverlay = /* @__PURE__ */ forwardRef(function ProgressOverlay(
  {
    open,
    title,
    detail,
    value,
    max,
    valueText,
    onCancel,
    cancelLabel,
    children,
    className,
    classNames,
    unstyled,
    ...props
  }: ProgressOverlayProps,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const defaultCancel = useUiText("progressOverlay.cancel", uiEditorText);
  const titleId = useId();
  const content = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = content.current;
    if (!element) {
      return;
    }
    if (open) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && element.contains(active)) {
        previous.current = active;
        (cancel.current ?? card.current)?.focus();
      }
      element.inert = true;
      return;
    }
    element.inert = false;
    const before = previous.current;
    previous.current = null;
    // The card is gone, so focus that was in it has fallen to the body.
    const active = document.activeElement;
    if (before?.isConnected && (active === null || active === document.body)) {
      before.focus();
    }
  }, [open]);

  return (
    <div
      {...props}
      ref={ref}
      className={cx("hm-progress-overlay", classNames?.root, className)}
      data-hm-unstyled={unstyledAttribute(unstyled)}
      aria-busy={open || undefined}
    >
      <div ref={content} className={cx("hm-progress-overlay-content", classNames?.content)}>
        {children}
      </div>
      {open ? (
        <div className={cx("hm-progress-overlay-scrim", classNames?.scrim)}>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would announce its legend as a form group; this is a status card. */}
          <div
            ref={card}
            role="group"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cx("hm-progress-overlay-card", classNames?.card)}
          >
            <p id={titleId} className={cx("hm-progress-overlay-title", classNames?.title)}>
              {title}
            </p>
            <ProgressBar
              value={value ?? undefined}
              max={max}
              label={title}
              valueText={valueText}
              className={cx("hm-progress-overlay-bar", classNames?.bar)}
              unstyled={unstyled}
            />
            {detail == null ? null : (
              <p className={cx("hm-progress-overlay-detail", classNames?.detail)}>{detail}</p>
            )}
            {onCancel ? (
              <Button
                ref={cancel}
                className={cx("hm-progress-overlay-cancel", classNames?.cancel)}
                unstyled={unstyled}
                onClick={onCancel}
              >
                {cancelLabel ?? defaultCancel}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
});
