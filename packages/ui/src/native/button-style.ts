import type { ColorToken } from "./create-native-theme.js";
import type { NativeThemeTokens } from "./theme.generated.js";

/**
 * How a native button looks: `primary` for the main action, `secondary`
 * (the default) for others, `quiet` for dense places, and three states a
 * choice can be in: `selected`, `success` for the right answer, and `hint`,
 * the gentle tone for a pick that wasn't it. There's no danger variant: a
 * wrong answer is never shown as an error.
 *
 * @public
 */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "selected" | "success" | "hint";

/**
 * Button sizes, as the least height of the target: `medium`, 44 dp, and
 * `large`, 64 dp, for people who need a large one. Both grow with the text
 * scale.
 *
 * @public
 */
export type ButtonSize = "medium" | "large";

/** A variant's colours, as token names; no background means transparent. */
interface VariantTokens {
  readonly background: ColorToken | undefined;
  readonly pressed: ColorToken;
  readonly foreground: ColorToken;
  readonly border: ColorToken | undefined;
}

/** Exported for the contrast test, which checks every variant in both themes. */
export const BUTTON_VARIANTS: Readonly<Record<ButtonVariant, VariantTokens>> = {
  primary: {
    background: "color-accent",
    pressed: "color-accent-active",
    foreground: "color-on-accent",
    border: undefined,
  },
  secondary: {
    background: "color-control",
    pressed: "color-control-active",
    foreground: "color-text",
    border: "color-border-strong",
  },
  quiet: {
    background: undefined,
    pressed: "color-control",
    foreground: "color-text",
    border: undefined,
  },
  selected: {
    background: "color-accent-subtle",
    pressed: "color-accent-subtle",
    foreground: "color-text",
    border: "color-accent",
  },
  success: {
    background: "color-success-subtle",
    pressed: "color-success-subtle",
    foreground: "color-success-text",
    border: "color-success",
  },
  hint: {
    background: "color-hint-subtle",
    pressed: "color-hint-subtle",
    foreground: "color-hint-text",
    border: "color-hint",
  },
};

/** What a button draws with, for one variant, size and state. */
export interface ButtonLook {
  readonly foreground: string;
  readonly container: {
    readonly minHeight: number;
    readonly paddingHorizontal: number;
    readonly paddingVertical: number;
    readonly gap: number;
    readonly borderRadius: number;
    readonly borderWidth: number;
    readonly borderColor: string;
    readonly backgroundColor: string;
    readonly opacity: number;
  };
}

/**
 * A button's colours and measures from the theme. The border always takes
 * the focus ring's width, transparent when the variant has none, so a
 * button doesn't change size when it gains focus or a state.
 */
export function buttonLook(
  tokens: NativeThemeTokens,
  options: {
    readonly variant: ButtonVariant;
    readonly size: ButtonSize;
    readonly textScale: number;
    readonly pressed: boolean;
    readonly focused: boolean;
    readonly disabled: boolean;
  },
): ButtonLook {
  const variant = BUTTON_VARIANTS[options.variant];
  const large = options.size === "large";
  const background = options.pressed && !options.disabled ? variant.pressed : variant.background;
  return {
    foreground: tokens[variant.foreground],
    container: {
      minHeight: tokens[large ? "control-height-large" : "control-height"] * options.textScale,
      paddingHorizontal: tokens[large ? "inset-loose" : "control-padding-x"],
      paddingVertical: tokens["inset-tight"],
      gap: tokens[large ? "gap-loose" : "control-gap"],
      borderRadius: tokens[large ? "radius-surface" : "radius-control"],
      borderWidth: tokens["focus-ring-width"],
      borderColor: options.focused
        ? tokens["focus-ring-color"]
        : variant.border === undefined
          ? "transparent"
          : tokens[variant.border],
      backgroundColor: background === undefined ? "transparent" : tokens[background],
      opacity: options.disabled ? tokens["opacity-disabled"] : 1,
    },
  };
}
