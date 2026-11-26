import { openDhavTracks } from "./dhav/tracks.js";
import type { FrontCheck } from "./front-check/types.js";
import { openMediabunnyTracks } from "./mediabunny/tracks.js";
import type { OpenTracks } from "./packets.js";

/**
 * Opens the tracks the SDK uses from a front-checked file, with the reader
 * for its container (docs/adr/0009): mediabunny's for ISOBMFF and Matroska,
 * and the SDK's own for DHAV, from the index the front check built. The
 * caller disposes of the result.
 *
 * Throws `VideoError` with the codes of the reader, and whatever mediabunny
 * throws for a file it can't read.
 *
 * @internal
 */
export async function openTracks(file: Blob, front: FrontCheck): Promise<OpenTracks> {
  return front.family === "dhav"
    ? openDhavTracks(file, front.index)
    : openMediabunnyTracks(file, front.container);
}
