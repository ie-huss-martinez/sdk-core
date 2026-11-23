import { readFileSync } from "node:fs";
import { describeConformance, readConformance } from "@hussmartinez/sdk-config/testing/conformance";
import { expect, it } from "vitest";
import { commandCases, documentCases, print } from "./generate.js";
import { applyToState, hasLoneSurrogate, hasNegativeZero, readAndWrite } from "./run.js";

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

it("holds no lone surrogate, so the files load in any JSON library", () => {
  // A decoder that keeps text as UTF-8, such as Rust's serde_json, refuses a whole file for
  // one. docs/formats/conformance.md says where lone surrogates are tested instead.
  for (const file of [DOCUMENTS, COMMANDS]) {
    expect(hasLoneSurrogate(JSON.parse(readFileSync(file, "utf8")))).toBe(false);
  }
});

it("tells a lone surrogate from a pair, in text and in a field's name", () => {
  expect(hasLoneSurrogate({ title: ["\u{1F4D3}", "plain"] })).toBe(false);
  expect(hasLoneSurrogate({ title: ["a\uD83D"] })).toBe(true);
  expect(hasLoneSurrogate({ title: "\uDCD3\uD83D" })).toBe(true);
  expect(hasLoneSurrogate({ "\uDCD3": 1 })).toBe(true);
});

it("reads negative zero as zero, in every case that holds one", () => {
  const cases = [...readConformance(DOCUMENTS).cases, ...readConformance(COMMANDS).cases];
  const withOne = cases.filter((testCase) => hasNegativeZero(testCase.input));
  // The hand-written cases of each format, at least.
  expect(withOne.length).toBeGreaterThanOrEqual(5);
  for (const testCase of cases) {
    expect(hasNegativeZero(testCase.expected), testCase.name).toBe(false);
  }
  expect(hasNegativeZero({ at: [1, -0] })).toBe(true);
  expect(hasNegativeZero({ at: [1, 0] })).toBe(false);
});
