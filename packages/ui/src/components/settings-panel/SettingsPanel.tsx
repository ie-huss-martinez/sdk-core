import { type ForwardedRef, forwardRef, type ReactElement, type ReactNode } from "react";
import { uiEditorText } from "../../messages/editor.js";
import type { uiMessages } from "../../messages/en.js";
import {
  type EditorPreferences,
  editorPreferenceOptions,
} from "../../preferences/editor-preferences.js";
import { useUiTextLookup } from "../messages/UiMessagesProvider.js";
import { SegmentedControl } from "../segmented-control/SegmentedControl.js";
import { cx } from "../shared/style-props.js";
import { Sheet, type SheetProps } from "../sheet/Sheet.js";

/**
 * Props of {@link SettingsPanel}.
 *
 * @public
 */
export interface SettingsPanelProps extends Omit<SheetProps, "title" | "children"> {
  /** The preferences shown. The panel is always controlled. */
  readonly value: EditorPreferences;
  /** Called with the whole new preferences when one changes. */
  readonly onValueChange: (value: EditorPreferences) => void;
  /**
   * Which preferences to offer, in order. Defaults to all of them. Leave
   * out what the editor doesn't use, such as `properties` without a
   * properties panel.
   */
  readonly settings?: readonly (keyof EditorPreferences)[] | undefined;
  /** Defaults to `settings.title`. */
  readonly title?: ReactNode;
  /** The host's own settings, after the editor's. */
  readonly children?: ReactNode;
}

const ALL: readonly (keyof EditorPreferences)[] = [
  "theme",
  "mode",
  "toolsLayout",
  "tools",
  "properties",
  "density",
  "motion",
  "tips",
];

type Key = Extract<keyof typeof uiMessages, `settings.${string}` | `mode.${string}`>;

/**
 * The editor's settings in a {@link Sheet} (sdk-core ADR 0067): appearance,
 * experience, tools layout, the panels, density, motion and tips, each a
 * segmented control. It's controlled: the host keeps the preferences where
 * it chooses, such as `localStorage`, and the editor never stores them.
 *
 * @public
 */
export const SettingsPanel = /* @__PURE__ */ forwardRef(function SettingsPanel(
  {
    value,
    onValueChange,
    settings = ALL,
    title,
    className,
    unstyled,
    children,
    ...props
  }: SettingsPanelProps,
  ref: ForwardedRef<HTMLDialogElement>,
): ReactElement {
  const t = useUiTextLookup(uiEditorText);
  const row = (name: keyof EditorPreferences): ReactElement => {
    const heading = t((name === "mode" ? "mode.label" : `settings.${name}`) as Key);
    const set = (next: string): void =>
      onValueChange({ ...value, [name]: name === "tips" ? next === "on" : next });
    const options =
      name === "tips"
        ? (["on", "off"] as const).map((option) => ({
            value: option,
            label: t(`settings.tips.${option}`),
          }))
        : editorPreferenceOptions[name].map((option) => ({
            value: option as string,
            label: t((name === "mode" ? `mode.${option}` : `settings.${name}.${option}`) as Key),
          }));
    const current = name === "tips" ? (value.tips ? "on" : "off") : (value[name] as string);
    return (
      <div key={name} className="hm-settings-panel-row">
        <span className="hm-settings-panel-label" aria-hidden="true">
          {heading}
        </span>
        <SegmentedControl
          className="hm-settings-panel-control"
          unstyled={unstyled}
          label={heading}
          value={current}
          onValueChange={set}
          options={options}
        />
      </div>
    );
  };
  return (
    <Sheet
      {...props}
      ref={ref}
      unstyled={unstyled}
      className={cx("hm-settings-panel", className)}
      title={title ?? t("settings.title")}
    >
      <div className="hm-settings-panel-rows">{settings.map(row)}</div>
      {children}
    </Sheet>
  );
});
