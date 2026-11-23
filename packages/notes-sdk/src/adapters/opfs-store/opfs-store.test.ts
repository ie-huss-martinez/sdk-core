import { describe, expect, it, vi } from "vitest";
import { indexOf, notebookOf, pageOf } from "../../../test/contracts/notes-store.contract.js";
import type { NotesStore } from "../../core/ports/notes-store.js";
import { createOpfsNotesStore } from "./opfs-store.js";

// Node has no origin private file system: this is the store on a server.
// The store on real storage is tested in opfs-store.browser.test.ts.

const ASSET = `sha256:${"0".repeat(64)}`;

const STORAGE_CALLS: Readonly<Record<string, (store: NotesStore) => Promise<unknown>>> = {
  readIndex: (store) => store.readIndex(),
  writeIndex: (store) => store.writeIndex(indexOf()),
  listNotebooks: (store) => store.listNotebooks(),
  readNotebook: (store) => store.readNotebook("n1"),
  writeNotebook: (store) => store.writeNotebook(notebookOf("n1")),
  deleteNotebook: (store) => store.deleteNotebook("n1"),
  readPage: (store) => store.readPage("n1", "p1"),
  writePage: (store) => store.writePage("n1", pageOf("p1")),
  deletePage: (store) => store.deletePage("n1", "p1"),
  listAssets: (store) => store.listAssets("n1"),
  readAsset: (store) => store.readAsset("n1", ASSET),
  writeAsset: (store) => store.writeAsset("n1", ASSET, new Blob(["x"])),
  deleteAsset: (store) => store.deleteAsset("n1", ASSET),
  writePageText: (store) => store.writePageText({ notebook: "n1", page: "p1", typed: "" }),
  readPageTexts: (store) => store.readPageTexts(),
};

describe("createOpfsNotesStore on a server", () => {
  it("can be created and closed without a browser", () => {
    expect(() => createOpfsNotesStore().close()).not.toThrow();
    expect(() => createOpfsNotesStore({ name: "Other_library-2" }).close()).not.toThrow();
  });

  it.each(["", "a/b", "../x", "a b", "a.b", "caf\u00e9", "x".repeat(65), 5 as unknown as string])(
    "refuses the storage name %j",
    (name) => {
      expect(() => createOpfsNotesStore({ name })).toThrow(TypeError);
    },
  );

  it.each(Object.entries(STORAGE_CALLS))(
    "rejects %s by naming the feature that is missing",
    async (_, call) => {
      const store = createOpfsNotesStore();
      await expect(call(store)).rejects.toMatchObject({
        name: "NotesError",
        code: "UNSUPPORTED_ENVIRONMENT",
        details: { feature: "navigator.storage.getDirectory" },
      });
      store.close();
    },
  );

  it("refuses an unsafe id before it looks for storage", async () => {
    const store = createOpfsNotesStore();
    await expect(store.readNotebook("../x")).rejects.toMatchObject({
      code: "INVALID_DOCUMENT",
      details: { reason: "invalid-id" },
    });
    await expect(store.writePage("n1", pageOf("a/b"))).rejects.toMatchObject({
      code: "INVALID_DOCUMENT",
      details: { reason: "invalid-id" },
    });
    await expect(store.readAsset("n1", "../x")).rejects.toMatchObject({
      code: "INVALID_DOCUMENT",
      details: { reason: "invalid-asset" },
    });
    store.close();
  });

  it("can't tell whether storage is kept, and can't ask for it", async () => {
    const store = createOpfsNotesStore();
    await expect(store.persistence()).resolves.toEqual({ persisted: undefined });
    await expect(store.requestPersistence()).resolves.toBe(false);
    store.close();
  });

  it("takes a subscription and gives it up", () => {
    const store = createOpfsNotesStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    expect(() => stop()).not.toThrow();
    store.close();
    expect(listener).not.toHaveBeenCalled();
  });

  it("rejects every call once closed", async () => {
    const store = createOpfsNotesStore();
    store.close();
    for (const call of Object.values(STORAGE_CALLS)) {
      await expect(call(store)).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    }
    await expect(store.lockNotebook("n1")).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    await expect(store.persistence()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
    await expect(store.requestPersistence()).rejects.toMatchObject({ code: "STORAGE_FAILED" });
  });
});
