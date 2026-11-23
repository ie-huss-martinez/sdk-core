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
import { missingFragments, waitForQuiet } from "./steps.mjs";

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
    const page = await browser.newPage();
    await page.goto(url);
    await page.bringToFront();
    return { version: `Chrome ${browser.version()}`, close: () => browser.close() };
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

/** Settings whose key names a hint, anywhere in VoiceOver's settings, turned off. */
function hintsOff(settings) {
  /** @type {Record<string, unknown>} */
  const off = {};
  const found = [];
  const visit = (object, target, path) => {
    for (const [key, value] of Object.entries(object ?? {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const inner = {};
        visit(value, inner, [...path, key]);
        if (Object.keys(inner).length > 0) {
          target[key] = inner;
        }
      } else if (/hint/i.test(key)) {
        found.push({ key: [...path, key].join("."), value });
        if (value === true || value === 1) {
          target[key] = typeof value === "boolean" ? false : 0;
        }
      }
    }
  };
  visit(settings, off, []);
  return { off, found };
}

/** Starts the screen reader. VoiceOver starts with its spoken hints off. */
async function startReader() {
  if (readerName === "nvda") {
    await reader.start();
    return {};
  }
  await voiceOver.start();
  const { off, found } = hintsOff(voiceOver.getSettings());
  await voiceOver.stop();
  print(`VoiceOver's hint settings: ${JSON.stringify(found)}`);
  await voiceOver.start({ settings: off });
  return { voiceOverHintSettings: found, voiceOverSettingsApplied: off };
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
    // first key, so the first step hears only its own speech.
    await sleep(8_000);
    await waitForQuiet(count, { quietMs: 2_000 });
    let heard = await count();
    for (const step of script.steps) {
      for (const key of step.keys) {
        await reader.press(key);
      }
      const { count: after, settled } = await waitForQuiet(count);
      const log = await reader.spokenPhraseLog();
      const said = [...log].slice(heard, after);
      heard = after;
      transcript.steps.push({
        ...step,
        said,
        missing: missingFragments(said, step.expect),
        settled,
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
  lines.push("| Step | Said | Missing |", "|---|---|---|");
  for (const step of transcript.steps) {
    const cell = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
    lines.push(
      `| ${cell(step.does)} | ${cell(step.said.join(" / ")) || "(nothing)"} | ${cell(step.missing.join(", "))} |`,
    );
  }
  return lines.join("\n");
}

const names = values.scripts.split(",");
const scripts = await Promise.all(
  names.map(async (name) => (await import(`./scripts/${name}.mjs`)).default),
);
mkdirSync(values.out, { recursive: true });
const sites = { catalogue: values.catalogue, learn: values.learn };

let failed = false;
const base = versions();
try {
  const setup = await startReader();
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
      const missing = transcript.steps.filter((step) => step.missing.length > 0);
      if (transcript.error) {
        failed = true;
        print(
          `::error title=${script.name}::${readerName} with ${browserName} couldn't run it: ${transcript.error.split("\n")[0]}`,
        );
      } else if (missing.length > 0) {
        const where = missing
          .map((step) => `"${step.does}" missed ${step.missing.join(", ")}`)
          .join("; ");
        if (values.assert) {
          failed = true;
          print(`::error title=${script.name}::${where}`);
        } else {
          print(`::notice title=${script.name}::Report only: ${where}`);
        }
      } else {
        print(`${script.name}, run ${attempt}: every expected fragment was said.`);
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
