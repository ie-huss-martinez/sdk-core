/// <reference lib="dom" preserve="true" />
/**
 * Starts the virtual screen reader. Only one can run at a time.
 *
 * @example
 * ```ts
 * import { startScreenReader } from "@hussmartinez/sdk-config/testing/screen-reader";
 * import { userEvent } from "vitest/browser";
 *
 * it("announces a move", async () => {
 *   const reader = await startScreenReader();
 *   onTestFinished(() => reader.stop());
 *   // … render the component and focus a row …
 *   expect(await reader.spoken(() => userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}"))).toEqual([
 *     "polite: Shape moved to position 4 of 4",
 *   ]);
 * });
 * ```
 *
 * @param {ScreenReaderOptions} [options]
 * @returns {Promise<ScreenReader>}
 */
export function startScreenReader({ container, quietMs, timeoutMs, }?: ScreenReaderOptions): Promise<ScreenReader>;
export type ScreenReaderOptions = {
    /**
     * What the screen reader can perceive. Defaults
     * to `document.body`, so that live regions outside a component are heard.
     */
    container?: Node;
    /**
     * How long speech must have stopped before a
     * step counts as finished, in milliseconds. Defaults to 150: ui's
     * announcer fills its region one animation frame after a change.
     */
    quietMs?: number;
    /**
     * The longest a step may keep speaking, in
     * milliseconds. Defaults to 3000.
     */
    timeoutMs?: number;
};
export type ScreenReader = {
    /**
     * Runs `step`,
     * if given, waits until speech has stopped, and returns the phrases spoken
     * since the previous call, or since the screen reader started. A live
     * region that was only emptied says nothing, as with a real screen reader.
     */
    spoken: (step?: () => unknown) => Promise<string[]>;
    /**
     * Stops listening. Every test that starts
     * a screen reader stops it, such as in `afterEach`.
     */
    stop: () => Promise<void>;
};
