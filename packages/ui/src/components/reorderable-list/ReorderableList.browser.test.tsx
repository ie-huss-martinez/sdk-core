import { act, createRef, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount, track } from "../../test/dom.js";
import { AnnouncerProvider } from "../announcer/Announcer.js";
import { ToggleButton } from "../toggle-button/ToggleButton.js";
import {
  focusReorderableListItem,
  ReorderableList,
  ReorderableListItem,
} from "./ReorderableList.js";

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
  window.scrollTo(0, 0);
});

function render(element: React.ReactElement): HTMLElement {
  const container = mount("");
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

interface Calls {
  onSelectedChange?: (id: string) => void;
  onMove?: (id: string, toIndex: number) => void;
  onRemove?: (id: string) => void;
}

/** A layers list that applies what the list asks for, as an editor's session would. */
function Layers({
  calls = {},
  refuse = false,
  readOnly = false,
  announceMoves,
  first = ["Title", "Photo", "Shape", "Background"],
}: {
  calls?: Calls;
  refuse?: boolean;
  readOnly?: boolean;
  announceMoves?: boolean;
  first?: string[];
}) {
  const [layers, setLayers] = useState(first);
  const [selected, setSelected] = useState<string | null>(first[1] ?? null);
  const [hidden, setHidden] = useState<string[]>([]);
  return (
    <AnnouncerProvider>
      <button type="button">Before</button>
      <ReorderableList
        label="Layers"
        selectedId={selected}
        announceMoves={announceMoves}
        onSelectedChange={(id) => {
          calls.onSelectedChange?.(id);
          setSelected(id);
        }}
        onMove={
          readOnly
            ? undefined
            : (id, toIndex) => {
                calls.onMove?.(id, toIndex);
                if (!refuse) {
                  setLayers((order) => {
                    const next = order.filter((layer) => layer !== id);
                    next.splice(toIndex, 0, id);
                    return next;
                  });
                }
              }
        }
        onRemove={
          readOnly
            ? undefined
            : (id) => {
                calls.onRemove?.(id);
                setLayers((order) => order.filter((layer) => layer !== id));
              }
        }
      >
        {layers.map((layer) => (
          <ReorderableListItem
            key={layer}
            id={layer}
            label={layer}
            controls={[
              <ToggleButton
                key="visible"
                variant="quiet"
                pressed={!hidden.includes(layer)}
                onPressedChange={(visible) =>
                  setHidden((ids) => (visible ? ids.filter((id) => id !== layer) : [...ids, layer]))
                }
              >
                Visible
              </ToggleButton>,
            ]}
          >
            {layer}
          </ReorderableListItem>
        ))}
      </ReorderableList>
      <label>
        Name
        <input type="text" />
      </label>
      <button type="button">After</button>
    </AnnouncerProvider>
  );
}

/** A list whose selection changes from outside it, as from an editor's stage. */
function Outside() {
  const [selectedId, setSelectedId] = useState("a");
  return (
    <>
      <button type="button" onClick={() => setSelectedId("b")}>
        Select b
      </button>
      <ReorderableList label="Layers" selectedId={selectedId}>
        <ReorderableListItem id="a" label="A">
          A
        </ReorderableListItem>
        <ReorderableListItem id="b" label="B">
          B
        </ReorderableListItem>
      </ReorderableList>
    </>
  );
}

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[role="row"]')].map((row) => row.dataset["hmId"]);
const item = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-hm-id="${id}"] [data-hm-cell="item"]`) as HTMLElement;
const toggle = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-hm-id="${id}"] button`) as HTMLElement;
const grid = (container: HTMLElement) => container.querySelector('[role="grid"]') as HTMLElement;

/** Focuses an item from outside the list, as a host does: it's selected too. */
const enter = (container: HTMLElement, id: string) => {
  act(() => {
    focusReorderableListItem(grid(container), id);
  });
};

/**
 * Reaches a cell as a keyboard user does: in at the Tab stop, then Ctrl
 * with the arrows, which don't select, and → to the control's cell.
 */
async function reach(container: HTMLElement, id: string, cell: "item" | "control" = "item") {
  const stop = grid(container).querySelector<HTMLElement>("[data-hm-tab-stop]") as HTMLElement;
  act(() => stop.focus());
  const order = rows(container);
  const from = order.indexOf(stop.closest<HTMLElement>("[data-hm-id]")?.dataset["hmId"]);
  const to = order.indexOf(id);
  const key = to > from ? "{ArrowDown}" : "{ArrowUp}";
  for (let step = 0; step < Math.abs(to - from); step += 1) {
    await userEvent.keyboard(`{Control>}${key}{/Control}`);
  }
  if (cell === "control") {
    await userEvent.keyboard("{ArrowRight}");
  }
}

/** A toggle that keeps its own state: pressing it renders only the toggle, not the list. */
function OwnToggle() {
  const [on, setOn] = useState(true);
  return (
    <button type="button" aria-label="Locked" aria-pressed={on} onClick={() => setOn(!on)}>
      L
    </button>
  );
}

/** A control's cell, which takes focus in its place (docs/adr/0009, #202). */
const controlCell = (container: HTMLElement, id: string) =>
  toggle(container, id).closest('[data-hm-cell="control"]') as HTMLElement;
const selected = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[role="row"][aria-selected="true"]')?.dataset["hmId"];
const tabStops = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>('[role="grid"] [tabindex="0"]')].map(
    (element) => element.closest<HTMLElement>("[data-hm-id]")?.dataset["hmId"],
  );

/**
 * Presses a key on the focused element, and reports whether its default was
 * prevented and whether the page scrolled. The page is taller than the
 * window, so a key the list didn't take would scroll it.
 */
async function press(keys: string): Promise<{ prevented: boolean; scrolled: boolean }> {
  if (!document.querySelector("[data-tall]")) {
    const tall = track(document.createElement("div"));
    tall.dataset["tall"] = "";
    tall.style.height = "300vh";
    document.body.append(tall);
  }
  window.scrollTo(0, 0);
  let prevented = false;
  const seen = (event: KeyboardEvent) => {
    prevented = event.defaultPrevented;
  };
  window.addEventListener("keydown", seen);
  await userEvent.keyboard(keys);
  window.removeEventListener("keydown", seen);
  // Smooth scrolling starts within a frame or two.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { prevented, scrolled: window.scrollY !== 0 };
}

describe("ReorderableList", () => {
  it("is a named grid of rows, with the selected row marked and each control in a cell", async () => {
    render(<Layers />);
    const grid = page.getByRole("grid", { name: "Layers" });
    await expect.element(grid).toBeVisible();
    expect(grid.getByRole("row").elements()).toHaveLength(4);
    await expect
      .element(grid.getByRole("row", { selected: true }))
      .toHaveAttribute("data-hm-id", "Photo");
    await expect.element(grid.getByRole("gridcell", { name: "Title", exact: true })).toBeVisible();
    expect(grid.getByRole("button", { name: "Visible", pressed: true }).elements()).toHaveLength(4);
  });

  it("has one Tab stop, on the selected item, and Tab leaves the list", async () => {
    const container = render(<Layers />);
    expect(tabStops(container)).toEqual(["Photo"]);
    (page.getByRole("button", { name: "Before" }).element() as HTMLElement).focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(item(container, "Photo"));
    await userEvent.tab();
    expect(document.activeElement).toBe(container.querySelector("input"));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(item(container, "Photo"));
  });

  it("takes the first item as the Tab stop when nothing is selected", () => {
    const container = render(
      <ReorderableList label="Layers">
        <ReorderableListItem id="a" label="A">
          A
        </ReorderableListItem>
        <ReorderableListItem id="b" label="B">
          B
        </ReorderableListItem>
      </ReorderableList>,
    );
    expect(tabStops(container)).toEqual(["a"]);
    expect(selected(container)).toBeUndefined();
  });

  it("moves between rows with ↑ and ↓ and selects, without wrapping", async () => {
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onSelectedChange }} />);
    item(container, "Photo").focus();
    expect(await press("{ArrowDown}")).toEqual({ prevented: true, scrolled: false });
    expect(document.activeElement).toBe(item(container, "Shape"));
    expect(selected(container)).toBe("Shape");
    await press("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(item(container, "Title"));
    // At the first row the key is still taken, and nothing changes.
    expect(await press("{ArrowUp}")).toEqual({ prevented: true, scrolled: false });
    expect(document.activeElement).toBe(item(container, "Title"));
    expect(onSelectedChange.mock.calls).toEqual([["Shape"], ["Photo"], ["Title"]]);
    expect(tabStops(container)).toEqual(["Title"]);
  });

  it("moves without selecting with Ctrl or ⌘ and an arrow, Home or End", async () => {
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onSelectedChange }} />);
    item(container, "Photo").focus();
    expect(await press("{Control>}{ArrowDown}{/Control}")).toEqual({
      prevented: true,
      scrolled: false,
    });
    expect(document.activeElement).toBe(item(container, "Shape"));
    await press("{Meta>}{ArrowUp}{/Meta}");
    expect(document.activeElement).toBe(item(container, "Photo"));
    expect(await press("{Control>}{End}{/Control}")).toEqual({ prevented: true, scrolled: false });
    expect(document.activeElement).toBe(item(container, "Background"));
    await press("{Control>}{Home}{/Control}");
    expect(document.activeElement).toBe(item(container, "Title"));
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(selected(container)).toBe("Photo");

    // Space selects the focused item.
    expect(await press(" ")).toEqual({ prevented: true, scrolled: false });
    expect(selected(container)).toBe("Title");
    await press("{Control>}{ArrowDown}{ArrowDown}{/Control}{Enter}");
    expect(selected(container)).toBe("Shape");
  });

  it("moves between a row's cells with ←, →, Home and End, and never changes the selection", async () => {
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onSelectedChange }} />);
    // A host focusing an item selects its row.
    enter(container, "Title");
    expect(onSelectedChange.mock.calls).toEqual([["Title"]]);
    onSelectedChange.mockClear();
    expect(await press("{ArrowRight}")).toEqual({ prevented: true, scrolled: false });
    expect(document.activeElement).toBe(controlCell(container, "Title"));
    // The same cell in the next row.
    await press("{Control>}{ArrowDown}{/Control}");
    expect(document.activeElement).toBe(controlCell(container, "Photo"));
    await press("{ArrowLeft}");
    expect(document.activeElement).toBe(item(container, "Photo"));
    await press("{End}");
    expect(document.activeElement).toBe(controlCell(container, "Photo"));
    await press("{Home}");
    expect(document.activeElement).toBe(item(container, "Photo"));
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(tabStops(container)).toEqual(["Photo"]);
  });

  it("follows the reading direction with ← and →", async () => {
    const container = render(
      <div dir="rtl">
        <Layers />
      </div>,
    );
    enter(container, "Title");
    await press("{ArrowLeft}");
    expect(document.activeElement).toBe(controlCell(container, "Title"));
    await press("{ArrowRight}");
    expect(document.activeElement).toBe(item(container, "Title"));
  });

  it("leaves Space and Enter on a control to the control", async () => {
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onSelectedChange }} />);
    await reach(container, "Title", "control");
    await userEvent.keyboard(" ");
    expect(toggle(container, "Title").getAttribute("aria-pressed")).toBe("false");
    await userEvent.keyboard("{Enter}");
    expect(toggle(container, "Title").getAttribute("aria-pressed")).toBe("true");
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it("keeps focus on a control's cell, named after the control and its state, never on the control", async () => {
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onSelectedChange }} />);
    enter(container, "Title");
    onSelectedChange.mockClear();
    await press("{ArrowRight}");
    const cell = controlCell(container, "Title");
    expect(document.activeElement).toBe(cell);
    expect(cell.getAttribute("role")).toBe("gridcell");
    expect(cell.getAttribute("aria-label")).toBe("Visible, pressed");
    // The control is part of its cell: never a Tab stop of its own.
    expect(toggle(container, "Title").tabIndex).toBe(-1);
    expect(await press(" ")).toEqual({ prevented: true, scrolled: false });
    expect(toggle(container, "Title").getAttribute("aria-pressed")).toBe("false");
    await vi.waitFor(() => expect(cell.getAttribute("aria-label")).toBe("Visible, not pressed"));
    expect(document.activeElement).toBe(cell);
    await press("{Enter}");
    expect(toggle(container, "Title").getAttribute("aria-pressed")).toBe("true");
    await vi.waitFor(() => expect(cell.getAttribute("aria-label")).toBe("Visible, pressed"));
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it("names a control's cell after the elements that label the control", async () => {
    const container = render(
      <ReorderableList label="Layers">
        <ReorderableListItem
          id="a"
          label="A"
          controls={[
            <span key="lock">
              <span id="lock-a">Lock</span>
              <button type="button" aria-pressed="true" aria-labelledby="lock-a">
                <svg aria-hidden="true" />
              </button>
            </span>,
          ]}
        >
          A
        </ReorderableListItem>
      </ReorderableList>,
    );
    await vi.waitFor(() =>
      expect(container.querySelector('[data-hm-cell="control"]')?.getAttribute("aria-label")).toBe(
        "Lock, pressed",
      ),
    );
  });

  it("keeps a control's cell named after its state when the control changes it alone", async () => {
    const container = render(
      <ReorderableList label="Layers" selectedId="a">
        <ReorderableListItem id="a" label="A" controls={[<OwnToggle key="own" />]}>
          A
        </ReorderableListItem>
      </ReorderableList>,
    );
    const cell = container.querySelector('[data-hm-cell="control"]') as HTMLElement;
    await vi.waitFor(() => expect(cell.getAttribute("aria-label")).toBe("Locked, pressed"));
    act(() => item(container, "a").focus());
    await press("{ArrowRight}");
    await press(" ");
    await vi.waitFor(() => expect(cell.getAttribute("aria-label")).toBe("Locked, not pressed"));
  });

  it("names a native checkbox's cell after its checkedness, and follows it", async () => {
    const container = render(
      <ReorderableList label="Layers" selectedId="a">
        <ReorderableListItem
          id="a"
          label="A"
          controls={[<input key="on" type="checkbox" aria-label="Shown" defaultChecked />]}
        >
          A
        </ReorderableListItem>
      </ReorderableList>,
    );
    const cell = container.querySelector('[data-hm-cell="control"]') as HTMLElement;
    await vi.waitFor(() => expect(cell.getAttribute("aria-label")).toBe("Shown, checked"));
    act(() => item(container, "a").focus());
    await press("{ArrowRight}");
    await press(" ");
    expect((container.querySelector("input") as HTMLInputElement).checked).toBe(false);
    await vi.waitFor(() => expect(cell.getAttribute("aria-label")).toBe("Shown, not checked"));
  });

  it("leaves Escape in a text field to the field when it takes it", async () => {
    const container = render(
      <ReorderableList label="Layers" selectedId="a">
        <ReorderableListItem
          id="a"
          label="A"
          controls={[
            <input
              key="name"
              aria-label="Name"
              onKeyDown={(event) => {
                if (event.key === "Escape") event.preventDefault();
              }}
            />,
          ]}
        >
          A
        </ReorderableListItem>
      </ReorderableList>,
    );
    const field = container.querySelector("input") as HTMLInputElement;
    await userEvent.click(field);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(field);
  });

  it("lets a text field among a row's controls be typed into, and Escape returns to its cell", async () => {
    const onRemove = vi.fn();
    const container = render(
      <ReorderableList label="Layers" selectedId="a" onRemove={onRemove}>
        <ReorderableListItem
          id="a"
          label="A"
          controls={[<input key="name" aria-label="Name" defaultValue="" />]}
        >
          A
        </ReorderableListItem>
      </ReorderableList>,
    );
    const field = container.querySelector("input") as HTMLInputElement;
    const cell = field.closest('[data-hm-cell="control"]') as HTMLElement;
    // A press puts focus in the field, which keeps it.
    await userEvent.click(field);
    expect(document.activeElement).toBe(field);
    await userEvent.keyboard("ab{Backspace}{Delete}c");
    expect(field.value).toBe("ac");
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(cell);
    // From the cell, Enter goes back into the field.
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(field);
  });

  it("hands focus from a clicked control to its cell, without selecting the row", async () => {
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onSelectedChange }} />);
    await userEvent.click(toggle(container, "Shape"));
    expect(document.activeElement).toBe(controlCell(container, "Shape"));
    expect(onSelectedChange).not.toHaveBeenCalled();
    // Alt with an arrow still reaches the list from there.
    expect(await press("{Alt>}{ArrowUp}{/Alt}")).toEqual({ prevented: true, scrolled: false });
  });

  it("selects a row on a click, but not on a click on its control", async () => {
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onSelectedChange }} />);
    await userEvent.click(toggle(container, "Shape"));
    expect(toggle(container, "Shape").getAttribute("aria-pressed")).toBe("false");
    expect(onSelectedChange).not.toHaveBeenCalled();
    await userEvent.click(item(container, "Shape"));
    expect(onSelectedChange.mock.calls).toEqual([["Shape"]]);
    expect(document.activeElement).toBe(item(container, "Shape"));
    expect(tabStops(container)).toEqual(["Shape"]);
  });

  it("moves the focused item with Alt and ↑ or ↓, keeps focus on it, and announces it", async () => {
    const onMove = vi.fn();
    const container = render(<Layers calls={{ onMove }} />);
    item(container, "Photo").focus();
    expect(await press("{Alt>}{ArrowDown}{/Alt}")).toEqual({ prevented: true, scrolled: false });
    expect(onMove.mock.calls).toEqual([["Photo", 2]]);
    expect(rows(container)).toEqual(["Title", "Shape", "Photo", "Background"]);
    expect(document.activeElement).toBe(item(container, "Photo"));
    await expect.element(page.getByText("Photo moved to position 3 of 4")).toBeInTheDocument();

    // From a control, focus stays on that row's control.
    toggle(container, "Photo").focus();
    await press("{Alt>}{ArrowUp}{ArrowUp}{/Alt}");
    expect(rows(container)).toEqual(["Photo", "Title", "Shape", "Background"]);
    expect(document.activeElement).toBe(controlCell(container, "Photo"));
    expect(tabStops(container)).toEqual(["Photo"]);
  });

  it("takes the move keys at the first and last rows, without calling onMove", async () => {
    const onMove = vi.fn();
    const container = render(<Layers calls={{ onMove }} />);
    enter(container, "Title");
    expect(await press("{Alt>}{ArrowUp}{/Alt}")).toEqual({ prevented: true, scrolled: false });
    item(container, "Background").focus();
    expect(await press("{Alt>}{ArrowDown}{/Alt}")).toEqual({ prevented: true, scrolled: false });
    expect(onMove).not.toHaveBeenCalled();
    expect(rows(container)).toEqual(["Title", "Photo", "Shape", "Background"]);
  });

  it("doesn't announce a move the host refused, or with announceMoves off", async () => {
    const container = render(<Layers refuse />);
    item(container, "Photo").focus();
    await press("{Alt>}{ArrowDown}{/Alt}");
    expect(rows(container)).toEqual(["Title", "Photo", "Shape", "Background"]);
    expect(document.body.textContent).not.toContain("moved to position");

    act(() => root?.render(<Layers key="quiet" announceMoves={false} />));
    item(container, "Photo").focus();
    await press("{Alt>}{ArrowDown}{/Alt}");
    expect(rows(container)).toEqual(["Title", "Shape", "Photo", "Background"]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(document.body.textContent).not.toContain("moved to position");
  });

  it("doesn't pull focus back after a refused move, once the user has gone elsewhere", async () => {
    const container = render(<Layers refuse />);
    item(container, "Photo").focus();
    await press("{Alt>}{ArrowDown}{/Alt}");
    // The user leaves; then the list renders in another order for its own reasons.
    const after = page.getByRole("button", { name: "After" }).element() as HTMLElement;
    after.focus();
    act(() => root?.render(<Layers key="other" first={["Photo", "Title"]} />));
    expect(document.activeElement?.textContent).not.toBe("Photo");
    expect(container.querySelector('[role="grid"]')?.contains(document.activeElement)).toBe(false);
  });

  it("removes the focused item with Delete or Backspace, and focuses the row that takes its place", async () => {
    const onRemove = vi.fn();
    const container = render(<Layers calls={{ onRemove }} />);
    item(container, "Photo").focus();
    expect(await press("{Delete}")).toEqual({ prevented: true, scrolled: false });
    expect(onRemove.mock.calls).toEqual([["Photo"]]);
    expect(rows(container)).toEqual(["Title", "Shape", "Background"]);
    expect(document.activeElement).toBe(item(container, "Shape"));
    // The row that took its place is selected, as focus on an item selects:
    // the list put focus there, not an entry from outside.
    expect(selected(container)).toBe("Shape");

    // The last row's place is taken by the new last row; from a control, its control.
    toggle(container, "Background").focus();
    expect(await press("{Backspace}")).toEqual({ prevented: true, scrolled: false });
    expect(rows(container)).toEqual(["Title", "Shape"]);
    expect(document.activeElement).toBe(controlCell(container, "Shape"));
    expect(tabStops(container)).toEqual(["Shape"]);
  });

  it("takes no move or remove key without onMove and onRemove", async () => {
    const container = render(<Layers readOnly />);
    item(container, "Photo").focus();
    expect((await press("{Delete}")).prevented).toBe(false);
    expect((await press("{Alt>}{ArrowDown}{/Alt}")).prevented).toBe(false);
    expect(rows(container)).toEqual(["Title", "Photo", "Shape", "Background"]);
  });

  it("takes no key with Shift or another modifier, in a text field, or outside the list", async () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    const onSelectedChange = vi.fn();
    const container = render(<Layers calls={{ onMove, onRemove, onSelectedChange }} />);
    item(container, "Photo").focus();
    for (const keys of [
      "{Shift>}{ArrowDown}{/Shift}",
      "{Shift>}{Delete}{/Shift}",
      "{Alt>}{Control>}{ArrowDown}{/Control}{/Alt}",
      "{Alt>}{ArrowLeft}{/Alt}",
      "{Control>}{Delete}{/Control}",
    ]) {
      expect((await press(keys)).prevented, keys).toBe(false);
    }
    const field = container.querySelector("input") as HTMLInputElement;
    field.focus();
    for (const keys of ["{Alt>}{ArrowDown}{/Alt}", "{Delete}", "{ArrowDown}"]) {
      expect((await press(keys)).prevented, keys).toBe(false);
    }
    expect(onMove).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);
  });

  it("moves the Tab stop to a row selected from outside, while focus is elsewhere", () => {
    const container = render(<Outside />);
    expect(tabStops(container)).toEqual(["a"]);
    act(() => container.querySelector("button")?.click());
    expect(tabStops(container)).toEqual(["b"]);
  });

  it("forwards refs to the grid and to a row", () => {
    const list = createRef<HTMLDivElement>();
    const row = createRef<HTMLDivElement>();
    render(
      <ReorderableList label="Layers" ref={list}>
        <ReorderableListItem id="a" label="A" ref={row}>
          A
        </ReorderableListItem>
      </ReorderableList>,
    );
    expect(list.current?.getAttribute("role")).toBe("grid");
    expect(row.current?.getAttribute("role")).toBe("row");
  });

  it("shows the selected row with a border as well as a colour, and meets the target size", () => {
    const container = render(<Layers />);
    const [first, second] = [...container.querySelectorAll('[role="row"]')] as HTMLElement[];
    expect(getComputedStyle(second as Element).backgroundColor).not.toBe(
      getComputedStyle(first as Element).backgroundColor,
    );
    expect(getComputedStyle(second as Element).borderTopColor).not.toBe(
      getComputedStyle(first as Element).borderTopColor,
    );
    for (const cell of [item(container, "Title"), toggle(container, "Title")]) {
      const box = cell.getBoundingClientRect();
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeGreaterThanOrEqual(24);
    }
  });

  it("shows a focus ring on an item, styled and unstyled", async () => {
    const container = render(
      <>
        <ReorderableList label="Styled" selectedId="a">
          <ReorderableListItem id="a" label="A">
            A
          </ReorderableListItem>
        </ReorderableList>
        <ReorderableList label="Plain" selectedId="b" unstyled>
          <ReorderableListItem id="b" label="B">
            B
          </ReorderableListItem>
        </ReorderableList>
      </>,
    );
    // Keyboard focus, so :focus-visible matches.
    await userEvent.tab();
    expect(document.activeElement).toBe(item(container, "a"));
    expect(getComputedStyle(item(container, "a")).outlineStyle).toBe("solid");
    await userEvent.tab();
    expect(document.activeElement).toBe(item(container, "b"));
    expect(getComputedStyle(item(container, "b")).outlineStyle).toBe("solid");
  });

  it("hydrates without errors or warnings, then takes the controls out of the Tab order", () => {
    const app = <Layers />;
    const container = mount(renderToString(app));
    const consoleError = vi.spyOn(console, "error");
    const recoverable: unknown[] = [];
    act(() => {
      root = hydrateRoot(container, app, { onRecoverableError: (e) => recoverable.push(e) });
    });
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(tabStops(container)).toEqual(["Photo"]);
    expect(toggle(container, "Title").tabIndex).toBe(-1);
  });

  describe("ReorderableList, the selection follows focus", () => {
    it("doesn't select the row Tab enters on, even with nothing selected (#201)", async () => {
      const onSelectedChange = vi.fn();
      const list = (selectedId?: string) => (
        <>
          <button type="button">Before</button>
          <ReorderableList
            label="Layers"
            selectedId={selectedId}
            onSelectedChange={onSelectedChange}
          >
            <ReorderableListItem id="a" label="A">
              A
            </ReorderableListItem>
            <ReorderableListItem id="b" label="B">
              B
            </ReorderableListItem>
          </ReorderableList>
        </>
      );
      const container = render(list());
      const before = container.querySelector("button") as HTMLElement;
      before.focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(item(container, "a"));
      expect(onSelectedChange).not.toHaveBeenCalled();

      // "b" selected while focus is outside the list, as from an editor's
      // stage: the Tab stop follows it, and Tab finds nothing to change.
      before.focus();
      act(() => root?.render(list("b")));
      onSelectedChange.mockClear();
      await userEvent.tab();
      expect(document.activeElement).toBe(item(container, "b"));
      expect(onSelectedChange).not.toHaveBeenCalled();
    });

    it("enters at the Tab stop, without selecting, when focus from outside lands on another cell", () => {
      // As NVDA's browse mode does with Tab, or a host's own focus() (#201).
      const onSelectedChange = vi.fn();
      const container = render(<Layers calls={{ onSelectedChange }} />);
      const before = page.getByRole("button", { name: "Before" }).element() as HTMLElement;
      act(() => before.focus());
      act(() => item(container, "Shape").focus());
      expect(document.activeElement).toBe(item(container, "Photo"));
      act(() => before.focus());
      act(() => toggle(container, "Background").focus());
      expect(document.activeElement).toBe(item(container, "Photo"));
      expect(onSelectedChange).not.toHaveBeenCalled();
      expect(selected(container)).toBe("Photo");
      expect(tabStops(container)).toEqual(["Photo"]);
    });

    it("selects and focuses the item focusReorderableListItem names, from outside", () => {
      const onSelectedChange = vi.fn();
      const container = render(<Layers calls={{ onSelectedChange }} />);
      let focused = false;
      act(() => {
        focused = focusReorderableListItem(grid(container), "Shape");
      });
      expect(focused).toBe(true);
      expect(document.activeElement).toBe(item(container, "Shape"));
      expect(onSelectedChange.mock.calls).toEqual([["Shape"]]);
      expect(focusReorderableListItem(grid(container), "Nothing")).toBe(false);
      expect(focusReorderableListItem(null, "Shape")).toBe(false);
    });

    it("doesn't select a Tab stop that isn't selected when Tab enters on it", async () => {
      const onSelectedChange = vi.fn();
      const container = render(<Layers calls={{ onSelectedChange }} />);
      const before = page.getByRole("button", { name: "Before" }).element() as HTMLElement;
      before.focus();
      await userEvent.tab();
      // Ctrl moves the Tab stop to Shape without selecting it.
      await userEvent.keyboard("{Control>}{ArrowDown}{/Control}");
      expect(tabStops(container)).toEqual(["Shape"]);
      act(() => before.focus());
      await userEvent.tab();
      expect(document.activeElement).toBe(item(container, "Shape"));
      expect(onSelectedChange).not.toHaveBeenCalled();
      expect(selected(container)).toBe("Photo");
    });

    it("keeps the cell a touch presses, however long it's held before focus comes", async () => {
      // On touch, focus arrives when the finger lifts, which can be well over
      // half a second after it pressed.
      const onSelectedChange = vi.fn();
      const container = render(<Layers calls={{ onSelectedChange }} />);
      const before = page.getByRole("button", { name: "Before" }).element() as HTMLElement;
      act(() => before.focus());
      const shape = item(container, "Shape");
      shape.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
      await new Promise((resolve) => setTimeout(resolve, 800));
      act(() => shape.focus());
      shape.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
      expect(document.activeElement).toBe(shape);
      expect(onSelectedChange.mock.calls).toEqual([["Shape"]]);
      // Once the press is over, focus from outside enters at the Tab stop again.
      await new Promise((resolve) => setTimeout(resolve, 0));
      act(() => before.focus());
      act(() => item(container, "Title").focus());
      expect(document.activeElement).toBe(item(container, "Shape"));
    });

    it("keeps the cell a pointer presses, coming from outside", async () => {
      const onSelectedChange = vi.fn();
      const container = render(<Layers calls={{ onSelectedChange }} />);
      (page.getByRole("button", { name: "Before" }).element() as HTMLElement).focus();
      await userEvent.click(item(container, "Shape"));
      expect(document.activeElement).toBe(item(container, "Shape"));
      expect(onSelectedChange.mock.calls).toEqual([["Shape"]]);
    });

    it("still moves between rows without selecting with Ctrl or ⌘", async () => {
      const onSelectedChange = vi.fn();
      const container = render(<Layers calls={{ onSelectedChange }} />);
      act(() => item(container, "Photo").focus());
      expect(onSelectedChange).not.toHaveBeenCalled();
      await userEvent.keyboard("{Control>}{ArrowDown}{/Control}");
      expect(document.activeElement).toBe(item(container, "Shape"));
      expect(onSelectedChange).not.toHaveBeenCalled();
    });

    it("keeps a moved row's selection as it was when focus is put back on it", async () => {
      const onSelectedChange = vi.fn();
      const container = render(<Layers calls={{ onSelectedChange }} />);
      act(() => item(container, "Photo").focus());
      await userEvent.keyboard("{Control>}{ArrowDown}{/Control}");
      await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
      expect(rows(container)).toEqual(["Title", "Shape", "Photo", "Background"]);
      expect(document.activeElement).toBe(item(container, "Shape"));
      expect(onSelectedChange).not.toHaveBeenCalled();
    });
  });
});
