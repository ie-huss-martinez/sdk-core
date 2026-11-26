/**
 * `@hussmartinez/ui` for React Native: the themes resolved to native
 * values, the icon set as data with a component that draws it, a few
 * primitives with large targets, and helpers for direction, preferences and
 * announcements (sdk-core ADR 0069).
 *
 * @remarks
 * It needs `react-native`, and `react-native-svg` for `Icon`. It touches no
 * DOM and no `Intl`, and it has no stylesheet: a native theme is a plain
 * object.
 *
 * @packageDocumentation
 */

export type { IconName } from "./icons/icon-name.generated.js";
export { announce } from "./native/announce.js";
export type { ButtonProps } from "./native/Button.js";
export { Button } from "./native/Button.js";
export type { ButtonSize, ButtonVariant } from "./native/button-style.js";
export type { Choice, ChoiceListProps } from "./native/ChoiceList.js";
export { ChoiceList } from "./native/ChoiceList.js";
export type { ChoiceState } from "./native/choice-state.js";
export { choiceState } from "./native/choice-state.js";
export type {
  NativeTheme,
  NativeThemeInput,
  NativeThemePair,
} from "./native/create-native-theme.js";
export {
  createNativeTheme,
  darkNativeTheme,
  lightNativeTheme,
} from "./native/create-native-theme.js";
export type { DirProps } from "./native/Dir.js";
export { Dir, NoFlip, useDirection } from "./native/Dir.js";
export type { Direction } from "./native/direction.js";
export { isRTL } from "./native/direction.js";
export type { IconProps } from "./native/Icon.js";
export { Icon } from "./native/Icon.js";
export type { IconData, IconShape } from "./native/icon-data.js";
export * from "./native/icons.generated.js";
export type { NativeUiProviderProps } from "./native/NativeUiProvider.js";
export { NativeUiProvider, useNativeTheme, useTextScale } from "./native/NativeUiProvider.js";
export type { NativePreferences } from "./native/preferences.js";
export {
  clampTextScale,
  defaultNativePreferences,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  nativePreferenceOptions,
  readNativePreferences,
} from "./native/preferences.js";
export type { TextProps, TextTone, TextVariant } from "./native/Text.js";
export { Text } from "./native/Text.js";
export type {
  NativeEasing,
  NativeFontWeight,
  NativeThemeTokens,
} from "./native/theme.generated.js";
export { useReducedMotion } from "./native/use-reduced-motion.js";
