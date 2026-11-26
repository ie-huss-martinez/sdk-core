/**
 * ui's icon names and the Lucide glyph behind each (docs/adr/0005). Names
 * describe what an icon is for in the SDK family, not what it draws, so a
 * glyph can change, or Lucide can rename it, without breaking anyone.
 *
 * `mirror` marks icons that point along the reading direction or along time,
 * which flip in right-to-left text, where the timeline runs right to left too:
 * undo and redo, the chevrons for earlier and later, trimming, fading, skipping
 * to the start or end, a range's start and end, and the arrows of links: onwards
 * and out to another site (docs/adr/0005, amended). Play doesn't mirror, nor do
 * rotations, physical directions, such as up and down, or glyphs that hold a
 * character or a clock face, such as `question` and `history`.
 *
 * `own` names a glyph ui draws itself, in `own-glyphs.ts`, for an icon
 * Lucide has no glyph for (docs/adr/0005, as amended).
 *
 * Development-time only: `pnpm --filter @hussmartinez/ui icons` reads it to
 * write `icons.generated.tsx`. Add an icon here, then regenerate.
 */
/** Where an icon's glyph comes from: Lucide's data, or ui's own. */
export type IconSource =
  | { readonly lucide: string; readonly own?: undefined; readonly mirror?: boolean }
  | { readonly own: string; readonly lucide?: undefined; readonly mirror?: boolean };

export const iconManifest = {
  add: { lucide: "plus" },
  arrow: { lucide: "move-up-right" },
  "arrow-right": { lucide: "arrow-right", mirror: true },
  book: { lucide: "book-open" },
  brain: { lucide: "brain" },
  check: { lucide: "check" },
  "chevron-down": { lucide: "chevron-down" },
  "chevron-left": { lucide: "chevron-left", mirror: true },
  "chevron-right": { lucide: "chevron-right", mirror: true },
  close: { lucide: "x" },
  code: { lucide: "code-xml" },
  command: { lucide: "command" },
  crop: { lucide: "crop" },
  delete: { lucide: "trash" },
  download: { lucide: "download" },
  duplicate: { lucide: "copy" },
  ellipse: { lucide: "ellipse" },
  "external-link": { lucide: "arrow-up-right", mirror: true },
  eyedropper: { lucide: "pipette" },
  "fade-in": { lucide: "chart-no-axes-column-increasing", mirror: true },
  "fade-out": { lucide: "chart-no-axes-column-decreasing", mirror: true },
  feed: { lucide: "rss" },
  fit: { lucide: "scan" },
  "flip-horizontal": { lucide: "triangles-centerline-dashed-vertical" },
  "flip-vertical": { lucide: "triangles-centerline-dashed-horizontal" },
  hidden: { lucide: "eye-off" },
  highlighter: { lucide: "highlighter" },
  history: { lucide: "rotate-ccw-clock" },
  image: { lucide: "image" },
  info: { lucide: "info" },
  layers: { lucide: "layers" },
  location: { lucide: "map-pin" },
  loop: { lucide: "repeat" },
  mail: { lucide: "mail" },
  menu: { lucide: "menu" },
  more: { lucide: "ellipsis" },
  "move-down": { lucide: "arrow-down" },
  "move-up": { lucide: "arrow-up" },
  muted: { lucide: "volume-x" },
  open: { lucide: "folder-open" },
  "page-add": { lucide: "file-plus" },
  "page-grid": { lucide: "grid-2x2" },
  "page-single": { lucide: "file" },
  pan: { lucide: "hand" },
  "panel-collapse": { lucide: "panel-left-close", mirror: true },
  "panel-expand": { lucide: "panel-left-open", mirror: true },
  pause: { lucide: "pause" },
  pen: { lucide: "pen" },
  play: { lucide: "play" },
  properties: { lucide: "sliders-horizontal" },
  question: { lucide: "message-circle-question-mark" },
  "range-end": { own: "range-end", mirror: true },
  "range-start": { own: "range-start", mirror: true },
  rectangle: { lucide: "rectangle-horizontal" },
  redact: { lucide: "rectangle-ellipsis" },
  redo: { lucide: "redo-2", mirror: true },
  remove: { lucide: "minus" },
  ripple: { lucide: "fold-horizontal" },
  "rotate-left": { lucide: "rotate-ccw" },
  "rotate-right": { lucide: "rotate-cw" },
  route: { lucide: "route" },
  search: { lucide: "search" },
  select: { lucide: "mouse-pointer-2" },
  settings: { lucide: "settings" },
  "skip-back": { lucide: "skip-back", mirror: true },
  "skip-forward": { lucide: "skip-forward", mirror: true },
  snap: { lucide: "magnet" },
  sparkles: { lucide: "sparkles" },
  split: { lucide: "scissors" },
  stop: { lucide: "square" },
  text: { lucide: "type" },
  "theme-dark": { lucide: "moon" },
  "theme-light": { lucide: "sun" },
  time: { lucide: "clock" },
  tip: { lucide: "lightbulb" },
  "trim-end": { lucide: "arrow-left-from-line", mirror: true },
  "trim-start": { lucide: "arrow-right-from-line", mirror: true },
  undo: { lucide: "undo-2", mirror: true },
  upload: { lucide: "upload" },
  visible: { lucide: "eye" },
  volume: { lucide: "volume-2" },
  warning: { lucide: "triangle-exclamation-point" },
  "zoom-in": { lucide: "zoom-in" },
  "zoom-out": { lucide: "zoom-out" },
} as const satisfies Record<string, IconSource>;
