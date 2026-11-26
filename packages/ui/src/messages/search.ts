import { defineMessages } from "@hussmartinez/sdk-core";

/**
 * English text of ui's search field. A part of its own, so the field doesn't
 * ship the other components' text, nor they its (docs/adr/0012).
 */
export const uiSearchText = /* @__PURE__ */ defineMessages({
  "searchField.clear": "Clear search",
});
