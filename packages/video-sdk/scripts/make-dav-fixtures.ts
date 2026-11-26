// Generates the DAV test fixtures in test/fixtures/video (docs/adr/0009):
// FFmpeg encodes synthetic sources, a frame-numbered picture and a sine
// tone, into bare H.264, HEVC and A-law streams, and this script wraps them
// in DHAV frames with the tests' own builder, since FFmpeg reads DHAV but
// doesn't write it. Never a recording (CONTRIBUTING.md, "Test videos").
//
// Run it with `node scripts/make-dav-fixtures.ts`, with FFmpeg 6 or later
// built with libx264 and libx265, only to change the fixtures: the output is
// committed. Every encoder runs single-threaded with deterministic settings.
// FFmpeg's own DHAV reader is the check that the files are what a recorder
// would write: `ffprobe -show_streams test/fixtures/video/numbered.dav`.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  concat,
  DHAV_TYPES,
  dhavClock,
  dhavFrame,
  dhavTags,
  joinNals,
  splitNals,
} from "../test/builders/dhav.ts";

const out = join(import.meta.dirname, "../test/fixtures/video");
const work = mkdtempSync(join(tmpdir(), "hm-dav-"));
const ffmpeg = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
const exact = ["-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1"];

/** Frames a second, as PAL recorders write. */
const RATE = 25;
const PERIOD = 1_000 / RATE;
/** A-law at 8 kHz, one channel: 320 bytes are one picture's 40 ms. */
const AUDIO_FRAME = 320;

// Eight 32-pixel blocks show each frame's number in binary, most significant
// bit first, white for 1, as in make-video-fixtures.sh.
const numbered = "geq=lum='if(mod(trunc(N/pow(2\\,7-trunc(X/32)))\\,2)\\,235\\,16)':cb=128:cr=128";
const picture = (seconds: number) =>
  `color=black:size=256x32:rate=${RATE}:duration=${seconds},format=yuv420p,${numbered}`;

/** The NAL unit type, and which types delimit a picture and start a key one. */
const CODECS = {
  h264: {
    tag: 0x08,
    type: (nal: Uint8Array) => (nal[0] as number) & 0x1f,
    delimiter: 9,
    key: (type: number) => type === 5,
  },
  hevc: {
    tag: 0x0c,
    type: (nal: Uint8Array) => ((nal[0] as number) >> 1) & 0x3f,
    delimiter: 35,
    key: (type: number) => type >= 16 && type <= 21,
  },
} as const;

/** The pictures of a bare stream encoded with access unit delimiters, without the delimiters. */
function pictures(stream: Uint8Array, codec: keyof typeof CODECS) {
  const { type, delimiter, key } = CODECS[codec];
  const units: Uint8Array[][] = [];
  for (const nal of splitNals(stream)) {
    if (type(nal) === delimiter) units.push([]);
    else units.at(-1)?.push(nal);
  }
  return units.map((nals) => ({
    key: nals.some((nal) => key(type(nal))),
    payload: joinNals(nals),
  }));
}

/** Wraps pictures, and the sound that plays with each, in DHAV frames. */
function dav(
  codec: keyof typeof CODECS,
  size: readonly [number, number],
  video: readonly { key: boolean; payload: Uint8Array }[],
  audio?: Uint8Array,
): Uint8Array {
  const frames: Uint8Array[] = [];
  video.forEach((frame, index) => {
    const time = Math.round(index * PERIOD);
    const date = dhavClock(time / 1_000);
    frames.push(
      dhavFrame({
        type: frame.key ? DHAV_TYPES.key : DHAV_TYPES.delta,
        number: index,
        date,
        timestamp: time,
        extension: frame.key
          ? concat(
              dhavTags.video(CODECS[codec].tag, RATE),
              dhavTags.size16(...size),
              dhavTags.skipped(),
            )
          : dhavTags.skipped(),
        payload: frame.payload,
      }),
    );
    const sound = audio?.subarray(index * AUDIO_FRAME, (index + 1) * AUDIO_FRAME);
    if (sound?.length) {
      frames.push(
        dhavFrame({
          type: DHAV_TYPES.audio,
          number: index,
          date,
          timestamp: time,
          extension: dhavTags.audio(1, 0x0e, 2),
          payload: sound,
        }),
      );
    }
  });
  return concat(...frames);
}

try {
  // H.264 without B-frames, as recorders write it, a key picture a second,
  // 3 seconds, with a 440 Hz tone in A-law.
  const h264 = join(work, "numbered.h264");
  ffmpeg(
    ...["-f", "lavfi", "-i", picture(3)],
    ...["-c:v", "libx264", "-preset", "fast", "-crf", "10", "-pix_fmt", "yuv420p"],
    ...["-threads", "1", "-g", String(RATE), "-bf", "0", "-x264-params", "aud=1:scenecut=0"],
    ...exact,
    ...["-f", "h264", h264],
  );
  const alaw = join(work, "tone.al");
  ffmpeg(
    ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000:duration=3"],
    ...["-c:a", "pcm_alaw", "-ac", "1", "-fflags", "+bitexact", "-f", "alaw", alaw],
  );
  writeFileSync(
    join(out, "numbered.dav"),
    dav("h264", [256, 32], pictures(readFileSync(h264), "h264"), readFileSync(alaw)),
  );

  // HEVC, which Chromium and Firefox don't decode, half a second, no sound.
  const hevc = join(work, "numbered.hevc");
  ffmpeg(
    ...["-f", "lavfi", "-i", picture(0.48)],
    ...["-c:v", "libx265", "-preset", "ultrafast", "-crf", "30", "-pix_fmt", "yuv420p"],
    ...["-x265-params", "log-level=error:pools=none:frame-threads=1:aud=1:bframes=0:keyint=25"],
    ...exact,
    ...["-f", "hevc", hevc],
  );
  writeFileSync(
    join(out, "hevc.dav"),
    dav("hevc", [256, 32], pictures(readFileSync(hevc), "hevc")),
  );
} finally {
  rmSync(work, { recursive: true });
}
