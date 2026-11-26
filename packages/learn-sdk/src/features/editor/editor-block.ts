import type { Announce } from "@hussmartinez/ui/react";
import type { ComponentType } from "react";
import type { LearnIssue } from "../../core/errors/learn-issues.js";
import type { Exercise } from "../../core/model/content.js";
import type { LanguageProfile } from "../../core/model/language-profile.js";
import type { LearnEditorMessages } from "./editor-messages.js";

/**
 * What an exercise type's editor block receives (ADR 0008).
 *
 * @public
 */
export interface EditorBlockProps<Payload = unknown> {
  /** The exercise, from the draft. Its payload may be invalid. */
  readonly exercise: Exercise<Payload>;
  /**
   * Replaces the payload, as one `learn.setPayload`. Pass the new payload, or
   * a function of the current one: that reads the draft as it is when the
   * edit is made, so two edits in a row don't overwrite each other.
   */
  readonly onPayload: (payload: Payload | ((current: Payload) => Payload)) => void;
  /** This exercise's problems, with paths relative to its payload. */
  readonly issues: readonly LearnIssue[];
  /** The language being taught: its `lang` and `dir` for the content's fields. */
  readonly profile: LanguageProfile;
  readonly messages: LearnEditorMessages;
  readonly announce: Announce;
}

/**
 * An exercise type's editor (ADR 0008): the component that builds its whole
 * payload, and the payload a new exercise of the type starts with. It never
 * adds commands of its own (ADR 0007).
 *
 * @public
 */
export interface EditorBlock<Payload = unknown> {
  /** Edits an exercise's payload. */
  readonly edit: ComponentType<EditorBlockProps<Payload>>;
  /**
   * A new exercise's payload. It may be invalid, with its required texts
   * empty, as a draft is while the teacher writes it.
   */
  readonly create: () => Payload;
}

/**
 * Types an editor block for a payload, so it can sit beside the built-in ones.
 *
 * @example
 * ```tsx
 * const flashcardEditor = defineEditorBlock<FlashcardPayload>({
 *   edit: ({ exercise, onPayload }) => …,
 *   create: () => ({ cards: [{ front: "", back: "" }] }),
 * });
 * <LearnEditor blocks={{ flashcard: flashcardEditor }} … />
 * ```
 *
 * @public
 */
export function defineEditorBlock<Payload>(block: EditorBlock<Payload>): EditorBlock {
  return block as unknown as EditorBlock;
}
