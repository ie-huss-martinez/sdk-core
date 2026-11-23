import { describe, expect, it } from "vitest";
import {
  describeNotesStoreContract,
  notebookOf,
} from "../../../test/contracts/notes-store.contract.js";
import type { NotesNotebook } from "../../core/model/notebook.js";
import { createMemoryNotesStore } from "./memory-store.js";

describeNotesStoreContract("createMemoryNotesStore", createMemoryNotesStore);

describe("createMemoryNotesStore", () => {
  it("keeps nothing on the device, and says so", async () => {
    const store = createMemoryNotesStore();
    await expect(store.persistence()).resolves.toEqual({ persisted: false });
    await expect(store.requestPersistence()).resolves.toBe(false);
  });

  it("keeps each store's data and locks to itself", async () => {
    const first = createMemoryNotesStore();
    const second = createMemoryNotesStore();
    await first.writeNotebook(notebookOf("n1"));
    await first.lockNotebook("n1");
    await expect(second.readNotebook("n1")).resolves.toBeUndefined();
    expect(await second.lockNotebook("n1")).toBeTypeOf("function");
  });

  it("gives a file back without its media type, as a file system does", async () => {
    const store = createMemoryNotesStore();
    const name = `sha256:${"0".repeat(64)}`;
    await store.writeAsset("n1", name, new Blob(["%PDF"], { type: "application/pdf" }));
    const read = await store.readAsset("n1", name);
    expect(read?.type).toBe("");
    await expect(read?.text()).resolves.toBe("%PDF");
  });

  // What real storage couldn't give back fails here too, on reading, as it would there.
  it.each<[string, Partial<Record<keyof NotesNotebook, unknown>>, string]>([
    ["a field JSON can't hold", { updatedAt: Number.NaN }, "invalid-time"],
    ["a field that is missing", { title: undefined }, "malformed-document"],
    ["no pages", { pages: [], outline: [] }, "malformed-document"],
  ])("refuses to read back a notebook with %s", async (_, changes, reason) => {
    const store = createMemoryNotesStore();
    await store.writeNotebook(notebookOf("n1", changes as Partial<NotesNotebook>));
    await expect(store.readNotebook("n1")).rejects.toMatchObject({
      code: "INVALID_DOCUMENT",
      details: { reason },
    });
  });

  it("refuses a document that can't be written as JSON", async () => {
    const store = createMemoryNotesStore();
    const cyclic: Record<string, unknown> = { ...notebookOf("n1") };
    cyclic["pages"] = [cyclic];
    await expect(store.writeNotebook(cyclic as unknown as NotesNotebook)).rejects.toMatchObject({
      code: "INVALID_DOCUMENT",
      details: { reason: "malformed-document" },
    });
    await expect(store.readNotebook("n1")).resolves.toBeUndefined();
  });

  it("refuses a page text that isn't text", async () => {
    const store = createMemoryNotesStore();
    await expect(
      store.writePageText({ notebook: "n1", page: "p1", typed: 5 as unknown as string }),
    ).rejects.toMatchObject({
      code: "INVALID_DOCUMENT",
      details: { reason: "malformed-document" },
    });
    await expect(store.readPageTexts()).resolves.toEqual([]);
  });
});
