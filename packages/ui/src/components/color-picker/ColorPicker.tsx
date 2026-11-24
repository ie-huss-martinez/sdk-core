import {
  type FocusEvent,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useInsertionEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import { EyedropperIcon } from "../../icons/icons.generated.js";
import { warnInDevelopment } from "../../internal/development.js";
import { uiColorPickerText } from "../../messages/color-picker.js";
import { useLatest } from "../../react/use-latest.js";
import { contrastRatio } from "../../theme/color.js";
import { IconButton } from "../button/IconButton.js";
import type { ColorSwatch } from "../color-field/ColorField.js";
import { useFieldLabelId, useFieldProps } from "../field/field-context.js";
import { type UiMessages, useUiMessagesFrom } from "../messages/UiMessagesProvider.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";
import {
  alphaOf,
  type Hsva,
  nameOf,
  opaquePart,
  parseColor,
  rgbOf,
  toHex,
  toHsva,
} from "./color.js";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/**
 * The parts of a colour picker that `classNames` can target.
 *
 * @public
 */
export type ColorPickerPart =
  | "root"
  | "area"
  | "hue"
  | "alpha"
  | "row"
  | "preview"
  | "input"
  | "eyeDropper"
  | "contrast"
  | "recent"
  | "swatches"
  | "swatch";

/**
 * Props of {@link ColorPicker}. Other props go to the root, a group.
 *
 * @public
 */
export interface ColorPickerProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "defaultValue" | "onChange">,
    StyleProps<ColorPickerPart> {
  /** The colour: `#rrggbb`, or `#rrggbbaa` with `alpha`. With it, the picker is controlled. */
  readonly value?: string | undefined;
  /** The first colour of an uncontrolled picker. Defaults to black. */
  readonly defaultValue?: string | undefined;
  /**
   * Called with every new colour, while dragging too, always lowercase
   * `#rrggbb`, or `#rrggbbaa` with `alpha`.
   */
  readonly onValueChange?: ((value: string) => void) | undefined;
  /**
   * Called once a change is committed: the pointer let go, a key on a
   * slider, Enter or leaving the hex input, a swatch or the eyedropper. Use
   * it for recent colours and for one undo step.
   */
  readonly onValueCommit?: ((value: string) => void) | undefined;
  /** `full` (the default) has every part; `palette` only the swatches, recent colours and hex input. */
  readonly variant?: "full" | "palette" | undefined;
  /** Adds an opacity slider, and makes the value `#rrggbbaa`. */
  readonly alpha?: boolean | undefined;
  /** Colours to pick from. */
  readonly swatches?: readonly ColorSwatch[] | undefined;
  /** Colours used recently, newest first. Keep them with {@link addRecentColor}. */
  readonly recentColors?: readonly string[] | undefined;
  /** The colour the picked one will sit on, such as a text's background. Shows the contrast between them. */
  readonly contrastWith?: string | undefined;
  /** The accessible name, such as "Fill". Leave it out inside a `Field`. */
  readonly label?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Replaces the eyedropper's icon. It draws with `currentColor`. */
  readonly eyeDropperIcon?: ReactNode;
  /** Defaults to `colorPicker.saturation` from the messages. */
  readonly saturationLabel?: string | undefined;
  /** Defaults to `colorPicker.brightness` from the messages. */
  readonly brightnessLabel?: string | undefined;
  /** Defaults to `colorPicker.hue` from the messages. */
  readonly hueLabel?: string | undefined;
  /** Defaults to `colorPicker.alpha` from the messages. */
  readonly alphaLabel?: string | undefined;
  /** Defaults to `colorPicker.hex` from the messages. */
  readonly hexLabel?: string | undefined;
  /** Defaults to `colorPicker.eyeDropper` from the messages. */
  readonly eyeDropperLabel?: string | undefined;
  /** The word after the label in the swatch group's name. Defaults to `colorPicker.swatches`. */
  readonly swatchesLabel?: string | undefined;
  /** The words after the label in the recent colours' group name. Defaults to `colorPicker.recent`. */
  readonly recentLabel?: string | undefined;
}

/** The browser's eyedropper, where there is one (Chromium). */
interface EyeDropperLike {
  open(): Promise<{ readonly sRGBHex: string }>;
}
type EyeDropperConstructor = new () => EyeDropperLike;

/** A spoken colour name, from the messages. */
function colorName(messages: UiMessages, color: string): string {
  const name = nameOf(color);
  switch (name.kind) {
    case "white":
      return messages.t("colorPicker.name.white");
    case "black":
      return messages.t("colorPicker.name.black");
    case "grey":
      return messages.t("colorPicker.name.grey");
    case "light-grey":
      return messages.t("colorPicker.name.lightGrey");
    case "dark-grey":
      return messages.t("colorPicker.name.darkGrey");
    default: {
      const hue = messages.t(`colorPicker.hue.${name.hue}`);
      return name.tone === "plain" ? hue : messages.t(`colorPicker.name.${name.tone}`, { hue });
    }
  }
}

/** A checkerboard under translucent colours, drawn in the theme's colours. */
function Checker({ id }: { id: string }): ReactElement {
  return (
    <pattern id={id} width="8" height="8" patternUnits="userSpaceOnUse">
      <rect width="8" height="8" className="hm-color-picker-checker" />
      <rect width="4" height="4" className="hm-color-picker-checker-alt" />
      <rect x="4" y="4" width="4" height="4" className="hm-color-picker-checker-alt" />
    </pattern>
  );
}

/** A square of one colour, over a checkerboard when it's translucent. */
function Fill({
  color,
  id,
  className,
}: {
  color: string;
  id: string;
  className: string | undefined;
}): ReactElement {
  const translucent = alphaOf(color) < 1;
  return (
    <svg className={className} aria-hidden="true" focusable="false">
      {translucent ? (
        <>
          <defs>
            <Checker id={id} />
          </defs>
          <rect width="100%" height="100%" fill={`url(#${id})`} />
        </>
      ) : null}
      <rect
        width="100%"
        height="100%"
        fill={opaquePart(color)}
        fillOpacity={translucent ? alphaOf(color) : undefined}
      />
    </svg>
  );
}

interface SwatchOption {
  readonly value: string;
  readonly label: string;
}

/** Swatches as a radio group with one Tab stop, as in ColorField. */
function SwatchGroup({
  options,
  value,
  labelledBy,
  disabled,
  idBase,
  className,
  swatchClassName,
  onPick,
}: {
  options: readonly SwatchOption[];
  value: string;
  labelledBy: string;
  disabled: boolean | undefined;
  idBase: string;
  className: string | undefined;
  swatchClassName: string | undefined;
  onPick: (value: string) => void;
}): ReactElement {
  const tabStop = options.find((option) => option.value === value) ?? options[0];
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const horizontal = event.key === "ArrowRight" || event.key === "ArrowLeft";
    const direction = rtl && horizontal ? -step : step;
    const focused = options.findIndex(
      (option) => option.value === (event.target as HTMLElement).dataset["hmValue"],
    );
    const next = options[(Math.max(0, focused) + direction + options.length) % options.length];
    if (next) {
      onPick(next.value);
      event.currentTarget
        .querySelector<HTMLElement>(`[data-hm-value="${CSS.escape(next.value)}"]`)
        ?.focus();
    }
  };
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-disabled={disabled ? true : undefined}
      className={className}
      onKeyDown={handleKeyDown}
    >
      {options.map((option, index) => (
        // biome-ignore lint/a11y/useSemanticElements: a native radio can't show its colour without an inline style; buttons with role="radio" are the APG pattern, as in ColorField.
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          disabled={disabled}
          tabIndex={option === tabStop ? 0 : -1}
          data-hm-value={option.value}
          className={cx("hm-color-picker-swatch", swatchClassName)}
          onClick={() => onPick(option.value)}
        >
          <Fill
            color={option.value}
            id={`${idBase}-${index}`}
            className="hm-color-picker-swatch-fill"
          />
        </button>
      ))}
    </div>
  );
}

/**
 * The hue strip's gradient: a stop every 60°. Offsets are literal strings,
 * because bundlers keep a module-scope array holding arithmetic in every
 * application that imports any of ui's components.
 */
const HUE_STOPS: readonly (readonly [string, string])[] = [
  ["0%", "#ff0000"],
  ["16.6667%", "#ffff00"],
  ["33.3333%", "#00ff00"],
  ["50%", "#00ffff"],
  ["66.6667%", "#0000ff"],
  ["83.3333%", "#ff00ff"],
  ["100%", "#ff0000"],
];

/** The eyedropper doesn't come or go while the page is open. */
const subscribeNever = (): (() => void) => () => undefined;
const hasEyeDropper = (): boolean =>
  typeof (globalThis as { EyeDropper?: unknown }).EyeDropper === "function";
const onServer = (): boolean => false;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * A colour picker (docs/adr/0013): a saturation and brightness area, a hue
 * slider, an optional opacity slider, a hex input, the browser's eyedropper
 * where there is one, and recent colours and swatches. Drawn in SVG, so it
 * renders complete on the server under a strict Content Security Policy,
 * and it never opens the browser's own picker.
 *
 * - **Every axis is a native range input** with its own name, and a value
 *   spoken with the colour's name, such as "40 %, dark blue". The area's
 *   two are visually hidden; the thumb shows which one has focus.
 * - **The hex input** commits on Enter or blur, as `ColorField`'s does.
 * - **Swatches and recent colours** are radio groups with one Tab stop.
 * - **Recent colours are the host's:** add committed colours to them with
 *   {@link addRecentColor} in `onValueCommit`.
 *
 * @example
 * ```tsx
 * <Field label={t("shape.fill")}>
 *   <ColorPicker
 *     value={fill}
 *     onValueChange={setFill}
 *     onValueCommit={(color) => setRecent((list) => addRecentColor(list, color))}
 *     recentColors={recent}
 *     swatches={swatches}
 *   />
 * </Field>
 * ```
 *
 * @public
 */
export const ColorPicker = /* @__PURE__ */ forwardRef<HTMLDivElement, ColorPickerProps>(
  function ColorPicker(
    {
      value: controlled,
      defaultValue,
      onValueChange,
      onValueCommit,
      variant = "full",
      alpha = false,
      swatches,
      recentColors,
      contrastWith,
      label,
      disabled,
      eyeDropperIcon,
      saturationLabel,
      brightnessLabel,
      hueLabel,
      alphaLabel,
      hexLabel,
      eyeDropperLabel,
      swatchesLabel,
      recentLabel,
      className,
      classNames,
      unstyled,
      ...props
    },
    ref,
  ) {
    const messages = useUiMessagesFrom(uiColorPickerText);
    const full = variant === "full";
    const [uncontrolled, setUncontrolled] = useState(
      () => parseColor(defaultValue ?? "", alpha) ?? parseColor("#000000", alpha),
    );
    const value =
      (controlled === undefined ? undefined : parseColor(controlled, alpha)) ??
      (uncontrolled as string);
    // Hue, saturation and brightness as last set, so the hue survives grey
    // and black. They're what's shown while they still give the value.
    const [kept, setKept] = useState<Hsva>(() => toHsva(value));
    const hsva = toHex(kept, alpha) === value ? kept : toHsva(value, kept);
    // The colour last reported, for commits that come before a render.
    const latest = useRef(value);
    useInsertionEffect(() => {
      latest.current = value;
    });
    const [draft, setDraft] = useState<string | null>(null);
    // Detected on the client only: the server and hydration render without it.
    const canPick = useSyncExternalStore(subscribeNever, hasEyeDropper, onServer);
    const saturationInput = useRef<HTMLInputElement>(null);
    // The pointer dragging in the area, if any.
    const dragging = useRef<number | undefined>(undefined);
    const sliders = useRef<HTMLDivElement>(null);

    const generated = useId();
    const idBase = `hm${generated.replace(/[^A-Za-z0-9_-]/g, "")}`;
    const ownLabelId = `${idBase}-label`;
    const hexLabelId = `${idBase}-hex`;
    const swatchesLabelId = `${idBase}-swatches`;
    const recentLabelId = `${idBase}-recent`;
    const fieldLabelId = useFieldLabelId();
    const fieldProps = useFieldProps({ id: undefined }, label);
    const groupLabelId =
      fieldLabelId ?? (label === undefined ? props["aria-labelledby"] : ownLabelId);
    if (groupLabelId === undefined && !props["aria-label"]) {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        warnInDevelopment(
          "ColorPicker needs an accessible name: pass label, or put it in a Field. Use text from your message catalogue.",
        );
      }
    }

    const set = (next: Hsva): void => {
      const color = toHex(next, alpha);
      setKept(next);
      if (color === latest.current) {
        return;
      }
      latest.current = color;
      if (controlled === undefined) {
        setUncontrolled(color);
      }
      onValueChange?.(color);
    };
    const commit = (): void => {
      onValueCommit?.(latest.current);
    };
    const pick = (color: string): void => {
      set(toHsva(color, hsva));
      commit();
    };
    const commitLatest = useLatest(commit);

    // A range input fires change when a change is committed: a key, or the
    // pointer let go. React's onChange is the input event instead.
    useEffect(() => {
      const element = sliders.current;
      if (!element) {
        return;
      }
      const handle = (event: Event): void => {
        if ((event.target as HTMLInputElement).type === "range") {
          commitLatest.current();
        }
      };
      element.addEventListener("change", handle);
      return () => element.removeEventListener("change", handle);
    }, [commitLatest, full]);

    const name = colorName(messages, value);
    const percent = (amount: number): string =>
      messages.t("colorPicker.percent", { value: amount, name });

    const fromPoint = (event: PointerEvent<HTMLDivElement>): void => {
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) {
        return;
      }
      set({
        ...hsva,
        s: clamp((event.clientX - box.left) / box.width),
        v: 1 - clamp((event.clientY - box.top) / box.height),
      });
    };
    const handleAreaPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
      if (disabled || event.button !== 0) {
        return;
      }
      event.preventDefault();
      dragging.current = event.pointerId;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer is up already; its events still arrive here.
      }
      saturationInput.current?.focus({ preventScroll: true });
      fromPoint(event);
    };
    const handleAreaPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
      if (dragging.current === event.pointerId) {
        fromPoint(event);
      }
    };
    const handleAreaPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
      if (dragging.current === event.pointerId) {
        dragging.current = undefined;
        commit();
      }
    };

    const setAxis = (axis: "s" | "v" | "h" | "a", amount: number): void => {
      set({ ...hsva, [axis]: amount });
    };

    const commitDraft = (): void => {
      if (draft === null) {
        return;
      }
      setDraft(null);
      const parsed = parseColor(draft, alpha);
      if (parsed !== undefined) {
        pick(parsed);
      }
    };
    const handleHexKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.nativeEvent.isComposing) {
        return;
      }
      if (event.key === "Enter") {
        flushSync(commitDraft);
      } else if (event.key === "Escape" && draft !== null) {
        event.preventDefault();
        setDraft(null);
      }
    };
    const handleHexBlur = (_event: FocusEvent<HTMLInputElement>): void => {
      commitDraft();
    };

    const handleEyeDropper = async (): Promise<void> => {
      const EyeDropper = (window as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
      if (!EyeDropper) {
        return;
      }
      try {
        const { sRGBHex } = await new EyeDropper().open();
        const picked = parseColor(sRGBHex);
        if (picked !== undefined) {
          pick(alpha ? toHex({ ...toHsva(picked, hsva), a: hsva.a }, true) : picked);
        }
      } catch {
        // Cancelled with Escape, or refused: nothing changes.
      }
    };

    const swatchOptions: SwatchOption[] = [];
    for (const swatch of swatches ?? []) {
      const color = parseColor(swatch.value, alpha);
      if (color !== undefined && !swatchOptions.some((option) => option.value === color)) {
        swatchOptions.push({ value: color, label: swatch.label });
      }
    }
    const recentOptions: SwatchOption[] = [];
    for (const recent of recentColors ?? []) {
      const color = parseColor(recent, alpha) ?? (alpha ? undefined : parseColor(recent, true));
      // Without alpha, a translucent recent colour is offered opaque.
      const shown = color === undefined ? undefined : alpha ? color : opaquePart(color);
      if (shown !== undefined && !recentOptions.some((option) => option.value === shown)) {
        recentOptions.push({
          value: shown,
          label: messages.t("colorPicker.recentColor", {
            name: colorName(messages, shown),
            hex: shown,
          }),
        });
      }
    }

    const background = parseColor(contrastWith ?? "");
    let contrast: ReactNode = null;
    if (background !== undefined) {
      const [r, g, b] = rgbOf(value);
      const [br, bg, bb] = rgbOf(background);
      const ratio = contrastRatio(
        { r, g, b, alpha: alphaOf(value) },
        { r: br, g: bg, b: bb, alpha: 1 },
      ) as number;
      // Rounded down, so a ratio shown as 4.5 always passes.
      const shown = Math.floor(ratio * 10) / 10;
      contrast = (
        <p className={cx("hm-color-picker-contrast", classNames?.contrast)}>
          {messages.t(ratio >= 4.5 ? "colorPicker.contrastPass" : "colorPicker.contrastFail", {
            ratio: shown,
          })}
        </p>
      );
    }

    const hueHex = toHex({ h: hsva.h, s: 1, v: 1, a: 1 });
    const opaque = opaquePart(value);
    const saturation = Math.round(hsva.s * 100);
    const brightness = Math.round(hsva.v * 100);

    return (
      // biome-ignore lint/a11y/useSemanticElements: the name comes from a Field's label outside the picker, which a fieldset's legend can't be; a group with aria-labelledby is the same semantics.
      <div
        {...props}
        ref={ref}
        role="group"
        aria-labelledby={groupLabelId}
        aria-disabled={disabled ? true : undefined}
        className={cx(
          "hm-color-picker",
          !full && "hm-color-picker--palette",
          classNames?.root,
          className,
        )}
        data-hm-unstyled={unstyledAttribute(unstyled)}
      >
        {label === undefined ? null : (
          <span id={ownLabelId} hidden>
            {label}
          </span>
        )}
        {full ? (
          <div ref={sliders} className="hm-color-picker-sliders">
            <div
              className={cx("hm-color-picker-area", classNames?.area)}
              data-hm-disabled={disabled ? "" : undefined}
              onPointerDown={handleAreaPointerDown}
              onPointerMove={handleAreaPointerMove}
              onPointerUp={handleAreaPointerUp}
              onPointerCancel={handleAreaPointerUp}
            >
              <svg className="hm-color-picker-area-svg" aria-hidden="true" focusable="false">
                <defs>
                  <linearGradient id={`${idBase}-white`} x1="0" x2="1" y1="0" y2="0">
                    <stop offset="0" stopColor="#ffffff" />
                    <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id={`${idBase}-black`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#000000" stopOpacity="0" />
                    <stop offset="1" stopColor="#000000" />
                  </linearGradient>
                </defs>
                <rect width="100%" height="100%" fill={hueHex} />
                <rect width="100%" height="100%" fill={`url(#${idBase}-white)`} />
                <rect width="100%" height="100%" fill={`url(#${idBase}-black)`} />
                <line
                  className="hm-color-picker-guide hm-color-picker-guide--saturation"
                  x1="0"
                  x2="100%"
                  y1={`${100 - brightness}%`}
                  y2={`${100 - brightness}%`}
                />
                <line
                  className="hm-color-picker-guide hm-color-picker-guide--brightness"
                  x1={`${saturation}%`}
                  x2={`${saturation}%`}
                  y1="0"
                  y2="100%"
                />
                <circle
                  className="hm-color-picker-thumb-outline"
                  cx={`${saturation}%`}
                  cy={`${100 - brightness}%`}
                  r="11"
                />
                <circle
                  className="hm-color-picker-thumb"
                  cx={`${saturation}%`}
                  cy={`${100 - brightness}%`}
                  r="10"
                  fill={opaque}
                />
              </svg>
              <input
                ref={saturationInput}
                type="range"
                min={0}
                max={100}
                step={1}
                value={saturation}
                disabled={disabled}
                aria-label={saturationLabel ?? messages.t("colorPicker.saturation")}
                aria-valuetext={percent(saturation)}
                className="hm-visually-hidden hm-color-picker-saturation"
                onChange={(event) => setAxis("s", Number(event.currentTarget.value) / 100)}
              />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={brightness}
                disabled={disabled}
                aria-label={brightnessLabel ?? messages.t("colorPicker.brightness")}
                aria-valuetext={percent(brightness)}
                className="hm-visually-hidden hm-color-picker-brightness"
                onChange={(event) => setAxis("v", Number(event.currentTarget.value) / 100)}
              />
            </div>
            <div className={cx("hm-color-picker-strip", "hm-color-picker-hue", classNames?.hue)}>
              <svg className="hm-color-picker-strip-svg" aria-hidden="true" focusable="false">
                <defs>
                  <linearGradient id={`${idBase}-hues`} x1="0" x2="1" y1="0" y2="0">
                    {HUE_STOPS.map(([offset, color]) => (
                      <stop key={offset} offset={offset} stopColor={color} />
                    ))}
                  </linearGradient>
                </defs>
                <rect width="100%" height="100%" fill={`url(#${idBase}-hues)`} />
              </svg>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                value={Math.round(hsva.h) % 360}
                disabled={disabled}
                aria-label={hueLabel ?? messages.t("colorPicker.hue")}
                aria-valuetext={messages.t("colorPicker.degrees", {
                  value: Math.round(hsva.h) % 360,
                  name,
                })}
                className="hm-color-picker-slider"
                onChange={(event) => setAxis("h", Number(event.currentTarget.value))}
              />
            </div>
            {alpha ? (
              <div
                className={cx("hm-color-picker-strip", "hm-color-picker-alpha", classNames?.alpha)}
              >
                <svg className="hm-color-picker-strip-svg" aria-hidden="true" focusable="false">
                  <defs>
                    <Checker id={`${idBase}-checker`} />
                    <linearGradient id={`${idBase}-alphas`} x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0" stopColor={opaque} stopOpacity="0" />
                      <stop offset="1" stopColor={opaque} />
                    </linearGradient>
                  </defs>
                  <rect width="100%" height="100%" fill={`url(#${idBase}-checker)`} />
                  <rect width="100%" height="100%" fill={`url(#${idBase}-alphas)`} />
                </svg>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(hsva.a * 100)}
                  disabled={disabled}
                  aria-label={alphaLabel ?? messages.t("colorPicker.alpha")}
                  aria-valuetext={percent(Math.round(hsva.a * 100))}
                  className="hm-color-picker-slider"
                  onChange={(event) => setAxis("a", Number(event.currentTarget.value) / 100)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        <div className={cx("hm-color-picker-row", classNames?.row)}>
          <Fill
            color={value}
            id={`${idBase}-preview`}
            className={cx("hm-color-picker-preview", classNames?.preview)}
          />
          <span id={hexLabelId} hidden>
            {hexLabel ?? messages.t("colorPicker.hex")}
          </span>
          <input
            type="text"
            id={fieldProps.id}
            aria-describedby={fieldProps["aria-describedby"]}
            aria-invalid={fieldProps["aria-invalid"]}
            aria-labelledby={[groupLabelId, hexLabelId].filter(Boolean).join(" ")}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={alpha ? 9 : 7}
            disabled={disabled}
            value={draft ?? value}
            className={cx("hm-text-field", "hm-color-picker-input", classNames?.input)}
            data-hm-unstyled={unstyledAttribute(unstyled)}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={handleHexBlur}
            onKeyDown={handleHexKeyDown}
          />
          {full && canPick ? (
            <IconButton
              variant="quiet"
              label={eyeDropperLabel ?? messages.t("colorPicker.eyeDropper")}
              icon={eyeDropperIcon ?? <EyedropperIcon />}
              disabled={disabled}
              unstyled={unstyled}
              className={cx("hm-color-picker-eye-dropper", classNames?.eyeDropper)}
              onClick={() => void handleEyeDropper()}
            />
          ) : null}
        </div>
        {contrast}
        {recentOptions.length === 0 ? null : (
          <>
            <span id={recentLabelId} hidden>
              {recentLabel ?? messages.t("colorPicker.recent")}
            </span>
            <SwatchGroup
              options={recentOptions}
              value={value}
              labelledBy={[groupLabelId, recentLabelId].filter(Boolean).join(" ")}
              disabled={disabled}
              idBase={`${idBase}-recent`}
              className={cx("hm-color-picker-swatches", classNames?.recent)}
              swatchClassName={classNames?.swatch}
              onPick={pick}
            />
          </>
        )}
        {swatchOptions.length === 0 ? null : (
          <>
            <span id={swatchesLabelId} hidden>
              {swatchesLabel ?? messages.t("colorPicker.swatches")}
            </span>
            <SwatchGroup
              options={swatchOptions}
              value={value}
              labelledBy={[groupLabelId, swatchesLabelId].filter(Boolean).join(" ")}
              disabled={disabled}
              idBase={`${idBase}-swatch`}
              className={cx("hm-color-picker-swatches", classNames?.swatches)}
              swatchClassName={classNames?.swatch}
              onPick={pick}
            />
          </>
        )}
      </div>
    );
  },
);
