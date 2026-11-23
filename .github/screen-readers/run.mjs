#!/usr/bin/env node
// Runs the manual passes' scripts with a real screen reader in a real
// browser, and writes what it said, step by step (sdk-core ADR 0066).
//
// - The browser is the real one: Chrome through Playwright's `chrome`
//   channel, and the runner's own Firefox and Safari, opened by the OS. The
//   screen reader reads the browser's accessibility tree, so a patched build
//   wouldn't be evidence for real users.
// - Every key is pressed through guidepup, at the OS level, as a person would.
// - With --assert, a step whose expected fragments weren't said fails the run.
//   Without it, the run fails only when the screen reader or the browser
//   can't start, and the transcripts are for a person to read.
//
// Usage: node run.mjs --reader <nvda|voiceover> --browser <chrome|firefox|safari>
//   --scripts <name,…> --catalogue <url> --learn <url> --out <dir> [--runs <n>] [--assert]

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { nvda, voiceOver } from "@guidepup/guidepup";
import { chromium } from "playwright";
import { missingFragments, outcome, platformKey, waitForSpeech } from "./steps.mjs";

const { values } = parseArgs({
  options: {
    reader: { type: "string" },
    browser: { type: "string" },
    scripts: { type: "string" },
    catalogue: { type: "string", default: "http://127.0.0.1:6006" },
    learn: { type: "string", default: "http://127.0.0.1:4340" },
    out: { type: "string", default: "transcripts" },
    runs: { type: "string", default: "1" },
    assert: { type: "boolean", default: false },
  },
});

const PAIRINGS = { nvda: ["chrome", "firefox"], voiceover: ["safari"] };
const { reader: readerName, browser: browserName } = values;
if (!PAIRINGS[readerName]?.includes(browserName) || !values.scripts) {
  process.stderr.write(
    "Usage: node run.mjs --reader nvda --browser <chrome|firefox>, or --reader voiceover --browser safari, with --scripts <name,…>\n",
  );
  process.exit(2);
}
const reader = readerName === "nvda" ? nvda : voiceOver;
const FIREFOX = "C:\\Program Files\\Mozilla Firefox\\firefox.exe";
/**
 * Everything the screen reader says for a command. Guidepup's default,
 * "initial", keeps only the first utterance, which drops a control's name
 * said after its container, or an announcement said after a focus change.
 */
const CAPTURE = { capture: true };
const print = (text) => process.stdout.write(`${text}\n`);
const run = (file, args) => execFileSync(file, args, { encoding: "utf8" }).trim();

/** The versions a transcript records, so a person can tell what said it. */
function versions() {
  const system =
    process.platform === "darwin"
      ? `macOS ${run("sw_vers", ["-productVersion"])}`
      : `${os.version()} ${os.release()}`;
  let browser = "";
  let screenReader = "";
  try {
    if (browserName === "firefox") {
      browser = run(FIREFOX, ["--version"]);
    } else if (browserName === "safari") {
      browser = `Safari ${run("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", "/Applications/Safari.app/Contents/Info.plist"])}`;
    }
    if (readerName === "nvda") {
      const cache =
        process.env.GUIDEPUP_SCREEN_READERS_PATH ??
        join(process.env.LOCALAPPDATA ?? "", "guidepup");
      const exe = readdirSync(cache, { recursive: true }).find((file) =>
        String(file).endsWith("nvda.exe"),
      );
      screenReader = exe
        ? `NVDA ${run("powershell", ["-NoProfile", "-Command", `(Get-Item '${join(cache, String(exe))}').VersionInfo.ProductVersion`])}`
        : "NVDA, version not found";
    } else {
      screenReader = `VoiceOver, ${system}`;
    }
  } catch (error) {
    print(`Couldn't read a version: ${error instanceof Error ? error.message : error}`);
  }
  return { system, browser, screenReader };
}

/**
 * Opens a page in the real browser and returns how to close it.
 *
 * @param {string} url
 */
async function openPage(url) {
  if (browserName === "chrome") {
    const browser = await chromium.launch({ channel: "chrome", headless: false });
    let page;
    try {
      page = await browser.newPage();
      await page.goto(url);
      await page.bringToFront();
    } catch (error) {
      // Nothing returns a way to close it, so close it here.
      await browser.close().catch(() => undefined);
      throw error;
    }
    return {
      version: `Chrome ${browser.version()}`,
      close: () => browser.close(),
      // What has focus, from the page itself, to tell late speech from
      // focus that went somewhere else. Only Chrome has a page to ask.
      focus: () =>
        page.evaluate(() => {
          const element = document.activeElement;
          if (!element || element === document.body) {
            return "(the page)";
          }
          const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
          const name =
            element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 60) ?? "";
          return `${role}: ${name}`;
        }),
    };
  }
  if (browserName === "firefox") {
    spawn(FIREFOX, ["-new-window", url], { detached: true, stdio: "ignore" }).unref();
    return {
      close: async () => {
        try {
          run("taskkill", ["/IM", "firefox.exe", "/F"]);
        } catch {
          // Already gone.
        }
      },
    };
  }
  run("open", ["-a", "Safari", url]);
  return {
    close: async () => {
      try {
        run("osascript", ["-e", 'tell application "Safari" to quit']);
      } catch {
        // Already gone.
      }
    },
  };
}

/**
 * VoiceOver's setting for its spoken instructions, such as "You are currently
 * on a slider. To start interacting with the slider, press…": "Speak
 * instructions" in VoiceOver Utility's verbosity hints. Found among the
 * settings guidepup reads, on the hosted macOS runner. VoiceOver failed to
 * start with it set to `false` where it stores a number, so it's turned off
 * in the type it has.
 */
const INSTRUCTIONS = "SCRShouldOutputVOInstructions";

/** The setting's "off", in the type VoiceOver stores it with. */
function off(value) {
  return typeof value === "number" ? 0 : typeof value === "string" ? "0" : false;
}

/**
 * Starts the screen reader. VoiceOver starts once to read its setting, then
 * again with its spoken instructions off. If that second start fails, it
 * starts as it was, and the transcript says the instructions stayed on.
 */
async function startReader() {
  if (readerName === "nvda") {
    await reader.start(CAPTURE);
    return {};
  }
  await voiceOver.start(CAPTURE);
  const before = voiceOver.getSettings()[INSTRUCTIONS];
  await voiceOver.stop();
  const wanted = { [INSTRUCTIONS]: off(before) };
  try {
    await voiceOver.start({ ...CAPTURE, settings: wanted });
  } catch (error) {
    print(
      `::warning title=VoiceOver::It didn't start with ${JSON.stringify(wanted)}, so its instructions stay on: ${error instanceof Error ? error.message : error}`,
    );
    await voiceOver.start(CAPTURE);
    return { voiceOverInstructions: { before, applied: null } };
  }
  const after = voiceOver.getSettings()[INSTRUCTIONS];
  print(
    `VoiceOver's ${INSTRUCTIONS}: ${JSON.stringify(before)} before, ${JSON.stringify(after)} now.`,
  );
  return { voiceOverInstructions: { before, applied: after } };
}

const count = async () => (await reader.spokenPhraseLog()).length;

/** Runs one script and returns its transcript, with `info` recorded in it. */
async function runScript(script, attempt, info) {
  const url = new URL(script.path, sites[script.site]).href;
  const transcript = {
    script: script.name,
    reader: readerName,
    browser: browserName,
    run: attempt,
    url,
    ...info,
    steps: [],
    error: null,
  };
  let page;
  try {
    page = await openPage(url);
    transcript.browserVersion = page.version;
    // Let the page load and the screen reader finish reading it before the
    // first key, so the first step hears only its own speech. Firefox, opened
    // by the OS, starts slower, and NVDA says nothing in it until it has
    // read the page: with 8 s, a first Tab that did reach the list was
    // heard as nothing.
    await sleep(browserName === "firefox" ? 15_000 : 8_000);
    await waitForSpeech(count, { firstMs: 3_000, quietMs: 2_000 });
    for (const step of script.steps) {
      const before = await count();
      for (const key of step.keys) {
        await reader.press(platformKey(key, process.platform), CAPTURE);
      }
      const { count: after, settled } = await waitForSpeech(count, { since: before });
      const log = await reader.spokenPhraseLog();
      const said = [...log].slice(before, after);
      const focus = await page.focus?.().catch(() => undefined);
      const missing = missingFragments(said, step.expect);
      transcript.steps.push({
        ...step,
        said,
        missing,
        ...outcome(step, missing, `${readerName}-${browserName}`),
        settled,
        ...(focus ? { focus } : {}),
      });
    }
  } catch (error) {
    transcript.error = String(error?.stack ?? error);
  } finally {
    await page?.close().catch(() => undefined);
    await sleep(2_000);
  }
  return transcript;
}

/** A Markdown summary of a transcript, for the job's summary page. */
function summary(transcript) {
  const lines = [
    `### ${transcript.script}: ${transcript.reader} with ${transcript.browser}, run ${transcript.run}`,
    "",
    `${transcript.screenReader}; ${transcript.browserVersion ?? transcript.browser}; ${transcript.system}`,
    "",
  ];
  if (transcript.error) {
    lines.push("```", transcript.error, "```");
    return lines.join("\n");
  }
  lines.push("| Step | Said | Missing | Result |", "|---|---|---|---|");
  for (const step of transcript.steps) {
    const cell = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
    const result = step.issue ? `${step.outcome}, ${step.issue}` : step.outcome;
    lines.push(
      `| ${cell(step.does)} | ${cell(step.said.join(" / ")) || "(nothing)"} | ${cell(step.missing.join(", "))} | ${result} |`,
    );
  }
  return lines.join("\n");
}

/**
 * Safari's first launch on a fresh runner reads its window title over the
 * first page, and the first script's transcript is lost to it. It's started
 * once, with nothing to test, and quit, before the scripts run.
 */
async function warmUp() {
  if (browserName !== "safari") {
    return;
  }
  const page = await openPage("about:blank");
  await sleep(15_000);
  await page.close();
  await sleep(3_000);
}

const names = values.scripts
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const scripts = await Promise.all(
  names.map(async (name) => (await import(`./scripts/${name}.mjs`)).default),
);
mkdirSync(values.out, { recursive: true });
const sites = { catalogue: values.catalogue, learn: values.learn };

let failed = false;
const base = versions();
try {
  const setup = await startReader();
  await warmUp();
  for (let attempt = 1; attempt <= Number(values.runs); attempt += 1) {
    for (const script of scripts) {
      const transcript = await runScript(script, attempt, { ...base, ...setup });
      const file = join(
        values.out,
        `${readerName}-${browserName}-${script.name}-run${attempt}.json`,
      );
      writeFileSync(file, JSON.stringify(transcript, null, 2));
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary(transcript)}\n\n`);
      }
      const failing = transcript.steps.filter((step) => step.outcome === "fail");
      const fixed = transcript.steps.filter((step) => step.outcome === "unexpected pass");
      const expected = transcript.steps.filter((step) => step.outcome === "expected failure");
      if (transcript.error) {
        failed = true;
        print(
          `::error title=${script.name}::${readerName} with ${browserName} couldn't run it: ${transcript.error.split("\n")[0]}`,
        );
      } else if (failing.length > 0 || fixed.length > 0) {
        const where = [
          ...failing.map((step) => `"${step.does}" missed ${step.missing.join(", ")}`),
          ...fixed.map(
            (step) =>
              `"${step.does}" now passes, though it's marked as failing for ${step.issue}: if that's fixed, remove the marker with the fix`,
          ),
        ].join("; ");
        if (values.assert) {
          failed = true;
          print(`::error title=${script.name}::${where}`);
        } else {
          print(`::notice title=${script.name}::Report only: ${where}`);
        }
      } else {
        print(
          `${script.name}, run ${attempt}: as expected${expected.length > 0 ? `, with ${expected.length} known failures still failing` : ""}.`,
        );
      }
    }
  }
} catch (error) {
  failed = true;
  print(
    `::error title=${readerName}::The screen reader couldn't start: ${error instanceof Error ? error.message : error}`,
  );
} finally {
  await reader.stop().catch(() => undefined);
}
process.exitCode = failed ? 1 : 0;
