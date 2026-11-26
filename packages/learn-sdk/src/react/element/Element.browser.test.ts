import "@hussmartinez/ui/styles.css";
import "../../styles.css";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { defineLearnEditorElement } from "../../element.js";
import type {
  LearnEditorChangeDetail,
  LearnEditorElementMethods,
  LearnEditorElementProps,
} from "./mount.js";

// The element's own wiring (ADR 0009): what LearnEditor does is its own
// tests' (ADR 0008), so these check only that attributes, properties,
// methods and events reach it and come back.

type Editor = HTMLElement & Partial<LearnEditorElementProps> & LearnEditorElementMethods;

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
const other = {
  ...content,
  exercises: [{ ...content.exercises[0], id: "other", title: "เครื่องดื่ม" }],
};

const editors: HTMLElement[] = [];
afterEach(async () => {
  for (const editor of editors.splice(0)) editor.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

async function until(condition: () => boolean, what: string, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (condition()) return;
  throw new Error(`timed out waiting for ${what}`);
}

function create(attributes: Record<string, string> = {}): Editor {
  defineLearnEditorElement();
  const editor = document.createElement("hm-learn-editor") as Editor;
  for (const [name, value] of Object.entries(attributes)) editor.setAttribute(name, value);
  // Wide enough for the frame's sidebar and outline: below 45rem, tools move to the tab bar.
  editor.style.inlineSize = "1200px";
  editor.style.blockSize = "800px";
  editor.defaultPreferences = { mode: "advanced" };
  editors.push(editor);
  return editor;
}

/** Every event's detail, by name. */
function record(editor: HTMLElement) {
  const events: { name: string; detail: unknown }[] = [];
  for (const name of ["change", "event", "error", "preferences"]) {
    editor.addEventListener(`hm-learn-editor-${name}`, (event) => {
      events.push({ name, detail: (event as CustomEvent).detail });
    });
  }
  return events;
}
const last = (events: { name: string; detail: unknown }[], name: string) =>
  events.filter((event) => event.name === name).at(-1)?.detail;

const heading = (editor: HTMLElement) =>
  editor.querySelector<HTMLElement>(".hm-learn-editor-heading");

describe("<hm-learn-editor> (ADR 0009, sdk-core ADR 0040)", () => {
  it("registers once, and renders the editor into its light DOM as a block", async () => {
    const Class = defineLearnEditorElement();
    expect(defineLearnEditorElement()).toBe(Class);
    expect(customElements.get("hm-learn-editor")).toBe(Class);
    const editor = create();
    editor.initialContent = content;
    document.body.append(editor);
    await until(() => heading(editor)?.textContent === "อาหาร", "the editor");
    expect(editor.shadowRoot).toBeNull();
    expect(getComputedStyle(editor).display).toBe("block");
  });

  it("resolves getContent() called before its first render, with typing committed", async () => {
    const editor = create();
    editor.initialContent = content;
    document.body.append(editor);
    // Called as soon as it's connected, before React has rendered.
    expect(await editor.getContent()).toEqual(content);

    const events = record(editor);
    await userEvent.fill(page.getByRole("textbox", { name: "Title" }), "ผลไม้");
    // No pause has passed: getContent() commits the typing.
    const saved = await editor.getContent();
    expect(saved.exercises[0]?.title).toBe("ผลไม้");
    const change = last(events, "change") as LearnEditorChangeDetail;
    expect(change.valid).toBe(true);
    expect(change.draft.exercises[0]?.title).toBe("ผลไม้");
    expect(events.some((event) => event.name === "event")).toBe(true);

    editor.undo();
    expect((await editor.getContent()).exercises[0]?.title).toBe("อาหาร");
    editor.redo();
    expect((await editor.getContent()).exercises[0]?.title).toBe("ผลไม้");
  });

  it("loads new content afresh when initialContent is set again", async () => {
    const editor = create();
    editor.initialContent = content;
    document.body.append(editor);
    await until(() => heading(editor)?.textContent === "อาหาร", "the first content");
    editor.initialContent = other;
    // The call waits for the new editor, not the one it replaces.
    expect(await editor.getContent()).toEqual(other);
    await until(() => heading(editor)?.textContent === "เครื่องดื่ม", "the new content");
  });

  it("opens afresh under new limits, which the session reads once", async () => {
    const editor = create();
    editor.initialContent = content;
    document.body.append(editor);
    expect((await editor.getContent()).exercises).toHaveLength(2);
    editor.limits = { maxExercises: 1 };
    await expect(editor.getContent()).rejects.toMatchObject({ code: "TOO_MANY_EXERCISES" });
  });

  it("takes theme, heading-level and single from attributes", async () => {
    const editor = create({ theme: "dark", "heading-level": "3", single: "" });
    editor.initialContent = { ...content, exercises: [content.exercises[0]] };
    document.body.append(editor);
    await until(() => heading(editor) !== null, "the editor");
    expect(editor.getAttribute("data-hm-theme")).toBe("dark");
    expect(heading(editor)?.tagName).toBe("H3");
    // One exercise: no outline.
    expect(editor.querySelector('[role="grid"]')).toBeNull();

    editor.removeAttribute("theme");
    await until(() => !editor.hasAttribute("data-hm-theme"), "the inherited theme");
  });

  it("fires error with the code for a refused command, and preferences on a change", async () => {
    const editor = create();
    const events = record(editor);
    editor.initialContent = content;
    editor.limits = { maxExercises: 2 };
    document.body.append(editor);
    await page.getByRole("button", { name: "Add multiple choice" }).click();
    await until(() => events.some((event) => event.name === "error"), "the error");
    expect(last(events, "error")).toEqual({
      code: "INVALID_COMMAND",
      details: { command: "learn.addExercise", reason: "too-many-exercises" },
    });

    await page.getByRole("radio", { name: "Easy" }).click();
    await until(() => events.some((event) => event.name === "preferences"), "the preferences");
    expect(last(events, "preferences")).toMatchObject({ mode: "easy" });
  });

  it("rejects getContent() with ABORTED when removed before its first render", async () => {
    const editor = create();
    editor.initialContent = content;
    document.body.append(editor);
    const pending = editor.getContent();
    editor.remove();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
  });
});
