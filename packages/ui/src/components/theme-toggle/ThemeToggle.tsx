import {
  type ForwardedRef,
  forwardRef,
  type ReactElement,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";
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
  /**
   * The theme as chosen: `system` follows `prefers-color-scheme`. `inherit`
   * is for an editor that hasn't chosen one and takes its page's: the toggle
   * shows the theme its own element inherits, read after mount, and light
   * on the server.
   */
  readonly value: "system" | "light" | "dark" | "inherit";
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
 * Whether an element shows ui's dark theme. ui's tokens set
 * `--hm-color-scheme` on the root, following the system, and on every
 * `data-hm-theme` subtree, so the element inherits the one it shows. Without
 * ui's tokens, its `color-scheme` decides, and the system does when that
 * allows both or neither.
 */
function showsDark(element: Element): boolean {
  const style = getComputedStyle(element);
  const scheme = style.getPropertyValue("--hm-color-scheme").trim();
  if (scheme === "dark" || scheme === "light") {
    return scheme === "dark";
  }
  const schemes = style.colorScheme.split(/\s+/);
  if (schemes.includes("dark") !== schemes.includes("light")) {
    return schemes.includes("dark");
  }
  return systemIsDark();
}

/** Attributes on an ancestor that can change the theme an element inherits. */
const THEME_ATTRIBUTES = ["data-hm-theme", "class", "style"];

/**
 * Whether `element` shows the dark theme, kept current as an ancestor's
 * `data-hm-theme`, class or style changes, or the system's preference does.
 * Light until the element is mounted, as on the server.
 */
function useShowsDark(element: Element | null): boolean {
  const watch = useCallback(
    (onChange: () => void) => {
      const unsubscribe = subscribe(onChange);
      if (!element) {
        return unsubscribe;
      }
      const observer = new MutationObserver(onChange);
      for (let node = element.parentElement; node; node = node.parentElement) {
        observer.observe(node, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
      }
      return () => {
        observer.disconnect();
        unsubscribe();
      };
    },
    [element],
  );
  const read = useCallback(() => (element ? showsDark(element) : false), [element]);
  return useSyncExternalStore(watch, read, onServer);
}

/**
 * The top bar's quick theme switch (sdk-core ADR 0067): a toggle button
 * named "Dark theme", pressed while the editor is dark, whether by choice, by
 * the system, or, with `inherit`, by its page. Pressing it chooses the other
 * theme explicitly; the settings panel can go back to the system's.
 *
 * @public
 */
export const ThemeToggle = /* @__PURE__ */ forwardRef(function ThemeToggle(
  { value, onValueChange, label, className, variant = "quiet", ...props }: ThemeToggleProps,
  ref: ForwardedRef<HTMLButtonElement>,
): ReactElement {
  const defaultLabel = useUiText("themeToggle.dark", uiEditorText);
  const system = useSyncExternalStore(subscribe, systemIsDark, onServer);
  // The element itself, once mounted, for the theme it inherits.
  const [element, setElement] = useState<HTMLButtonElement | null>(null);
  const inherited = useShowsDark(value === "inherit" ? element : null);
  const dark =
    value === "dark" || (value === "system" && system) || (value === "inherit" && inherited);
  const setRefs = useCallback(
    (node: HTMLButtonElement | null) => {
      setElement(node);
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );
  return (
    <IconButton
      {...props}
      ref={setRefs}
      variant={variant}
      className={cx("hm-theme-toggle", className)}
      label={label ?? defaultLabel}
      icon={<ThemeDarkIcon />}
      pressed={dark}
      onClick={() => onValueChange(dark ? "light" : "dark")}
    />
  );
});
