import { act, createRef, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { TextField } from "../text-field/TextField.js";
import { SearchField, type SearchFieldProps } from "./SearchField.js";

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

function render(element: React.ReactElement): HTMLElement {
  const container = mount("");
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

const field = (props: Partial<SearchFieldProps> = {}) => (
  <SearchField label="Search guides" {...props} />
);
const inputOf = (container: HTMLElement) => container.querySelector("input") as HTMLInputElement;
const boxOf = (container: HTMLElement) =>
  container.querySelector(".hm-search-field") as HTMLElement;
const clearOf = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(".hm-search-field-clear");
const style = (element: Element | null | undefined): CSSStyleDeclaration =>
  getComputedStyle(element as Element);

/** A field whose owner holds the text, and follows the user or doesn't. */
function Controlled({ follow, onAsk }: { follow: boolean; onAsk: (text: string) => void }) {
  const [value, setValue] = useState("cors");
  return field({
    value,
    onValueChange: (text) => {
      onAsk(text);
      if (follow) {
        setValue(text);
      }
    },
  });
}

/** A field whose owner listens to the input's own change event, not onValueChange. */
function ControlledByChange() {
  const [value, setValue] = useState("cors");
  return field({ value, onChange: (event) => setValue(event.currentTarget.value) });
}

describe("SearchField before JavaScript", () => {
  it("is a search input in a styled box, with the browser's own way to clear it", () => {
    // A page rendered at build time that never hydrates, as Astro's is.
    const container = mount(renderToStaticMarkup(field({ defaultValue: "cors" })));
    const input = inputOf(container);
    expect(input.type).toBe("search");
    expect(input.value).toBe("cors");
    expect(clearOf(container)).toBeNull();
    expect(boxOf(container).hasAttribute("data-hm-ready")).toBe(false);
    expect(style(boxOf(container)).borderTopStyle).toBe("solid");
    expect(style(input).borderTopStyle).toBe("none");
  });

  it("gets its clear button when it hydrates, without a warning, and keeps its text", () => {
    const page = field({ defaultValue: "cors" });
    const container = mount(renderToString(page));
    const input = inputOf(container);
    const consoleError = vi.spyOn(console, "error");
    const recoverable: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, page, { onRecoverableError: (e) => recoverable.push(e) });
    });
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(inputOf(container)).toBe(input);
    expect(input.value).toBe("cors");
    expect(clearOf(container)?.getAttribute("aria-label")).toBe("Clear search");
  });

  it("keeps what was typed before it hydrated, and offers to clear it", async () => {
    const page = field();
    const container = mount(renderToString(page));
    // Someone who started typing before the page's JavaScript arrived.
    await userEvent.click(inputOf(container));
    await userEvent.keyboard("socket");
    act(() => {
      root = hydrateRoot(container, page);
    });
    expect(inputOf(container).value).toBe("socket");
    expect(clearOf(container)).not.toBeNull();
    await userEvent.click(clearOf(container) as HTMLElement);
    expect(inputOf(container).value).toBe("");
    expect(clearOf(container)).toBeNull();
  });
});

describe("SearchField", () => {
  it("looks like a text field: the same height, border and background", () => {
    const container = render(
      <>
        <TextField label="Name" />
        {field()}
      </>,
    );
    const text = style(container.querySelector(".hm-text-field"));
    const box = style(boxOf(container));
    for (const property of [
      "height",
      "backgroundColor",
      "borderTopColor",
      "borderTopWidth",
      "borderTopLeftRadius",
    ] as const) {
      expect(box[property], property).toBe(text[property]);
    }
    expect(style(inputOf(container)).fontSize).toBe(text.fontSize);
  });

  it("shows a clear button only while it holds text, and reports each change", async () => {
    const onValueChange = vi.fn();
    const container = render(field({ onValueChange }));
    expect(clearOf(container)).toBeNull();
    await userEvent.click(inputOf(container));
    await userEvent.keyboard("ab");
    expect(inputOf(container).value).toBe("ab");
    expect(clearOf(container)).not.toBeNull();
    await userEvent.keyboard("{Backspace}{Backspace}");
    expect(clearOf(container)).toBeNull();
    expect(onValueChange.mock.calls.map(([text]) => text)).toEqual(["a", "ab", "a", ""]);
  });

  it("clears with its button, and returns focus to the field", async () => {
    const onValueChange = vi.fn();
    const container = render(field({ defaultValue: "cors", onValueChange }));
    await userEvent.click(clearOf(container) as HTMLElement);
    expect(inputOf(container).value).toBe("");
    // Told once, not once by the button and again by the input.
    expect(onValueChange.mock.calls).toEqual([[""]]);
    expect(document.activeElement).toBe(inputOf(container));
    expect(clearOf(container)).toBeNull();
  });

  it("is reached with Tab, then its clear button, which Enter presses", async () => {
    const container = render(field({ defaultValue: "cors" }));
    await userEvent.tab();
    expect(document.activeElement).toBe(inputOf(container));
    await userEvent.tab();
    expect(document.activeElement).toBe(clearOf(container));
    await userEvent.keyboard("{Enter}");
    expect(inputOf(container).value).toBe("");
    expect(document.activeElement).toBe(inputOf(container));
  });

  it("draws the focus ring around the box when the input has focus, and only then", async () => {
    const container = render(field({ defaultValue: "cors" }));
    expect(style(boxOf(container)).outlineStyle).toBe("none");
    await userEvent.tab();
    expect(style(boxOf(container)).outlineStyle).toBe("solid");
    expect(style(inputOf(container)).outlineStyle).toBe("none");
    // On to the clear button: the ring is the button's own now.
    await userEvent.tab();
    expect(style(boxOf(container)).outlineStyle).toBe("none");
    expect(style(clearOf(container)).outlineStyle).toBe("solid");
  });

  it("follows value when it's controlled, and asks before it changes", async () => {
    const asked: string[] = [];
    const onAsk = (text: string): void => {
      asked.push(text);
    };
    const container = render(<Controlled follow={false} onAsk={onAsk} />);
    await userEvent.click(clearOf(container) as HTMLElement);
    expect(asked).toEqual([""]);
    expect(inputOf(container).value).toBe("cors");
    act(() => root?.render(<Controlled follow onAsk={onAsk} />));
    await userEvent.click(clearOf(container) as HTMLElement);
    expect(inputOf(container).value).toBe("");
  });

  it("tells onChange too when it's cleared, for an owner that listens there", async () => {
    const container = render(<ControlledByChange />);
    expect(inputOf(container).value).toBe("cors");
    await userEvent.click(clearOf(container) as HTMLElement);
    expect(inputOf(container).value).toBe("");
    expect(clearOf(container)).toBeNull();
  });

  it("offers to clear again after its form puts its first text back", async () => {
    const container = render(
      <form>
        {field({ defaultValue: "cors" })}
        <button type="reset">Reset</button>
      </form>,
    );
    await userEvent.click(clearOf(container) as HTMLElement);
    expect(clearOf(container)).toBeNull();
    await userEvent.click(container.querySelector('[type="reset"]') as HTMLElement);
    expect(inputOf(container).value).toBe("cors");
    await expect.poll(() => clearOf(container)).not.toBeNull();
  });

  it("has no clear button while it's disabled or read-only", () => {
    const container = render(
      <>
        {field({ defaultValue: "cors", disabled: true })}
        {field({ defaultValue: "cors", readOnly: true })}
      </>,
    );
    expect(container.querySelector(".hm-search-field-clear")).toBeNull();
    expect(inputOf(container).disabled).toBe(true);
  });

  it("meets the 24 px target size, the clear button too", () => {
    const container = render(field({ defaultValue: "cors" }));
    for (const element of [boxOf(container), clearOf(container) as HTMLElement]) {
      const box = element.getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeGreaterThanOrEqual(24);
    }
  });

  it("shrinks its input, not its box, in a narrow place", () => {
    const container = render(
      <div style={{ inlineSize: "160px" }}>
        {field({ defaultValue: "a long query that doesn't fit", end: <kbd>/</kbd> })}
      </div>,
    );
    expect(boxOf(container).getBoundingClientRect().width).toBe(160);
    expect(boxOf(container).scrollWidth).toBeLessThanOrEqual(160);
  });

  it("drops visual styles but keeps layout and focus with unstyled", async () => {
    const container = render(field({ unstyled: true, defaultValue: "cors" }));
    expect(style(boxOf(container)).borderTopStyle).toBe("none");
    expect(style(boxOf(container)).display).toBe("flex");
    await userEvent.tab();
    expect(style(boxOf(container)).outlineStyle).toBe("solid");
  });

  it("forwards its ref to the input, for a shortcut that focuses it", () => {
    const ref = createRef<HTMLInputElement>();
    const container = render(<SearchField ref={ref} label="Search guides" />);
    expect(ref.current).toBe(inputOf(container));
    act(() => ref.current?.focus());
    expect(document.activeElement).toBe(inputOf(container));
  });
});
