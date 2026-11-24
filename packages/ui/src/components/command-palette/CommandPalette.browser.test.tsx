import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { AnnouncerProvider } from "../announcer/Announcer.js";
import { Button } from "../button/Button.js";
import { CommandPalette, type CommandPaletteItem } from "./CommandPalette.js";

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

const items: CommandPaletteItem[] = [
  { id: "crop", label: "Crop", description: "Cut the edges off", shortcut: "C" },
  { id: "rotate-left", label: "Rotate left", group: "Orientation" },
  { id: "rotate-right", label: "Rotate right", group: "Orientation", disabled: true },
  { id: "draw", label: "Draw" },
];

function Host({ onRun }: { onRun: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <AnnouncerProvider>
      <Button onClick={() => setOpen(true)}>Open</Button>
      <CommandPalette open={open} onOpenChange={setOpen} items={items} onRun={onRun} />
    </AnnouncerProvider>
  );
}

async function open(onRun = vi.fn()) {
  const container = mount("");
  act(() => {
    root = createRoot(container);
    root.render(<Host onRun={onRun} />);
  });
  const opener = container.querySelector("button") as HTMLButtonElement;
  await userEvent.click(opener);
  const dialog = container.querySelector("dialog") as HTMLDialogElement;
  await vi.waitFor(() => expect(dialog.open).toBe(true));
  const input = dialog.querySelector('[role="combobox"]') as HTMLInputElement;
  return { container, dialog, input, opener, onRun };
}

const activeLabel = (input: HTMLInputElement): string | null | undefined => {
  const id = input.getAttribute("aria-activedescendant");
  return id
    ? document.getElementById(id)?.querySelector(".hm-command-palette-label")?.textContent
    : null;
};

describe("CommandPalette", () => {
  it("opens with focus in an empty combobox that controls its listbox", async () => {
    const { input, dialog } = await open();

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(input.getAttribute("aria-controls") ?? "")?.getAttribute("role"),
    ).toBe("listbox");
    expect(dialog.querySelectorAll('[role="option"]')).toHaveLength(4);
    expect(activeLabel(input)).toBe("Crop");
  });

  it("describes each option by its description, group and shortcut", async () => {
    const { dialog } = await open();
    const crop = dialog.querySelector('[role="option"]') as HTMLElement;
    const description = document.getElementById(crop.getAttribute("aria-describedby") ?? "");

    expect(description?.textContent).toBe("Cut the edges offC");
  });

  it("moves the active option with the arrow keys, Home and End, wrapping round", async () => {
    const { input } = await open();

    await userEvent.keyboard("{ArrowDown}");
    expect(activeLabel(input)).toBe("Rotate left");
    await userEvent.keyboard("{End}");
    expect(activeLabel(input)).toBe("Draw");
    await userEvent.keyboard("{ArrowDown}");
    expect(activeLabel(input)).toBe("Crop");
    await userEvent.keyboard("{ArrowUp}");
    expect(activeLabel(input)).toBe("Draw");
    await userEvent.keyboard("{Home}");
    expect(activeLabel(input)).toBe("Crop");
    expect(document.activeElement).toBe(input);
  });

  it("filters as you type, announces the count, and says when nothing matches", async () => {
    const { input, dialog } = await open();

    await userEvent.keyboard("rot");
    expect(
      [...dialog.querySelectorAll(".hm-command-palette-label")].map((e) => e.textContent),
    ).toEqual(["Rotate left", "Rotate right"]);
    expect(activeLabel(input)).toBe("Rotate left");
    await vi.waitFor(() =>
      expect(document.querySelector('.hm-announcer [role="status"]')?.textContent).toBe(
        "2 results",
      ),
    );

    await userEvent.keyboard("zzz");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    expect(dialog.querySelector(".hm-command-palette-empty")?.textContent).toBe("No tools match.");
  });

  it("runs the active option on Enter, closes and returns focus to the opener", async () => {
    const { input, dialog, opener, onRun } = await open();

    await userEvent.keyboard("draw{Enter}");

    expect(onRun).toHaveBeenCalledWith("draw");
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(document.activeElement).toBe(opener);
    expect(input.isConnected).toBe(false);
  });

  it("lists a disabled option but doesn't run it", async () => {
    const { input, dialog, onRun } = await open();

    await userEvent.keyboard("rotate right");
    expect(activeLabel(input)).toBe("Rotate right");
    expect(dialog.querySelector('[aria-selected="true"]')?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    await userEvent.keyboard("{Enter}");

    expect(onRun).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("runs an option on click", async () => {
    const { dialog, onRun } = await open();

    await userEvent.click(dialog.querySelectorAll('[role="option"]')[1] as HTMLElement);

    expect(onRun).toHaveBeenCalledWith("rotate-left");
    await vi.waitFor(() => expect(dialog.open).toBe(false));
  });

  it("closes on Escape, and starts empty when it opens again", async () => {
    const { input, dialog, opener } = await open();

    await userEvent.keyboard("draw{Escape}");
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    expect(document.activeElement).toBe(opener);
    expect(input.value).toBe("draw");

    await userEvent.click(opener);
    await vi.waitFor(() => expect(dialog.open).toBe(true));
    const again = dialog.querySelector('[role="combobox"]') as HTMLInputElement;
    expect(again.value).toBe("");
    expect(dialog.querySelectorAll('[role="option"]')).toHaveLength(4);
  });
});
