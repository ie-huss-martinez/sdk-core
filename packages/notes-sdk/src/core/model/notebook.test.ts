import { describe, expect, it } from "vitest";
import type { NotesAssetReference, NotesItem } from "./items.js";
import { boxOf } from "./items.js";
import {
  NOTES_PAGE_SIZES,
  type NotesNotebook,
  type NotesPage,
  notebookAssetReferences,
  notebookAssets,
} from "./notebook.js";
import { NOTES_MAX_PAGE_SIDE, NOTES_MIN_PAGE_SIDE } from "./portable.js";

const asset = (pair: string, mediaType: string, size = 10): NotesAssetReference => ({
  asset: `sha256:${pair.repeat(32)}`,
  mediaType,
  size,
});

const PDF = asset("0a", "application/pdf");
const OTHER_PDF = asset("0b", "application/pdf");
const AUDIO = asset("0c", "audio/webm");
const PICTURE = asset("0d", "image/png");
const OTHER_PICTURE = asset("0e", "image/jpeg");

const image = (id: string, reference: NotesAssetReference): NotesItem => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  image: reference,
});
const stroke: NotesItem = {
  id: "s",
  type: "stroke",
  tool: "pen",
  color: "#000000",
  size: 200,
  points: [0, 0, 500],
};

const NOTEBOOK: NotesNotebook = {
  id: "nb",
  title: "Handouts",
  cover: "green",
  createdAt: 0,
  updatedAt: 0,
  pages: [
    {
      id: "p1",
      width: 59_500,
      height: 84_200,
      template: "blank",
      background: { pdf: PDF, pageIndex: 0 },
    },
    {
      id: "p2",
      width: 59_500,
      height: 84_200,
      template: "blank",
      background: { pdf: PDF, pageIndex: 1 },
    },
    { id: "p3", width: 59_500, height: 84_200, template: "lined" },
    {
      id: "p4",
      width: 59_500,
      height: 84_200,
      template: "blank",
      background: { pdf: OTHER_PDF, pageIndex: 0 },
    },
  ],
  outline: [],
  recordings: [{ id: "r1", audio: AUDIO, startedAt: 0, duration: 1_000 }],
};

const names = (assets: Map<string, NotesAssetReference>) => [...assets.keys()];

describe("notebookAssets", () => {
  it("lists each PDF and recording of the notebook once, by its hash", () => {
    const assets = notebookAssets(NOTEBOOK, []);
    expect(names(assets)).toStrictEqual([PDF.asset, OTHER_PDF.asset, AUDIO.asset]);
    expect(assets.get(PDF.asset)).toStrictEqual(PDF);
    expect(assets.get(AUDIO.asset)).toStrictEqual(AUDIO);
  });

  it("adds the pictures on the pages given, once each", () => {
    const pages: NotesPage[] = [
      { id: "p1", items: [stroke, image("i1", PICTURE), image("i2", PICTURE)] },
      { id: "p3", items: [image("i1", OTHER_PICTURE), image("i3", PICTURE)] },
    ];
    expect(names(notebookAssets(NOTEBOOK, pages))).toStrictEqual([
      PDF.asset,
      OTHER_PDF.asset,
      AUDIO.asset,
      PICTURE.asset,
      OTHER_PICTURE.asset,
    ]);
  });

  it("lists nothing for a notebook of plain pages with no ink", () => {
    const plain: NotesNotebook = {
      ...NOTEBOOK,
      pages: [NOTEBOOK.pages[2] ?? { id: "p", width: 59_500, height: 84_200, template: "lined" }],
      recordings: [],
    };
    expect(notebookAssets(plain, [{ id: "p3", items: [stroke] }]).size).toBe(0);
  });

  it("takes any iterable of pages, such as a map's values", () => {
    const pages = new Map<string, NotesPage>([["p1", { id: "p1", items: [image("i1", PICTURE)] }]]);
    expect(notebookAssets(NOTEBOOK, pages.values()).has(PICTURE.asset)).toBe(true);
  });

  it("lists a file used as a PDF and as a picture once", () => {
    const pages: NotesPage[] = [
      { id: "p1", items: [image("i1", { ...PDF, mediaType: "image/png" })] },
    ];
    expect(notebookAssets(NOTEBOOK, pages).size).toBe(3);
  });
});

describe("NOTES_PAGE_SIZES", () => {
  it("holds A4 and US Letter, in units of a hundredth of a point", () => {
    expect(NOTES_PAGE_SIZES).toStrictEqual({
      a4: { width: 59_500, height: 84_200 },
      letter: { width: 61_200, height: 79_200 },
    });
  });

  it("holds sizes a page may have", () => {
    for (const size of Object.values(NOTES_PAGE_SIZES)) {
      for (const side of [size.width, size.height]) {
        expect(side).toBeGreaterThanOrEqual(NOTES_MIN_PAGE_SIDE);
        expect(side).toBeLessThanOrEqual(NOTES_MAX_PAGE_SIDE);
        expect(Number.isInteger(side)).toBe(true);
      }
    }
  });
});

describe("boxOf", () => {
  it("gives the rectangle of a picture or a link, and nothing else of it", () => {
    const picture = image("i1", PICTURE);
    if (picture.type !== "image") throw new Error("The fixture is a picture.");
    expect(boxOf({ ...picture, x: 5, y: 6, width: 7, height: 8 })).toStrictEqual({
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    });
    expect(
      boxOf({ id: "l", type: "link", x: 1, y: 2, width: 3, height: 4, page: "p1" }),
    ).toStrictEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });
});

describe("notebookAssetReferences", () => {
  it("gives every reference, in the notebook's order, with the ones that repeat", () => {
    const smaller = { ...PICTURE, size: PICTURE.size - 1 };
    const pages: NotesPage[] = [
      { id: "p1", items: [stroke, image("i1", smaller), image("i2", PICTURE)] },
    ];
    const references = [...notebookAssetReferences(NOTEBOOK, pages)];
    // Each page's PDF, then each recording, then each picture: none is left out for repeating.
    expect(references).toStrictEqual([
      ...NOTEBOOK.pages.flatMap((page) => (page.background ? [page.background.pdf] : [])),
      ...NOTEBOOK.recordings.map((recording) => recording.audio),
      smaller,
      PICTURE,
    ]);
    expect(references.length).toBeGreaterThan(notebookAssets(NOTEBOOK, pages).size);
    // Of the two, the one kept is the last.
    expect(notebookAssets(NOTEBOOK, pages).get(PICTURE.asset)).toStrictEqual(PICTURE);
  });
});
