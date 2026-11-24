import { type ForwardedRef, forwardRef, type ReactElement } from "react";
import { Dialog, type DialogProps } from "../dialog/Dialog.js";
import { cx } from "../shared/style-props.js";

/**
 * Props of {@link Sheet}: a {@link Dialog}'s, with where it comes from.
 *
 * @public
 */
export interface SheetProps extends Omit<DialogProps, "size"> {
  /**
   * `auto` (the default) comes from the inline end on a wide viewport and
   * from the bottom below 48 rem; `end` and `bottom` always do.
   */
  readonly placement?: "auto" | "end" | "bottom" | undefined;
}

/**
 * A modal sheet (sdk-core ADR 0067): a {@link Dialog} that comes from the
 * inline end, as a drawer, or from the bottom, as on phones. It keeps
 * everything a dialog does: focus moves in and back, the page behind is
 * inert, and Escape asks to close. It sits in the top layer, so it follows
 * the viewport rather than its container.
 *
 * @public
 */
export const Sheet = /* @__PURE__ */ forwardRef(function Sheet(
  { placement = "auto", className, ...props }: SheetProps,
  ref: ForwardedRef<HTMLDialogElement>,
): ReactElement {
  return (
    <Dialog {...props} ref={ref} className={cx("hm-sheet", `hm-sheet--${placement}`, className)} />
  );
});
