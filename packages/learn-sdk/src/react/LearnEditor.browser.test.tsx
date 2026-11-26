import "@hussmartinez/ui/styles.css";
import "../styles.css";
import { startScreenReader } from "@hussmartinez/sdk-config/testing/screen-reader";
import axe from "axe-core";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { isLearnError } from "../core/errors/learn-error.js";
import { COMMIT_PAUSE_MS } from "../features/editor/committed-text.js";
import { LearnEditor, type LearnEditorHandle, type LearnEditorProps } from "./LearnEditor.js";

// The editor (ADR 0008): each built-in type authored with the keyboard alone,
// typing as one undo step and never mid-composition, problems at their
// fields, the one-exercise case, focus after structural edits, and axe's
// WCAG 2.2 AA rules in its main states.

const content = {
  format: "hm-learn-content",
  version: 1,
  exercises: [
    {
      id: "mc",
      type: "multiple-choice",
      title: "อาหาร",
      payload: { questions: [{ prompt: "กิน", choices: ["eat", "drink"], correct: 0 }] },
    },
    {
      id: "wo",
      type: "word-order",
      payload: { items: [{ tiles: ["ฉัน", "กิน", "ข้าว"], translation: "I eat rice." }] },
    },
  ],
};
const one = { ...content, exercises: [content.exercises[0]] };
const thai = { code: "th", direction: "ltr" } as const;

let root: Root | undefined;
let container: HTMLElement | undefined;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.useRealTimers();
});

function render(props: Partial<LearnEditorProps> = {}, ref?: React.Ref<LearnEditorHandle>) {
  container = document.createElement("div");
  // Wide enough for the frame's sidebar and outline: below 45rem, tools move to the tab bar.
  container.style.inlineSize = "1200px";
  container.style.blockSize = "800px";
  document.body.append(container);
  root = createRoot(container);
  const element = container;
  act(() =>
    root?.render(
      <LearnEditor
        ref={ref}
        initialContent={content}
        profile={thai}
        defaultPreferences={{ mode: "advanced" }}
        {...props}
      />,
    ),
  );
  return element;
}

const field = (scope: HTMLElement, label: string) => {
  const labelElement = [...scope.querySelectorAll("label")].find(
    (each) => each.textContent === label,
  );
  const id = labelElement?.getAttribute("for");
  const input = id
    ? (scope.querySelector(`#${CSS.escape(id)}`) as HTMLInputElement | HTMLTextAreaElement | null)
    : null;
  if (!input) throw new Error(`No field labelled ${label}`);
  return input;
};
const button = (scope: HTMLElement, name: string) => {
  const found = [...scope.querySelectorAll("button")].find(
    (each) =>
      each.getAttribute("aria-label") === name ||
      each.textContent?.trim() === name ||
      // A start card's name is its title, followed by its description.
      (each.classList.contains("hm-learn-editor-card") && each.textContent?.startsWith(name)),
  );
  if (!found) throw new Error(`No button ${name}`);
  return found;
};

async function expectNoAxeViolations(scope: HTMLElement) {
  const { violations } = await axe.run(scope, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  });
  expect(
    violations.flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${node.html.slice(0, 160)}`),
    ),
  ).toEqual([]);
}

describe("LearnEditor", () => {
  it("opens content with an outline and the first exercise selected, and passes axe", async () => {
    const element = render();
    expect(element.querySelector("[role=grid]")?.getAttribute("aria-label")).toBe("Exercises");
    expect(field(element, "Title").value).toBe("อาหาร");
    // The taught language's fields say so, and turn off the browser's spelling help.
    const prompt = field(element, "Question");
    expect([
      prompt.lang,
      prompt.dir,
      prompt.spellcheck,
      prompt.getAttribute("autocorrect"),
    ]).toEqual(["th", "ltr", false, "off"]);
    expect(field(element, "Title").lang).toBe("");
    await expectNoAxeViolations(element);
  });

  it("writes a multiple-choice exercise with the keyboard alone, and hands the host valid content", async () => {
    const onChange = vi.fn();
    const ref = createRef<LearnEditorHandle>();
    const element = render({ initialContent: undefined, onChange }, ref);
    button(element, "Add multiple choice").focus();
    await userEvent.keyboard("{Enter}");
    // Focus goes to the new exercise's first field.
    expect(document.activeElement).toBe(field(element, "Title"));
    await userEvent.keyboard("Food");
    await userEvent.tab(); // instructions
    await userEvent.tab(); // the question
    await userEvent.keyboard("ร้อน");
    field(element, "Choice 1").focus();
    await userEvent.keyboard("hot");
    field(element, "Choice 2").focus();
    await userEvent.keyboard("cold");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ valid: true }),
    );
    const saved = ref.current?.getContent();
    expect(saved?.exercises[0]).toMatchObject({
      type: "multiple-choice",
      title: "Food",
      payload: { questions: [{ prompt: "ร้อน", choices: ["hot", "cold"], correct: 0 }] },
    });
  });

  it("shows each problem at its field, tied with aria-describedby, and counts them in the outline", async () => {
    const onChange = vi.fn();
    const element = render({ initialContent: undefined, onChange });
    await userEvent.click(button(element, "Add multiple choice"));
    const prompt = field(element, "Question");
    expect(prompt.getAttribute("aria-invalid")).toBe("true");
    const described = (prompt.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain("This can't be empty.");
    expect(element.querySelector("[role=row]")?.textContent).toContain("3 problems");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ valid: false }),
    );
    await expectNoAxeViolations(element);
  });

  it("commits a burst of typing as one undo step", async () => {
    const element = render();
    const title = field(element, "Title");
    title.focus();
    await userEvent.keyboard("{Control>}a{/Control}Lunch");
    await userEvent.tab();
    expect(field(element, "Title").value).toBe("Lunch");
    await userEvent.click(button(element, "Undo"));
    expect(field(element, "Title").value).toBe("อาหาร");
  });

  it("commits nothing while an input method composes Thai, then commits when it ends", async () => {
    const onChange = vi.fn();
    const element = render({ onChange });
    const prompt = field(element, "Question") as HTMLTextAreaElement;
    prompt.focus();
    vi.useFakeTimers();
    act(() => {
      prompt.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    // The input method builds ข้าว in steps; each step is an input event.
    for (const step of ["ข", "ข้", "ข้า", "ข้าว"]) {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(prompt, step);
        prompt.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
      });
    }
    // The pause ends during the composition: nothing is committed yet.
    act(() => vi.advanceTimersByTime(COMMIT_PAUSE_MS + 100));
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      prompt.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "ข้าว" }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const draft = onChange.mock.calls[0]?.[0] as typeof content | undefined;
    expect(draft?.exercises[0]?.payload).toMatchObject({ questions: [{ prompt: "ข้าว" }] });
  });

  it("commits pending typing when the editor goes away", async () => {
    const onChange = vi.fn();
    const element = render({ onChange });
    field(element, "Title").focus();
    await userEvent.keyboard("{Control>}a{/Control}Unsaved");
    expect(onChange).not.toHaveBeenCalled();
    act(() => root?.unmount());
    root = undefined;
    expect(onChange).toHaveBeenCalledTimes(1);
    const draft = onChange.mock.calls[0]?.[0] as typeof content | undefined;
    expect(draft?.exercises[0]?.title).toBe("Unsaved");
  });

  it("removes an exercise with Undo in a toast, and focuses the outline", async () => {
    const element = render();
    await userEvent.click(button(element, "Remove exercise"));
    expect(element.querySelectorAll("[role=row]")).toHaveLength(1);
    expect(element.closest("body")?.textContent).toContain("Exercise removed");
    expect(element.querySelector("[role=grid]")?.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(element.querySelectorAll("[role=row]")).toHaveLength(2);
  });

  it("keeps a word-order exercise's other right orders in step with its words", async () => {
    const ref = createRef<LearnEditorHandle>();
    const element = render({}, ref);
    await userEvent.click(element.querySelectorAll("[role=row]")[1] as HTMLElement);
    await userEvent.click(button(element, "Accept another order"));
    field(element, "Word 2").focus();
    await userEvent.keyboard("{Control>}a{/Control}ดื่ม");
    await userEvent.tab();
    const draft = ref.current?.getContent();
    expect(draft?.exercises[1]?.payload).toMatchObject({
      items: [{ tiles: ["ฉัน", "ดื่ม", "ข้าว"], alternatives: [["ฉัน", "ดื่ม", "ข้าว"]] }],
    });
  });

  describe("single", () => {
    it("edits one exercise, with no outline and no structural tools", async () => {
      const element = render({ single: true, initialContent: one });
      expect(element.querySelector("[role=grid]")).toBeNull();
      expect(
        [...element.querySelectorAll("button")].some((each) =>
          each.textContent?.includes("Remove exercise"),
        ),
      ).toBe(false);
      expect(field(element, "Title").value).toBe("อาหาร");
      await expectNoAxeViolations(element);
    });

    it("starts from the cards when empty, and the card chosen adds the one exercise", async () => {
      const ref = createRef<LearnEditorHandle>();
      const element = render({ single: true, initialContent: undefined }, ref);
      await userEvent.click(button(element, "Put words in order"));
      expect(element.querySelector(".hm-learn-editor-card")).toBeNull();
      expect(() => ref.current?.getContent()).toThrow();
    });

    it("refuses content with more than one exercise", () => {
      const element = render({ single: true });
      expect(element.querySelector("[role=alert]")?.textContent).not.toBe("");
      const ref = createRef<LearnEditorHandle>();
      render({ single: true }, ref);
      try {
        ref.current?.getContent();
      } catch (error) {
        expect(isLearnError(error, "INVALID_DOCUMENT")).toBe(true);
      }
    });
  });

  it("announces a removal and its undo, and the problems left after an edit", async () => {
    const reader = await startScreenReader();
    onTestFinished(() => reader.stop());
    const element = render();
    const removal = await reader.spoken(() => userEvent.click(button(element, "Remove exercise")));
    expect(removal).toContain("polite: Exercise removed");
    const undone = await reader.spoken(() => userEvent.keyboard("{Control>}z{/Control}"));
    expect(undone).toContain("polite: Undone");
    field(element, "Question").focus();
    const emptied = await reader.spoken(async () => {
      await userEvent.keyboard("{Control>}a{/Control}{Backspace}");
      await userEvent.tab();
    });
    expect(emptied).toContain("polite: 1 problem to fix.");
  });
});
