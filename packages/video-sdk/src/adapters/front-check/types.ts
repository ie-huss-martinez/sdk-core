import type { VideoContainer } from "../../core/model/source.js";
import type { DhavIndex } from "../dhav/scan.js";

/**
 * What the front check learned about a file, before anything else reads it
 * (ADR 0001).
 *
 * @internal
 */
export type FrontCheck =
  | {
      readonly container: Exclude<VideoContainer, "dav">;
      /** Which of mediabunny's readers may read it. */
      readonly family: "isobmff" | "matroska";
      /** The bytes of the file's index, which `maxIndexSize` bounds. */
      readonly indexSize: number;
      /** Every track, of every kind. */
      readonly tracks: number;
    }
  | {
      readonly container: "dav";
      /** The SDK's own reader reads it (docs/adr/0009). */
      readonly family: "dhav";
      readonly indexSize: number;
      readonly tracks: number;
      /** The file's packets, from the check's walk of its frames. */
      readonly index: DhavIndex;
    };

/** The front check of a file one of mediabunny's readers reads. */
export type MediabunnyFrontCheck = Extract<FrontCheck, { family: "isobmff" | "matroska" }>;
