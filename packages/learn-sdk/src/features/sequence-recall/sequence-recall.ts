import type { ExerciseType } from "../../core/model/exercise-type.js";
import { defineExerciseType } from "../../core/model/exercise-type.js";

/**
 * The data of a `sequence-recall` exercise: a board of tiles and the order
 * some of them light up in, which the learner then taps back.
 *
 * @public
 */
export interface SequenceRecallPayload {
  /** How many tiles the board has, from 2 to `maxTiles`, and never over 1,000. Where each one sits is the application's. */
  readonly tiles: number;
  /**
   * The tiles that light up, in order, by position from 0: at least one,
   * and none twice, as on a Corsi board.
   */
  readonly sequence: readonly number[];
  /** Whether the learner taps them back in reverse. Forward without it. */
  readonly backward?: boolean;
}

/**
 * A learner's answer to a `sequence-recall` exercise: the tiles they
 * tapped, in order, by position. It may be shorter than the sequence, when
 * they stopped, and is never longer.
 *
 * @public
 */
export interface SequenceRecallAnswer {
  readonly taps: readonly number[];
}

/** The largest board there can be, whatever a host raises `maxTiles` to. */
const MAX_BOARD = 1_000;

/**
 * The order to tap a `sequence-recall` exercise's tiles in: as shown, or
 * reversed when it's a backward one.
 *
 * @example
 * ```ts
 * expectedTaps({ tiles: 9, sequence: [4, 0, 7], backward: true }); // [7, 0, 4]
 * ```
 *
 * @public
 */
export function expectedTaps(payload: SequenceRecallPayload): readonly number[] {
  return payload.backward === true ? [...payload.sequence].reverse() : payload.sequence;
}

/**
 * The `sequence-recall` exercise type: watch tiles light up in order, then
 * tap them back, forwards or backwards, as in the Corsi block-tapping task
 * (ADR 0010). Content holds the sequence, so a session is the same
 * wherever it's graded; an application draws the board and makes its
 * sequences.
 *
 * Each tap in the right place scores a point, and `grade.items` says which
 * were, so a player can replay the path from the first slip.
 *
 * Its issues, beyond the generic ones: `out-of-range` for a tile the board
 * doesn't have, or more taps than the sequence is long, and `repeated-tile`
 * for a sequence that lights a tile twice.
 *
 * @example
 * ```ts
 * const payload = { tiles: 9, sequence: [4, 0, 7] };
 * gradeAnswer(exercise, { taps: [4, 0, 2] }, { types }); // { score: 2, max: 3, items: [true, true, false] }
 * ```
 *
 * @public
 */
export const sequenceRecall: ExerciseType<SequenceRecallPayload, SequenceRecallAnswer> =
  /* @__PURE__ */ defineExerciseType<SequenceRecallPayload, SequenceRecallAnswer>({
    type: "sequence-recall",
    validate(payload, context) {
      const fields = context.fields(payload, ["tiles", "sequence", "backward"]);
      if (!fields) {
        return undefined;
      }
      const tiles = context.at("tiles").wholeNumber(fields.tiles);
      // A board is a list of tiles in all but name, so its size has the same
      // limit, checked on a list of that size. Past MAX_BOARD nothing is a
      // board, whatever a host's limit, and no list that long is ever made.
      if (tiles !== undefined && tiles > MAX_BOARD) {
        context.at("tiles").issue("out-of-range");
      }
      const board =
        tiles === undefined || tiles > MAX_BOARD
          ? undefined
          : context.at("tiles").list(Array.from({ length: tiles }), {
              limit: "maxTiles",
              minimum: 2,
            });
      const list = context.at("sequence").list(fields.sequence, { limit: "maxTiles", minimum: 1 });
      const sequence = list?.map((entry, index) =>
        context.at("sequence", index).wholeNumber(entry),
      );
      const backward = context.at("backward").yesNo(fields.backward, { optional: true });
      if (
        !board ||
        tiles === undefined ||
        !sequence ||
        sequence.some((tile) => tile === undefined)
      ) {
        return undefined;
      }
      let valid = true;
      const seen = new Set<number>();
      (sequence as number[]).forEach((tile, index) => {
        if (tile >= tiles) {
          context.at("sequence", index).issue("out-of-range");
          valid = false;
        } else if (seen.has(tile)) {
          context.at("sequence", index).issue("repeated-tile");
          valid = false;
        }
        seen.add(tile);
      });
      if (!valid || (fields.backward !== undefined && backward === undefined)) {
        return undefined;
      }
      return {
        tiles,
        sequence: sequence as number[],
        ...(backward === undefined ? {} : { backward }),
      };
    },
    validateAnswer(answer, payload, context) {
      const fields = context.fields(answer, ["taps"]);
      const list = fields && context.at("taps").list(fields.taps, { limit: "maxTiles" });
      if (!list) {
        return undefined;
      }
      if (list.length > payload.sequence.length) {
        context.at("taps").issue("out-of-range");
        return undefined;
      }
      const taps = list.map((entry, index) => {
        const tap = context.at("taps", index).wholeNumber(entry);
        if (tap !== undefined && tap >= payload.tiles) {
          context.at("taps", index).issue("out-of-range");
          return undefined;
        }
        return tap;
      });
      return taps.every((tap) => tap !== undefined) ? { taps: taps as number[] } : undefined;
    },
    grade(payload, answer) {
      const items = expectedTaps(payload).map((tile, index) => answer.taps[index] === tile);
      return { score: items.filter(Boolean).length, max: items.length, items };
    },
  });
