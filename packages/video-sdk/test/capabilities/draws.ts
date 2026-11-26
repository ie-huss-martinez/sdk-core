// Whether a real decoded frame can be drawn into a worker's 2D OffscreenCanvas
// and read back (docs/adr/0006): directly with drawImage(frame), and through
// createImageBitmap(frame), the fallback.
import { frontCheck } from "../../src/adapters/front-check/front-check.js";
import { frameBounds } from "../../src/adapters/mediabunny/frame-bounds.js";
import { decodeVideoFrames } from "../../src/adapters/mediabunny/video-decoder.js";
import { openTracks } from "../../src/adapters/open-tracks.js";
import { probeFile } from "../../src/adapters/probe.js";
import { videoLimits } from "../../src/core/errors/video-limits.js";

export interface Draws {
  readonly videoFrame: boolean;
  readonly imageBitmap: boolean;
}

/** Draws `source` on a cleared canvas and reads its centre back: opaque means drawn. */
function drawsOpaque(draw: (context: OffscreenCanvasRenderingContext2D) => void): boolean {
  try {
    const canvas = new OffscreenCanvas(64, 36);
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.clearRect(0, 0, 64, 36);
    draw(context);
    return context.getImageData(32, 18, 1, 1).data[3] === 255;
  } catch {
    return false;
  }
}

export async function draws(file: Blob): Promise<Draws> {
  let result: Draws = { videoFrame: false, imageBitmap: false };
  try {
    const probe = await probeFile(file, videoLimits.resolve());
    const tracks = await openTracks(file, await frontCheck(file, videoLimits.resolve()));
    try {
      const { video } = tracks;
      const config = await video.config();
      if (config === null) return result;
      const range = { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY, limit: 1 };
      await decodeVideoFrames(video.packets(), config, frameBounds(probe), range, async (frame) => {
        const videoFrame = drawsOpaque((context) => context.drawImage(frame, 0, 0, 64, 36));
        let imageBitmap = false;
        try {
          const bitmap = await createImageBitmap(frame);
          imageBitmap = drawsOpaque((context) => context.drawImage(bitmap, 0, 0, 64, 36));
          bitmap.close();
        } catch {
          imageBitmap = false;
        }
        result = { videoFrame, imageBitmap };
      });
    } finally {
      tracks.dispose();
    }
  } catch {
    // Nothing decoded: neither path can be measured, so both stay false.
  }
  return result;
}
