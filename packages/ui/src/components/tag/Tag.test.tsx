import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Tag, TagList } from "./Tag.js";

describe("Tag on the server", () => {
  it("renders a neutral span with its text in a label", () => {
    expect(renderToString(<Tag>React</Tag>)).toBe(
      '<span class="hm-tag hm-tag--neutral"><span class="hm-tag-label">React</span></span>',
    );
  });

  it("renders a tone and a decorative icon", () => {
    const html = renderToString(
      <Tag tone="warning" icon={<svg />}>
        Deprecated
      </Tag>,
    );
    expect(html).toContain('class="hm-tag hm-tag--warning"');
    expect(html).toContain('<span class="hm-tag-icon" aria-hidden="true"><svg></svg></span>');
  });

  it("adds className and classNames per part, marks unstyled and passes native props", () => {
    const html = renderToString(
      <Tag
        className="app"
        classNames={{ root: "root", icon: "icon", label: "label" }}
        icon={<svg />}
        unstyled
        id="status"
        lang="en"
      >
        New
      </Tag>,
    );
    expect(html).toContain('class="hm-tag hm-tag--neutral root app"');
    expect(html).toContain('data-hm-unstyled=""');
    expect(html).toContain('class="hm-tag-icon icon"');
    expect(html).toContain('class="hm-tag-label label"');
    expect(html).toContain('id="status"');
    expect(html).toContain('lang="en"');
  });

  it("is a list item with as, where it can't know its list", () => {
    // An `.astro` file renders each component on its own, so a tag there
    // never sees its TagList's context.
    expect(renderToString(<Tag as="li">React</Tag>)).toBe(
      '<li class="hm-tag hm-tag--neutral"><span class="hm-tag-label">React</span></li>',
    );
  });

  it("is static: it has no role, no tabindex and no state", () => {
    const html = renderToString(<Tag tone="danger">Failed</Tag>);
    expect(html).not.toMatch(/role=|tabindex=|aria-/);
  });
});

describe("TagList on the server", () => {
  const list = (
    <TagList aria-label="Stack" className="app">
      <Tag>React</Tag>
      <Tag tone="accent">Astro</Tag>
    </TagList>
  );

  it("renders a list whose tags are its items", () => {
    expect(renderToString(list)).toBe(
      '<ul aria-label="Stack" role="list" class="hm-tag-list app">' +
        '<li class="hm-tag hm-tag--neutral"><span class="hm-tag-label">React</span></li>' +
        '<li class="hm-tag hm-tag--accent"><span class="hm-tag-label">Astro</span></li>' +
        "</ul>",
    );
  });

  it("keeps the list role, which Safari drops from a list without markers", () => {
    const html = renderToString(
      // @ts-expect-error -- `role` isn't a prop: the list stays a list.
      <TagList role="presentation">
        <Tag>React</Tag>
      </TagList>,
    );
    expect(html).toContain('role="list"');
    expect(html).not.toContain("presentation");
  });

  it("needs no client JavaScript: static markup is the whole component", () => {
    // What an Astro page without a `client:` directive, or any static
    // renderer, writes: the same markup, with nothing left to hydrate.
    expect(renderToStaticMarkup(list)).toBe(renderToString(list));
  });
});
