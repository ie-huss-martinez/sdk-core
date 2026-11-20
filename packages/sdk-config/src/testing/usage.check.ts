// Type-checked by `pnpm typecheck`, never run or published: a TypeScript test
// project's use of the testing entries, through the package's own exports, as
// a repository imports them. A declaration that's missing or wrong fails
// here, as TS7016 did before they shipped.

import {
  type EntrySize,
  entryFiles,
  formatKilobytes,
  measureEntry,
} from "@hussmartinez/sdk-config/size";
import {
  type AudioOutput,
  audioOutput,
  resetAudioOutput,
} from "@hussmartinez/sdk-config/testing/audio-output";
import {
  type ConformanceCase,
  type ConformanceFile,
  checkCase,
  conforms,
  describeConformance,
  readConformance,
  schemaValidator,
} from "@hussmartinez/sdk-config/testing/conformance";
import requireBrowserTestImage, {
  ALLOW_HOST_ENV,
  browserTestImageProblem,
  CONTAINER_ENV,
} from "@hussmartinez/sdk-config/testing/require-image";
import type { TestContext } from "vitest";
import { userEvent } from "vitest/browser";

/** The README's pattern: probe inside the test that needs audio, and skip it with the reason. */
export async function needAudio(context: TestContext): Promise<void> {
  const audio = await audioOutput({ activate: (button) => userEvent.click(button) });
  if (!audio.available) {
    context.skip(audio.reason.trim());
  }
}

export async function usage(): Promise<void> {
  const audio: AudioOutput = await audioOutput({
    activate: async (button: HTMLButtonElement) => button.click(),
    measureMs: 200,
  });
  const skipped: boolean = !audio.available && audio.reason.length > 0;
  const ratio: number | undefined = audio.clockRatio;
  resetAudioOutput();

  const file: ConformanceFile = readConformance(new URL("file:///cases.json"));
  const first: ConformanceCase | undefined = file.cases[0];
  const errors: string[] = schemaValidator("schema.json")({ format: "hm-plan" });
  const same: boolean = conforms([1], [1], 0.5);
  const problem: string | undefined = first ? await checkCase(first, (input) => input) : undefined;
  describeConformance("cases.json", (input: { lengths: number[] }) => input.lengths.length);

  // @ts-expect-error: audioOutput takes options, not a number.
  await audioOutput(5);
  // @ts-expect-error: the subject isn't a number.
  const wrong: number = file.subject;

  void [skipped, ratio, errors, same, problem, wrong];
}

/** The guard, as a script of a repository's own would use it. */
export function guard(): string | undefined {
  const marker: "HM_VISUAL_CONTAINER" = CONTAINER_ENV;
  const bypass: "HM_ALLOW_HOST_BROWSER" = ALLOW_HOST_ENV;
  const problem: string | undefined = browserTestImageProblem({ [marker]: "1", [bypass]: "" });
  requireBrowserTestImage();
  return problem;
}

/** The size entry, as a repository's .size-limit.js and scripts use it. */
export async function sizes(): Promise<string> {
  const files: string[] = entryFiles("dist/index.js");
  const size: EntrySize = await measureEntry("dist/index.js");
  return `${files.length} files, ${formatKilobytes(size.built)}, ${formatKilobytes(size.minified)}`;
}
