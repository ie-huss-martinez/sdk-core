import { ColorField, type ColorSwatch, SegmentedControl, Slider } from "@hussmartinez/ui/react";
import type { ReactNode } from "react";
import type { NotesColor } from "../../core/model/items.js";
import { NOTES_UNITS_PER_POINT } from "../../core/model/portable.js";
import type { NotesEraserMode, NotesInkSettings } from "../../features/tool-types.js";
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

/** Each tool's range of sizes, in points. */
const SIZES = {
  pen: [0.5, 8, 0.5],
  highlighter: [6, 30, 1],
  eraser: [4, 48, 1],
  text: [8, 48, 1],
} as const;

export interface ToolOptionsProps {
  readonly settings: NotesInkSettings;
  readonly onChange: (patch: Partial<NotesInkSettings>) => void;
}

/**
 * The options of the tool in hand, under the toolbar: colour and width for
 * the pen and the highlighter, how and how wide for the eraser, colour and
 * size for text. Tools without options show nothing.
 */
export function ToolOptions({ settings, onChange }: ToolOptionsProps): ReactNode {
  const { messages } = useNotes();
  const t = messages.t as (key: string, params?: Record<string, unknown>) => string;
  const points = (value: number) => t("options.points", { size: value });

  const swatches = (colors: readonly (readonly [string, string])[]): ColorSwatch[] =>
    colors.map(([name, value]) => ({ label: t(`options.colors.${name}`), value }));

  const size = (
    key: "penSize" | "highlighterSize" | "eraserSize" | "textSize",
    range: readonly [number, number, number],
    label: string,
  ) => (
    <span className="hm-notes-option">
      <span className="hm-notes-option-label" aria-hidden="true">
        {label}
      </span>
      <Slider
        label={label}
        min={range[0]}
        max={range[1]}
        step={range[2]}
        value={settings[key] / NOTES_UNITS_PER_POINT}
        formatValue={points}
        onValueChange={(value) => onChange({ [key]: Math.round(value * NOTES_UNITS_PER_POINT) })}
      />
    </span>
  );

  const color = (
    key: "penColor" | "highlighterColor" | "textColor",
    colors: readonly (readonly [string, string])[],
  ) => (
    <ColorField
      label={messages.t("options.color")}
      swatches={swatches(colors)}
      value={settings[key]}
      onValueChange={(value) => onChange({ [key]: value.toLowerCase() as NotesColor })}
    />
  );

  let options: ReactNode = null;
  if (settings.tool === "pen") {
    options = (
      <>
        {color("penColor", PEN_COLORS)}
        {size("penSize", SIZES.pen, messages.t("options.width"))}
      </>
    );
  } else if (settings.tool === "highlighter") {
    options = (
      <>
        {color("highlighterColor", HIGHLIGHTER_COLORS)}
        {size("highlighterSize", SIZES.highlighter, messages.t("options.width"))}
      </>
    );
  } else if (settings.tool === "eraser") {
    options = (
      <>
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
        {size("eraserSize", SIZES.eraser, messages.t("options.width"))}
      </>
    );
  } else if (settings.tool === "text") {
    options = (
      <>
        {color("textColor", PEN_COLORS)}
        {size("textSize", SIZES.text, messages.t("options.textSize"))}
      </>
    );
  }
  if (!options) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls, not a form's fieldset
    <div className="hm-notes-options" role="group" aria-label={messages.t("options.label")}>
      {options}
    </div>
  );
}
