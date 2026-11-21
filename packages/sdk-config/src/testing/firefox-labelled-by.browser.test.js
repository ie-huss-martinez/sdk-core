import { describe, expect, it } from "vitest";
import { removeLabelledByElements } from "./firefox-labelled-by.js";

const firefox = navigator.userAgent.includes("Firefox/");

// The browser project lists the guard's setup file, by its package path, so
// by now it has run in this page.
describe("the guard against the Firefox crash, as a setup file", () => {
  it.runIf(firefox)(
    "has removed ariaLabelledByElements from the page's elements in Firefox",
    () => {
      expect("ariaLabelledByElements" in Element.prototype).toBe(false);
      expect("ariaLabelledByElements" in document.createElement("button")).toBe(false);
    },
  );

  it.runIf(firefox)("leaves aria-labelledby itself working, by ID", () => {
    document.body.innerHTML = '<button aria-labelledby="name"></button><span id="name">Undo</span>';
    const button = /** @type {HTMLButtonElement} */ (document.querySelector("button"));

    expect(button.getAttribute("aria-labelledby")).toBe("name");
    expect(document.getElementById("name")?.textContent).toBe("Undo");
    document.body.innerHTML = "";
  });

  it.skipIf(firefox)("changes nothing in another browser", () => {
    const before = "ariaLabelledByElements" in Element.prototype;

    removeLabelledByElements();

    expect("ariaLabelledByElements" in Element.prototype).toBe(before);
  });
});
