import { type ForwardedRef, forwardRef, type ReactElement, type ReactNode } from "react";
import { MoreIcon } from "../../icons/icons.generated.js";
import { uiEditorText } from "../../messages/editor.js";
import { Button } from "../button/Button.js";
import { useUiText } from "../messages/UiMessagesProvider.js";
import { cx, type StyleProps } from "../shared/style-props.js";
import { Toolbar, type ToolbarProps } from "../toolbar/Toolbar.js";

/**
 * One tab of a {@link TabBar}, usually a group of tools.
 *
 * @public
 */
export interface TabBarItem {
  readonly id: string;
  readonly label: string;
  /** Draws with `currentColor`. */
  readonly icon: ReactNode;
}

/**
 * The parts of a tab bar that `classNames` can target.
 *
 * @public
 */
export type TabBarPart = "root" | "item";

/**
 * Props of {@link TabBar}.
 *
 * @public
 */
export interface TabBarProps
  extends Omit<ToolbarProps, "classNames" | "orientation" | "children">,
    StyleProps<TabBarPart> {
  readonly items: readonly TabBarItem[];
  /** The open tab's id, or `null`. Shown with `aria-pressed`. */
  readonly value: string | null;
  /** Called with a tab's id when it's pressed. */
  readonly onValueChange: (id: string) => void;
  /** How many tabs fit before "More". Defaults to 5. Without `onMore`, every tab shows. */
  readonly max?: number | undefined;
  /** Called when "More" is pressed; it opens what the bar leaves out. */
  readonly onMore?: (() => void) | undefined;
  /** Defaults to `tabBar.more`. */
  readonly moreLabel?: string | undefined;
}

/**
 * The bar across the foot of a phone (sdk-core ADR 0067): up to five tabs,
 * each with an icon over its label, then "More". Each tab usually opens a
 * {@link Sheet} with a group's tools. A toolbar with one Tab stop and arrow
 * keys between the tabs; the open one is pressed.
 *
 * @public
 */
export const TabBar = /* @__PURE__ */ forwardRef(function TabBar(
  {
    items,
    value,
    onValueChange,
    max = 5,
    onMore,
    moreLabel,
    className,
    classNames,
    unstyled,
    ...props
  }: TabBarProps,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const defaultMore = useUiText("tabBar.more", uiEditorText);
  // Tabs past `max` move behind "More" only when there's somewhere to show them.
  const overflows = onMore !== undefined && items.length > max;
  const shown = overflows ? items.slice(0, max) : items;
  const item = (
    id: string,
    label: string,
    icon: ReactNode,
    pressed: boolean | undefined,
    run: () => void,
  ) => (
    <Button
      key={id}
      variant="quiet"
      startIcon={icon}
      pressed={pressed}
      unstyled={unstyled}
      className={cx("hm-tab-bar-item", classNames?.item)}
      onClick={run}
    >
      {label}
    </Button>
  );
  return (
    <Toolbar
      {...props}
      ref={ref}
      orientation="horizontal"
      unstyled={unstyled}
      className={cx("hm-tab-bar", classNames?.root, className)}
    >
      {shown.map((tab) =>
        item(tab.id, tab.label, tab.icon, tab.id === value, () => onValueChange(tab.id)),
      )}
      {overflows ? item("more", moreLabel ?? defaultMore, <MoreIcon />, undefined, onMore) : null}
    </Toolbar>
  );
});
