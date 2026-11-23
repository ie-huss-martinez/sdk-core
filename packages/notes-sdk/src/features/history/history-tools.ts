import { defineTool } from "@hussmartinez/sdk-core";
import type { NotesTool } from "../tool-types.js";

/** Undoes the last edit (sdk-core ADR 0010). */
export const undoTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.undo",
  label: "tools.undo",
  icon: "undo",
  group: "history",
  isEnabled: ({ snapshot }) => snapshot.canUndo,
  run: ({ session }) => {
    session.undo();
  },
  shortcuts: "undo",
});

/** Redoes the last undone edit. */
export const redoTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.redo",
  label: "tools.redo",
  icon: "redo",
  group: "history",
  isEnabled: ({ snapshot }) => snapshot.canRedo,
  run: ({ session }) => {
    session.redo();
  },
  shortcuts: "redo",
});
