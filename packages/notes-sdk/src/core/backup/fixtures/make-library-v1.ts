import { writeFileSync } from "node:fs";
import type { NotesStore } from "../../ports/notes-store.js";
import { createNotesBackup } from "../backup.js";
import {
  LIBRARY_V1_PICTURE_NAME,
  LIBRARY_V1_TIME,
  libraryV1Index,
  libraryV1Notebooks,
  libraryV1Pages,
  libraryV1Picture,
} from "./library-v1.js";

/**
 * Writes `library-v1.zip`: a backup in version 1 of the format, which every
 * later release must keep restoring. It was run once, when version 1 was
 * fixed, and no test runs it.
 *
 * Don't run it again to make a test pass. A file written by a later
 * release proves nothing about backups people already have, so the script
 * refuses to replace an existing file.
 *
 * From `packages/notes-sdk`:
 *
 * ```sh
 * pnpm exec esbuild src/core/backup/fixtures/make-library-v1.ts --bundle \
 *   --platform=node --format=esm --outfile=/tmp/notes-sdk/backup/make-library-v1.mjs
 * node /tmp/notes-sdk/backup/make-library-v1.mjs src/core/backup/fixtures/library-v1.zip
 * ```
 */

const [, , output] = process.argv;
if (output === undefined) throw new Error("Pass the path of the file to write.");

// A backup only reads notebooks, pages and files, so that's all this store has.
const store = {
  readNotebook: async (id) => libraryV1Notebooks.find((notebook) => notebook.id === id),
  readPage: async (notebook, page) => libraryV1Pages[notebook]?.find((entry) => entry.id === page),
  readAsset: async (_notebook, asset) =>
    asset === LIBRARY_V1_PICTURE_NAME ? new Blob([libraryV1Picture]) : undefined,
} satisfies Pick<NotesStore, "readNotebook" | "readPage" | "readAsset"> as NotesStore;

const backup = await createNotesBackup(store, libraryV1Index, { now: () => LIBRARY_V1_TIME });
// "wx" fails if the file exists.
writeFileSync(output, new Uint8Array(await backup.arrayBuffer()), { flag: "wx" });
process.stdout.write(`Wrote ${output}: ${backup.size} bytes.\n`);
