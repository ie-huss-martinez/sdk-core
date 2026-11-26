import { act, createRef } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { Button } from "./Button.js";
import { ButtonLink } from "./ButtonLink.js";

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
  history.replaceState(null, "", location.pathname + location.search);
});

/** A page that renders at build time and ships no JavaScript, as Astro does. */
function staticPage(element: React.ReactElement): HTMLElement {
  return mount(renderToStaticMarkup(element));
}

const style = (element: Element | null | undefined): CSSStyleDeclaration =>
  getComputedStyle(element as Element);
const px = (value: string): number => Number.parseFloat(value);

describe("ButtonLink", () => {
  it("looks like the button of the same variant and size, from static markup alone", () => {
    const variants = ["primary", "secondary", "quiet", "danger"] as const;
    const container = staticPage(
      <div>
        {variants.map((variant) => (
          <p key={variant}>
            <Button variant={variant} size="small">
              Guides
            </Button>
            <ButtonLink variant={variant} size="small" href="#guides">
              Guides
            </ButtonLink>
          </p>
        ))}
      </div>,
    );
    for (const [index, pair] of [...container.querySelectorAll("p")].entries()) {
      const variant = variants[index];
      const button = style(pair.querySelector("button"));
      const link = style(pair.querySelector("a"));
      for (const property of [
        "backgroundColor",
        "color",
        "borderTopColor",
        "borderTopLeftRadius",
        "fontSize",
        "fontWeight",
        "height",
        "paddingInlineStart",
        "display",
      ] as const) {
        expect(link[property], `${variant}: ${property}`).toBe(button[property]);
      }
      expect(link.textDecorationLine, variant).toBe("none");
    }
    // The comparison is of styled buttons: the stylesheet did apply.
    expect(style(container.querySelector("a")).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("is followed with Enter and with a click, but not with Space, as a link is", async () => {
    const container = staticPage(<ButtonLink href="#guides">Guides</ButtonLink>);
    const link = container.querySelector("a") as HTMLAnchorElement;
    link.focus();
    await userEvent.keyboard(" ");
    expect(location.hash).toBe("");
    await userEvent.keyboard("{Enter}");
    expect(location.hash).toBe("#guides");
    history.replaceState(null, "", location.pathname + location.search);
    await userEvent.click(link);
    expect(location.hash).toBe("#guides");
  });

  it("is in the Tab order and shows the focus ring on keyboard focus", async () => {
    const container = staticPage(<ButtonLink href="#guides">Guides</ButtonLink>);
    const link = container.querySelector("a") as HTMLAnchorElement;
    await userEvent.tab();
    expect(document.activeElement).toBe(link);
    expect(style(link).outlineStyle).toBe("solid");
    expect(px(style(link).outlineWidth)).toBeGreaterThanOrEqual(2);
  });

  it("meets the 24 px target size when small", () => {
    const container = staticPage(
      <ButtonLink size="small" href="#a">
        A
      </ButtonLink>,
    );
    const box = (container.querySelector("a") as Element).getBoundingClientRect();
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(box.width).toBeGreaterThanOrEqual(24);
  });

  it("adds the new-tab hint to its text without showing it", () => {
    const container = staticPage(
      <>
        <ButtonLink href="https://example.com/">Example</ButtonLink>
        <ButtonLink href="https://example.com/" target="_blank">
          Example
        </ButtonLink>
      </>,
    );
    const [same, newTab] = [...container.querySelectorAll("a")] as HTMLAnchorElement[];
    expect((newTab as HTMLElement).textContent).toBe("Example (opens in a new tab)");
    // Hidden on screen: the link is no wider for it.
    expect((newTab as HTMLElement).getBoundingClientRect().width).toBe(
      (same as HTMLElement).getBoundingClientRect().width,
    );
  });

  it("goes nowhere and leaves the Tab order when its URL was refused", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fromData = ["javascript", "document.title = 'ran'"].join(":");
    const title = document.title;
    const container = staticPage(<ButtonLink href={fromData}>Run</ButtonLink>);
    const link = container.querySelector("a") as HTMLAnchorElement;
    await userEvent.click(link);
    expect(document.title).toBe(title);
    await userEvent.tab();
    expect(document.activeElement).not.toBe(link);
  });

  it("drops visual styles but keeps layout and focus with unstyled", async () => {
    const container = staticPage(
      <>
        <ButtonLink variant="primary" href="#a">
          Styled
        </ButtonLink>
        <ButtonLink variant="primary" href="#b" unstyled>
          Plain
        </ButtonLink>
      </>,
    );
    const [styled, plain] = [...container.querySelectorAll("a")] as HTMLAnchorElement[];
    expect(style(plain).backgroundColor).not.toBe(style(styled).backgroundColor);
    expect(style(plain).textDecorationLine).toBe("underline");
    expect(style(plain).display).toBe("inline-flex");
    (styled as HTMLElement).focus();
    await userEvent.tab();
    expect(style(plain).outlineStyle).toBe("solid");
  });

  it("forwards its ref to the link", () => {
    const ref = createRef<HTMLAnchorElement>();
    const container = mount("");
    act(() => {
      root = createRoot(container);
      root.render(
        <ButtonLink ref={ref} href="#guides">
          Guides
        </ButtonLink>,
      );
    });
    expect(ref.current).toBeInstanceOf(HTMLAnchorElement);
  });

  it("hydrates without errors or warnings, where a page does hydrate", () => {
    const app = (
      <ButtonLink variant="primary" href="https://example.com/" target="_blank" endIcon={<svg />}>
        Example
      </ButtonLink>
    );
    const container = mount(renderToString(app));
    const consoleError = vi.spyOn(console, "error");
    const recoverable: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, app, { onRecoverableError: (e) => recoverable.push(e) });
    });
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
