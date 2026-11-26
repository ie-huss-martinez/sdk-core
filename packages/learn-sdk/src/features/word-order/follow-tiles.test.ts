import { describe, expect, it } from "vitest";
import { followTiles, tilePositions } from "./follow-tiles.js";

const tiles = ["ฉัน", "กิน", "ข้าว"];
const other = ["ข้าว", "ฉัน", "กิน"];

describe("followTiles", () => {
  it("finds each text's tile once, even when texts repeat", () => {
    expect(tilePositions(["a", "b", "a"], ["a", "a", "b"])).toEqual([0, 2, 1]);
    expect(tilePositions(tiles, ["x"])).toEqual([null]);
  });

  it("carries a tile's new text into the other order", () => {
    expect(followTiles(tiles, ["ฉัน", "ดื่ม", "ข้าว"], other)).toEqual(["ข้าว", "ฉัน", "ดื่ม"]);
  });

  it("adds a new tile at the end, and drops a removed one", () => {
    expect(followTiles(tiles, [...tiles, "แล้ว"], other)).toEqual([...other, "แล้ว"]);
    expect(followTiles(tiles, ["ฉัน", "ข้าว"], other)).toEqual(["ข้าว", "ฉัน"]);
  });

  it("leaves the order alone for a move, or for changes it can't follow", () => {
    expect(followTiles(tiles, ["กิน", "ฉัน", "ข้าว"], other)).toBe(other);
    expect(followTiles(tiles, ["x", "y", "ข้าว"], other)).toBe(other);
  });

  it("changes only the tile that changed when its text repeats", () => {
    expect(followTiles(["a", "b", "a"], ["a", "b", "c"], ["a", "a", "b"])).toEqual(["a", "c", "b"]);
  });
});
