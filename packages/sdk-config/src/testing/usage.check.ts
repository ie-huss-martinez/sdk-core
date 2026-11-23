// Type-checked by `pnpm typecheck`, never run or published: a TypeScript test
// project's use of the testing entries, through the package's own exports, as
// a repository imports them. A declaration that's missing or wrong fails
// here, as TS7016 did before they shipped.

import {
  type EntrySize,
  entryBudget,
  entryFiles,
  exportCosts,
  formatKilobytes,
  importBudget,
  importCost,
  keptCode,
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
import {
  CRASHING_FIREFOX,
  removeLabelledByElements,
  withFirefoxLabelledByGuard,
} from "@hussmartinez/sdk-config/testing/firefox-labelled-by";
import {
  FONT_CONFIG_ENV,
  FONT_CONFIG_FILE,
  fontLaunchEnv,
  usesFontRules,
} from "@hussmartinez/sdk-config/testing/fonts";
import requireBrowserTestImage, {
  ALLOW_HOST_ENV,
  browserTestImageProblem,
  CONTAINER_ENV,
  webServersFor,
} from "@hussmartinez/sdk-config/testing/require-image";
import {
  type ScreenReader,
  type ScreenReaderOptions,
  startScreenReader,
} from "@hussmartinez/sdk-config/testing/screen-reader";
import {
  browserTimeouts,
  endToEndTimeouts,
  unitTimeouts,
} from "@hussmartinez/sdk-config/testing/timeouts";
import { test } from "@playwright/test";
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

/** The screen reader, as a browser test uses it: a step, and what it said. */
export async function spoken(): Promise<string[]> {
  const options: ScreenReaderOptions = { container: document.body, quietMs: 150, timeoutMs: 3000 };
  const reader: ScreenReader = await startScreenReader(options);
  try {
    const phrases: string[] = await reader.spoken(() => userEvent.keyboard("{Tab}"));
    const quiet: string[] = await reader.spoken();
    // @ts-expect-error: a step is a function, not the keys.
    await reader.spoken("{Tab}");
    return [...phrases, ...quiet];
  } finally {
    await reader.stop();
  }
}

/** The guard, as a script of a repository's own would use it. */
export function guard(): string | undefined {
  const marker: "HM_VISUAL_CONTAINER" = CONTAINER_ENV;
  const bypass: "HM_ALLOW_HOST_BROWSER" = ALLOW_HOST_ENV;
  const problem: string | undefined = browserTestImageProblem({ [marker]: "1", [bypass]: "" });
  requireBrowserTestImage();
  return problem;
}

/** The web servers of a Playwright configuration: one, several or none, typed as given. */
export function guardedServers(): {
  webServer: { command: string; url: string; timeout: number }[];
} {
  const vite = { command: "vite preview", url: "http://localhost:4310", timeout: 60_000 };
  const several: { command: string; url: string; timeout: number }[] = webServersFor([vite, vite]);
  const one: { command: string; url: string; timeout: number }[] = webServersFor(vite, {});
  const none: (typeof vite)[] = webServersFor<typeof vite>(undefined);
  return { webServer: [...several, ...one, ...none] };
}

/** The size entry, as a repository's .size-limit.js and scripts use it. */
export async function sizes(): Promise<string> {
  const files: string[] = entryFiles("dist/index.js");
  const size: EntrySize = await measureEntry("dist/index.js");
  return `${files.length} files, ${formatKilobytes(size.built)}, ${formatKilobytes(size.minified)}`;
}

/** The budgets and the import measurements, as a .size-limit.js and a script use them. */
export async function budgets(): Promise<number> {
  const checks = [
    entryBudget({ name: "Core (.)", entry: "dist/index.js", limit: "17 kB" }),
    importBudget({
      name: "Import: floor",
      entry: "dist/index.js",
      imports: "{ a }",
      limit: "1 kB",
    }),
  ];
  const { size } = await importCost("dist/index.js", "{ a }");
  const [floor] = await exportCosts("dist/index.js");
  const { functions, calls } = await keptCode("dist/index.js", "{ a }");
  return checks.length + size + (floor?.size ?? 0) + functions + calls.length;
}

/** The family's timeouts, as a Vitest project and a Playwright configuration spread them. */
export function timeouts(): number {
  const unit: { testTimeout: number; hookTimeout: number } = { ...unitTimeouts };
  const browser: { testTimeout: number; hookTimeout: number } = { ...browserTimeouts };
  const playwright: { timeout: number; expect: { timeout: number } } = { ...endToEndTimeouts };
  return unit.testTimeout + browser.hookTimeout + playwright.timeout + playwright.expect.timeout;
}

/** The font rules, as an end-to-end configuration and a runner of a repository's own would use them. */
export function fonts(): { use: { launchOptions: { env: Record<string, string> } } } {
  const variable: "FONTCONFIG_FILE" = FONT_CONFIG_ENV;
  const file: string = FONT_CONFIG_FILE;
  const applies: boolean = usesFontRules({ HM_VISUAL_CONTAINER: "1" });
  const env: Record<string, string> = fontLaunchEnv();
  return { use: { launchOptions: { env: applies ? env : { ...env, [variable]: file } } } };
}

/** The Firefox guard, with Playwright's own `test` and one a repository extended. */
export function firefoxGuard(): string {
  const guarded = withFirefoxLabelledByGuard(test);
  // A fixture of the repository's own that navigates before handing the page on.
  const extended = withFirefoxLabelledByGuard(
    test.extend<{ editor: string }>({
      editor: "pdf",
      page: async ({ page, editor }, use) => {
        await page.goto(`/${editor}`);
        await use(page);
      },
    }),
  );
  guarded("a page", async ({ page }) => {
    await page.addInitScript(removeLabelledByElements);
  });
  extended("a fixture of the repository's own", async ({ page, editor }) => {
    await page.goto(`/${editor}`);
  });
  const { revision, browserVersion }: { revision: string; browserVersion: string } =
    CRASHING_FIREFOX;
  return `${revision} ${browserVersion}`;
}
