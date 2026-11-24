import { type ForwardedRef, forwardRef, type ReactElement, useSyncExternalStore } from "react";
import { ThemeDarkIcon } from "../../icons/icons.generated.js";
import { uiEditorText } from "../../messages/editor.js";
import { IconButton, type IconButtonProps } from "../button/IconButton.js";
import { useUiText } from "../messages/UiMessagesProvider.js";
import { cx } from "../shared/style-props.js";

/**
 * Props of {@link ThemeToggle}.
 *
 * @public
 */
export interface ThemeToggleProps
  extends Omit<IconButtonProps, "label" | "icon" | "pressed" | "onClick"> {
  /** The theme as chosen: `system` follows `prefers-color-scheme`. */
  readonly value: "system" | "light" | "dark";
  /** Called with the theme to switch to, always `light` or `dark`. */
  readonly onValueChange: (value: "light" | "dark") => void;
  /** Defaults to `themeToggle.dark`, "Dark theme". */
  readonly label?: string | undefined;
}

const QUERY = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemIsDark = (): boolean => window.matchMedia(QUERY).matches;
// The server can't know; hydration starts light and corrects after.
const onServer = (): boolean => false;

/**
 * The top bar's quick theme switch (sdk-core ADR 0067): a toggle button
 * named "Dark theme", pressed while the editor is dark, whether by choice or
 * by the system. Pressing it chooses the other theme explicitly; the
 * settings panel can go back to the system's.
 *
 * @public
 */
export const ThemeToggle = /* @__PURE__ */ forwardRef(function ThemeToggle(
  { value, onValueChange, label, className, variant = "quiet", ...props }: ThemeToggleProps,
  ref: ForwardedRef<HTMLButtonElement>,
): ReactElement {
  const defaultLabel = useUiText("themeToggle.dark", uiEditorText);
  const system = useSyncExternalStore(subscribe, systemIsDark, onServer);
  const dark = value === "dark" || (value === "system" && system);
  return (
    <IconButton
      {...props}
      ref={ref}
      variant={variant}
      className={cx("hm-theme-toggle", className)}
      label={label ?? defaultLabel}
      icon={<ThemeDarkIcon />}
      pressed={dark}
      onClick={() => onValueChange(dark ? "light" : "dark")}
    />
  );
});
