import {
  type EditorMode,
  isToolInMode,
  type ShortcutRegistry,
  type ToolRegistry,
} from "@hussmartinez/sdk-core";
import type { CommandPaletteItem, IconComponent, ToolListGroup } from "@hussmartinez/ui/react";
import type { NotesTool, NotesToolState } from "../../features/tool-types.js";
import { BAR_TOOLS } from "../../features/tools.js";

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** A chord's parts as text, such as "Ctrl+Shift+Z", from the messages' key names. */
export function shortcutText(
  shortcuts: ShortcutRegistry,
  id: string,
  t: Translate,
): string | undefined {
  const chord = shortcuts.describe(id)[0];
  if (!chord) return undefined;
  return chord
    .map((part) => ("message" in part && part.message ? t(part.message) : part.value))
    .join("+");
}

/** Each group's label, after its first tool's group (docs/adr/0008). */
const groupLabel = (group: readonly NotesTool[], t: Translate): string =>
  t(`toolbar.groups.${group[0]?.group ?? "other"}`);

interface Lists {
  /** The tools panel's groups for a mode: the panel's tools at or below it, available now. */
  readonly groups: readonly ToolListGroup[];
  /** Every available tool, the bar's too, for the command palette: modes never hide them there. */
  readonly palette: readonly CommandPaletteItem[];
}

/**
 * The tools panel and the command palette, from the registry (sdk-core ADR
 * 0067): a tool's level only decides whether the panel lists it.
 */
export function toolLists(
  registry: ToolRegistry<NotesTool>,
  shortcuts: ShortcutRegistry,
  state: NotesToolState,
  mode: EditorMode,
  icons: Readonly<Record<string, IconComponent>>,
  t: Translate,
): Lists {
  const available = (tool: NotesTool) => tool.isAvailable?.(state) ?? true;
  const enabled = (tool: NotesTool) => tool.isEnabled?.(state) ?? true;
  const icon = (tool: NotesTool) => {
    const Icon = icons[tool.icon];
    return Icon ? <Icon /> : null;
  };
  const groups: ToolListGroup[] = [];
  const palette: CommandPaletteItem[] = [];
  for (const group of registry.toolbar) {
    const label = groupLabel(group, t);
    const panel = group.filter(
      (tool) => !BAR_TOOLS.has(tool.id) && available(tool) && isToolInMode(tool, mode),
    );
    if (panel.length > 0) {
      groups.push({
        id: group[0]?.id ?? label,
        label,
        items: panel.map((tool) => ({
          id: tool.id,
          label: t(tool.label),
          description: tool.description ? t(tool.description) : undefined,
          icon: icon(tool),
          shortcut: shortcutText(shortcuts, tool.id, t),
          ariaKeyShortcuts: shortcuts.ariaKeyShortcuts(tool.id) || undefined,
          disabled: !enabled(tool),
          pressed: tool.isActive?.(state),
        })),
      });
    }
    for (const tool of group.filter(available)) {
      palette.push({
        id: tool.id,
        label: t(tool.label),
        description: tool.description ? t(tool.description) : undefined,
        group: label,
        shortcut: shortcutText(shortcuts, tool.id, t),
        icon: icon(tool),
        disabled: !enabled(tool),
      });
    }
  }
  // Tools in no group, such as selecting everything, are still in the palette.
  const listed = new Set(palette.map((item) => item.id));
  for (const tool of registry.tools.filter((each) => !listed.has(each.id) && available(each))) {
    palette.push({
      id: tool.id,
      label: t(tool.label),
      description: tool.description ? t(tool.description) : undefined,
      group: t(`toolbar.groups.${tool.group}`),
      shortcut: shortcutText(shortcuts, tool.id, t),
      icon: icon(tool),
      disabled: !enabled(tool),
    });
  }
  return { groups, palette };
}
