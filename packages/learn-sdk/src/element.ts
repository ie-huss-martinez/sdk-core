/**
 * The `<hm-learn-editor>` custom element of the learn SDK.
 *
 * @remarks
 * Importing this entry registers nothing: applications call
 * `defineLearnEditorElement()` themselves, and importing it on a server does
 * nothing (ADR 0004, ADR 0009). The element renders `<LearnEditor>` into its
 * light DOM, so React and React DOM, the package's optional peer
 * dependencies, are needed here. Hosts import `@hussmartinez/ui/styles.css`
 * once, then this package's `styles.css` (sdk-core ADR 0036).
 *
 * @packageDocumentation
 */

import { createEditorElement } from "@hussmartinez/sdk-core/element";
import { toHeadingLevel } from "@hussmartinez/ui";
import {
  type LearnEditorChangeDetail,
  type LearnEditorElementEvent,
  type LearnEditorElementMethods,
  type LearnEditorElementProps,
  mountLearnEditor,
} from "./react/element/mount.js";

export { learnEditorMessages } from "./features/editor/editor-messages.js";
export type {
  LearnEditorChangeDetail,
  LearnEditorElementEvent,
  LearnEditorElementMethods,
  LearnEditorElementProps,
};

/**
 * Registers `<hm-learn-editor>`, or the tag you name, and returns its class
 * (sdk-core ADR 0040, ADR 0009): the attributes `theme`, `locale`,
 * `heading-level` (also the property `headingLevel`) and `single`, a boolean
 * attribute; the properties `initialContent`, `types`, `blocks`, `profile`,
 * `limits`, `newId`, `messages`, `preferences` and `defaultPreferences`; the
 * methods `getContent`, `flush`, `undo` and `redo`; and the events
 * `hm-learn-editor-change`, `-event`, `-error` and `-preferences`. Calling it
 * again returns the same class.
 *
 * @example
 * ```ts
 * import { defineLearnEditorElement } from "@hussmartinez/learn-sdk/element";
 *
 * defineLearnEditorElement();
 * const editor = document.querySelector("hm-learn-editor");
 * editor.initialContent = await (await fetch("/lessons/food.json")).json();
 * editor.addEventListener("hm-learn-editor-change", (event) => {
 *   saveButton.disabled = !event.detail.valid;
 * });
 * saveButton.addEventListener("click", async () => save(await editor.getContent()));
 * ```
 *
 * @public
 */
export const defineLearnEditorElement = /* @__PURE__ */ createEditorElement<
  Partial<LearnEditorElementProps>,
  LearnEditorElementMethods,
  LearnEditorElementEvent
>({
  kind: "learn",
  attributes: {
    theme: "theme",
    locale: "locale",
    // As text: anything but 2 to 6 is the default, 2 (sdk-core ADR 0058).
    "heading-level": { property: "headingLevel", parse: toHeadingLevel },
    // A boolean attribute: present, with any value, is true; removed is unset.
    single: { property: "single", parse: () => true },
  },
  properties: [
    "initialContent",
    "types",
    "blocks",
    "profile",
    "limits",
    "newId",
    "messages",
    "preferences",
    "defaultPreferences",
  ],
  methods: ["getContent", "flush", "undo", "redo"],
  events: ["change", "event", "error", "preferences"],
  mount: mountLearnEditor,
});
