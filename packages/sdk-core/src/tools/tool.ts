import { familyShortcuts } from "../shortcuts/family.js";
import type { ShortcutSpec } from "../shortcuts/registry.js";

/**
 * How much experience a tool asks for (ADR 0067). An editor in a given
 * {@link EditorMode} lists the tools at or below its level in its tools
 * panel; every tool stays reachable from the command palette and its
 * shortcut in every mode.
 *
 * @public
 */
export type ToolLevel = "easy" | "advanced" | "expert";

/**
 * How much of an editor is shown (ADR 0067): Easy lists `easy` tools,
 * Advanced adds `advanced` ones, and Expert lists them all.
 *
 * @public
 */
export type EditorMode = ToolLevel;

/**
 * A tool's definition: one feature of an editor, such as rotating pages or
 * splitting a clip (ADR 0009, ADR 0030). Headless: `sdk-core` never reads
 * `view`, which is the SDK's own UI contribution.
 *
 * @typeParam State - The session state that availability is computed from.
 * @typeParam Context - What `run` receives, such as the session.
 * @typeParam View - The SDK's UI contribution, such as a React component.
 * @public
 */
export interface ToolDefinition<State = unknown, Context = unknown, View = unknown> {
  /** `<sdk>.<tool>`, lowercase, such as `pdf.rotate-left`. Unique in a registry. */
  readonly id: string;
  /** The message key of its label (ADR 0014), never text. */
  readonly label: string;
  /** The name of an icon from `@hussmartinez/ui`'s icon set. */
  readonly icon: string;
  /** The toolbar group it belongs to by default, such as `history`. */
  readonly group: string;
  /**
   * The message key of a one-line description, shown under the label in
   * Easy mode and searched by the command palette (ADR 0067).
   */
  readonly description?: string;
  /**
   * The least experienced mode that lists it in the tools panel. Defaults to
   * `advanced`. It never removes the tool: its shortcut and the command
   * palette reach it in every mode (ADR 0067).
   */
  readonly level?: ToolLevel;
  /** Capabilities it needs, such as `encryption`. Without one, it's left out. */
  readonly requires?: readonly string[];
  /** Whether to show it now. Shown when omitted. */
  readonly isAvailable?: (state: State) => boolean;
  /** Whether it can run now; shown disabled otherwise. Enabled when omitted. */
  readonly isEnabled?: (state: State) => boolean;
  /** For toggles: whether it's on, shown with `aria-pressed`. */
  readonly isActive?: (state: State) => boolean;
  /** Does what the tool does. */
  readonly run: (context: Context) => void | Promise<void>;
  /**
   * The name of a family action, such as `"undo"`, to take the family's keys,
   * or its own chords, such as `["Mod+Shift+L"]` or
   * `[{ keys: "Mod+S", inEditable: true }]`. Parsed by the shortcut registry.
   */
  readonly shortcuts?: ShortcutSpec;
  /** The SDK's UI contribution, which only its own UI layer reads. */
  readonly view?: View;
}

/**
 * A tool, checked and frozen by {@link defineTool}.
 *
 * @public
 */
export type Tool<State = unknown, Context = unknown, View = unknown> = Readonly<
  ToolDefinition<State, Context, View>
>;

const ID = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const GROUP = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const KEYS = new Set([
  "id",
  "label",
  "icon",
  "group",
  "description",
  "level",
  "requires",
  "isAvailable",
  "isEnabled",
  "isActive",
  "run",
  "shortcuts",
  "view",
]);

const LEVELS: readonly unknown[] = ["easy", "advanced", "expert"];

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * Checks a tool's definition and returns it frozen.
 *
 * @example
 * ```ts
 * export const rotateLeft = defineTool({
 *   id: "pdf.rotate-left",
 *   label: "tools.rotate-left",
 *   icon: "rotate-left",
 *   group: "pages",
 *   isEnabled: (state: PdfSessionSnapshot) => state.selection.length > 0,
 *   run: ({ session }: PdfToolContext) => session.rotateSelection(-90),
 *   shortcuts: ["Mod+Shift+L"],
 * });
 * ```
 *
 * @param definition - The tool.
 * @returns A frozen copy of the definition.
 * @throws `TypeError` if the definition is malformed, such as an `id` that
 *   isn't `<sdk>.<tool>`, a missing `run`, or an unknown key.
 * @public
 */
export function defineTool<State = unknown, Context = unknown, View = unknown>(
  definition: ToolDefinition<State, Context, View>,
): Tool<State, Context, View> {
  const where = isText(definition?.id) ? `Tool "${definition.id}"` : "A tool";
  const fail = (problem: string): never => {
    throw new TypeError(`${where} ${problem}.`);
  };
  if (definition === null || typeof definition !== "object") {
    fail("must be an object");
  }
  const unknown = Object.keys(definition).filter((key) => !KEYS.has(key));
  if (unknown.length > 0) {
    fail(`has unknown keys: ${unknown.join(", ")}`);
  }
  if (!isText(definition.id) || !ID.test(definition.id)) {
    fail(`needs an id like "pdf.rotate-left": "<sdk>.<tool>", in lowercase`);
  }
  for (const key of ["label", "icon"] as const) {
    if (!isText(definition[key])) {
      fail(`needs a ${key}`);
    }
  }
  if (!isText(definition.group) || !GROUP.test(definition.group)) {
    fail('needs a group in lowercase, such as "pages"');
  }
  if (definition.description !== undefined && !isText(definition.description)) {
    fail("must give its description as a message key");
  }
  if (definition.level !== undefined && !LEVELS.includes(definition.level)) {
    fail('must have a level of "easy", "advanced" or "expert"');
  }
  if (
    definition.requires !== undefined &&
    !(Array.isArray(definition.requires) && definition.requires.every(isText))
  ) {
    fail("must list its requires as capability names");
  }
  for (const key of ["isAvailable", "isEnabled", "isActive"] as const) {
    if (definition[key] !== undefined && typeof definition[key] !== "function") {
      fail(`must have a function for ${key}`);
    }
  }
  if (typeof definition.run !== "function") {
    fail("needs a run function");
  }
  const { shortcuts } = definition;
  const isChord = (chord: unknown) =>
    isText(chord) ||
    (chord !== null &&
      typeof chord === "object" &&
      isText((chord as { keys?: unknown }).keys) &&
      Object.keys(chord).every((key) => ["keys", "inEditable", "repeat"].includes(key)));
  if (
    shortcuts !== undefined &&
    !(typeof shortcuts === "string" && Object.hasOwn(familyShortcuts, shortcuts)) &&
    !(Array.isArray(shortcuts) && shortcuts.length > 0 && shortcuts.every(isChord))
  ) {
    fail("must give its shortcuts as chords or a family action name");
  }
  return Object.freeze({
    ...definition,
    ...(definition.requires ? { requires: Object.freeze([...definition.requires]) } : {}),
    ...(Array.isArray(shortcuts) ? { shortcuts: Object.freeze([...shortcuts]) } : {}),
  });
}

const RANK: Readonly<Record<ToolLevel, number>> = { easy: 0, advanced: 1, expert: 2 };

/**
 * Whether an editor in `mode` lists the tool in its tools panel (ADR 0067).
 * A tool without a level counts as `advanced`. This only decides what's
 * listed: keep every tool in the registry, its shortcuts and the command
 * palette whatever this returns.
 *
 * @example
 * ```ts
 * const listed = registry.tools.filter((tool) => isToolInMode(tool, mode));
 * ```
 *
 * @param tool - The tool, or anything with its optional `level`.
 * @param mode - The editor's mode.
 * @returns `true` when the tool's level is at or below the mode's.
 * @public
 */
export function isToolInMode(
  tool: { readonly level?: ToolLevel | undefined },
  mode: EditorMode,
): boolean {
  return RANK[tool.level ?? "advanced"] <= RANK[mode];
}
