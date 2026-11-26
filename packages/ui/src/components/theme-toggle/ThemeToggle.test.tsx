import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle.js";

describe("ThemeToggle on the server", () => {
  it("renders an inherited theme as light, which the browser corrects after mount", () => {
    const html = renderToString(<ThemeToggle value="inherit" onValueChange={() => {}} />);
    expect(html).toContain('aria-label="Dark theme"');
    expect(html).toContain('aria-pressed="false"');
  });
});
