import {
  act,
  createRef,
  type ReactNode,
  type RefObject,
  StrictMode,
  useImperativeHandle,
  useState,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createFakePdfEngine } from "../../../test/fixtures/fake-pdf.js";
import { text } from "../../../test/fixtures/notes.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import { createMemoryNotesStore } from "../../adapters/memory-store/memory-store.js";
import { NotesProvider } from "../NotesProvider.js";
import { TextEditor } from "./TextEditor.js";

afterEach(cleanUp);

interface Controls {
  /** Takes the editor off the page, as scrolling its page out of view does. */
  hide(): void;
  zoom(pixelsPerPoint: number): void;
}

/** A text editor on a page, which a test can take away or zoom. */
function Stage(props: {
  readonly value: string;
  readonly onDone: (text: string) => boolean | undefined;
  readonly controls: RefObject<Controls | null>;
  readonly wrap?: (children: ReactNode) => ReactNode;
}): ReactNode {
  const [shown, setShown] = useState(true);
  const [pixelsPerPoint, setPixelsPerPoint] = useState(1);
  const [item] = useState(() => text("t1", props.value));
  useImperativeHandle(
    props.controls,
    () => ({ hide: () => setShown(false), zoom: setPixelsPerPoint }),
    [],
  );
  const editor = shown ? (
    <TextEditor item={item} pixelsPerPoint={pixelsPerPoint} onDone={props.onDone} />
  ) : null;
  return (
    <div style={{ position: "relative", width: 600, height: 800 }}>
      {props.wrap ? props.wrap(editor) : editor}
    </div>
  );
}

async function mountEditor(value = "", wrap?: (children: ReactNode) => ReactNode) {
  const onDone = vi.fn<(text: string) => boolean | undefined>();
  const controls = createRef<Controls>();
  const container = await mount(
    <NotesProvider store={createMemoryNotesStore()} pdfEngine={createFakePdfEngine()}>
      <Stage value={value} onDone={onDone} controls={controls} {...(wrap ? { wrap } : {})} />
    </NotesProvider>,
  );
  const field = await waitFor(() => {
    const found = container.querySelector<HTMLTextAreaElement>(".hm-notes-text-editor");
    if (!found) throw new Error("No text editor.");
    return found;
  });
  const hide = () => act(async () => controls.current?.hide());
  const zoom = (pixelsPerPoint: number) => act(async () => controls.current?.zoom(pixelsPerPoint));
  return { container, field, onDone, hide, zoom };
}

/** Types into the field that has focus, inside act(): each key updates the editor. */
const type = (keys: string) => act(async () => void (await userEvent.keyboard(keys)));

describe("TextEditor", () => {
  it("keeps the draft when its page takes it away without a blur", async () => {
    const { container, field, onDone, hide } = await mountEditor("Heat");
    // Focus is in the field, with the caret after its text.
    expect(document.activeElement).toBe(field);
    await type(" and work");
    expect(onDone).not.toHaveBeenCalled();

    await hide();
    expect(container.querySelector(".hm-notes-text-editor")).toBeNull();
    expect(onDone).toHaveBeenCalledExactlyOnceWith("Heat and work");
  });

  it("ends the edit once when it's blurred and then taken away", async () => {
    const { field, onDone, hide } = await mountEditor();
    await type("Entropy");
    await act(async () => field.blur());
    expect(onDone).toHaveBeenCalledExactlyOnceWith("Entropy");

    await hide();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("doesn't end the edit when React's development mode mounts it twice", async () => {
    const { field, onDone, hide } = await mountEditor("", (children) => (
      <StrictMode>{children}</StrictMode>
    ));
    // Mounted, cleaned up and mounted again: the field is still there, with focus.
    expect(onDone).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);

    await type("Work");
    await hide();
    expect(onDone).toHaveBeenCalledExactlyOnceWith("Work");
  });

  it("leaves Escape to an input method that's composing, and ends the edit with it otherwise", async () => {
    const { field, onDone } = await mountEditor();
    await type("Ene");
    const pressEscape = (isComposing: boolean) =>
      act(async () => {
        field.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
            isComposing,
          }),
        );
      });

    await pressEscape(true);
    expect(onDone).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field);

    await pressEscape(false);
    expect(onDone).toHaveBeenCalledExactlyOnceWith("Ene");
  });

  it("stays as tall as its text when a zoom changes its width and font size", async () => {
    const { field, zoom } = await mountEditor("One\nTwo\nThree");
    const height = () => field.getBoundingClientRect().height;
    // Three lines, each one and a quarter times the font size of 14 pixels.
    await waitFor(() => expect(Math.abs(height() - 52.5)).toBeLessThan(2));

    await zoom(2);
    expect(Number.parseFloat(field.style.fontSize)).toBe(28);
    expect(Math.abs(height() - 105)).toBeLessThan(2);
  });

  it("stays, with what was typed, when the text can't be kept, and ends again when it's next left", async () => {
    const { container, field, onDone } = await mountEditor("Heat");
    onDone.mockReturnValueOnce(false);
    field.focus();
    await type(" and work");
    await act(async () => field.blur());
    expect(onDone).toHaveBeenCalledExactlyOnceWith("Heat and work");
    // Refused: the field is still there, with the draft.
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Heat and work");
    field.focus();
    await act(async () => field.blur());
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
