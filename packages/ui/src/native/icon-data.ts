import type { IconName } from "../icons/icon-name.generated.js";

/**
 * One shape of an icon: an SVG element's name and its geometry. The
 * generator only ever writes the shapes and attributes its allowlist
 * accepts.
 *
 * @public
 */
export type IconShape = readonly [
  element: "path" | "circle" | "rect" | "line" | "ellipse" | "polyline" | "polygon",
  attributes: Readonly<Record<string, string>>,
];

/**
 * An icon of ui's set as plain data: the shapes to draw on a 24-unit grid,
 * with a stroke of 2 and round caps and joins. `Icon` draws it; anything
 * else that draws paths can too.
 *
 * @public
 */
export interface IconData {
  /** The icon's name in ui's set, such as `rotate-left`. */
  readonly name: IconName;
  /**
   * Whether the icon points along the reading direction or along time, and
   * so flips in right-to-left text, as undo and the chevrons do.
   */
  readonly mirror: boolean;
  readonly nodes: readonly IconShape[];
}
