import { describe, expect, it } from "vitest";
import { writeFile } from "./opfs-files.js";

// `writeFile` against a folder in memory, where a test decides when another
// writer gets in. The real file system is tested in opfs-store.browser.test.ts.

const notFound = (): DOMException => new DOMException("gone", "NotFoundError");

/**
 * A folder that does what `writeFile` asks of one. A file's text replaces
 * the earlier one only when its writer closes, as in the browser.
 */
function fakeFolder() {
  const files = new Map<string, string>();
  const removed: string[] = [];
  const fake = {
    files,
    /** The names removed, in order. */
    removed,
    /** What every write is refused with, when set. */
    failure: undefined as unknown,
    /** Called once a file was looked at, and when a failed write was dropped. */
    afterLook: (): void => undefined,
    afterAbort: (): void => undefined,
    directory: {
      getFileHandle: async (name: string, options?: FileSystemGetFileOptions) => {
        if (!files.has(name)) {
          if (!options?.create) throw notFound();
          files.set(name, "");
        }
        return {
          getFile: async () => {
            const file = new Blob([files.get(name) ?? ""]);
            fake.afterLook();
            return file;
          },
          createWritable: async () => {
            let pending = "";
            return {
              write: async (data: string) => {
                if (fake.failure !== undefined) throw fake.failure;
                pending += data;
              },
              close: async () => {
                files.set(name, pending);
              },
              abort: async () => {
                fake.afterAbort();
              },
            };
          },
        };
      },
      removeEntry: async (name: string) => {
        if (!files.delete(name)) throw notFound();
        removed.push(name);
      },
    } as unknown as FileSystemDirectoryHandle,
  };
  return fake;
}

const failed = new DOMException("The disk gave up.", "InvalidStateError");
const THEIRS = '{"theirs":true}';

describe("writeFile", () => {
  it("stores the whole file, and replaces the one before it", async () => {
    const folder = fakeFolder();
    await writeFile(folder.directory, "p1.json", "first", true);
    expect(folder.files.get("p1.json")).toBe("first");
    await writeFile(folder.directory, "p1.json", "second", false);
    expect(folder.files.get("p1.json")).toBe("second");
  });

  it.each([true, false])(
    "keeps what the file held when the write fails (alone: %s)",
    async (alone) => {
      const folder = fakeFolder();
      await writeFile(folder.directory, "p1.json", "first", alone);
      folder.failure = failed;
      await expect(writeFile(folder.directory, "p1.json", "second", alone)).rejects.toBe(failed);
      expect(folder.files.get("p1.json")).toBe("first");
      expect(folder.removed).toEqual([]);
    },
  );

  it("removes the empty file a failed first write made, while it's alone at the file", async () => {
    const folder = fakeFolder();
    folder.failure = failed;
    await expect(writeFile(folder.directory, "p1.json", "mine", true)).rejects.toBe(failed);
    expect(folder.files.has("p1.json")).toBe(false);
  });

  it("leaves the file a writer that takes no lock filled meanwhile, even while alone", async () => {
    const folder = fakeFolder();
    folder.failure = failed;
    folder.afterAbort = () => folder.files.set("p1.json", THEIRS);
    await expect(writeFile(folder.directory, "p1.json", "mine", true)).rejects.toBe(failed);
    expect(folder.files.get("p1.json")).toBe(THEIRS);
  });

  it("leaves the empty file of a failed first write where other writers can't be kept out", async () => {
    const folder = fakeFolder();
    folder.failure = failed;
    await expect(writeFile(folder.directory, "p1.json", "mine", false)).rejects.toBe(failed);
    expect(folder.files.get("p1.json")).toBe("");
    // The next write fills it.
    folder.failure = undefined;
    await writeFile(folder.directory, "p1.json", "mine", false);
    expect(folder.files.get("p1.json")).toBe("mine");
  });

  it("never removes what another tab stored after the file was seen empty", async () => {
    const folder = fakeFolder();
    folder.failure = failed;
    // Another tab stores its document between this one's look at the file and its removal.
    folder.afterLook = () => folder.files.set("p1.json", THEIRS);
    await expect(writeFile(folder.directory, "p1.json", "mine", false)).rejects.toBe(failed);
    expect(folder.removed).toEqual([]);
    expect(folder.files.has("p1.json")).toBe(true);
  });
});
