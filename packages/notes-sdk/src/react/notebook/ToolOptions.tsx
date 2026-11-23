import { ColorField, type ColorSwatch, SegmentedControl, Slider } from "@hussmartinez/ui/react";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
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
  const at = radios.indexOf(document.activeElement as HTMLElement);
  if (at === -1) return;
  event.preventDefault();
  const next = radios[(at + step + radios.length) % radios.length];
  next?.focus();
  next?.click();
}

/**
 * The options of the tool in hand, in a pill floating over the page: three
 * widths and the palette at a tap, and behind "More options" any colour and
 * width. Tools without options show nothing. Give it the tool as its key:
 * each tool's options arrive afresh, with the panel closed.
 */
export function ToolOptions({ settings, onChange }: ToolOptionsProps): ReactNode {
  const { messages, icons } = useNotes();
  const t = messages.t as (key: string, params?: Record<string, unknown>) => string;
  const points = (value: number) => t("options.points", { size: value });
  const [more, setMore] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useId();
  const { tool } = settings;

  // A press anywhere else, or Escape, closes the panel.
  useEffect(() => {
    if (!more) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMore(false);
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMore(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onEscape);
    };
  }, [more]);

  const sizeKey: SizeKey | undefined =
    tool === "pen"
      ? "penSize"
      : tool === "highlighter"
        ? "highlighterSize"
        : tool === "eraser"
          ? "eraserSize"
          : tool === "text"
            ? "textSize"
            : undefined;
  const colorKey: ColorKey | undefined =
    tool === "pen"
      ? "penColor"
      : tool === "highlighter"
        ? "highlighterColor"
        : tool === "text"
          ? "textColor"
          : undefined;
  if (!sizeKey) return null;

  const colors: readonly (readonly [string, string])[] =
    tool === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  const sizeLabel = messages.t(tool === "text" ? "options.textSize" : "options.width");
  const { range, presets } = SIZES[sizeKey];
  const swatches: ColorSwatch[] = colors.map(([name, value]) => ({
    label: t(`options.colors.${name}`),
    value,
  }));
  const Chevron = icons["chevron-down"];
  const color = colorKey ? settings[colorKey] : undefined;
  // A colour from outside the palette gets a swatch of its own, so what's in hand always shows.
  const custom = color !== undefined && !colors.some(([, value]) => value === color);

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of controls, not a form's fieldset
    <div
      ref={root}
      className="hm-notes-options"
      role="group"
      aria-label={messages.t("options.label")}
      data-hm-tool={tool}
      data-hm-notes-control=""
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
      <div
        className="hm-notes-sizes"
        role="radiogroup"
        aria-label={sizeLabel}
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
      {colorKey ? (
        <>
          <span className="hm-notes-options-rule" aria-hidden="true" />
          <div
            className="hm-notes-swatches"
            role="radiogroup"
            aria-label={messages.t("options.color")}
            onKeyDown={onRadioKeys}
          >
            {colors.map(([name, value], index) => {
              const checked = value === color;
              return (
                // biome-ignore lint/a11y/useSemanticElements: a radio drawn as a button, in a radiogroup
                <button
                  key={value}
                  type="button"
                  role="radio"
                  className="hm-notes-swatch"
                  aria-checked={checked}
                  aria-label={t(`options.colors.${name}`)}
                  tabIndex={checked || (custom && index === 0) ? 0 : -1}
                  onClick={() => onChange({ [colorKey]: value as NotesColor })}
                >
                  <span
                    className="hm-notes-swatch-dot"
                    style={{ backgroundColor: value }}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
            {custom ? (
              <span className="hm-notes-swatch" data-hm-custom="" aria-hidden="true">
                <span className="hm-notes-swatch-dot" style={{ backgroundColor: color }} />
              </span>
            ) : null}
          </div>
        </>
      ) : null}
      <button
        type="button"
        className="hm-notes-options-more"
        aria-label={messages.t("options.more")}
        aria-expanded={more}
        aria-controls={panel}
        onClick={() => setMore(!more)}
      >
        {Chevron ? <Chevron /> : null}
      </button>
      {more ? (
        // biome-ignore lint/a11y/useSemanticElements: a group of controls, not a form's fieldset
        <div
          id={panel}
          className="hm-notes-popover"
          role="group"
          aria-label={messages.t("options.custom")}
        >
          {colorKey ? (
            <ColorField
              label={messages.t("options.color")}
              swatches={swatches}
              value={settings[colorKey]}
              onValueChange={(value) => onChange({ [colorKey]: value.toLowerCase() as NotesColor })}
            />
          ) : null}
          <span className="hm-notes-option">
            <span className="hm-notes-option-label" aria-hidden="true">
              {sizeLabel}
            </span>
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
            <span className="hm-notes-option-value" aria-hidden="true">
              {points(settings[sizeKey] / NOTES_UNITS_PER_POINT)}
            </span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
