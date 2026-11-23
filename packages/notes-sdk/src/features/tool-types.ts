import type { Tool } from "@hussmartinez/sdk-core";
import type { NotesColor } from "../core/model/items.js";
import type { NotesSession, NotesSessionSnapshot } from "../core/session/notebook-session.js";

/**
 * What the pointer does on a page.
 *
 * @public
 */
export type NotesPointerTool =
  | "pen"
  | "highlighter"
  | "eraser"
  | "lasso"
  | "text"
  | "link"
  | "hand";

/**
 * How the eraser erases: whole strokes, or only the parts it passes over.
 *
 * @public
 */
export type NotesEraserMode = "stroke" | "precise";

/**
 * The writing settings of the editor: the tool in hand and each tool's
 * colour and size, in page units.
 *
 * @public
 */
export interface NotesInkSettings {
  readonly tool: NotesPointerTool;
  readonly penColor: NotesColor;
  readonly penSize: number;
  readonly highlighterColor: NotesColor;
  readonly highlighterSize: number;
  readonly eraserMode: NotesEraserMode;
  readonly eraserSize: number;
  readonly textColor: NotesColor;
  readonly textSize: number;
  /** Whether every stroke that looks like a line, a rectangle, an ellipse or a triangle is straightened. */
  readonly straighten: boolean;
  /** Whether a finger writes. When it doesn't, fingers pan and zoom, and only a pen or a mouse writes. */
  readonly fingerDraws: boolean;
}

/**
 * The settings a new editor starts with.
 *
 * @public
 */
export const DEFAULT_INK_SETTINGS: NotesInkSettings = {
  tool: "pen",
  penColor: "#1f2937",
  penSize: 220,
  highlighterColor: "#fde047",
  highlighterSize: 1400,
  eraserMode: "precise",
  eraserSize: 1200,
  textColor: "#1f2937",
  textSize: 1400,
  straighten: false,
  fingerDraws: false,
};

/**
 * What a tool reads to decide whether it's available, enabled or active.
 *
 * @public
 */
export interface NotesToolState {
  /** The open notebook's current snapshot. */
  readonly snapshot: NotesSessionSnapshot;
  readonly settings: NotesInkSettings;
  /** How many items are selected. */
  readonly selected: number;
  /** Whether the page sidebar shows. */
  readonly sidebar: boolean;
  /** Whether sound is being recorded, and whether this browser can record. */
  readonly recording: boolean;
  readonly canRecord: boolean;
  /** Whether a PDF is being exported. */
  readonly exporting: boolean;
  /** The zoom, where 1 fits the page's width, and its bounds. */
  readonly zoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

/**
 * What a tool runs against.
 *
 * @public
 */
export interface NotesToolContext {
  readonly session: NotesSession;
  /** Changes the writing settings, such as the tool in hand. */
  readonly setSettings: (patch: Partial<NotesInkSettings>) => void;
  /** Turns a writing option on or off. */
  readonly toggle: (option: "straighten" | "fingerDraws") => void;
  /** Adds a page after the current one, with the same paper and size. */
  readonly addPage: () => void;
  /** Removes the current page. */
  readonly deletePage: () => void;
  /** Removes the selected items. */
  readonly deleteSelection: () => void;
  /** Selects every item of the current page. */
  readonly selectAll: () => void;
  /** Asks the user for a picture and places it on the current page. */
  readonly chooseImage: () => void;
  /** Multiplies the zoom, or fits the page's width with `"fit"`. */
  readonly zoom: (change: number | "fit") => void;
  readonly toggleSidebar: () => void;
  /** Opens the sidebar on its search. */
  readonly search: () => void;
  readonly toggleRecording: () => void;
  /** Writes the notebook as a PDF and hands it to the host or the browser. */
  readonly exportPdf: () => void;
  /** Saves and goes back to the library. */
  readonly close: () => void;
}

/**
 * One of the notebook's tools (sdk-core ADR 0009 and ADR 0030): headless, so
 * the React editor and the custom element share it.
 *
 * @public
 */
export type NotesTool = Tool<NotesToolState, NotesToolContext, undefined>;
