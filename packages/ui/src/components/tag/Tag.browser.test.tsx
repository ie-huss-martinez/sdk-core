import { act, createRef } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addStyle, cleanUp, loadStyles, mount } from "../../test/dom.js";
import { Tag, TagList } from "./Tag.js";

let root: Root | undefined;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await loadStyles();
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  cleanUp();
  vi.restoreAllMocks();
});

/** A page that renders at build time and ships no JavaScript, as Astro does. */
function staticPage(element: React.ReactElement): HTMLElement {
  return mount(renderToStaticMarkup(element));
}

const style = (element: Element | null | undefined): CSSStyleDeclaration =>
  getComputedStyle(element as Element);

describe("Tag", () => {
  it("is styled from static markup alone, each tone with its own colours", () => {
    const container = staticPage(
      <>
        <Tag>Neutral</Tag>
        <Tag tone="accent">Accent</Tag>
        <Tag tone="success">Success</Tag>
        <Tag tone="warning">Warning</Tag>
        <Tag tone="danger">Danger</Tag>
      </>,
    );
    const tags = [...container.querySelectorAll(".hm-tag")];
    expect(new Set(tags.map((tag) => style(tag).backgroundColor)).size).toBe(5);
    for (const tag of tags) {
      expect(style(tag).display).toBe("inline-flex");
      expect(style(tag).borderTopStyle).toBe("solid");
    }
  });

  it("takes no focus", () => {
    const container = staticPage(<Tag>React</Tag>);
    expect((container.querySelector(".hm-tag") as HTMLElement).tabIndex).toBe(-1);
  });

  it("wraps text too long for its line instead of cutting it or overflowing", () => {
    const container = staticPage(
      <div style={{ inlineSize: "120px" }}>
        <Tag>Short</Tag>
        <Tag>A tag with a label far too long for its container</Tag>
      </div>,
    );
    const [short, long] = [...container.querySelectorAll(".hm-tag")] as HTMLElement[];
    const box = (long as HTMLElement).getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(120);
    expect(box.height).toBeGreaterThan((short as HTMLElement).getBoundingClientRect().height);
    expect((long as HTMLElement).scrollWidth).toBeLessThanOrEqual(Math.ceil(box.width));
  });

  it("drops visual styles but keeps layout with unstyled", () => {
    const container = staticPage(
      <>
        <Tag tone="danger">Styled</Tag>
        <Tag tone="danger" unstyled>
          Plain
        </Tag>
      </>,
    );
    const [styled, plain] = [...container.querySelectorAll(".hm-tag")];
    expect(style(plain).backgroundColor).not.toBe(style(styled).backgroundColor);
    expect(style(plain).borderTopStyle).toBe("none");
    expect(style(plain).display).toBe("inline-flex");
  });

  it("lets component tokens set on an ancestor restyle it", () => {
    const container = staticPage(
      <div style={{ ["--hm-tag-radius" as string]: "0px", ["--hm-tag-bg" as string]: "#c7eaa0" }}>
        <Tag>Frontend</Tag>
      </div>,
    );
    const tag = container.querySelector(".hm-tag");
    expect(style(tag).borderRadius).toBe("0px");
    expect(style(tag).backgroundColor).toBe("rgb(199, 234, 160)");
  });

  it("gives way to a page's own unlayered CSS, whatever its specificity", () => {
    addStyle("span { background-color: rgb(1, 2, 3); }");
    const container = staticPage(<Tag tone="success">Stable</Tag>);
    expect(style(container.querySelector(".hm-tag")).backgroundColor).toBe("rgb(1, 2, 3)");
  });

  it("forwards its ref to the element it renders", () => {
    const tag = createRef<HTMLElement>();
    const item = createRef<HTMLElement>();
    const container = mount("");
    act(() => {
      root = createRoot(container);
      root.render(
        <>
          <Tag ref={tag}>Alone</Tag>
          <TagList>
            <Tag ref={item}>In a list</Tag>
          </TagList>
        </>,
      );
    });
    expect(tag.current).toBeInstanceOf(HTMLSpanElement);
    expect(item.current).toBeInstanceOf(HTMLLIElement);
  });
});

describe("TagList", () => {
  const list = (
    <TagList aria-label="Stack">
      {["React", "Astro", "TypeScript", "PostgreSQL", "Playwright"].map((name) => (
        <Tag key={name}>{name}</Tag>
      ))}
    </TagList>
  );

  it("is a list of its tags, without markers or the list's own spacing", () => {
    const container = staticPage(list);
    const ul = container.querySelector("ul") as HTMLUListElement;
    expect(ul.getAttribute("role")).toBe("list");
    expect([...ul.children].map((item) => item.tagName)).toEqual(["LI", "LI", "LI", "LI", "LI"]);
    expect(style(ul).paddingInlineStart).toBe("0px");
    expect(style(ul).marginBlockStart).toBe("0px");
    // No longer a list item to CSS, so it draws no marker; still one to assistive technology.
    expect(style(ul.firstElementChild).display).toBe("flex");
    expect(style(ul).listStyleType).toBe("none");
  });

  it("wraps onto more lines when its tags don't fit", () => {
    const container = staticPage(<div style={{ inlineSize: "160px" }}>{list}</div>);
    const tops = new Set(
      [...container.querySelectorAll("li")].map((item) => Math.round(item.offsetTop)),
    );
    expect(tops.size).toBeGreaterThan(1);
    for (const item of container.querySelectorAll("li")) {
      expect(item.getBoundingClientRect().right).toBeLessThanOrEqual(
        container.getBoundingClientRect().left + 160,
      );
    }
  });

  it("hydrates without errors or warnings, where a page does hydrate", () => {
    const container = mount(renderToString(list));
    const consoleError = vi.spyOn(console, "error");
    const recoverable: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, list, { onRecoverableError: (e) => recoverable.push(e) });
    });
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
