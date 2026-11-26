import "@hussmartinez/ui/styles.css";
import "@hussmartinez/learn-sdk/styles.css";
import "./example.css";
import {
  defineLearnEditorElement,
  type LearnEditorChangeDetail,
  type LearnEditorElementMethods,
  type LearnEditorElementProps,
} from "@hussmartinez/learn-sdk/element";
import content from "../../thai-basics.json" with { type: "json" };

/**
 * The element, as a host without React uses it (ADR 0009): ui's stylesheet
 * first, then the SDK's (sdk-core ADR 0036), the element registered
 * explicitly, its content and language set as properties, and Save on only
 * while the draft is valid, showing what `getContent()` resolves with.
 */
defineLearnEditorElement();

type LearnEditorElement = HTMLElement & LearnEditorElementProps & LearnEditorElementMethods;

const editor = document.querySelector<LearnEditorElement>("hm-learn-editor");
const save = document.querySelector<HTMLButtonElement>("#save");
const output = document.querySelector("output");
if (editor && save && output) {
  editor.profile = { code: "th", direction: "ltr" };
  editor.initialContent = content;
  editor.addEventListener("hm-learn-editor-change", (event) => {
    save.disabled = !(event as CustomEvent<LearnEditorChangeDetail>).detail.valid;
  });
  save.addEventListener("click", async () => {
    output.textContent = JSON.stringify(await editor.getContent(), null, 2);
  });
}
