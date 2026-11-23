import type { BrowserCommand } from "vitest/node";

/** One sample of a pen's path: where it is in an element's box, and how hard it presses. */
export interface PenSample {
  /** Fractions of the element's width and height, from its top-left corner. */
  readonly x: number;
  readonly y: number;
  /** From 0 to 1. Defaults to 0.5. */
  readonly pressure?: number;
}

/** A pen stroke to send to the browser. */
export interface PenStroke {
  /** A CSS selector of the element the samples are placed in. */
  readonly selector: string;
  readonly samples: readonly PenSample[];
  /** Hold the pen's barrel button for the stroke, which erases. */
  readonly barrel?: boolean;
  /** The pen's tilt, in degrees. */
  readonly tiltX?: number;
  readonly tiltY?: number;
}

/**
 * Sends a pen stroke through Chromium's protocol, so the page receives real
 * pointer events of type "pen", with pressure and tilt, as a tablet's stylus
 * sends them (docs/adr/0002). Resolves to `false` in browsers without the
 * protocol, where a test dispatches its own events instead.
 */
const penStroke: BrowserCommand<[stroke: PenStroke]> = async (context, stroke) => {
  if (context.provider.name !== "playwright") {
    throw new Error("penStroke needs the Playwright provider");
  }
  const { page } = context;
  if (page.context().browser()?.browserType().name() !== "chromium") return false;
  const box = await context.iframe.locator(stroke.selector).first().boundingBox();
  if (!box) throw new Error(`penStroke found no element for ${stroke.selector}`);
  const session = await page.context().newCDPSession(page);
  const button = stroke.barrel ? "right" : "left";
  const buttons = stroke.barrel ? 2 : 1;
  try {
    for (const [index, sample] of stroke.samples.entries()) {
      const last = index === stroke.samples.length - 1;
      const common = {
        x: box.x + sample.x * box.width,
        y: box.y + sample.y * box.height,
        pointerType: "pen" as const,
        force: sample.pressure ?? 0.5,
        tiltX: stroke.tiltX ?? 0,
        tiltY: stroke.tiltY ?? 0,
      };
      if (index === 0) {
        await session.send("Input.dispatchMouseEvent", {
          ...common,
          type: "mousePressed",
          button,
          buttons,
          clickCount: 1,
        });
      } else {
        await session.send("Input.dispatchMouseEvent", {
          ...common,
          type: "mouseMoved",
          button,
          buttons,
        });
      }
      if (last) {
        await session.send("Input.dispatchMouseEvent", {
          ...common,
          type: "mouseReleased",
          button,
          buttons: 0,
          clickCount: 1,
          force: 0,
        });
      }
    }
  } finally {
    await session.detach();
  }
  return true;
};

/** The browser commands of this package's tests. */
export const penCommands = { penStroke };
