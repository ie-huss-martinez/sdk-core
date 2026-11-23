import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { startScreenReader } from "./screen-reader.js";

/** @type {Awaited<ReturnType<typeof startScreenReader>> | undefined} */
let reader;

afterEach(async () => {
  await reader?.stop();
  reader = undefined;
  document.body.replaceChildren();
});

/** Two buttons and a polite, atomic live region, as a component and ui's announcer. */
function mount() {
  const container = document.createElement("main");
  container.innerHTML =
    '<button type="button">First</button><button type="button">Second</button><div role="status" aria-live="polite" aria-atomic="true"></div>';
  document.body.append(container);
  return /** @type {HTMLElement} */ (container.querySelector('[role="status"]'));
}

describe("startScreenReader", () => {
  it("hears focus that real keys move, a step at a time", async () => {
    mount();
    reader = await startScreenReader();

    expect(await reader.spoken(() => userEvent.keyboard("{Tab}"))).toEqual(["button, First"]);
    expect(await reader.spoken(() => userEvent.keyboard("{Tab}"))).toEqual(["button, Second"]);
  });

  it("hears a live region, as late as the announcer's next frame", async () => {
    const status = mount();
    reader = await startScreenReader();

    const phrases = await reader.spoken(() => {
      requestAnimationFrame(() => {
        status.textContent = "Saved";
      });
    });

    expect(phrases).toEqual(["polite: Saved"]);
  });

  it("says nothing for a live region that's only emptied, as ui's announcer does first", async () => {
    const status = mount();
    status.textContent = "Saved";
    reader = await startScreenReader();

    const phrases = await reader.spoken(async () => {
      status.textContent = "";
      // A separate change, as in WebKit, where the library logs each one.
      await new Promise((resolve) => setTimeout(resolve, 50));
      status.textContent = "Saved again";
    });

    expect(phrases).toEqual(["polite: Saved again"]);
  });

  it("returns nothing for a step that says nothing, and nothing twice", async () => {
    mount();
    reader = await startScreenReader();
    await reader.spoken(() => userEvent.keyboard("{Tab}"));

    expect(await reader.spoken()).toEqual([]);
    expect(await reader.spoken(() => undefined)).toEqual([]);
  });

  it("refuses a second reader while one runs, and allows one after it stops", async () => {
    mount();
    reader = await startScreenReader();

    await expect(startScreenReader()).rejects.toThrow("A screen reader is already running");

    await reader.stop();
    await reader.stop();
    await expect(reader.spoken()).rejects.toThrow("This screen reader has stopped.");
    reader = await startScreenReader();
    expect(await reader.spoken(() => userEvent.keyboard("{Tab}"))).toEqual(["button, First"]);
  });

  it("gives up on a step after timeoutMs, rather than hang", async () => {
    mount();
    // Speech can't stay quiet for a second within 300 ms, so the step can
    // only end by timing out.
    reader = await startScreenReader({ quietMs: 1000, timeoutMs: 300 });
    const started = Date.now();

    await expect(reader.spoken(() => userEvent.keyboard("{Tab}"))).rejects.toThrow(
      `Speech didn't stop within 300 ms: ["button, First"]`,
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
