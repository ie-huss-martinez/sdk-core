import { defineMessages } from "@hussmartinez/sdk-core";

/**
 * English text of ui's links. A part of its own, so a link doesn't ship the
 * other components' text, nor they a link's (docs/adr/0012).
 */
export const uiLinkText = /* @__PURE__ */ defineMessages({
  "buttonLink.newTab": "(opens in a new tab)",
});
