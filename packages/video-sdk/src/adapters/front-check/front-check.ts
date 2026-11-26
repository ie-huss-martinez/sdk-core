import { createWindowReader } from "@hussmartinez/sdk-core";
import type { VideoFilePolicy } from "../../core/errors/video-limits.js";
import { packetCaps } from "../packets.js";
import { checkDhav, looksDhav } from "./dhav.js";
import { checkEbml, looksEbml } from "./ebml.js";
import { refused } from "./errors.js";
import { checkIsobmff, looksIsobmff } from "./isobmff.js";
import type { FrontCheck } from "./types.js";

export { packetCaps } from "../packets.js";
export type { FrontCheck } from "./types.js";

/**
 * Identifies a file by its signature, and walks its structure with the
 * SDK's own code before anything else reads it (ADR 0001): only ISOBMFF,
 * QuickTime, Matroska, WebM and DHAV pass, with a bounded index, supported
 * edit lists and no encryption. The walk visits at most as many elements as
 * the limits allow packets, plus a margin for the structure around them.
 * For DHAV, which the SDK reads with its own code, the walk is the whole
 * reading, and the result carries its index (docs/adr/0009).
 *
 * Throws `VideoError`: `UNSUPPORTED_FORMAT` for anything else or refused,
 * `INVALID_VIDEO` for malformed structure, and `INDEX_TOO_LARGE`.
 *
 * @internal
 */
export async function frontCheck(file: Blob, policy: VideoFilePolicy): Promise<FrontCheck> {
  const reader = createWindowReader(file);
  const caps = packetCaps(policy);
  const maxElements = caps.video + caps.audio + 10_000;
  if (await looksIsobmff(reader)) return checkIsobmff(reader, policy, maxElements);
  if (await looksEbml(reader)) return checkEbml(reader, policy, maxElements);
  if (await looksDhav(reader)) return checkDhav(reader, policy, maxElements);
  throw refused("unknown", "signature");
}
