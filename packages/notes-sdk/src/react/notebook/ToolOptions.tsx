import { ColorPicker, type ColorSwatch, SegmentedControl, Slider } from "@hussmartinez/ui/react";
import { type KeyboardEvent, type ReactNode, useId } from "react";
import type { NotesColor } from "../../core/model/items.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type {
  NotesEraserMode,
  NotesInkSettings,
  NotesPointerTool,
} from "../../features/tool-types.js";
import { useNotes } from "../context.js";

/** The pen's and the text's colours. Their names are in the catalogue. */
export const PEN_COLORS = [
  ["black", "#1f2937"],
  ["blue", "#1d4ed8"],
  ["red", "#dc2626"],
  ["green", "#15803d"],
  ["amber", "#d97706"],
  ["purple", "#7c3aed"],
] as const;

/** The highlighter's colours. */
export const HIGHLIGHTER_COLORS = [
  ["yellow", "#fde047"],
  ["green", "#86efac"],
  ["pink", "#f9a8d4"],
  ["blue", "#93c5fd"],
  ["orange", "#fdba74"],
] as const;

type SizeKey = "penSize" | "highlighterSize" | "eraserSize" | "textSize";
type ColorKey = "penColor" | "highlighterColor" | "textColor";

/** Each tool's range of sizes, in points, and the three it offers at a tap, in page units. */
const SIZES = {
  penSize: { range: [0.5, 8, 0.5], presets: [100, 220, 400] },
  highlighterSize: { range: [6, 30, 1], presets: [800, 1400, 2400] },
  eraserSize: { range: [4, 48, 1], presets: [600, 1200, 2400] },
  textSize: { range: [8, 48, 1], presets: [1100, 1400, 2000] },
} as const;

const SIZE_NAMES = ["small", "medium", "large"] as const;

const SIZE_KEYS: Partial<Record<NotesPointerTool, SizeKey>> = {
  pen: "penSize",
  highlighter: "highlighterSize",
  eraser: "eraserSize",
  text: "textSize",
};

const COLOR_KEYS: Partial<Record<NotesPointerTool, ColorKey>> = {
  pen: "penColor",
  highlighter: "highlighterColor",
  text: "textColor",
};

/** Whether the tool in hand has options to show (docs/adr/0008). */
export const hasToolOptions = (tool: NotesPointerTool): boolean => SIZE_KEYS[tool] !== undefined;

export interface ToolOptionsProps {
  readonly settings: NotesInkSettings;
  readonly onChange: (patch: Partial<NotesInkSettings>) => void;
}

/** Arrow keys move between the radios of a group and choose as they go, as radios do. */
function onRadioKeys(event: KeyboardEvent<HTMLDivElement>): void {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (step === 0) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  const at = radios.indexOf(event.target as HTMLElement);
  if (at === -1) return;
  event.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next?.focus();
  next?.click();
}

/**
 * The options of the tool in hand, in the frame's properties panel
 * (docs/adr/0008): three widths at a tap and any width on a slider, and the
 * tool's palette, with any colour, through ui's `ColorPicker`. A tool
 * without options says so.
 */
export function ToolOptions({ settings, onChange }: ToolOptionsProps): ReactNode {
  const { messages } = useNotes();
  const t = messages.t as (key: string, params?: Record<string, unknown>) => string;
  const points = (value: number) => t("options.points", { size: value });
  const sizeLabelId = useId();
  const { tool } = settings;
  const sizeKey = SIZE_KEYS[tool];
  const colorKey = COLOR_KEYS[tool];

  if (!sizeKey) {
    return (
      <p className="hm-notes-options-none">{t("properties.none", { tool: t(`tools.${tool}`) })}</p>
    );
  }

  const colors: readonly (readonly [string, string])[] =
    tool === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const sizeLabel = messages.t(tool === "text" ? "options.textSize" : "options.width");
  const { range, presets } = SIZES[sizeKey];
  const swatches: ColorSwatch[] = colors.map(([name, value]) => ({
    label: t(`options.colors.${name}`),
    value,
  }));

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls, not a form's fieldset
    <div
      className="hm-notes-options"
      role="group"
      aria-label={messages.t("options.label")}
      data-hm-tool={tool}
    >
      {tool === "eraser" ? (
        <SegmentedControl<NotesEraserMode>
          label={messages.t("options.eraser.mode")}
          size="small"
          value={settings.eraserMode}
          onValueChange={(eraserMode) => onChange({ eraserMode })}
          options={[
            { value: "precise", label: messages.t("options.eraser.precise") },
            { value: "stroke", label: messages.t("options.eraser.stroke") },
          ]}
        />
      ) : null}
      <div className="hm-notes-option">
        <span className="hm-notes-option-label" id={sizeLabelId}>
          {sizeLabel}
        </span>
        <div
          className="hm-notes-sizes"
          role="radiogroup"
          aria-labelledby={sizeLabelId}
          onKeyDown={onRadioKeys}
        >
          {presets.map((preset, index) => {
            const checked = settings[sizeKey] === preset;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a radio drawn as a button, in a radiogroup
              <button
                key={preset}
                type="button"
                role="radio"
                className="hm-notes-size"
                aria-checked={checked}
                aria-label={`${t(`options.sizes.${SIZE_NAMES[index] ?? "medium"}`)}, ${points(preset / NOTES_UNITS_PER_POINT)}`}
                tabIndex={
                  checked || (index === 0 && !presets.includes(settings[sizeKey] as never)) ? 0 : -1
                }
                data-hm-size={SIZE_NAMES[index]}
                onClick={() => onChange({ [sizeKey]: preset })}
              >
                <span className="hm-notes-size-mark" aria-hidden="true" />
              </button>
            );
          })}
        </div>
        <Slider
          label={sizeLabel}
          min={range[0]}
          max={range[1]}
          step={range[2]}
          value={settings[sizeKey] / NOTES_UNITS_PER_POINT}
          formatValue={points}
          onValueChange={(value) =>
            onChange({ [sizeKey]: Math.round(value * NOTES_UNITS_PER_POINT) })
          }
        />
      </div>
      {colorKey ? (
        <div className="hm-notes-option">
          {/* The picker is named by its own label: this one is what's seen. */}
          <span className="hm-notes-option-label" aria-hidden="true">
            {messages.t("options.color")}
          </span>
          <ColorPicker
            className="hm-notes-options-color"
            variant="palette"
            label={messages.t("options.color")}
            swatches={swatches}
            value={settings[colorKey]}
            onValueChange={(value) => onChange({ [colorKey]: value.toLowerCase() as NotesColor })}
          />
        </div>
      ) : null}
    </div>
  );
}
