import {
  type ComponentRef,
  type ForwardedRef,
  type ForwardRefExoticComponent,
  forwardRef,
  type RefAttributes,
  useContext,
} from "react";
import { Text as NativeText, type TextProps as NativeTextProps } from "react-native";
import type { ColorToken } from "./create-native-theme.js";
import { useDirection } from "./Dir.js";
import { NativeUiContext } from "./NativeUiProvider.js";

/**
 * A text size: `body`, the default, `small` or `title`.
 *
 * @public
 */
export type TextVariant = "body" | "small" | "title";

/**
 * What a text's colour says. `hint` is the gentle tone for "look again";
 * `danger` is for real errors, never for a wrong answer.
 *
 * @public
 */
export type TextTone = "default" | "muted" | "accent" | "success" | "hint" | "warning" | "danger";

const TONES: Readonly<Record<TextTone, ColorToken>> = {
  default: "color-text",
  muted: "color-text-muted",
  accent: "color-accent-text",
  success: "color-success-text",
  hint: "color-hint-text",
  warning: "color-warning-text",
  danger: "color-danger-text",
};

/**
 * Props of {@link Text}. React Native's text props pass through.
 *
 * @public
 */
export interface TextProps extends NativeTextProps {
  /** Defaults to `body`. */
  readonly variant?: TextVariant | undefined;
  /** Defaults to `default`, the theme's text colour. */
  readonly tone?: TextTone | undefined;
  /** A colour that wins over `tone`, for text on a filled surface. */
  readonly color?: string | undefined;
  /** The strong weight. A `title` always has it. */
  readonly strong?: boolean | undefined;
}

/**
 * Text in the theme's type: its size follows the provider's text scale, on
 * top of the device's own font size setting, and its line height follows
 * its size.
 *
 * @example
 * ```tsx
 * <Text variant="title">{messages.t("home.title")}</Text>
 * ```
 *
 * @public
 */
export const Text: ForwardRefExoticComponent<
  TextProps & RefAttributes<ComponentRef<typeof NativeText>>
> = /* @__PURE__ */ forwardRef(function Text(
  { variant = "body", tone = "default", color, strong = false, style, ...props }: TextProps,
  ref: ForwardedRef<ComponentRef<typeof NativeText>>,
) {
  const { theme, textScale } = useContext(NativeUiContext);
  const direction = useDirection();
  const { tokens } = theme;
  const fontSize = tokens[`font-size-${variant}`] * textScale;
  const leading = variant === "title" ? tokens["line-height-tight"] : tokens["line-height-body"];
  return (
    <NativeText
      {...props}
      ref={ref}
      style={[
        {
          color: color ?? tokens[TONES[tone]],
          fontSize,
          lineHeight: Math.round(fontSize * leading),
          fontWeight:
            strong || variant === "title"
              ? tokens["font-weight-strong"]
              : tokens["font-weight-regular"],
          letterSpacing: tokens["letter-spacing"],
          writingDirection: direction,
        },
        style,
      ]}
    />
  );
});
