import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CommandPalette } from "./CommandPalette.js";

const noop = (): void => undefined;

describe("CommandPalette on the server", () => {
  it("renders closed, named by a hidden title, with no search until it opens", () => {
    const html = renderToString(
      <CommandPalette
        open={false}
        onOpenChange={noop}
        onRun={noop}
        items={[{ id: "a", label: "A" }]}
      />,
    );
    expect(html).toMatch(/^<dialog aria-labelledby="([^"]+)" class="hm-command-palette">/);
    expect(html).toContain('class="hm-visually-hidden">Commands</h2>');
    expect(html).not.toContain("combobox");
  });

  it("renders the combobox and its listbox when open", () => {
    const html = renderToString(
      <CommandPalette
        open
        onOpenChange={noop}
        onRun={noop}
        title="Tools"
        items={[
          { id: "a", label: "Crop", shortcut: "C" },
          { id: "b", label: "Draw", disabled: true },
        ]}
      />,
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('role="listbox"');
    expect(html).toMatch(/role="option" aria-selected="true"[^>]*>.*Crop/);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('<kbd class="hm-command-palette-shortcut">C</kbd>');
  });
});
