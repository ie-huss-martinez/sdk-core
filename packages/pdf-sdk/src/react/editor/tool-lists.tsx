import {
  type EditorMode,
  isToolInMode,
  type ShortcutRegistry,
  type ToolRegistry,
} from "@hussmartinez/sdk-core";
import type { CommandPaletteItem, IconComponent, ToolListGroup } from "@hussmartinez/ui/react";
import { THUMBNAIL_KEYS } from "../../features/pages/thumbnail-keys.js";
import type { PdfTool, PdfToolState } from "../../features/tool-types.js";
import { BAR_TOOLS } from "../../features/tools.js";

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** A chord's parts as text, such as "Ctrl+Shift+Z", from the messages' key names. */
function shortcutText(shortcuts: ShortcutRegistry, id: string, t: Translate): string | undefined {
  const chord = shortcuts.describe(id)[0];
  if (!chord) return undefined;
  return chord
    .map((part) => ("message" in part && part.message ? t(part.message) : part.value))
    .join("+");
}

/** Each group's label, after its first tool's group (docs/adr/0012). */
const groupLabel = (group: readonly PdfTool[], t: Translate): string =>
  t(`toolbar.groups.${group[0]?.group ?? "other"}`);

/** What {@link toolLists} gives the editor. */
export interface ToolLists {
  /** The tools panel's groups for a mode: the panel's tools at or below it, available now. */
  readonly groups: readonly ToolListGroup[];
  /** Every available tool, the bar's too, for the command palette: modes never hide them there. */
  readonly palette: readonly CommandPaletteItem[];
}

/**
 * The tools panel and the command palette, from the registry (sdk-core ADR
 * 0067): a tool's level only decides whether the panel lists it. `extra`
 * lists tools whatever their level, such as a start card's in Easy mode.
 *
 * Delete and move have no editor-wide shortcut: their keys work only in the
 * thumbnails (docs/adr/0008). Their rows still say so with
 * `aria-keyshortcuts`, but show no shortcut, which would work nowhere else.
 */
export function toolLists(
  registry: ToolRegistry<PdfTool>,
  shortcuts: ShortcutRegistry,
  state: PdfToolState,
  mode: EditorMode,
  icons: Readonly<Record<string, IconComponent>>,
  t: Translate,
  extra: ReadonlySet<string> = new Set(),
): ToolLists {
  const available = (tool: PdfTool) => tool.isAvailable?.(state) ?? true;
  const enabled = (tool: PdfTool) => tool.isEnabled?.(state) ?? true;
  const listed = (tool: PdfTool) => isToolInMode(tool, mode) || extra.has(tool.id);
  const icon = (tool: PdfTool) => {
    const Icon = icons[tool.icon];
    return Icon ? <Icon /> : null;
  };
  const groups: ToolListGroup[] = [];
  const palette: CommandPaletteItem[] = [];
  for (const group of registry.toolbar) {
    const label = groupLabel(group, t);
    const panel = group.filter(
      (tool) => !BAR_TOOLS.has(tool.id) && available(tool) && listed(tool),
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
          ariaKeyShortcuts: shortcuts.ariaKeyShortcuts(tool.id) ?? THUMBNAIL_KEYS[tool.id],
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
  // Tools in no group, such as those a host's `toolbar` leaves out, are still in the palette.
  const inPalette = new Set(palette.map((item) => item.id));
  for (const tool of registry.tools.filter((each) => !inPalette.has(each.id) && available(each))) {
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
