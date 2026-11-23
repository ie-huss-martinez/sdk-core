import { defineTool } from "@hussmartinez/sdk-core";
import type { NotesTool } from "../tool-types.js";

/** Starts or stops recording sound alongside the ink (docs/adr/0007). */
export const recordTool: NotesTool = /* @__PURE__ */ defineTool({
  id: "notes.record",
  label: "tools.record",
  icon: "microphone",
  group: "audio",
  isAvailable: ({ canRecord }) => canRecord,
  isActive: ({ recording }) => recording,
  run: ({ toggleRecording }) => {
    toggleRecording();
  },
});
