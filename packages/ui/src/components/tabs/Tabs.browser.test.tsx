import { act, createRef, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { Tabs, type TabsProps } from "./Tabs.js";

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

const tabs = [
  { id: "next", label: "Next.js", content: <p>Server Components</p> },
  { id: "astro", label: "Astro", content: <p>Islands</p> },
  { id: "remix", label: "Remix", content: <p>Loaders</p> },
];

function render(element: React.ReactElement, dir?: "rtl"): HTMLElement {
  const container = mount("");
  if (dir) {
    container.dir = dir;
  }
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

const stack = (props: Partial<TabsProps> = {}) => (
  <Tabs label="Implementations" tabs={tabs} {...props} />
);
const tabsOf = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[role="tab"]')] as [
    HTMLElement,
    HTMLElement,
    HTMLElement,
  ];
const selectedOf = (container: HTMLElement) =>
  container.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
const shownPanels = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(".hm-tabs-panel")]
    .filter((panel) => panel.getClientRects().length > 0)
    .map((panel) => panel.textContent);
const style = (element: Element | null | undefined): CSSStyleDeclaration =>
  getComputedStyle(element as Element);

/** Tabs whose owner holds the value, and follows the user or doesn't. */
function Controlled({ follow, onAsk }: { follow: boolean; onAsk: (id: string) => void }) {
  const [value, setValue] = useState("astro");
  return stack({
    value,
    onValueChange: (id) => {
      onAsk(id);
      if (follow) {
        setValue(id);
      }
    },
  });
}

describe("Tabs before JavaScript", () => {
  it("shows every panel under its heading, with nothing to operate", async () => {
    // A page rendered at build time that never hydrates, as Astro's is.
    const container = mount(renderToStaticMarkup(stack()));
    expect(container.querySelector('[role="tablist"], [role="tab"], [role="tabpanel"]')).toBeNull();
    expect(shownPanels(container)).toEqual([
      "Next.jsServer Components",
      "AstroIslands",
      "RemixLoaders",
    ]);
    expect([...container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
      "Next.js",
      "Astro",
      "Remix",
    ]);
    // Nothing in it takes focus: there's nothing to press.
    const before = document.activeElement;
    await userEvent.tab();
    expect(container.contains(document.activeElement)).toBe(false);
    (before as HTMLElement | null)?.focus?.();
  });

  it("becomes tabs when it hydrates, without a warning, and keeps what's in its panels", () => {
    const container = mount(renderToString(stack()));
    const paragraph = container.querySelector("p") as HTMLParagraphElement;
    const consoleError = vi.spyOn(console, "error");
    const recoverable: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, stack(), { onRecoverableError: (e) => recoverable.push(e) });
    });
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe(
      "Implementations",
    );
    expect(selectedOf(container)).toBe("Next.js");
    expect(shownPanels(container)).toEqual(["Server Components"]);
    expect(container.querySelector("h2")).toBeNull();
    // The same element as before, not a new one: a panel's own state survives.
    expect(paragraph.isConnected).toBe(true);
    expect(paragraph.parentElement?.getAttribute("role")).toBe("tabpanel");
  });
});

describe("Tabs", () => {
  it("is tabs at once when rendered in the browser, each panel named by its tab", () => {
    const container = render(stack());
    const [first] = tabsOf(container);
    const panel = container.querySelector('[role="tabpanel"]:not([hidden])') as HTMLElement;
    expect(panel.getAttribute("aria-labelledby")).toBe(first.id);
    expect(first.getAttribute("aria-controls")).toBe(panel.id);
    expect(container.querySelectorAll('[role="tabpanel"][hidden]')).toHaveLength(2);
  });

  it("has one Tab stop, on the selected tab, and then the panel", async () => {
    const container = render(stack({ defaultValue: "astro" }));
    const [, astro] = tabsOf(container);
    await userEvent.tab();
    expect(document.activeElement).toBe(astro);
    await userEvent.tab();
    expect(document.activeElement).toBe(container.querySelector('[role="tabpanel"]:not([hidden])'));
    expect(style(document.activeElement).outlineStyle).toBe("solid");
  });

  it("selects with the arrow keys, wrapping, and with Home and End", async () => {
    const onValueChange = vi.fn();
    const container = render(stack({ onValueChange }));
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(selectedOf(container)).toBe("Astro");
    expect(document.activeElement).toBe(tabsOf(container)[1]);
    expect(shownPanels(container)).toEqual(["Islands"]);
    await userEvent.keyboard("{End}");
    expect(selectedOf(container)).toBe("Remix");
    await userEvent.keyboard("{ArrowRight}");
    expect(selectedOf(container)).toBe("Next.js");
    await userEvent.keyboard("{ArrowLeft}");
    expect(selectedOf(container)).toBe("Remix");
    await userEvent.keyboard("{Home}");
    expect(selectedOf(container)).toBe("Next.js");
    expect(onValueChange.mock.calls.map(([id]) => id)).toEqual([
      "astro",
      "remix",
      "next",
      "remix",
      "next",
    ]);
  });

  it("swaps the arrows in right-to-left text, where the row runs the other way", async () => {
    const container = render(stack(), "rtl");
    await userEvent.tab();
    await userEvent.keyboard("{ArrowLeft}");
    expect(selectedOf(container)).toBe("Astro");
    await userEvent.keyboard("{ArrowRight}");
    expect(selectedOf(container)).toBe("Next.js");
  });

  it("only moves focus with manual activation, until Enter or Space", async () => {
    const container = render(stack({ activation: "manual" }));
    await userEvent.tab();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tabsOf(container)[1]);
    expect(selectedOf(container)).toBe("Next.js");
    await userEvent.keyboard("{Enter}");
    expect(selectedOf(container)).toBe("Astro");
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard(" ");
    expect(selectedOf(container)).toBe("Remix");
  });

  it("selects with a click, and shows the focus ring only for the keyboard", async () => {
    const container = render(stack());
    const [, astro] = tabsOf(container);
    await userEvent.click(astro);
    expect(selectedOf(container)).toBe("Astro");
    expect(style(astro).outlineStyle).toBe("none");
    await userEvent.keyboard("{ArrowRight}");
    expect(style(document.activeElement).outlineStyle).toBe("solid");
  });

  it("follows value when it's controlled, and asks before it changes", async () => {
    const asked: string[] = [];
    const onAsk = (id: string): void => {
      asked.push(id);
    };
    const container = render(<Controlled follow={false} onAsk={onAsk} />);
    await userEvent.click(tabsOf(container)[2]);
    expect(asked).toEqual(["remix"]);
    expect(selectedOf(container)).toBe("Astro");
    act(() => root?.render(<Controlled follow onAsk={onAsk} />));
    await userEvent.click(tabsOf(container)[2]);
    expect(selectedOf(container)).toBe("Remix");
  });

  it("selects the first tab when the value names none", () => {
    const container = render(stack({ value: "gone" }));
    expect(selectedOf(container)).toBe("Next.js");
  });

  it("marks the selected tab with a line, not with colour alone", () => {
    const container = render(stack());
    const [selected, other] = tabsOf(container);
    expect(style(selected).borderBottomColor).not.toBe(style(other).borderBottomColor);
    expect(style(selected).borderBottomWidth).toBe(style(other).borderBottomWidth);
    expect(Number.parseFloat(style(selected).borderBottomWidth)).toBeGreaterThanOrEqual(2);
  });

  it("meets the 24 px target size", () => {
    const container = render(stack());
    for (const tab of tabsOf(container)) {
      const box = tab.getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeGreaterThanOrEqual(24);
    }
  });

  it("scrolls its row when the tabs don't fit, and brings a focused tab into view", async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `tab-${index}`,
      label: `Implementation ${index + 1}`,
      content: <p>Panel {index + 1}</p>,
    }));
    const container = render(
      <div style={{ inlineSize: "320px" }}>
        <Tabs label="Implementations" tabs={many} />
      </div>,
    );
    const list = container.querySelector('[role="tablist"]') as HTMLElement;
    expect(container.querySelector(".hm-tabs")?.getBoundingClientRect().width).toBe(320);
    expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    // The row that scrolls isn't a Tab stop of its own: Tab goes to the selected tab.
    await userEvent.tab();
    expect(document.activeElement).toBe(list.querySelector('[role="tab"]'));
    await userEvent.keyboard("{End}");
    const last = document.activeElement as HTMLElement;
    expect(last.textContent).toBe("Implementation 12");
    const row = list.getBoundingClientRect();
    const box = last.getBoundingClientRect();
    // Within a pixel: a row scrolls by whole pixels, and its tabs' widths aren't whole.
    expect(box.left).toBeGreaterThanOrEqual(row.left - 1);
    expect(box.right).toBeLessThanOrEqual(row.right + 1);
  });

  it("shows the selected tab in a row that scrolls, without moving the page", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      id: `tab-${index}`,
      label: `Implementation ${index + 1}`,
      content: <p>Panel {index + 1}</p>,
    }));
    // Below the fold, so anything that scrolled the page to it would show.
    const container = render(
      <div style={{ inlineSize: "320px", marginBlockStart: "200vh" }}>
        <Tabs label="Implementations" tabs={many} defaultValue="tab-9" />
      </div>,
    );
    const list = container.querySelector('[role="tablist"]') as HTMLElement;
    const row = list.getBoundingClientRect();
    const box = (
      list.querySelector('[aria-selected="true"]') as HTMLElement
    ).getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(row.left - 1);
    expect(box.right).toBeLessThanOrEqual(row.right + 1);
    expect(document.scrollingElement?.scrollTop).toBe(0);
  });

  it("drops visual styles but keeps layout, target size and focus with unstyled", async () => {
    const container = render(
      <>
        {stack()}
        {stack({ unstyled: true })}
      </>,
    );
    const [styled, plain] = [...container.querySelectorAll(".hm-tabs")] as HTMLElement[];
    const styledTab = (styled as HTMLElement).querySelector('[role="tab"]');
    const plainTab = (plain as HTMLElement).querySelector<HTMLElement>('[role="tab"]');
    expect(style(plainTab).borderBottomColor).not.toBe(style(styledTab).borderBottomColor);
    expect(style(plain?.querySelector('[role="tablist"]')).display).toBe("flex");
    expect((plainTab as HTMLElement).getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    plainTab?.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(style(document.activeElement).outlineStyle).toBe("solid");
  });

  it("lets component tokens set on an ancestor restyle it", () => {
    const container = render(
      <div style={{ ["--hm-tabs-indicator-color" as string]: "rgb(1, 2, 3)" }}>{stack()}</div>,
    );
    expect(style(tabsOf(container)[0]).borderBottomColor).toBe("rgb(1, 2, 3)");
  });

  it("forwards its ref to the root", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Tabs ref={ref} label="Implementations" tabs={tabs} />);
    expect(ref.current?.className).toBe("hm-tabs");
  });
});
