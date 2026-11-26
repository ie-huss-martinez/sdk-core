import { type ReactElement, useContext } from "react";
import type { ColorValue, StyleProp, ViewStyle } from "react-native";
import { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect, Svg } from "react-native-svg";
import { useDirection } from "./Dir.js";
import type { IconData, IconShape } from "./icon-data.js";
import { NativeUiContext } from "./NativeUiProvider.js";

/**
 * Props of {@link Icon}.
 *
 * @public
 */
export interface IconProps {
  /** The icon to draw: one of ui's, such as `undoIcon`, or data of the same shape. */
  readonly icon: IconData;
  /** Width and height. Defaults to the theme's `icon-size`, times the text scale. */
  readonly size?: number | undefined;
  /** The stroke's colour. Defaults to the theme's text colour. */
  readonly color?: ColorValue | undefined;
  /**
   * The accessible name, for an icon that means something on its own.
   * Without it, the icon is decorative and hidden from screen readers, as
   * it should be inside a labelled button.
   */
  readonly label?: string | undefined;
  readonly style?: StyleProp<ViewStyle> | undefined;
}

function shape([element, attributes]: IconShape, index: number): ReactElement {
  // The shapes never change order, so their index is a stable key.
  switch (element) {
    case "path":
      return <Path key={index} {...attributes} />;
    case "circle":
      return <Circle key={index} {...attributes} />;
    case "rect":
      return <Rect key={index} {...attributes} />;
    case "line":
      return <Line key={index} {...attributes} />;
    case "ellipse":
      return <Ellipse key={index} {...attributes} />;
    case "polyline":
      return <Polyline key={index} {...attributes} />;
    case "polygon":
      return <Polygon key={index} {...attributes} />;
  }
}

/**
 * Draws an icon of ui's set with `react-native-svg`, in the theme's text
 * colour. An icon that points along the reading direction, such as undo or
 * a chevron, is mirrored inside right-to-left content: the direction is the
 * closest `Dir`'s.
 *
 * @example
 * ```tsx
 * <Icon icon={chevronRightIcon} />
 * <Icon icon={warningIcon} label={messages.t("sync.failed")} />
 * ```
 *
 * @public
 */
export function Icon({ icon, size, color, label, style }: IconProps): ReactElement {
  const { theme, textScale } = useContext(NativeUiContext);
  const direction = useDirection();
  const side = size ?? theme.tokens["icon-size"] * textScale;
  const mirrored = icon.mirror && direction === "rtl";
  return (
    <Svg
      width={side}
      height={side}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? theme.tokens["color-text"]}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={[mirrored ? { transform: [{ scaleX: -1 }] } : undefined, style]}
      {...(label === undefined
        ? {
            accessible: false,
            accessibilityElementsHidden: true,
            importantForAccessibility: "no-hide-descendants",
          }
        : { accessible: true, accessibilityRole: "image", accessibilityLabel: label })}
    >
      {icon.nodes.map(shape)}
    </Svg>
  );
}
