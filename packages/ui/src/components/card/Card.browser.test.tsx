import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { Card } from "./Card.js";

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

function render(element: React.ReactElement): HTMLElement {
  const container = mount("");
  act(() => {
    root = createRoot(container);
    root.render(element);
  });
  return container.querySelector(".hm-card") as HTMLElement;
}

function TestCard({
  onOpen,
  onDelete,
  unstyled,
}: {
  onOpen: () => void;
  onDelete: () => void;
  unstyled?: boolean;
}) {
  return (
    <Card
      unstyled={unstyled}
      style={{ inlineSize: "240px" }}
      title={
        <button type="button" onClick={onOpen}>
          Travel
        </button>
      }
      eyebrow="Guide"
      media={<div style={{ blockSize: "80px" }} data-testid="media" />}
      footer={
        <>
          <span data-testid="tag">Errors</span>
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        </>
      }
    >
      <p data-testid="body">12 notes</p>
    </Card>
  );
}

describe("Card", () => {
  it.each([false, true])(
    "follows its main action from anywhere on the card (unstyled: %s)",
    async (unstyled) => {
      const onOpen = vi.fn();
      const onDelete = vi.fn();
      const card = render(<TestCard onOpen={onOpen} onDelete={onDelete} unstyled={unstyled} />);
      // The main action covers them, so Playwright's check that they receive
      // the click would refuse: the click lands where they are, on the action.
      await userEvent.click(card.querySelector("[data-testid=body]") as HTMLElement, {
        force: true,
      });
      await userEvent.click(card.querySelector("[data-testid=media]") as HTMLElement, {
        force: true,
      });
      // A footer's tags aren't interactive, so they follow the main action too.
      await userEvent.click(card.querySelector("[data-testid=tag]") as HTMLElement, {
        force: true,
      });
      expect(onOpen).toHaveBeenCalledTimes(3);
      expect(onDelete).not.toHaveBeenCalled();
    },
  );

  it("keeps the footer's own actions above the main one", async () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    const card = render(<TestCard onOpen={onOpen} onDelete={onDelete} />);
    await userEvent.click(card.querySelector(".hm-card-footer button") as HTMLElement);
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows the media, then the eyebrow, above the title", () => {
    const card = render(<TestCard onOpen={vi.fn()} onDelete={vi.fn()} />);
    const media = card.querySelector(".hm-card-media") as HTMLElement;
    const eyebrow = card.querySelector(".hm-card-eyebrow") as HTMLElement;
    const title = card.querySelector(".hm-card-title") as HTMLElement;
    expect(media.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      eyebrow.getBoundingClientRect().top,
    );
    expect(eyebrow.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      title.getBoundingClientRect().top,
    );
    // From edge to edge, past the card's padding.
    expect(media.getBoundingClientRect().left).toBeLessThanOrEqual(
      card.getBoundingClientRect().left + 1,
    );
  });

  it.each([false, true])(
    "draws the focus ring around the card, not the title (unstyled: %s)",
    async (unstyled) => {
      const card = render(<TestCard onOpen={vi.fn()} onDelete={vi.fn()} unstyled={unstyled} />);
      const action = card.querySelector(".hm-card-title button") as HTMLElement;
      expect(getComputedStyle(card).outlineStyle).toBe("none");
      await userEvent.tab();
      expect(document.activeElement).toBe(action);
      expect(getComputedStyle(card).outlineStyle).not.toBe("none");
      expect(getComputedStyle(action).outlineStyle).toBe("none");
    },
  );
});
