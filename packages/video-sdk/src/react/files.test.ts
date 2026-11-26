import { describe, expect, it } from "vitest";
import { ACCEPT } from "./files.js";

describe("what the file pickers accept", () => {
  it("lists every container the SDK opens, by type where browsers have one, and by extension", () => {
    const accepted = ACCEPT.split(",");
    expect(accepted).toEqual(
      expect.arrayContaining(["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"]),
    );
    // A DAV recording has no MIME type: without its extension, a picker greys it out.
    expect(accepted).toEqual(expect.arrayContaining([".mp4", ".mov", ".webm", ".mkv", ".dav"]));
  });
});
