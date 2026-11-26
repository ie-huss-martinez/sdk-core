import { type EditorMode, isToolInMode, type ToolRegistry } from "@hussmartinez/sdk-core";
import type { CommandPaletteItem, ToolListGroup } from "@hussmartinez/ui/react";
import { type AudioTool, BAR_TOOLS, TRANSPORT_TOOLS } from "../../features/tools/tools.js";
import { ICONS } from "../icons.js";
import type { ToolFlags } from "../tools.js";

type Translate = (key: string, values?: Record<string, unknown>) => string;

/** What {@link toolLists} needs to know of each tool, beside the registry. */
export interface ToolListsInput {
  readonly registry: ToolRegistry<AudioTool>;
  /** Each present tool's flags, from `useAudioTools`. */
  readonly flags: ReadonlyMap<string, ToolFlags>;
  readonly mode: EditorMode;
  readonly t: Translate;
  /** A tool's first shortcut as text, from `useAudioTools`. */
  readonly keysText: (id: string) => string | undefined;
  /** A tool's shortcuts, for `aria-keyshortcuts`. */
  readonly ariaKeyShortcuts: (id: string) => string | undefined;
  /** Tools listed whatever their level, such as a start card's in Easy mode. */
  readonly extra?: ReadonlySet<string>;
}

/** What {@link toolLists} gives the editor. */
export interface ToolLists {
  /** The tools panel's groups for a mode: the panel's tools at or below it. */
  readonly groups: readonly ToolListGroup[];
  /** Every present tool, the bars' and the transport's too: modes never hide them there. */
  readonly palette: readonly CommandPaletteItem[];
}

const TRANSPORT: ReadonlySet<string> = /* @__PURE__ */ new Set(TRANSPORT_TOOLS);

/** A group's label, after its first tool's group (docs/adr/0007). */
const groupLabel = (group: string | undefined, t: Translate): string =>
  t(`toolbar.${group ?? "clips"}`);

/**
 * The tools panel and the command palette, from the registry (sdk-core ADR
 * 0067): a tool's level only decides whether the panel lists it. The bars'
 * tools and playback's, which the transport holds, are never in the panel,
 * and every tool is in the palette.
 */
export function toolLists(input: ToolListsInput): ToolLists {
  const { registry, flags, mode, t, keysText, ariaKeyShortcuts, extra = new Set() } = input;
  const enabled = (tool: AudioTool) => flags.get(tool.id)?.enabled ?? true;
  const listed = (tool: AudioTool) => isToolInMode(tool, mode) || extra.has(tool.id);
  const icon = (tool: AudioTool) => {
    const Icon = ICONS[tool.icon];
    return Icon ? <Icon /> : null;
  };
  const item = (tool: AudioTool, group: string): CommandPaletteItem => ({
    id: tool.id,
    label: t(tool.label),
    description: tool.description ? t(tool.description) : undefined,
    group,
    shortcut: keysText(tool.id),
    icon: icon(tool),
    disabled: !enabled(tool),
  });
  const groups: ToolListGroup[] = [];
  const palette: CommandPaletteItem[] = [];
  for (const group of registry.toolbar) {
    const label = groupLabel(group[0]?.group, t);
    const panel = group.filter(
      (tool) => !BAR_TOOLS.has(tool.id) && !TRANSPORT.has(tool.id) && listed(tool),
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
          shortcut: keysText(tool.id),
          ariaKeyShortcuts: ariaKeyShortcuts(tool.id),
          disabled: !enabled(tool),
          pressed: tool.isActive ? (flags.get(tool.id)?.active ?? false) : undefined,
        })),
      });
    }
    for (const tool of group) palette.push(item(tool, label));
  }
  // Tools in no group, such as playback's, are still in the palette.
  const inPalette = new Set(palette.map((each) => each.id));
  for (const tool of registry.tools.filter((each) => !inPalette.has(each.id))) {
    palette.push(item(tool, groupLabel(tool.group, t)));
  }
  return { groups, palette };
}
