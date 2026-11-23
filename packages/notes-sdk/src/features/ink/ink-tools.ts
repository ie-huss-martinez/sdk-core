import { defineTool } from "@hussmartinez/sdk-core";
import type { NotesPointerTool, NotesTool } from "../tool-types.js";

/** A tool that puts a pointer tool in hand, and is active while it is. */
const pointerTool = (tool: NotesPointerTool, icon: string, shortcut: string): NotesTool =>
  /* @__PURE__ */ defineTool({
    id: `notes.${tool}`,
    label: `tools.${tool}`,
    icon,
    group: "ink",
    isActive: ({ settings }) => settings.tool === tool,
    run: ({ setSettings }) => {
      setSettings({ tool });
    },
    shortcuts: [shortcut],
  });

/** Writes with a pen that follows pressure. */
export const penTool: NotesTool = /* @__PURE__ */ pointerTool("pen", "pen", "p");
/** Marks text with translucent ink, under the pen's. */
export const highlighterTool: NotesTool = /* @__PURE__ */ pointerTool(
  "highlighter",
  "highlighter",
  "h",
);
/** Erases whole strokes, or the parts it passes over. */
export const eraserTool: NotesTool = /* @__PURE__ */ pointerTool("eraser", "eraser", "e");
/** Selects items by drawing around them, to move, resize, recolour or delete them. */
export const lassoTool: NotesTool = /* @__PURE__ */ pointerTool("lasso", "lasso", "l");
/** Adds and edits boxes of typed text. */
export const textTool: NotesTool = /* @__PURE__ */ pointerTool("text", "text", "t");
/** Marks an area that leads to another page. */
export const linkTool: NotesTool = /* @__PURE__ */ pointerTool("link", "link", "k");
/** Moves the page, and follows links. */
export const handTool: NotesTool = /* @__PURE__ */ pointerTool("hand", "pan", "v");

/** Places a picture on the page. */
export const imageTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.image",
  label: "tools.image",
  icon: "image",
  group: "ink",
  run: ({ chooseImage }) => {
    chooseImage();
  },
});

/** Straightens strokes that look like shapes. */
export const straightenTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.straighten",
  label: "tools.straighten",
  icon: "shapes",
  group: "options",
  isActive: ({ settings }) => settings.straighten,
  run: ({ toggle }) => {
    toggle("straighten");
  },
});

/** Lets a finger write, for devices without a pen. */
export const fingerTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.finger",
  label: "tools.finger",
  icon: "touch",
  group: "options",
  isActive: ({ settings }) => settings.fingerDraws,
  run: ({ toggle }) => {
    toggle("fingerDraws");
  },
});

/** Removes the selected items. */
export const deleteSelectionTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.delete-selection",
  label: "tools.deleteSelection",
  icon: "delete",
  group: "selection",
  isAvailable: ({ selected }) => selected > 0,
  run: ({ deleteSelection }) => {
    deleteSelection();
  },
  shortcuts: "delete",
});

/** Selects every item of the current page. */
export const selectAllTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.select-all",
  label: "tools.selectAll",
  icon: "select",
  group: "selection",
  run: ({ selectAll }) => {
    selectAll();
  },
  shortcuts: "select-all",
});
