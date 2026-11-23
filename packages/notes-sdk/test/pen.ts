import { commands } from "vitest/browser";
import type { PenSample } from "./pen-commands.js";

export type { PenSample };

/** How a test's pointer writes. */
export interface DrawOptions {
  readonly pointerType?: "pen" | "mouse" | "touch";
  /** Hold the pen's barrel button, which erases. */
  readonly barrel?: boolean;
}

let nextPointer = 100;

/**
 * Draws on an element as a stylus does. In Chromium the samples go through
 * the browser's own input pipeline, as real pen events with pressure. In
 * Firefox and WebKit, which have no such protocol, the same samples are
 * dispatched as pointer events on the element.
 */
export async function draw(
  selector: string,
  samples: readonly PenSample[],
  options: DrawOptions = {},
): Promise<void> {
  const pointerType = options.pointerType ?? "pen";
  if (pointerType === "pen") {
    const sent = await commands.penStroke({
      selector,
      samples,
      ...(options.barrel ? { barrel: true } : {}),
    });
    if (sent) return;
  }
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Nothing matches ${selector}`);
  const box = element.getBoundingClientRect();
  const pointerId = nextPointer++;
  const held = options.barrel ? 2 : 1;
  samples.forEach((sample, index) => {
    const type = index === 0 ? "pointerdown" : "pointermove";
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId,
      pointerType,
      isPrimary: true,
      clientX: box.left + sample.x * box.width,
      clientY: box.top + sample.y * box.height,
      pressure: sample.pressure ?? 0.5,
      button: index === 0 ? (options.barrel ? 2 : 0) : -1,
      buttons: held,
      width: 1,
      height: 1,
    };
    element.dispatchEvent(new PointerEvent(type, init));
    if (index === samples.length - 1) {
      element.dispatchEvent(
        new PointerEvent("pointerup", {
          ...init,
          pressure: 0,
          button: options.barrel ? 2 : 0,
          buttons: 0,
        }),
      );
    }
  });
}

/** A straight path of samples between two points, pressing as given. */
export function line(
  from: readonly [number, number],
  to: readonly [number, number],
  { steps = 12, pressure = 0.5 }: { readonly steps?: number; readonly pressure?: number } = {},
): PenSample[] {
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: from[0] + ((to[0] - from[0]) * index) / steps,
    y: from[1] + ((to[1] - from[1]) * index) / steps,
    pressure,
  }));
}
