import { describe, expect, it } from "vitest";
import { isScriptUrl } from "./link.js";

describe("isScriptUrl", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "\u0001javascript:alert(1)",
    "java\tscript:alert(1)",
    "j\na\rv\tascript:alert(1)",
  ])("is true for %j, which a browser would run", (href) => {
    expect(isScriptUrl(href)).toBe(true);
  });

  it.each([
    "/guides",
    "#top",
    "https://example.com/javascript:",
    "mailto:someone@example.com",
    "javascript",
    "/javascript:alert(1)",
    "",
  ])("is false for %j", (href) => {
    expect(isScriptUrl(href)).toBe(false);
  });
});
