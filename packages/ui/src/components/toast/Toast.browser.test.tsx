import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanUp, loadStyles, mount } from "../../test/dom.js";
import { AnnouncerProvider } from "../announcer/Announcer.js";
import { Button } from "../button/Button.js";
import { type ToastApi, ToastProvider, useToast } from "./Toast.js";

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

let api: ToastApi;

function Capture() {
  api = useToast();
  return <Button>Editor</Button>;
}

function render(max?: number) {
  const container = mount("");
  act(() => {
    root = createRoot(container);
    root.render(
      <AnnouncerProvider>
        <ToastProvider max={max}>
          <Capture />
        </ToastProvider>
      </AnnouncerProvider>,
    );
  });
  const region = container.querySelector(".hm-toast-region") as HTMLElement;
  return { container, region, editor: container.querySelector("button") as HTMLButtonElement };
}

const messages = (region: HTMLElement): string[] =>
  [...region.querySelectorAll(".hm-toast-message")].map((element) => element.textContent ?? "");

describe("ToastProvider", () => {
  it("shows a toast in the top layer without taking focus, and announces it once", async () => {
    const { region, editor } = render();
    editor.focus();

    act(() => {
      api.show({ message: "Rotated" });
    });

    expect(region.matches(":popover-open")).toBe(true);
    expect(messages(region)).toEqual(["Rotated"]);
    expect(document.activeElement).toBe(editor);
    expect(region.hasAttribute("aria-live")).toBe(false);
    await vi.waitFor(() =>
      expect(document.querySelector('.hm-announcer [role="status"]')?.textContent).toBe("Rotated"),
    );
  });

  it("announces a danger toast assertively", async () => {
    const { region } = render();

    act(() => {
      api.show({ message: "The file is too large.", tone: "danger" });
    });

    expect(region.querySelector(".hm-toast")?.getAttribute("data-hm-tone")).toBe("danger");
    await vi.waitFor(() =>
      expect(document.querySelector('.hm-announcer [role="alert"]')?.textContent).toBe(
        "The file is too large.",
      ),
    );
  });

  it("goes after its duration, and hides the region when the last one goes", async () => {
    const { region } = render();

    act(() => {
      api.show({ message: "Rotated", duration: 50 });
    });

    await vi.waitFor(() => expect(messages(region)).toEqual([]));
    expect(region.matches(":popover-open")).toBe(false);
  });

  it("stays while the pointer is over it, and goes once it leaves", async () => {
    const { region, editor } = render();
    act(() => {
      api.show({ message: "Rotated", duration: 800 });
    });

    // Hovered before its time is up, then kept well past it.
    await userEvent.hover(region.querySelector(".hm-toast-dismiss") as HTMLElement);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(messages(region)).toEqual(["Rotated"]);

    await userEvent.hover(editor);
    await vi.waitFor(() => expect(messages(region)).toEqual([]));
  });

  it("stays while focus is inside it", async () => {
    const { region } = render();
    act(() => {
      api.show({
        message: "Rotated",
        duration: 100,
        action: { label: "Undo", onAction: () => {} },
      });
    });

    act(() => (region.querySelector(".hm-toast-action") as HTMLElement).focus());
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(messages(region)).toEqual(["Rotated"]);
  });

  it("runs its action and dismisses itself", async () => {
    const { region } = render();
    const onAction = vi.fn();
    act(() => {
      api.show({ message: "Rotated", action: { label: "Undo", onAction } });
    });

    await userEvent.click(region.querySelector(".hm-toast-action") as HTMLElement);

    expect(onAction).toHaveBeenCalledOnce();
    expect(messages(region)).toEqual([]);
  });

  it("dismisses with its button, or by id", async () => {
    const { region } = render();
    let second = "";
    act(() => {
      api.show({ message: "One" });
      second = api.show({ message: "Two" });
    });

    await userEvent.click(region.querySelector('[aria-label="Dismiss"]') as HTMLElement);
    expect(messages(region)).toEqual(["Two"]);
    act(() => api.dismiss(second));
    expect(messages(region)).toEqual([]);
  });

  it("keeps at most max toasts, dropping the oldest", () => {
    const { region } = render(2);

    act(() => {
      api.show({ message: "One" });
      api.show({ message: "Two" });
      api.show({ message: "Three" });
    });

    expect(messages(region)).toEqual(["Two", "Three"]);
  });
  it("ends the focus pause when the toast holding focus is pushed out", async () => {
    const { region } = render(1);
    act(() => {
      api.show({ message: "One", action: { label: "Undo", onAction: () => {} } });
    });
    act(() => (region.querySelector(".hm-toast-action") as HTMLElement).focus());

    act(() => {
      api.show({ message: "Two", duration: 50 });
    });

    expect(messages(region)).toEqual(["Two"]);
    await vi.waitFor(() => expect(messages(region)).toEqual([]));
  });

  it("moves into an open modal dialog, where its actions can be used, and back out", async () => {
    const { container } = render();
    const dialog = mount("<dialog><button type='button'>Inside</button></dialog>").querySelector(
      "dialog",
    ) as HTMLDialogElement;
    dialog.showModal();
    const onAction = vi.fn();

    act(() => {
      api.show({ message: "Rotated", duration: 60_000, action: { label: "Undo", onAction } });
    });

    const inDialog = dialog.querySelector(".hm-toast-region") as HTMLElement;
    expect(inDialog.matches(":popover-open")).toBe(true);
    await userEvent.click(inDialog.querySelector(".hm-toast-action") as HTMLElement);
    expect(onAction).toHaveBeenCalledOnce();

    act(() => {
      api.show({ message: "Cropped", duration: 60_000 });
    });
    dialog.close();
    await vi.waitFor(() => expect(container.querySelector(".hm-toast-region")).not.toBeNull());
    const outside = container.querySelector(".hm-toast-region") as HTMLElement;
    expect(dialog.querySelector(".hm-toast-region")).toBeNull();
    await vi.waitFor(() => expect(outside.matches(":popover-open")).toBe(true));
    expect(messages(outside)).toEqual(["Cropped"]);
  });
  it("speaks once from inside an open modal dialog, not through the page's announcer", async () => {
    render();
    const dialog = mount("<dialog><button type='button'>Inside</button></dialog>").querySelector(
      "dialog",
    ) as HTMLDialogElement;
    dialog.showModal();

    act(() => {
      api.show({ message: "Rotated", duration: 60_000 });
      api.show({ message: "Export failed.", tone: "danger", duration: 60_000 });
    });

    await vi.waitFor(() =>
      expect(dialog.querySelector('.hm-toast-region [role="status"]')?.textContent).toBe("Rotated"),
    );
    await vi.waitFor(() =>
      expect(dialog.querySelector('.hm-toast-region [role="alert"]')?.textContent).toBe(
        "Export failed.",
      ),
    );
    expect(document.querySelector('.hm-announcer [role="status"]')?.textContent).toBe("");
    expect(document.querySelector('.hm-announcer [role="alert"]')?.textContent).toBe("");
    dialog.close();
  });
  it("moves into the modal opened last, not the last in the document", async () => {
    render();
    const dialogs = mount(
      "<dialog id='a'><button type='button'>A</button></dialog><dialog id='b'><button type='button'>B</button></dialog>",
    );
    const a = dialogs.querySelector("#a") as HTMLDialogElement;
    const b = dialogs.querySelector("#b") as HTMLDialogElement;
    b.showModal();
    a.showModal();
    // Let the provider see them open.
    await new Promise((resolve) => setTimeout(resolve, 0));

    act(() => {
      api.show({ message: "Rotated", duration: 60_000 });
    });

    expect(a.querySelector(".hm-toast-region")).not.toBeNull();
    expect(b.querySelector(".hm-toast-region")).toBeNull();
    a.close();
    await vi.waitFor(() => expect(b.querySelector(".hm-toast-region")).not.toBeNull());
    b.close();
  });

  it("falls back to the page's announcer when the modal closes before the toast is spoken", async () => {
    render();
    const dialog = mount("<dialog><button type='button'>Inside</button></dialog>").querySelector(
      "dialog",
    ) as HTMLDialogElement;
    dialog.showModal();

    act(() => {
      api.show({ message: "Rotated", duration: 60_000 });
      dialog.close();
    });

    await vi.waitFor(() =>
      expect(document.querySelector('.hm-announcer [role="status"]')?.textContent).toBe("Rotated"),
    );
  });
});
