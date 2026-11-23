import {
  AddIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  DownloadIcon,
  DuplicateIcon,
  FitIcon,
  HighlighterIcon,
  type IconComponent,
  type IconProps,
  ImageIcon,
  MoreIcon,
  MoveDownIcon,
  MoveUpIcon,
  OpenIcon,
  PageAddIcon,
  PageGridIcon,
  PanIcon,
  PauseIcon,
  PenIcon,
  PlayIcon,
  RedoIcon,
  SearchIcon,
  SelectIcon,
  StopIcon,
  TextIcon,
  UndoIcon,
  UploadIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@hussmartinez/ui/react";
import type { ReactElement } from "react";

type Shape = readonly ["path" | "circle" | "rect", Readonly<Record<string, string>>];

/**
 * Draws one of the notes SDK's own glyphs, for the icons ui has none for
 * (docs/adr/0001). They're drawn as ui's are, so they sit with them: a
 * 24-unit grid, a stroke of 2 with round caps and joins, in `currentColor`,
 * and hidden from assistive technology unless given a label.
 */
function glyph(name: string, shapes: readonly Shape[], { label, className, ...props }: IconProps) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `hm-icon ${className}` : "hm-icon"}
      data-hm-icon={name}
      focusable="false"
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      {shapes.map(([Tag, attributes], index) => (
        // The shapes never change order, so their index is a stable key.
        // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered shapes
        <Tag key={index} {...attributes} />
      ))}
    </svg>
  );
}

/** An eraser: a slanted block resting on a line. */
function EraserIcon(props: IconProps): ReactElement {
  return glyph(
    "eraser",
    [
      [
        "path",
        {
          d: "M8.5 20 4 15.5a2 2 0 0 1 0-2.8L12.6 4a2 2 0 0 1 2.8 0L20 8.6a2 2 0 0 1 0 2.8L11.5 20z",
        },
      ],
      ["path", { d: "m8 9 7 7" }],
      ["path", { d: "M6 20h15" }],
    ],
    props,
  );
}

/** A lasso: a loop, and the rope's free end. */
function LassoIcon(props: IconProps): ReactElement {
  return glyph(
    "lasso",
    [
      ["path", { d: "M12 4c4.7 0 8.5 2.2 8.5 5s-3.8 5-8.5 5-8.5-2.2-8.5-5 3.8-5 8.5-5z" }],
      [
        "path",
        {
          d: "M7.5 13.3c-1.5 1.2-1.8 3 -.6 4 1.2 1 2.8.5 2.8-.8 0-1.3-1.7-1.7-2.7-.7-1 1-.8 3 .3 4.2",
        },
      ],
    ],
    props,
  );
}

/** Two links of a chain. */
function LinkIcon(props: IconProps): ReactElement {
  return glyph(
    "link",
    [
      ["path", { d: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" }],
      ["path", { d: "M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" }],
    ],
    props,
  );
}

/** A microphone on its stand. */
function MicrophoneIcon(props: IconProps): ReactElement {
  return glyph(
    "microphone",
    [
      ["rect", { x: "9", y: "3", width: "6", height: "11", rx: "3" }],
      ["path", { d: "M5 11a7 7 0 0 0 14 0" }],
      ["path", { d: "M12 18v3" }],
      ["path", { d: "M8.5 21h7" }],
    ],
    props,
  );
}

/** A folder. */
function FolderIcon(props: IconProps): ReactElement {
  return glyph(
    "folder",
    [
      [
        "path",
        { d: "M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
      ],
    ],
    props,
  );
}

/** A folder with a plus sign. */
function FolderAddIcon(props: IconProps): ReactElement {
  return glyph(
    "folder-add",
    [
      [
        "path",
        { d: "M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" },
      ],
      ["path", { d: "M12 11v5" }],
      ["path", { d: "M9.5 13.5h5" }],
    ],
    props,
  );
}

/** A bookmark, for the outline. */
function BookmarkIcon(props: IconProps): ReactElement {
  return glyph(
    "bookmark",
    [["path", { d: "M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" }]],
    props,
  );
}

/** A finger touching a surface. */
function TouchIcon(props: IconProps): ReactElement {
  return glyph(
    "touch",
    [
      ["path", { d: "M9 12V5.5a1.5 1.5 0 0 1 3 0V11" }],
      ["path", { d: "M12 10.5a1.5 1.5 0 0 1 3 0V12" }],
      [
        "path",
        {
          d: "M15 11.5a1.5 1.5 0 0 1 3 0V16a5 5 0 0 1-5 5h-1.2a5 5 0 0 1-4-2l-2.7-3.7a1.5 1.5 0 0 1 2.3-1.9L9 15",
        },
      ],
    ],
    props,
  );
}

/** A circle and a square: shapes. */
function ShapesIcon(props: IconProps): ReactElement {
  return glyph(
    "shapes",
    [
      ["circle", { cx: "8", cy: "8", r: "4.5" }],
      ["rect", { x: "11.5", y: "11.5", width: "9", height: "9", rx: "1.5" }],
    ],
    props,
  );
}

/** A closed notebook: a board with its spine and a label. */
function NotebookIcon(props: IconProps): ReactElement {
  return glyph(
    "notebook",
    [
      ["rect", { x: "5", y: "3", width: "14", height: "18", rx: "2" }],
      ["path", { d: "M9 3v18" }],
      ["path", { d: "M12.5 8h3.5" }],
    ],
    props,
  );
}

/** A chevron pointing down: more about what's beside it. */
function ChevronDownIcon(props: IconProps): ReactElement {
  return glyph("chevron-down", [["path", { d: "m6 9 6 6 6-6" }]], props);
}

/** A shield with a tick: kept safe, on this device. */
function ShieldIcon(props: IconProps): ReactElement {
  return glyph(
    "shield",
    [
      ["path", { d: "M12 3 5 6v5c0 4.5 2.9 8.3 7 10 4.1-1.7 7-5.5 7-10V6z" }],
      ["path", { d: "m9 12 2 2 4-4" }],
    ],
    props,
  );
}

/** A sidebar: a window with a column down its left. */
function SidebarIcon(props: IconProps): ReactElement {
  return glyph(
    "sidebar",
    [
      ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2.5" }],
      ["path", { d: "M9 4v16" }],
    ],
    props,
  );
}

/** A grid of four: back to all the notebooks. */
function LibraryIcon(props: IconProps): ReactElement {
  return glyph(
    "library",
    [
      ["rect", { x: "4", y: "4", width: "6.5", height: "6.5", rx: "1.5" }],
      ["rect", { x: "13.5", y: "4", width: "6.5", height: "6.5", rx: "1.5" }],
      ["rect", { x: "4", y: "13.5", width: "6.5", height: "6.5", rx: "1.5" }],
      ["rect", { x: "13.5", y: "13.5", width: "6.5", height: "6.5", rx: "1.5" }],
    ],
    props,
  );
}

/** An arrow leaving a tray: send the notebook out as a file. */
function ShareIcon(props: IconProps): ReactElement {
  return glyph(
    "share",
    [
      ["path", { d: "M12 15V3" }],
      ["path", { d: "m7.5 7.5 4.5-4.5 4.5 4.5" }],
      ["path", { d: "M5 12v6.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V12" }],
    ],
    props,
  );
}

/**
 * The components of the icons the editor names: ui's, and the notes SDK's
 * own glyphs for those ui has none for (sdk-core ADR 0030, docs/adr/0001). A
 * host's `icons` prop overrides any of them.
 *
 * @public
 */
export const notesIcons: Readonly<Record<string, IconComponent>> = {
  add: AddIcon,
  check: CheckIcon,
  "chevron-left": ChevronLeftIcon,
  "chevron-right": ChevronRightIcon,
  close: CloseIcon,
  delete: DeleteIcon,
  download: DownloadIcon,
  duplicate: DuplicateIcon,
  fit: FitIcon,
  highlighter: HighlighterIcon,
  image: ImageIcon,
  more: MoreIcon,
  "move-down": MoveDownIcon,
  "move-up": MoveUpIcon,
  open: OpenIcon,
  "page-add": PageAddIcon,
  "page-grid": PageGridIcon,
  pan: PanIcon,
  pause: PauseIcon,
  pen: PenIcon,
  play: PlayIcon,
  redo: RedoIcon,
  search: SearchIcon,
  select: SelectIcon,
  stop: StopIcon,
  text: TextIcon,
  undo: UndoIcon,
  upload: UploadIcon,
  "zoom-in": ZoomInIcon,
  "zoom-out": ZoomOutIcon,
  eraser: EraserIcon,
  lasso: LassoIcon,
  link: LinkIcon,
  microphone: MicrophoneIcon,
  folder: FolderIcon,
  "folder-add": FolderAddIcon,
  bookmark: BookmarkIcon,
  touch: TouchIcon,
  shapes: ShapesIcon,
  notebook: NotebookIcon,
  "chevron-down": ChevronDownIcon,
  shield: ShieldIcon,
  sidebar: SidebarIcon,
  library: LibraryIcon,
  share: ShareIcon,
};
