// Browser commands defined in vitest.config.ts.
import type { PenStroke } from "./pen-commands.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    /**
     * Sends a pen stroke through Chromium's protocol. Resolves to `false`
     * in browsers without it.
     */
    penStroke: (stroke: PenStroke) => Promise<boolean>;
  }
}
