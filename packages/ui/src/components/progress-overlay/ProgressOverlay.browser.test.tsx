import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { ProgressOverlay } from "./ProgressOverlay.js";

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

function Stage({ open, onCancel }: { open: boolean; onCancel?: () => void }): ReactElement {
  return (
    <ProgressOverlay
      open={open}
      title="Exporting"
      detail="Encoding on this device"
      value={30}
      onCancel={onCancel}
    >
      <button type="button">Rotate</button>
    </ProgressOverlay>
  );
}

function render(element: ReactElement): HTMLElement {
  const container = mount("");
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

const rerender = (element: ReactElement): void => {
  act(() => root?.render(element));
};

describe("ProgressOverlay", () => {
  it("makes the content inert while open, and moves focus from it to Cancel", () => {
    const onCancel = vi.fn();
    const container = render(<Stage open={false} onCancel={onCancel} />);
    const content = container.querySelector(".hm-progress-overlay-content") as HTMLElement;
    const rotate = container.querySelector("button") as HTMLButtonElement;
    rotate.focus();

    rerender(<Stage open onCancel={onCancel} />);

    expect(content.inert).toBe(true);
    const cancel = container.querySelector(".hm-progress-overlay-cancel") as HTMLButtonElement;
    expect(document.activeElement).toBe(cancel);
    const card = container.querySelector('[role="group"]') as HTMLElement;
    expect(document.getElementById(card.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(
      "Exporting",
    );
  });

  it("covers the content, so a click can't reach it", async () => {
    const container = render(<Stage open />);
    const scrim = container.querySelector(".hm-progress-overlay-scrim") as HTMLElement;
    const rotate = container.querySelector(".hm-progress-overlay-content button") as HTMLElement;
    const box = rotate.getBoundingClientRect();

    expect(
      document.elementFromPoint(box.x + 1, box.y + 1)?.closest(".hm-progress-overlay-scrim"),
    ).toBe(scrim);
  });

  it("cancels with its button", async () => {
    const onCancel = vi.fn();
    const container = render(<Stage open onCancel={onCancel} />);

    await userEvent.click(container.querySelector(".hm-progress-overlay-cancel") as HTMLElement);

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("focuses the card without a Cancel button", () => {
    const container = render(<Stage open={false} />);
    (container.querySelector("button") as HTMLButtonElement).focus();

    rerender(<Stage open />);

    expect(document.activeElement).toBe(container.querySelector('[role="group"]'));
  });

  it("returns focus where it was when it closes, and leaves the content usable", () => {
    const container = render(<Stage open={false} onCancel={() => {}} />);
    const rotate = container.querySelector("button") as HTMLButtonElement;
    rotate.focus();
    rerender(<Stage open onCancel={() => {}} />);

    rerender(<Stage open={false} onCancel={() => {}} />);

    expect(document.activeElement).toBe(rotate);
    expect((container.querySelector(".hm-progress-overlay-content") as HTMLElement).inert).toBe(
      false,
    );
    expect(container.querySelector(".hm-progress-overlay-scrim")).toBeNull();
  });

  it("leaves focus alone when it opens while focus is elsewhere", () => {
    const outside = mount('<button type="button">Outside</button>').querySelector(
      "button",
    ) as HTMLElement;
    render(<Stage open={false} />);
    outside.focus();

    rerender(<Stage open />);

    expect(document.activeElement).toBe(outside);
  });
});
