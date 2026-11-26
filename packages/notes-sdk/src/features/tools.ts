import { recordTool } from "./audio/audio-tools.js";
import { exportPdfTool } from "./file/file-tools.js";
import { redoTool, undoTool } from "./history/history-tools.js";
import {
  deleteSelectionTool,
  eraserTool,
  fingerTool,
  handTool,
  highlighterTool,
  imageTool,
  lassoTool,
  linkTool,
  penTool,
  selectAllTool,
  straightenTool,
  textTool,
} from "./ink/ink-tools.js";
import { addPageTool, deletePageTool } from "./pages/page-tools.js";
import type { NotesTool } from "./tool-types.js";
import {
  closeTool,
  searchTool,
  sidebarTool,
  zoomFitTool,
  zoomInTool,
  zoomOutTool,
} from "./view/view-tools.js";

/**
 * Every tool of an open notebook, in their default order (sdk-core
 * ADR 0030). Pass a subset's ids as the editor's `tools`, and arrange them
 * with `toolbar`.
 *
 * @public
 */
export const notesTools: readonly NotesTool[] = [
  closeTool,
  undoTool,
  redoTool,
  penTool,
  highlighterTool,
  eraserTool,
  lassoTool,
  textTool,
  imageTool,
  linkTool,
  handTool,
  straightenTool,
  fingerTool,
  addPageTool,
  deletePageTool,
  zoomOutTool,
  zoomInTool,
  zoomFitTool,
  sidebarTool,
  searchTool,
  recordTool,
  exportPdfTool,
  selectAllTool,
  deleteSelectionTool,
];

/**
 * The tools' default groups (docs/adr/0008): the top bar's, then the tools
 * panel's, each named after its first tool's group. Selecting everything
 * and deleting the selection have keys, and no button of their own: they're
 * in the command palette.
 *
 * @internal
 */
export const DEFAULT_TOOLBAR: readonly (readonly string[])[] = [
  ["notes.close"],
  ["notes.undo", "notes.redo"],
  ["notes.sidebar", "notes.search"],
  ["notes.pen", "notes.highlighter", "notes.eraser", "notes.text"],
  ["notes.lasso", "notes.image", "notes.link"],
  ["notes.hand", "notes.straighten", "notes.finger"],
  ["notes.add-page", "notes.delete-page"],
  ["notes.record"],
  ["notes.zoom-out", "notes.zoom-fit", "notes.zoom-in"],
  ["notes.export-pdf"],
];

/**
 * Tools the top bar and the stage hold, never the tools panel: they have no
 * level (sdk-core ADR 0067).
 *
 * @internal
 */
export const BAR_TOOLS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "notes.close",
  "notes.undo",
  "notes.redo",
  "notes.sidebar",
  "notes.search",
  "notes.zoom-out",
  "notes.zoom-fit",
  "notes.zoom-in",
  "notes.export-pdf",
]);
