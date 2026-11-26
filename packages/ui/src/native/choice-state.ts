import type { ButtonVariant } from "./button-style.js";

/**
 * What a choice shows:
 *
 * - `idle`: nothing is picked, or it's another choice that can still be picked;
 * - `selected`: it's the pick, and no answer is shown;
 * - `correct`: the answer is shown, and it's this one;
 * - `hint`: the answer is shown, and this was the pick, which wasn't it;
 * - `dimmed`: the answer is shown, and this is neither.
 *
 * @public
 */
export type ChoiceState = "idle" | "selected" | "correct" | "hint" | "dimmed";

/**
 * The state of one choice, from what's picked and the answer, if it's
 * shown. The answer is shown once there's a pick and a `correctKey`.
 *
 * @param key - The choice.
 * @param picked - The picked choice's key, or `null`.
 * @param correctKey - The right choice's key, when the list gives feedback.
 * @public
 */
export function choiceState(
  key: string,
  picked: string | null,
  correctKey: string | undefined,
): ChoiceState {
  if (picked === null) {
    return "idle";
  }
  if (correctKey === undefined) {
    return key === picked ? "selected" : "idle";
  }
  if (key === correctKey) {
    return "correct";
  }
  return key === picked ? "hint" : "dimmed";
}

/**
 * The button variant that draws each state. A wrong pick is `hint`, never
 * a danger colour: the right answer is what should stay in mind.
 */
export const CHOICE_VARIANTS: Readonly<Record<ChoiceState, ButtonVariant>> = {
  idle: "secondary",
  selected: "selected",
  correct: "success",
  hint: "hint",
  dimmed: "secondary",
};
