import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { ThemeToggle } from "./ThemeToggle.js";

let root: Root | undefined;

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await loadStyles();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  cleanUp();
});

/** Renders the toggle inside a container, and returns both. */
function render(value: "system" | "light" | "dark" | "inherit", onValueChange = vi.fn()) {
  const container = mount("");
  const ref = createRef<HTMLButtonElement>();
  act(() => {
    root = createRoot(container);
    root.render(<ThemeToggle ref={ref} value={value} onValueChange={onValueChange} />);
  });
  return { container, button: () => ref.current as HTMLButtonElement, onValueChange };
}

/** Lets the mutation observer's callback run, and React apply what it read. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("ThemeToggle inheriting its page's theme", () => {
  it("shows the theme its element inherits, and follows an ancestor's data-hm-theme", async () => {
    document.documentElement.setAttribute("data-hm-theme", "dark");
    const { container, button } = render("inherit");
    await settle();
    expect(button().getAttribute("aria-pressed")).toBe("true");

    // A closer ancestor wins, and a change to it is seen.
    container.setAttribute("data-hm-theme", "light");
    await settle();
    expect(button().getAttribute("aria-pressed")).toBe("false");
    document.documentElement.setAttribute("data-hm-theme", "light");
    container.setAttribute("data-hm-theme", "dark");
    await settle();
    expect(button().getAttribute("aria-pressed")).toBe("true");
  });

  it("follows the system when no ancestor chooses, and switches to the other theme", async () => {
    const system = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const { button, onValueChange } = render("inherit");
    await settle();
    expect(button().getAttribute("aria-pressed")).toBe(String(system));
    act(() => button().click());
    expect(onValueChange).toHaveBeenCalledWith(system ? "light" : "dark");
  });

  it("keeps a chosen theme whatever the page's", async () => {
    document.documentElement.setAttribute("data-hm-theme", "dark");
    const { button } = render("light");
    await settle();
    expect(button().getAttribute("aria-pressed")).toBe("false");
  });
});

describe("ThemeToggle's ref", () => {
  it("runs the cleanup a host's callback ref returns when it unmounts, and gives a plain one null", () => {
    const container = mount("");
    const cleanup = vi.fn();
    const withCleanup = vi.fn((_: HTMLButtonElement | null) => cleanup);
    const plain = vi.fn();
    act(() => {
      root = createRoot(container);
      root.render(
        <>
          <ThemeToggle ref={withCleanup} value="light" onValueChange={() => {}} />
          <ThemeToggle ref={plain} value="light" onValueChange={() => {}} />
        </>,
      );
    });
    expect(withCleanup).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
    act(() => root?.unmount());
    root = undefined;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(withCleanup).not.toHaveBeenCalledWith(null);
    expect(plain).toHaveBeenLastCalledWith(null);
  });
});
