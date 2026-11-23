import { describeConformance } from "@hussmartinez/sdk-config/testing/conformance";
import { expect, it } from "vitest";
import { commandCases, documentCases, print } from "./generate.js";
import { applyToState, readAndWrite } from "./run.js";

/**
 * The conformance vectors (sdk-core ADR 0045): the same files a port in
 * another language runs, checked here against the TypeScript SDK's readers
 * and `applyNotesCommand`. test/formats.test.ts checks them against the
 * schemas.
 */

const DOCUMENTS = new URL("../../conformance/hm-notes-documents.json", import.meta.url);
const COMMANDS = new URL("../../conformance/hm-notes-commands.json", import.meta.url);

it("keeps the checked-in cases up to date with their generator", async () => {
  // `pnpm conformance:update` rewrites them.
  await expect(`${print(documentCases())}\n`).toMatchFileSnapshot(
    "../../conformance/hm-notes-documents.json",
  );
  await expect(`${print(commandCases())}\n`).toMatchFileSnapshot(
    "../../conformance/hm-notes-commands.json",
  );
});

describeConformance(DOCUMENTS, readAndWrite);
describeConformance(COMMANDS, applyToState);
