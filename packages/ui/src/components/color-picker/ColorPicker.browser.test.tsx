import { act, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { Field } from "../field/Field.js";
import { ColorPicker, type ColorPickerProps } from "./ColorPicker.js";

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
  delete (window as { EyeDropper?: unknown }).EyeDropper;
});

function render(element: React.ReactElement): HTMLElement {
  const container = mount("");
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

const swatches = [
  { value: "#d92d20", label: "Red" },
  { value: "#1570ef", label: "Blue" },
  { value: "#ffffff", label: "White" },
];

/** A controlled picker in a Field, as an inspector would have. */
function Fill({
  initial = "#1570ef",
  onValueChange,
  onValueCommit,
  ...props
}: Partial<ColorPickerProps> & { initial?: string }) {
  const [fill, setFill] = useState(initial);
  return (
    <Field label="Fill">
      <ColorPicker
        {...props}
        value={fill}
        onValueChange={(value) => {
          setFill(value);
          onValueChange?.(value);
        }}
        onValueCommit={onValueCommit}
      />
    </Field>
  );
}

const slider = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')].find(
    (input) => input.getAttribute("aria-label") === name,
  ) as HTMLInputElement;
const hex = (container: HTMLElement) =>
  container.querySelector(".hm-color-picker-input") as HTMLInputElement;
const textOf = (ids: string | null) =>
  (ids ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");

describe("ColorPicker", () => {
  it("is a group named by its field, with a named slider for each axis", () => {
    const container = render(<Fill />);
    const group = container.querySelector('[role="group"]') as HTMLElement;

    expect(textOf(group.getAttribute("aria-labelledby"))).toBe("Fill");
    expect(textOf(hex(container).getAttribute("aria-labelledby"))).toBe("Fill Hex");
    expect(slider(container, "Saturation").value).toBe("91");
    expect(slider(container, "Saturation").getAttribute("aria-valuetext")).toBe("91 %, blue");
    expect(slider(container, "Brightness").getAttribute("aria-valuetext")).toBe("94 %, blue");
    expect(slider(container, "Hue").getAttribute("aria-valuetext")).toMatch(/^215°, blue$/);
    expect(slider(container, "Opacity")).toBeUndefined();
  });

  it("changes saturation and brightness from the keyboard, committing each key", async () => {
    const changes = vi.fn();
    const commits = vi.fn();
    const container = render(<Fill onValueChange={changes} onValueCommit={commits} />);

    slider(container, "Saturation").focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(slider(container, "Saturation").value).toBe("90");
    slider(container, "Brightness").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(slider(container, "Brightness").value).toBe("93");
    expect(changes).toHaveBeenCalledTimes(2);
    expect(commits.mock.calls).toEqual(changes.mock.calls);
    expect(hex(container).value).toBe(changes.mock.calls[1]?.[0]);
  });

  it("keeps the hue through grey", async () => {
    const container = render(<Fill initial="#808080" />);

    slider(container, "Hue").focus();
    await userEvent.keyboard("{End}");
    expect(hex(container).value).toBe("#808080");
    expect(slider(container, "Hue").value).toBe("359");

    slider(container, "Saturation").focus();
    await userEvent.keyboard("{PageUp}");
    expect(slider(container, "Hue").value).toBe("359");
    expect(slider(container, "Saturation").getAttribute("aria-valuetext")).toMatch(/red$/);
  });

  it("follows the pointer in the area, and commits once, on release", () => {
    const changes = vi.fn();
    const commits = vi.fn();
    const container = render(<Fill onValueChange={changes} onValueCommit={commits} />);
    const area = container.querySelector(".hm-color-picker-area") as HTMLElement;
    const box = area.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: "mouse" };

    act(() => {
      area.dispatchEvent(
        new PointerEvent("pointerdown", {
          ...init,
          clientX: box.left + box.width * 0.25,
          clientY: box.top + box.height * 0.5,
        }),
      );
    });
    expect(slider(container, "Saturation").value).toBe("25");
    expect(slider(container, "Brightness").value).toBe("50");
    expect(document.activeElement).toBe(slider(container, "Saturation"));
    act(() => {
      area.dispatchEvent(
        new PointerEvent("pointermove", {
          ...init,
          clientX: box.left + box.width * 0.75,
          clientY: box.top + box.height * 0.25,
        }),
      );
    });
    expect(commits).not.toHaveBeenCalled();
    act(() => {
      area.dispatchEvent(new PointerEvent("pointerup", { ...init }));
    });

    expect(slider(container, "Saturation").value).toBe("75");
    expect(slider(container, "Brightness").value).toBe("75");
    expect(changes).toHaveBeenCalledTimes(2);
    expect(commits).toHaveBeenCalledOnce();
    expect(commits).toHaveBeenCalledWith(changes.mock.calls[1]?.[0]);
  });

  it("commits typed hex on Enter, goes back for text that isn't a colour, and drops typing on Escape", async () => {
    const commits = vi.fn();
    const container = render(<Fill onValueCommit={commits} />);
    const input = hex(container);

    await userEvent.clear(input);
    await userEvent.type(input, "D92D20{Enter}");
    expect(commits).toHaveBeenLastCalledWith("#d92d20");
    expect(input.value).toBe("#d92d20");

    await userEvent.clear(input);
    await userEvent.type(input, "abc{Escape}");
    expect(input.value).toBe("#d92d20");

    await userEvent.clear(input);
    await userEvent.type(input, "red");
    input.blur();
    await vi.waitFor(() => expect(input.value).toBe("#d92d20"));
    expect(commits).toHaveBeenCalledOnce();
  });

  it("offers swatches and recent colours as named radio groups", async () => {
    const commits = vi.fn();
    const container = render(
      <Fill
        swatches={swatches}
        recentColors={["#12b76a", "not a colour", "#1570ef"]}
        onValueCommit={commits}
      />,
    );
    const [recent, presets] = [...container.querySelectorAll('[role="radiogroup"]')] as [
      HTMLElement,
      HTMLElement,
    ];

    expect(textOf(recent.getAttribute("aria-labelledby"))).toBe("Fill recent colours");
    expect(textOf(presets.getAttribute("aria-labelledby"))).toBe("Fill swatches");
    const recentRadios = recent.querySelectorAll('[role="radio"]');
    expect([...recentRadios].map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "green, #12b76a",
      "blue, #1570ef",
    ]);
    // One Tab stop each: the checked colour.
    expect(recentRadios[1]?.getAttribute("tabindex")).toBe("0");

    (presets.querySelector('[aria-label="Blue"]') as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(hex(container).value).toBe("#ffffff");
    expect(commits).toHaveBeenLastCalledWith("#ffffff");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("White");

    await userEvent.click(recentRadios[0] as HTMLElement);
    expect(commits).toHaveBeenLastCalledWith("#12b76a");
  });

  it("adds an opacity slider and keeps the value as #rrggbbaa with alpha", async () => {
    const changes = vi.fn();
    const container = render(<Fill alpha initial="#1570ef80" onValueChange={changes} />);

    expect(slider(container, "Opacity").value).toBe("50");
    slider(container, "Opacity").focus();
    await userEvent.keyboard("{ArrowRight}");

    expect(changes).toHaveBeenLastCalledWith("#1570ef82");
    expect(hex(container).maxLength).toBe(9);
  });

  it("has only swatches, recent colours and the hex input as a palette", () => {
    const container = render(<Fill variant="palette" swatches={swatches} />);

    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(0);
    expect(container.querySelector(".hm-color-picker-area")).toBeNull();
    expect(hex(container)).not.toBeNull();
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
  });

  it("shows the contrast with contrastWith, rounded down", () => {
    const container = render(
      <>
        <Fill initial="#ffffff" contrastWith="#000000" />
        <Fill initial="#777777" contrastWith="#ffffff" />
      </>,
    );
    const hints = [...container.querySelectorAll(".hm-color-picker-contrast")];

    expect(hints.map((hint) => hint.textContent)).toEqual([
      "Contrast 21:1, enough for text",
      "Contrast 4.4:1, too low for text",
    ]);
  });

  it("offers the eyedropper only where the browser has one", async () => {
    expect(render(<Fill />).querySelector(".hm-color-picker-eye-dropper")).toBeNull();
    act(() => root?.unmount());

    (window as { EyeDropper?: unknown }).EyeDropper = class {
      open() {
        return Promise.resolve({ sRGBHex: "#12B76A" });
      }
    };
    const commits = vi.fn();
    const container = render(<Fill onValueCommit={commits} />);
    const button = container.querySelector(".hm-color-picker-eye-dropper") as HTMLButtonElement;

    expect(button.getAttribute("aria-label")).toBe("Pick a colour from the screen");
    await userEvent.click(button);
    await vi.waitFor(() => expect(commits).toHaveBeenCalledWith("#12b76a"));
    expect(hex(container).value).toBe("#12b76a");
  });

  it("disables every control", () => {
    const container = render(<Fill disabled swatches={swatches} />);

    for (const control of container.querySelectorAll("input, button")) {
      expect((control as HTMLInputElement).disabled, control.outerHTML).toBe(true);
    }
  });

  it("hydrates the server's markup without a mismatch", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const element = <Fill alpha initial="#1570ef80" swatches={swatches} contrastWith="#ffffff" />;
    const container = mount(renderToString(element));

    act(() => {
      root = hydrateRoot(container, element);
    });

    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector(".hm-color-picker-thumb")?.getAttribute("fill")).toBe("#1570ef");
  });
});
