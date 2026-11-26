/**
 * The `<hm-notes-editor>` custom element of the notes SDK.
 *
 * @remarks
 * Importing this entry registers nothing: applications call
 * `defineNotesEditorElement()` themselves, and importing it on a server does
 * nothing (sdk-core ADR 0004, ADR 0007). The element renders `<NotesEditor>`
 * into its light DOM, so React and React DOM, the package's optional peer
 * dependencies, are needed here. Hosts import `@hussmartinez/ui/styles.css`
 * once, then this package's `styles.css` (sdk-core ADR 0036).
 *
 * @packageDocumentation
 */

import { createEditorElement } from "@hussmartinez/sdk-core/element";
import { toHeadingLevel } from "@hussmartinez/ui";
import {
  mountNotesEditor,
  type NotesEditorElementEvent,
  type NotesEditorElementMethods,
  type NotesEditorElementProps,
} from "./react/element/mount.js";

export type { NotesEditorElementEvent, NotesEditorElementMethods, NotesEditorElementProps };

/** A space-separated list, as the `tools` attribute holds. */
const words = (value: string): readonly string[] => value.split(/\s+/).filter(Boolean);

/**
 * Registers `<hm-notes-editor>`, or the tag you name, and returns its class
 * (sdk-core ADR 0040): the attributes `theme`, `locale`, `tools` and
 * `heading-level` (also the property `headingLevel`); the properties
 * `store`, `pdfEngine`, `recorder`, `assetsUrl`, `filePolicy`, `messages`,
 * `preferences` and `defaultPreferences`; the methods `open` and `close`;
 * and the events `hm-notes-editor-view`, `-settings`, `-preferences` and
 * `-event`. Calling it again returns the same class.
 *
 * @example
 * ```ts
 * import { defineNotesEditorElement } from "@hussmartinez/notes-sdk/element";
 *
 * defineNotesEditorElement();
 * const editor = document.querySelector("hm-notes-editor");
 * editor.addEventListener("hm-notes-editor-view", (event) => showHeader(event.detail.view === "library"));
 * ```
 *
 * @public
 */
export const defineNotesEditorElement = /* @__PURE__ */ createEditorElement<
  Partial<NotesEditorElementProps>,
  NotesEditorElementMethods,
  NotesEditorElementEvent
>({
  kind: "notes",
  attributes: {
    theme: "theme",
    locale: "locale",
    tools: { property: "tools", parse: words },
    // As text: anything but 2 to 6 is the default, 2 (sdk-core ADR 0058).
    "heading-level": { property: "headingLevel", parse: toHeadingLevel },
  },
  properties: [
    "store",
    "pdfEngine",
    "recorder",
    "assetsUrl",
    "filePolicy",
    "messages",
    "preferences",
    "defaultPreferences",
  ],
  methods: ["open", "close"],
  events: ["view", "settings", "preferences", "event"],
  mount: mountNotesEditor,
});
