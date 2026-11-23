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

/** The toolbar's default groups. Selection tools have keys, and no button of their own. */
export const DEFAULT_TOOLBAR: readonly (readonly string[])[] = [
  ["notes.close"],
  ["notes.undo", "notes.redo"],
  [
    "notes.pen",
    "notes.highlighter",
    "notes.eraser",
    "notes.lasso",
    "notes.text",
    "notes.image",
    "notes.link",
    "notes.hand",
  ],
  ["notes.straighten", "notes.finger"],
  ["notes.add-page", "notes.delete-page"],
  ["notes.zoom-out", "notes.zoom-in", "notes.zoom-fit", "notes.sidebar", "notes.search"],
  ["notes.record"],
  ["notes.export-pdf"],
];
