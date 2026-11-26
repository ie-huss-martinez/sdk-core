import type { WindowReader } from "@hussmartinez/sdk-core";
import type { VideoFilePolicy } from "../../core/errors/video-limits.js";
import { isFilePrefix, isFrameMagic } from "../dhav/format.js";
import { scanDhav } from "../dhav/scan.js";
import type { FrontCheck } from "./types.js";

/**
 * Whether a file starts like a DHAV recording: a first frame's `DHAV`, or
 * the `DAHUA` file header some recorders write before it.
 *
 * @internal
 */
export async function looksDhav(reader: WindowReader): Promise<boolean> {
  const head = await reader.bytes(0, 5);
  return isFrameMagic(head) || isFilePrefix(head);
}

/**
 * The front check for DHAV (docs/adr/0009). No other reader parses these
 * files, so the check is the SDK's own bounded walk of every frame, and its
 * result carries the index that walk built: what the probe measures and what
 * every later reader reads packets through.
 *
 * @internal
 */
export async function checkDhav(
  reader: WindowReader,
  policy: VideoFilePolicy,
  maxElements: number,
): Promise<FrontCheck> {
  const index = await scanDhav(reader, policy, maxElements);
  policy.check("maxIndexSize", index.size);
  return { container: "dav", family: "dhav", indexSize: index.size, tracks: index.tracks, index };
}
