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
  it("stays above stage content stacked high, with Cancel on top and clickable", async () => {
    const onCancel = vi.fn();
    const container = render(
      <ProgressOverlay open title="Exporting" onCancel={onCancel}>
        <div style={{ blockSize: "20rem", position: "relative" }}>
          <div
            className="high"
            style={{ position: "absolute", inset: 0, zIndex: 10, background: "black" }}
          />
        </div>
      </ProgressOverlay>,
    );
    const cancel = container.querySelector(".hm-progress-overlay-cancel") as HTMLElement;
    const card = container.querySelector(".hm-progress-overlay-card") as HTMLElement;
    const centre = (element: Element) => {
      const box = element.getBoundingClientRect();
      return [box.x + box.width / 2, box.y + box.height / 2] as const;
    };

    expect(
      document.elementFromPoint(...centre(cancel))?.closest(".hm-progress-overlay-cancel"),
    ).toBe(cancel);
    expect(document.elementFromPoint(...centre(card))?.closest(".hm-progress-overlay-card")).toBe(
      card,
    );
    await userEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("speaks the title when it opens and the detail when it changes, not the bar", () => {
    const container = render(<ProgressOverlay open={false} title="Exporting" value={10} />);
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status.closest("[aria-busy]")).toBeNull();
    expect(status.textContent).toBe("");

    rerender(<ProgressOverlay open title="Exporting" value={10} />);
    expect(status.textContent).toBe("Exporting");
    rerender(<ProgressOverlay open title="Exporting" value={60} />);
    expect(status.textContent).toBe("Exporting");
    rerender(<ProgressOverlay open title="Exporting" value={60} detail="Writing the file" />);
    expect(status.textContent).toBe("Exporting. Writing the file");
  });

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
