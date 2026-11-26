import {
  type ComponentRef,
  createContext,
  type ForwardedRef,
  type ForwardRefExoticComponent,
  forwardRef,
  type RefAttributes,
  useContext,
} from "react";
import { I18nManager, View, type ViewProps } from "react-native";
import { type Direction, isRTL } from "./direction.js";

const DirectionContext = /* @__PURE__ */ createContext<Direction | undefined>(undefined);

/**
 * The direction of the closest {@link Dir} or {@link NoFlip}, or the
 * application's own (`I18nManager.isRTL`) outside both. Use it to mirror
 * what a `direction` style can't, such as a drawing or a gesture.
 *
 * @public
 */
export function useDirection(): Direction {
  const inherited = useContext(DirectionContext);
  return inherited ?? (I18nManager.isRTL ? "rtl" : "ltr");
}

/**
 * Props of {@link Dir}. View props pass through.
 *
 * @public
 */
export interface DirProps extends ViewProps {
  /** The direction itself. It wins over `locale`. */
  readonly dir?: Direction | undefined;
  /** The language the content is written in, as a BCP 47 tag: its direction is used. */
  readonly locale?: string | undefined;
}

/**
 * Lays out a subtree in the direction of its content's language, with the
 * `direction` style, so it takes effect at once and Arabic content can sit
 * inside a Spanish interface. `I18nManager.forceRTL` flips the whole
 * application instead, and needs a restart.
 *
 * Rows, `start` and `end` follow it, and so do ui's mirrored icons. With
 * neither `dir` nor `locale`, it keeps the direction around it.
 *
 * @example
 * ```tsx
 * <Dir locale="ar">
 *   <Text>{arabicSentence}</Text>
 * </Dir>
 * ```
 *
 * @public
 */
export const Dir: ForwardRefExoticComponent<DirProps & RefAttributes<ComponentRef<typeof View>>> =
  /* @__PURE__ */ forwardRef(function Dir(
    { dir, locale, style, ...props }: DirProps,
    ref: ForwardedRef<ComponentRef<typeof View>>,
  ) {
    const inherited = useDirection();
    const direction = dir ?? (locale === undefined ? inherited : isRTL(locale) ? "rtl" : "ltr");
    return (
      <DirectionContext.Provider value={direction}>
        <View {...props} ref={ref} style={[{ direction }, style]} />
      </DirectionContext.Provider>
    );
  });

/**
 * Keeps a physical layout unmirrored in right-to-left text: a map, a grid
 * whose positions matter, arrows that point at real places. Use {@link Dir}
 * for content whose order follows reading.
 *
 * @public
 */
export const NoFlip: ForwardRefExoticComponent<
  ViewProps & RefAttributes<ComponentRef<typeof View>>
> = /* @__PURE__ */ forwardRef(function NoFlip(
  props: ViewProps,
  ref: ForwardedRef<ComponentRef<typeof View>>,
) {
  return <Dir {...props} ref={ref} dir="ltr" />;
});
