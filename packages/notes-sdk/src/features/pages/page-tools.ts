import { defineTool } from "@hussmartinez/sdk-core";
import type { NotesTool } from "../tool-types.js";

/** Adds a page after the current one. */
export const addPageTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.add-page",
  label: "tools.addPage",
  description: "tools.add-page.description",
  level: "expert",
  icon: "page-add",
  group: "pages",
  run: ({ addPage }) => {
    addPage();
  },
});

/** Removes the current page. A notebook keeps at least one. */
export const deletePageTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.delete-page",
  label: "tools.deletePage",
  description: "tools.delete-page.description",
  level: "expert",
  icon: "delete",
  group: "pages",
  isEnabled: ({ snapshot }) => snapshot.notebook.pages.length > 1,
  run: ({ deletePage }) => {
    deletePage();
  },
});
