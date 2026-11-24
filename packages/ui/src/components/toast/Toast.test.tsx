import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ToastApi, ToastProvider, useToast } from "./Toast.js";

let api: ToastApi | undefined;

function Shows() {
  api = useToast();
  return null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ToastProvider on the server", () => {
  it("renders its children and an empty, hidden region named from the messages", () => {
    const html = renderToString(
      <ToastProvider>
        <p>Editor</p>
      </ToastProvider>,
    );
    expect(html).toBe(
      '<p>Editor</p><section popover="manual" aria-label="Notifications" class="hm-toast-region"></section>',
    );
  });

  it("does nothing without a provider, with a warning in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    renderToString(<Shows />);

    expect(api?.show({ message: "Rotated" })).toBe("");
    expect(() => api?.dismiss("x")).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/useToast needs a ToastProvider/));
  });
});
