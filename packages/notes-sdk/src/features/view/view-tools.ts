import { defineTool } from "@hussmartinez/sdk-core";
import type { NotesTool } from "../tool-types.js";

/** How much one step of zoom changes it. */
export const ZOOM_STEP = 1.25;

/** Goes back to the library, saving first. */
export const closeTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.close",
  label: "tools.close",
  description: "tools.close.description",
  icon: "library",
  group: "navigation",
  run: ({ close }) => {
    close();
  },
});

/** Shows the page larger. */
export const zoomInTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.zoom-in",
  label: "tools.zoomIn",
  description: "tools.zoom-in.description",
  icon: "zoom-in",
  group: "view",
  isEnabled: ({ zoom, maxZoom }) => zoom < maxZoom,
  run: ({ zoom }) => {
    zoom(ZOOM_STEP);
  },
  shortcuts: "zoom-in",
});

/** Shows the page smaller. */
export const zoomOutTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.zoom-out",
  label: "tools.zoomOut",
  description: "tools.zoom-out.description",
  icon: "zoom-out",
  group: "view",
  isEnabled: ({ zoom, minZoom }) => zoom > minZoom,
  run: ({ zoom }) => {
    zoom(1 / ZOOM_STEP);
  },
  shortcuts: "zoom-out",
});

/** Fits the page's width in the view. */
export const zoomFitTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.zoom-fit",
  label: "tools.zoomFit",
  description: "tools.zoom-fit.description",
  icon: "fit",
  group: "view",
  isEnabled: ({ zoom }) => zoom !== 1,
  run: ({ zoom }) => {
    zoom("fit");
  },
  shortcuts: "zoom-reset",
});

/** Shows or hides the sidebar of pages, outline, search and recordings. */
export const sidebarTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.sidebar",
  label: "tools.sidebar",
  description: "tools.sidebar.description",
  icon: "sidebar",
  group: "view",
  isActive: ({ sidebar }) => sidebar,
  run: ({ toggleSidebar }) => {
    toggleSidebar();
  },
});

/** Opens the search of typed text and PDF text. */
export const searchTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.search",
  label: "tools.search",
  description: "tools.search.description",
  icon: "search",
  group: "view",
  run: ({ search }) => {
    search();
  },
  shortcuts: ["Mod+F"],
});
