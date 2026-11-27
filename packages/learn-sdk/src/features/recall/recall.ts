import { nfc } from "../../core/model/engine.js";
import type { ExerciseType } from "../../core/model/exercise-type.js";
import { defineExerciseType } from "../../core/model/exercise-type.js";
import { normalizeForGrading } from "../../core/model/language-profile.js";
import type { ValidationContext } from "../../core/model/validation-context.js";
import { matchTolerantly } from "../../core/operations/tolerant-match.js";

/**
 * One thing to remember: a cue, and what goes with it, such as a face and a
 * name, or an object and where it's kept.
 *
 * @public
 */
export interface RecallItem {
  /**
   * The item's id, which its card in the learner's progress is kept under.
   * Unique in its exercise, and best unique in everything a learner
   * studies, such as `"vault:keys"`, because a scope has one card per id.
   */
  readonly id: string;
  /** What the learner is shown or asked, such as "Where are the keys?". */
  readonly cue: string;
  /** 1 to `maxChoices` answers, any of which is right. */
  readonly answers: readonly string[];
  /**
   * 2 to `maxChoices` choices to pick from, at least one of them an
   * accepted answer. Without them, the learner types or says the answer.
   */
  readonly choices?: readonly string[];
}

/**
 * The data of a `recall` exercise: one or more items.
 *
 * @public
 */
export interface RecallPayload {
  readonly items: readonly RecallItem[];
}

/**
 * A learner's answer to a `recall` exercise: for each item, in order, what
 * they picked, typed or said, or `null` if they gave nothing, which counts
 * as not remembered.
 *
 * @public
 */
export interface RecallAnswer {
  readonly recalled: readonly (string | null)[];
}

/**
 * Options for {@link createRecallType}.
 *
 * @public
 */
export interface RecallTypeOptions {
  /**
   * Grades forgivingly, with {@link matchTolerantly}: the largest accepted
   * distance, from 0 to 1, such as {@link DEFAULT_MATCH_DISTANCE}. Without
   * it, an answer is right when it equals an accepted answer after the
   * language profile's rules, as in every other exercise type.
   */
  readonly tolerance?: number;
}

/** Compares choices as a learner sees them: NFC, ignoring surrounding spaces. */
const asSeen = (text: string) => nfc(text).trim();

function texts(
  list: readonly unknown[] | undefined,
  context: ValidationContext,
): string[] | undefined {
  const read = list?.map((entry, index) => context.at(index).text(entry));
  return read?.every((text) => text !== undefined) ? (read as string[]) : undefined;
}

function validateItem(entry: unknown, context: ValidationContext): RecallItem | undefined {
  const fields = context.fields(entry, ["id", "cue", "answers", "choices"]);
  if (!fields) {
    return undefined;
  }
  const id = context.at("id").text(fields.id);
  const cue = context.at("cue").text(fields.cue);
  const answers = texts(
    context.at("answers").list(fields.answers, { limit: "maxChoices", minimum: 1 }),
    context.at("answers"),
  );
  const choiceList = context
    .at("choices")
    .list(fields.choices, { limit: "maxChoices", minimum: 2, optional: true });
  const choices = choiceList === undefined ? undefined : texts(choiceList, context.at("choices"));
  if (choices) {
    const seen = new Set<string>();
    choices.forEach((choice, index) => {
      if (seen.has(asSeen(choice))) {
        context.at("choices", index).issue("duplicate-choice");
      }
      seen.add(asSeen(choice));
    });
    if (answers && !answers.some((answer) => seen.has(asSeen(answer)))) {
      context.at("choices").issue("answer-not-in-options");
    }
  }
  if (id === undefined || cue === undefined || !answers || (choiceList !== undefined && !choices)) {
    return undefined;
  }
  return { id, cue, answers, ...(choices ? { choices } : {}) };
}

/**
 * Makes the `recall` exercise type, with a host's choice of how strictly
 * it's graded. Register the same one on a server as on a device, so both
 * grade alike.
 *
 * @example
 * ```ts
 * // Spoken answers: forgive an article, a plural or one slip in four letters.
 * const types = createExerciseTypes([createRecallType({ tolerance: DEFAULT_MATCH_DISTANCE })]);
 * gradeAnswer(exercise, { recalled: ["in the drawers"] }, { types, profile: englishProfile });
 * ```
 *
 * @param options - Whether to grade forgivingly.
 * @throws `TypeError` if `tolerance` isn't a number from 0 to 1.
 * @public
 */
export function createRecallType(
  options: RecallTypeOptions = {},
): ExerciseType<RecallPayload, RecallAnswer> {
  const { tolerance } = options;
  if (
    tolerance !== undefined &&
    (typeof tolerance !== "number" || !(tolerance >= 0 && tolerance <= 1))
  ) {
    throw new TypeError("tolerance is a number from 0 to 1.");
  }
  return defineExerciseType<RecallPayload, RecallAnswer>({
    type: "recall",
    validate(payload, context) {
      const fields = context.fields(payload, ["items"]);
      const list =
        fields && context.at("items").list(fields.items, { limit: "maxItems", minimum: 1 });
      if (!list) {
        return undefined;
      }
      const items = list.map((entry, index) => validateItem(entry, context.at("items", index)));
      const ids = new Set<string>();
      items.forEach((item, index) => {
        if (item && ids.has(item.id)) {
          context.at("items", index, "id").issue("duplicate-id");
        }
        if (item) {
          ids.add(item.id);
        }
      });
      return items.length > 0 &&
        items.every((item) => item !== undefined) &&
        ids.size === items.length
        ? { items: items as RecallItem[] }
        : undefined;
    },
    validateAnswer(answer, payload, context) {
      const fields = context.fields(answer, ["recalled"]);
      const list = fields && context.at("recalled").list(fields.recalled, { limit: "maxItems" });
      if (!list) {
        return undefined;
      }
      if (list.length !== payload.items.length) {
        context.at("recalled").issue("out-of-range");
        return undefined;
      }
      const recalled = list.map((entry, index) =>
        entry === null ? null : context.at("recalled", index).text(entry, { allowEmpty: true }),
      );
      return recalled.every((text) => text !== undefined)
        ? { recalled: recalled as (string | null)[] }
        : undefined;
    },
    grade(payload, answer, profile) {
      const items = payload.items.map((item, index) => {
        const given = answer.recalled[index];
        if (given === null || given === undefined) {
          return false;
        }
        if (tolerance !== undefined) {
          // The other choices are rivals: an answer nearer one of them is that one.
          const accepted = new Set(item.answers.map(asSeen));
          const others = (item.choices ?? []).filter((choice) => !accepted.has(asSeen(choice)));
          return matchTolerantly(given, item.answers, { profile, maxDistance: tolerance, others })
            .match;
        }
        const normalized = normalizeForGrading(given, profile);
        if (
          normalized !== "" &&
          item.answers.some((accepted) => normalizeForGrading(accepted, profile) === normalized)
        ) {
          return true;
        }
        // A choice is accepted as an answer when it reads the same as one,
        // ignoring surrounding spaces, so picking that choice must be right
        // whatever the profile makes of the spaces.
        const seen = asSeen(given);
        return (
          item.choices?.some((choice) => asSeen(choice) === seen) === true &&
          item.answers.some((accepted) => asSeen(accepted) === seen)
        );
      });
      return { score: items.filter(Boolean).length, max: items.length, items };
    },
    // Remembered or not is the whole signal: no grade here is partly right.
    reviewItems: (payload, _answer, grade) =>
      payload.items.map((item, index) => ({
        itemId: item.id,
        rating: grade.items[index] === true ? ("good" as const) : ("again" as const),
      })),
  });
}

/**
 * The `recall` exercise type: remember what goes with a cue, by picking it
 * from choices, typing it or saying it (ADR 0010). It's for spaced
 * retrieval: unlike the quiz types, it rates its own items, so with a
 * scheduler the player keeps a card for each: `good` when it was
 * remembered, `again` when it wasn't.
 *
 * This one grades exactly, after the language profile's rules
 * ({@link normalizeForGrading}). A pick that reads as an accepted answer,
 * surrounding spaces aside, is right too, since that's what made the choice
 * valid. {@link createRecallType} makes one that
 * forgives a slip.
 *
 * Its issues, beyond the generic ones: `duplicate-id` for two items with
 * the same id, `duplicate-choice` for two choices that read the same, and
 * `answer-not-in-options` when the choices include no accepted answer.
 *
 * @example
 * ```ts
 * const payload = {
 *   items: [{ id: "vault:keys", cue: "Where are the keys?", answers: ["In the drawer"] }],
 * };
 * gradeAnswer(exercise, { recalled: ["in the drawer"] }, { types, profile: englishProfile });
 * // { score: 1, max: 1, items: [true] }
 * ```
 *
 * @public
 */
export const recall: ExerciseType<RecallPayload, RecallAnswer> = /* @__PURE__ */ createRecallType();
