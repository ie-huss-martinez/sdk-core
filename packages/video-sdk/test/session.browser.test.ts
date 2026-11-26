import { describe, expect, it } from "vitest";
import { createVideoEngine } from "../src/adapters/video-engine.js";
import { createVideoSession, isVideoError, planFrames, type VideoEngine } from "../src/index.js";
import landscapeVp8 from "./fixtures/video/landscape-vp8.webm?url";
import numberedDav from "./fixtures/video/numbered.dav?url";
import offsetWebm from "./fixtures/video/offset.webm?url";

/** The real engine, counting the sources that are open. */
function counted(engine: VideoEngine) {
  const open = new Set<string>();
  return {
    open,
    engine: {
      ...engine,
      async open(...args: Parameters<VideoEngine["open"]>) {
        const info = await engine.open(...args);
        open.add(info.id);
        return info;
      },
      async close(id: string) {
        open.delete(id);
        return engine.close(id);
      },
    } satisfies VideoEngine,
  };
}

const blob = async (url: string) => (await fetch(url)).blob();

// The session over the SDK's own engine and real files, in each browser
// engine (docs/adr/0003).
describe("a video session over the real engine", () => {
  it("inserts real files, and leaves nothing open after a cancelled insert or destroy", async () => {
    const real = createVideoEngine();
    const { engine, open } = counted(real);
    const session = createVideoSession({ engine });

    await session.insert(await blob(landscapeVp8));
    const plan = session.getSnapshot().plan;
    expect(plan?.output).toMatchObject({
      width: 1280,
      height: 720,
      frameRate: { num: 30, den: 1 },
    });
    expect(plan && planFrames(plan)).toBe(60);

    // A source whose time starts at 1 s inserts like any other.
    await session.insert(await blob(offsetWebm));
    expect(session.getSnapshot().plan?.clips).toHaveLength(2);
    expect(open.size).toBe(2);

    // Cancelled as the engine opens the file: nothing new stays open.
    const controller = new AbortController();
    const cancelling = {
      ...engine,
      open: (...args: Parameters<VideoEngine["open"]>) => {
        controller.abort();
        return engine.open(...args);
      },
    } satisfies VideoEngine;
    const second = createVideoSession({ engine: cancelling });
    let error: unknown;
    try {
      await second.insert(await blob(landscapeVp8), { signal: controller.signal });
    } catch (caught) {
      error = caught;
    }
    expect(isVideoError(error, "ABORTED")).toBe(true);
    expect(open.size).toBe(2);

    await session.destroy();
    await second.destroy();
    expect(open.size).toBe(0);
    await real.destroy();
  });

  it("inserts a DAV recording, with its size, its rate and its sound", async () => {
    const engine = createVideoEngine();
    const session = createVideoSession({ engine });
    // As a file picker gives it: a name, and no type a browser knows.
    const bytes = await (await blob(numberedDav)).arrayBuffer();
    await session.insert(new File([bytes], "recording.dav"));
    const { plan, sources, warnings } = session.getSnapshot();
    expect(plan?.output).toMatchObject({ width: 256, height: 32, frameRate: { num: 25, den: 1 } });
    expect(plan && planFrames(plan)).toBe(75);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      container: "dav",
      audio: { codec: "alaw", sampleRate: 8_000, channels: 1 },
    });
    expect(sources[0]?.unplayableAudio).toBeUndefined();
    expect(warnings).toEqual([]);
    await session.destroy();
    await engine.destroy();
  });
});
