import { createContext, type ReactElement, type ReactNode, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import {
  darkNativeTheme,
  lightNativeTheme,
  type NativeTheme,
  type NativeThemePair,
} from "./create-native-theme.js";
import { clampTextScale, type NativePreferences } from "./preferences.js";

/** What the native components read from the closest provider. */
export interface NativeUi {
  readonly theme: NativeTheme;
  readonly textScale: number;
  readonly motion: NativePreferences["motion"];
}

/** Without a provider: the light theme at its own size, following the device's motion setting. */
const DEFAULT: NativeUi = { theme: lightNativeTheme, textScale: 1, motion: "system" };

export const NativeUiContext = /* @__PURE__ */ createContext<NativeUi>(DEFAULT);

/**
 * Props of {@link NativeUiProvider}.
 *
 * @public
 */
export interface NativeUiProviderProps {
  /**
   * One theme, used whatever the device's appearance, or a light and a dark
   * one. Defaults to the built-in pair.
   */
  readonly theme?: NativeTheme | NativeThemePair | undefined;
  /**
   * Which theme of a pair to use: `system`, the default, follows the
   * device's appearance.
   */
  readonly colorMode?: NativePreferences["theme"] | undefined;
  /** Multiplies text and target sizes. Defaults to 1; kept from 1 to 2. */
  readonly textScale?: number | undefined;
  /** `system`, the default, follows the device's reduce-motion setting. */
  readonly motion?: NativePreferences["motion"] | undefined;
  readonly children?: ReactNode;
}

const isPair = (theme: NativeTheme | NativeThemePair): theme is NativeThemePair =>
  "light" in theme && "dark" in theme;

/**
 * Gives the native components their theme and the person's preferences.
 * It renders no view of its own. Without it, components use the built-in
 * light theme.
 *
 * @example
 * ```tsx
 * <NativeUiProvider colorMode={preferences.theme} textScale={preferences.textScale}>
 *   <Dir locale={locale} style={{ flex: 1 }}>
 *     <App />
 *   </Dir>
 * </NativeUiProvider>
 * ```
 *
 * @public
 */
export function NativeUiProvider({
  theme,
  colorMode = "system",
  textScale = 1,
  motion = "system",
  children,
}: NativeUiProviderProps): ReactElement {
  const device = useColorScheme();
  const scheme = colorMode === "system" ? (device === "dark" ? "dark" : "light") : colorMode;
  const value = useMemo<NativeUi>(() => {
    const pair = theme === undefined ? undefined : isPair(theme) ? theme : undefined;
    const fallback = scheme === "dark" ? darkNativeTheme : lightNativeTheme;
    const resolved =
      theme === undefined ? fallback : pair === undefined ? (theme as NativeTheme) : pair[scheme];
    return { theme: resolved, textScale: clampTextScale(textScale), motion };
  }, [theme, scheme, textScale, motion]);
  return <NativeUiContext.Provider value={value}>{children}</NativeUiContext.Provider>;
}

/**
 * The theme of the closest {@link NativeUiProvider}, or the built-in light
 * theme without one.
 *
 * @public
 */
export function useNativeTheme(): NativeTheme {
  return useContext(NativeUiContext).theme;
}

/**
 * The text scale of the closest {@link NativeUiProvider}, from 1 to 2, or 1
 * without one. Multiply the sizes of your own text and targets by it, as
 * ui's components do.
 *
 * @public
 */
export function useTextScale(): number {
  return useContext(NativeUiContext).textScale;
}
