import {
  type ComponentRef,
  type ForwardedRef,
  type ForwardRefExoticComponent,
  forwardRef,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
  useContext,
  useState,
} from "react";
import {
  type BlurEvent,
  type FocusEvent,
  Pressable,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from "react-native";
import { type ButtonSize, type ButtonVariant, buttonLook } from "./button-style.js";
import { Icon } from "./Icon.js";
import type { IconData } from "./icon-data.js";
import { NativeUiContext } from "./NativeUiProvider.js";
import { Text } from "./Text.js";

/**
 * Props of {@link Button}. Pressable's props pass through.
 *
 * @public
 */
export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  /** Defaults to `secondary`. */
  readonly variant?: ButtonVariant | undefined;
  /** Defaults to `medium`, a 44 dp target; `large` is 64 dp. */
  readonly size?: ButtonSize | undefined;
  /**
   * Before the label: an icon of ui's set, drawn in the label's colour, or
   * any element, such as a picture. It's decorative; the label names the
   * button.
   */
  readonly icon?: IconData | ReactElement | undefined;
  /** The label. A string is drawn as the theme's strong text; anything else as it is. */
  readonly children?: ReactNode;
  readonly style?: StyleProp<ViewStyle> | undefined;
}

/**
 * A button on React Native's `Pressable`, with a target of at least 44 dp,
 * or 64 dp when `large`, which grows with the text scale. It shows focus
 * for keyboards and switch access, and says it's a button, and whether it's
 * disabled, to screen readers.
 *
 * @example
 * ```tsx
 * <Button variant="primary" size="large" onPress={start}>
 *   {messages.t("session.start")}
 * </Button>
 * ```
 *
 * @public
 */
export const Button: ForwardRefExoticComponent<
  ButtonProps & RefAttributes<ComponentRef<typeof View>>
> = /* @__PURE__ */ forwardRef(function Button(
  {
    variant = "secondary",
    size = "medium",
    icon,
    children,
    disabled,
    style,
    onFocus,
    onBlur,
    accessibilityState,
    ...props
  }: ButtonProps,
  ref: ForwardedRef<ComponentRef<typeof View>>,
) {
  const { theme, textScale } = useContext(NativeUiContext);
  const [focused, setFocused] = useState(false);
  const isDisabled = disabled === true;
  const look = (pressed: boolean) =>
    buttonLook(theme.tokens, { variant, size, textScale, pressed, focused, disabled: isDisabled });
  const { foreground } = look(false);
  return (
    <Pressable
      accessibilityRole="button"
      {...props}
      ref={ref}
      disabled={isDisabled}
      accessibilityState={{ ...accessibilityState, disabled: isDisabled }}
      onFocus={(event: FocusEvent) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event: BlurEvent) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", justifyContent: "center" },
        look(pressed).container,
        style,
      ]}
    >
      {icon === undefined ? null : isValidElement(icon) ? (
        icon
      ) : (
        <Icon icon={icon} color={foreground} />
      )}
      {typeof children === "string" || typeof children === "number" ? (
        <Text strong color={foreground} style={{ flexShrink: 1, textAlign: "center" }}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
});
