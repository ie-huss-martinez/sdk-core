import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Field } from "../field/Field.js";
import { SearchField } from "./SearchField.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SearchField on the server", () => {
  it("renders a named search input in a box, after a decorative icon", () => {
    const html = renderToString(<SearchField label="Search guides" placeholder="A symptom" />);
    expect(html).toMatch(
      /^<div class="hm-search-field"><span class="hm-search-field-icon" aria-hidden="true"><svg [^>]*data-hm-icon="search"[^>]*>.*<\/svg><\/span><input [^>]*\/><\/div>$/,
    );
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search guides"');
    expect(html).toContain('placeholder="A symptom"');
    expect(html).toContain('class="hm-search-field-input"');
  });

  it("leaves clearing to the browser until its own button works", () => {
    const html = renderToString(<SearchField label="Search guides" defaultValue="cors" />);
    expect(html).toContain('value="cors"');
    expect(html).not.toContain("hm-search-field-clear");
    expect(html).not.toContain("data-hm-ready");
  });

  it("needs no client JavaScript: static markup is the whole field", () => {
    const field = <SearchField label="Search guides" defaultValue="cors" end={<kbd>/</kbd>} />;
    expect(renderToStaticMarkup(field)).toBe(renderToString(field));
  });

  it("puts className on the box and native props on the input, with classNames per part", () => {
    const html = renderToString(
      <SearchField
        label="Search guides"
        className="app"
        classNames={{ root: "root", icon: "icon", input: "input", end: "end" }}
        unstyled
        name="q"
        autoComplete="off"
        aria-keyshortcuts="Control+k"
        icon={<svg data-testid="own" />}
        end={<span aria-hidden="true">Ctrl K</span>}
      />,
    );
    expect(html).toContain('<div class="hm-search-field root app" data-hm-unstyled="">');
    expect(html).toContain(
      '<span class="hm-search-field-icon icon" aria-hidden="true"><svg data-testid="own">',
    );
    expect(html).toMatch(/<input [^>]*class="hm-search-field-input input"/);
    expect(html).toMatch(/<input [^>]*name="q"/);
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('aria-keyshortcuts="Control+k"');
    expect(html).toContain(
      '<span class="hm-search-field-end end"><span aria-hidden="true">Ctrl K</span></span>',
    );
  });

  it("takes its name, description and error from a Field", () => {
    const html = renderToString(
      <Field label="Search guides" description="By symptom or error code" error="Too short">
        <SearchField />
      </Field>,
    );
    const [, id] = /<label [^>]*for="([^"]+)"/.exec(html) ?? [];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<input [^>]*id="${id}"`));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/<input [^>]*aria-describedby="[^"]+"/);
  });

  it("warns in development without an accessible name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    renderToString(<SearchField placeholder="Search" />);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/SearchField needs an accessible name/),
    );
  });
});
