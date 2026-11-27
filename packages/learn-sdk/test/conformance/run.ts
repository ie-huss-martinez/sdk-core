import { conforms } from "@hussmartinez/sdk-config/testing/conformance";
import {
  accessibleCourses,
  applyLearnCommand,
  applyProgressChanges,
  arabicProfile,
  type Content,
  type ContentDraft,
  type Course,
  createExerciseTypes,
  createFsrsScheduler,
  defineExerciseType,
  dueItems,
  englishProfile,
  type FsrsSchedulerOptions,
  type Grade,
  gapFill,
  gradeAnswer,
  type LanguageProfile,
  type LearnCommand,
  type Learner,
  type LearnLimitOverrides,
  matchTolerantly,
  multipleChoice,
  normalizeForGrading,
  type ProgressChange,
  type ProgressDocument,
  parseContent,
  parseProgress,
  type Rating,
  recall,
  type Scheduled,
  type Scheduler,
  type SchedulingState,
  sequenceRecall,
  spanishProfile,
  type TolerantMatch,
  toProgressDocument,
  wordOrder,
} from "../../src/index.js";
import { createFakeScheduler } from "../../src/testing.js";

/**
 * How the TypeScript SDK runs each conformance subject: what a port in
 * another language implements too (sdk-core ADR 0045). There's one runner
 * per subject, shared by the generator that writes the cases and the tests
 * that check them. conformance/README.md describes them for ports.
 */

/**
 * A host's exercise type, as every port registers it for the vectors:
 * `"free-form"` takes any object as its payload and returns it unchanged.
 * It shows how a reader treats a type it doesn't know the shape of.
 */
export const freeForm = defineExerciseType<object, unknown>({
  type: "free-form",
  validate: (payload) => payload as object,
  validateAnswer: (answer) => answer,
  grade: () => ({ score: 0, max: 0, items: [] }),
});

/** The built-in types and `"free-form"`. */
export const types = createExerciseTypes([
  multipleChoice,
  gapFill,
  wordOrder,
  recall,
  sequenceRecall,
  freeForm,
]);

/** Whether a call returns, rather than throws. */
export const accepts = (read: () => unknown): boolean => {
  try {
    read();
    return true;
  } catch {
    return false;
  }
};

/** A document, as a JSON value or as JSON text, with limits other than the defaults. */
export interface DocumentInput {
  readonly document: unknown;
  readonly limits?: LearnLimitOverrides;
}

/** `hm-learn-content`: a document read, giving the content as the reader returns it. */
export function readContent({ document, limits }: DocumentInput): Content {
  return parseContent(document, { types, ...(limits ? { limits } : {}) });
}

/** `hm-learn-progress`: a document read and written back. */
export function readProgress({ document, limits }: DocumentInput): ProgressDocument {
  return toProgressDocument(parseProgress(document, limits ? { limits } : {}));
}

/**
 * `hm-learn-grading`: one exercise, read as an `hm-learn-content` document
 * of its own, and an answer graded with the default language profile
 * (Unicode NFC only), giving the grade.
 */
export function grade({ exercise, answer }: { exercise: unknown; answer: unknown }): Grade {
  const [read] = readContent({
    document: { format: "hm-learn-content", version: 1, exercises: [exercise] },
  }).exercises;
  if (!read) {
    throw new Error("The case's exercise didn't read.");
  }
  return gradeAnswer(read, answer, { types });
}

/** `hm-learn-access`: the codes of the courses a learner may open, in course order. */
export function access({ learner, courses }: { learner: Learner; courses: Course[] }): string[] {
  return accessibleCourses(learner, courses).map((course) => course.code);
}

/** `hm-learn-progress-changes`: changes applied to a progress document, giving the new one. */
export function applyChanges({
  progress,
  changes,
}: {
  progress: unknown;
  changes: ProgressChange[];
}): ProgressDocument {
  return toProgressDocument(applyProgressChanges(parseProgress(progress), changes));
}

/** The schedulers a port reproduces: FSRS-7, with its options, and the fake from `./testing`. */
export type SchedulingInput = {
  readonly scheduler: "fsrs" | "fake";
  readonly options?: FsrsSchedulerOptions;
  readonly reviews: readonly { readonly rating: Rating; readonly at: number }[];
} & ({ readonly start: number } | { readonly state: SchedulingState });

/**
 * `hm-learn-scheduling`: a run of reviews, from a new item's state at
 * `start`, or from a given `state`. Gives every state in turn, the new one
 * first when there is one, each with its due time.
 */
export function schedule(input: SchedulingInput): Scheduled[] {
  const scheduler: Scheduler =
    input.scheduler === "fsrs" ? createFsrsScheduler(input.options) : createFakeScheduler();
  const states: Scheduled[] = "start" in input ? [scheduler.initial(input.start)] : [];
  let state = "state" in input ? input.state : (states[0] as Scheduled).state;
  for (const { rating, at } of input.reviews) {
    const next = scheduler.review(state, rating, at);
    states.push(next);
    state = next.state;
  }
  return states;
}

/** Commands applied in order to content, with limits other than the defaults. */
export interface CommandsInput {
  readonly document: unknown;
  readonly commands: readonly unknown[];
  readonly limits?: LearnLimitOverrides;
}

/**
 * `hm-learn-commands`: commands applied in order to content read with
 * `parseContent`, giving the draft. Their inverses, applied in reverse
 * order, must restore the content exactly, though the inverses themselves
 * aren't compared.
 */
export function editCommands({ document, commands, limits }: CommandsInput): ContentDraft {
  const options = { types, ...(limits ? { limits } : {}) };
  const start: ContentDraft = parseContent(document, options);
  let state = start;
  const inverses: LearnCommand[] = [];
  for (const command of commands) {
    const applied = applyLearnCommand(state, command, options);
    state = applied.state;
    inverses.unshift(applied.inverse);
  }
  const undone = inverses.reduce(
    (draft, inverse) => applyLearnCommand(draft, inverse, options).state,
    state,
  );
  if (!conforms(JSON.parse(JSON.stringify(undone)), JSON.parse(JSON.stringify(start)))) {
    throw new Error("The commands' inverses didn't restore the content.");
  }
  return state;
}

/** The built-in language profiles, by the name a case gives. */
const PROFILES: Readonly<Record<string, LanguageProfile>> = {
  es: spanishProfile,
  en: englishProfile,
  ar: arabicProfile,
};

/** What a matching case asks: a text prepared for comparison, or an answer matched tolerantly. */
export type MatchingInput =
  | { readonly profile: string; readonly normalize: string }
  | {
      readonly profile?: string;
      readonly given: string | readonly string[];
      readonly accepted: readonly string[];
      readonly others?: readonly string[];
      readonly maxDistance?: number;
    };

/**
 * `hm-learn-matching`: the built-in language profiles and the tolerant
 * matcher. A case with `normalize` gives the text as the named profile
 * prepares it for comparison, after NFC. Any other gives whether `given`
 * matches one of `accepted`, and how far it is from the closest.
 */
export function matching(input: MatchingInput): string | TolerantMatch {
  const profile = input.profile === undefined ? undefined : PROFILES[input.profile];
  if (input.profile !== undefined && !profile) {
    throw new Error(`The case names a profile the runner doesn't have: ${input.profile}.`);
  }
  if ("normalize" in input) {
    return normalizeForGrading(input.normalize, profile as LanguageProfile);
  }
  return matchTolerantly(input.given, input.accepted, {
    ...(profile ? { profile } : {}),
    ...(input.others ? { others: input.others } : {}),
    ...(input.maxDistance === undefined ? {} : { maxDistance: input.maxDistance }),
  });
}

/** `hm-learn-due-items`: the ids of the cards due at `now`, in the order to review them. */
export function due({
  progress,
  now,
  limit,
}: {
  progress: unknown;
  now: number;
  limit?: number;
}): string[] {
  return dueItems(parseProgress(progress), now, limit === undefined ? {} : { limit }).map(
    (card) => card.itemId,
  );
}
