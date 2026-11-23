import type { ShortcutRegistry, ToolRegistry } from "@hussmartinez/sdk-core";
import { IconButton, ToggleButton, Toolbar, ToolbarGroup } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import type { NotesTool, NotesToolState } from "../../features/tool-types.js";
import { useNotes } from "../context.js";

/**
 * Props for {@link NotesToolbar}.
 *
 * @public
 */
export interface NotesToolbarProps {
  /** The notebook's tools, from `createToolRegistry`. */
  readonly registry: ToolRegistry<NotesTool>;
  /** The notebook's shortcuts, for each button's `aria-keyshortcuts`. */
  readonly shortcuts?: ShortcutRegistry;
  /** What the tools read to be available, enabled or active. */
  readonly state: NotesToolState;
  /** Runs a tool. */
  readonly onRun: (tool: NotesTool) => void;
  /** Extra classes on the root. */
  readonly className?: string;
}

/**
 * The toolbar across the top of an open notebook: ui's `Toolbar`, one
 * labelled group per toolbar group of the registry and one button per tool.
 * A tool that's on or off, such as the pen in hand, is a toggle button with
 * `aria-pressed`. Arrow keys move between the buttons, so it's one tab stop.
 *
 * @public
 */
export function NotesToolbar(props: NotesToolbarProps): ReactNode {
  const { registry, shortcuts, state, onRun, className } = props;
  const { messages, icons } = useNotes();
  const t = messages.t as (key: string) => string;
  if (registry.toolbar.length === 0) return null;
  return (
    <Toolbar label={messages.t("toolbar.label")} {...(className ? { className } : {})}>
      {registry.toolbar.map((group) => {
        const tools = group.filter((tool) => tool.isAvailable?.(state) ?? true);
        if (tools.length === 0) return null;
        return (
          <ToolbarGroup
            key={group.map((tool) => tool.id).join(" ")}
            data-hm-group={group[0]?.group ?? "other"}
            label={t(`toolbar.groups.${group[0]?.group ?? "other"}`)}
          >
            {tools.map((tool) => {
              const Icon = icons[tool.icon];
              const keys = shortcuts?.ariaKeyShortcuts(tool.id);
              const shared = {
                "data-hm-tool": tool.id,
                label: t(tool.label),
                icon: Icon ? <Icon /> : null,
                disabled: !(tool.isEnabled?.(state) ?? true),
                focusableWhenDisabled: true,
                ...(keys ? { "aria-keyshortcuts": keys } : {}),
              };
              return tool.isActive ? (
                <ToggleButton
                  key={tool.id}
                  {...shared}
                  variant="quiet"
                  pressed={tool.isActive(state)}
                  onPressedChange={() => onRun(tool)}
                />
              ) : (
                <IconButton key={tool.id} {...shared} variant="quiet" onClick={() => onRun(tool)} />
              );
            })}
          </ToolbarGroup>
        );
      })}
    </Toolbar>
  );
}
