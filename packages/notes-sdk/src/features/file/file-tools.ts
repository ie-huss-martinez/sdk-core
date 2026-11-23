import { defineTool } from "@hussmartinez/sdk-core";
import type { NotesTool } from "../tool-types.js";

/** Writes the notebook as a PDF, with the ink as vector paths (docs/adr/0006). */
export const exportPdfTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.export-pdf",
  label: "tools.exportPdf",
  icon: "share",
  group: "file",
  isEnabled: ({ exporting }) => !exporting,
  run: ({ exportPdf }) => {
    exportPdf();
  },
});
