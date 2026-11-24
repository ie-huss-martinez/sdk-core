import type { EditorMode } from "@hussmartinez/sdk-core";
import { type ForwardedRef, forwardRef, type ReactElement } from "react";
import { uiEditorText } from "../../messages/editor.js";
import { useUiText } from "../messages/UiMessagesProvider.js";
import {
  SegmentedControl,
  type SegmentedControlProps,
} from "../segmented-control/SegmentedControl.js";
import { cx } from "../shared/style-props.js";

/**
 * Props of {@link ModeSwitch}.
 *
 * @public
 */
export interface ModeSwitchProps
  extends Omit<SegmentedControlProps<EditorMode>, "label" | "options"> {
  /** The group's accessible name. Defaults to `mode.label`, "Experience". */
  readonly label?: string | undefined;
  /** Text of each mode. Defaults to `mode.easy`, `mode.advanced` and `mode.expert`. */
  readonly modeLabels?: Partial<Record<EditorMode, string>> | undefined;
}

/**
 * Easy, Advanced and Expert, as a segmented control (sdk-core ADR 0067).
 * Switching mode only changes what's shown, never the document.
 *
 * @public
 */
export const ModeSwitch = /* @__PURE__ */ forwardRef(function ModeSwitch(
  { label, modeLabels, className, ...props }: ModeSwitchProps,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const text = {
    label: useUiText("mode.label", uiEditorText),
    easy: useUiText("mode.easy", uiEditorText),
    advanced: useUiText("mode.advanced", uiEditorText),
    expert: useUiText("mode.expert", uiEditorText),
  };
  return (
    <SegmentedControl
      {...props}
      ref={ref}
      className={cx("hm-mode-switch", className)}
      label={label ?? text.label}
      options={(["easy", "advanced", "expert"] as const).map((mode) => ({
        value: mode,
        label: modeLabels?.[mode] ?? text[mode],
      }))}
    />
  );
});
