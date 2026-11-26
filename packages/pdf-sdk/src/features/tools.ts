import { redoTool, undoTool } from "./history/history-tools.js";
import { openTool } from "./open/open-tool.js";
import { deletePagesTool } from "./pages/delete-tool.js";
import { insertPagesTool } from "./pages/insert-tool.js";
import { moveEarlierTool, moveLaterTool } from "./pages/move-tools.js";
import { rotateLeftTool, rotateRightTool } from "./pages/rotate-tools.js";
import { downloadTool } from "./save/download-tool.js";
import type { PdfTool } from "./tool-types.js";

/**
 * Every tool the editor knows, in their default order (sdk-core ADR 0030).
 *
 * @public
 */
export const pdfTools: readonly PdfTool[] = [
  openTool,
  insertPagesTool,
  undoTool,
  redoTool,
  rotateLeftTool,
  rotateRightTool,
  moveEarlierTool,
  moveLaterTool,
  deletePagesTool,
  downloadTool,
];

/**
 * The tools' default groups (docs/adr/0012): the bar's first and last, and
 * the tools panel's between them, each named after its first tool's group.
 */
export const DEFAULT_TOOLBAR: readonly (readonly string[])[] = [
  ["pdf.open"],
  ["pdf.undo", "pdf.redo"],
  ["pdf.rotate-left", "pdf.rotate-right"],
  ["pdf.delete-pages", "pdf.insert-pages"],
  ["pdf.move-earlier", "pdf.move-later"],
  ["pdf.download"],
];

/**
 * Tools the top bar holds, never the tools panel: they have no level
 * (sdk-core ADR 0067). Download is the bar's primary button.
 */
export const BAR_TOOLS: ReadonlySet<string> = /* @__PURE__ */ new Set([
  "pdf.open",
  "pdf.undo",
  "pdf.redo",
  "pdf.download",
]);
