import { type ForwardedRef, forwardRef, type ReactElement, type ReactNode } from "react";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { useEditorFrame } from "../editor-frame/EditorFrame.js";
import { cx, type StyleProps } from "../shared/style-props.js";
import { Toolbar, type ToolbarProps } from "../toolbar/Toolbar.js";
import { ToolbarGroup } from "../toolbar/ToolbarGroup.js";
import { Tooltip } from "../tooltip/Tooltip.js";

/**
 * One tool in a {@link ToolList}.
 *
 * @public
 */
export interface ToolListItem {
  readonly id: string;
  /** Its name, from the SDK's messages. */
  readonly label: string;
  /** One line under the label in full rows, when `descriptions` is on. */
  readonly description?: string | undefined;
  /** Draws with `currentColor`. */
  readonly icon: ReactNode;
  /** The shortcut as text to show, such as "Ctrl+Shift+L", when `shortcuts` is on. */
  readonly shortcut?: string | undefined;
  /** The shortcut for `aria-keyshortcuts`, from the shortcut registry. */
  readonly ariaKeyShortcuts?: string | undefined;
  /** Shown, focusable and announced as unavailable, but not run. */
  readonly disabled?: boolean | undefined;
  /** For tools that are on or selected, shown with `aria-pressed`. */
  readonly pressed?: boolean | undefined;
}

/**
 * A labelled group of tools.
 *
 * @public
 */
export interface ToolListGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly ToolListItem[];
}

/**
 * The parts of a tool list that `classNames` can target.
 *
 * @public
 */
export type ToolListPart = "root" | "group" | "groupLabel" | "item" | "description" | "shortcut";

/**
 * Props of {@link ToolList}.
 *
 * @public
 */
export interface ToolListProps
  extends Omit<ToolbarProps, "classNames" | "orientation" | "children" | "label">,
    StyleProps<ToolListPart> {
  /** The list's accessible name, such as "Image tools". */
  readonly label: string;
  readonly groups: readonly ToolListGroup[];
  /** Called with a tool's id when it's chosen. */
  readonly onRun: (id: string) => void;
  /**
   * `full` rows with labels, or `icons` only, named by tooltips. Inside an
   * {@link EditorFrame}, follows its tools panel.
   */
  readonly display?: "full" | "icons" | undefined;
  /** Inside an {@link EditorFrame}, horizontal in its dock and vertical otherwise. */
  readonly orientation?: "horizontal" | "vertical" | undefined;
  /** Whether full rows show descriptions, as Easy mode does. Defaults to `false`. */
  readonly descriptions?: boolean | undefined;
  /** Whether full rows show shortcuts, as Expert mode does. Defaults to `false`. */
  readonly shortcuts?: boolean | undefined;
  /** Whether groups show their label above their tools. Defaults to `true` in full rows. */
  readonly groupLabels?: boolean | undefined;
}

/**
 * An editor's tools, in labelled groups, as a toolbar with one Tab stop and
 * arrow keys between the tools (sdk-core ADR 0067). Rows show an icon and a
 * label, and optionally a description and the shortcut; icons only show a
 * tooltip with the name. Disabled tools stay focusable, so keyboard and
 * screen-reader users find them too.
 *
 * Which tools to list for a mode is the SDK's choice, with sdk-core's
 * `isToolInMode`; tools it leaves out stay in the command palette.
 *
 * @public
 */
export const ToolList = /* @__PURE__ */ forwardRef(function ToolList(
  {
    label,
    groups,
    onRun,
    display,
    orientation,
    descriptions = false,
    shortcuts = false,
    groupLabels,
    className,
    classNames,
    unstyled,
    ...props
  }: ToolListProps,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const frame = useEditorFrame();
  const docked = frame?.layout === "dock";
  const shownAs = display ?? (frame?.toolsState === "icons" || docked ? "icons" : "full");
  const direction = orientation ?? (docked ? "horizontal" : "vertical");
  const showGroupLabels = groupLabels ?? (shownAs === "full" && direction === "vertical");

  return (
    <Toolbar
      {...props}
      ref={ref}
      label={label}
      orientation={direction}
      unstyled={unstyled}
      className={cx("hm-tool-list", `hm-tool-list--${shownAs}`, classNames?.root, className)}
    >
      {groups.map((group) => {
        return (
          <ToolbarGroup
            key={group.id}
            label={group.label}
            className={cx("hm-tool-list-group", classNames?.group)}
          >
            {showGroupLabels ? (
              <span
                aria-hidden="true"
                className={cx("hm-tool-list-group-label", classNames?.groupLabel)}
              >
                {group.label}
              </span>
            ) : null}
            {group.items.map((item) => {
              if (shownAs === "icons") {
                return (
                  <Tooltip
                    key={item.id}
                    type="label"
                    content={item.label}
                    placement={direction === "horizontal" ? "top" : "bottom"}
                  >
                    <IconButton
                      variant="quiet"
                      label={item.label}
                      icon={item.icon}
                      pressed={item.pressed}
                      disabled={item.disabled}
                      focusableWhenDisabled
                      aria-keyshortcuts={item.ariaKeyShortcuts}
                      unstyled={unstyled}
                      className={cx("hm-tool-list-item", classNames?.item)}
                      onClick={() => onRun(item.id)}
                    />
                  </Tooltip>
                );
              }
              const hasDescription = descriptions && item.description != null;
              return (
                <Button
                  key={item.id}
                  variant="quiet"
                  startIcon={item.icon}
                  pressed={item.pressed}
                  disabled={item.disabled}
                  focusableWhenDisabled
                  aria-keyshortcuts={item.ariaKeyShortcuts}
                  unstyled={unstyled}
                  className={cx(
                    "hm-tool-list-item",
                    hasDescription && "hm-tool-list-item--described",
                    classNames?.item,
                  )}
                  onClick={() => onRun(item.id)}
                >
                  {/* The name is the label then the description, as they're shown. */}
                  <span className="hm-tool-list-text">
                    <span className="hm-tool-list-label">{item.label}</span>
                    {hasDescription ? " " : null}
                    {hasDescription ? (
                      <span className={cx("hm-tool-list-description", classNames?.description)}>
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                  {shortcuts && item.shortcut ? (
                    <span
                      aria-hidden="true"
                      className={cx("hm-tool-list-shortcut", classNames?.shortcut)}
                    >
                      <kbd>{item.shortcut}</kbd>
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </ToolbarGroup>
        );
      })}
    </Toolbar>
  );
});
