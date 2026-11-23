// The real browsers, with no Playwright: the OS opens the page in the
// runner's own Firefox or Safari, and guidepup presses the keys through the
// screen reader and reads what it says.
//
// Usage: node native.mjs <nvda-firefox | voiceover-safari>
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { nvda, voiceOver } from "@guidepup/guidepup";

const pairing = process.argv[2];
const url = pathToFileURL(
  new URL("./page.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
).href;
const reader = pairing === "nvda-firefox" ? nvda : voiceOver;
const result = { pairing, url, steps: [], error: null };

try {
  await reader.start();
  if (pairing === "nvda-firefox") {
    spawn("cmd", ["/c", "start", "", "firefox", "-new-window", url], {
      stdio: "ignore",
      detached: true,
    });
  } else {
    execFileSync("open", ["-a", "Safari", url]);
  }
  // Give the browser time to start and the screen reader time to read the page.
  await sleep(15_000);
  await reader.clearSpokenPhraseLog();
  for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Enter"]) {
    await reader.press(key);
    await sleep(1_000);
    result.steps.push({ key, said: await reader.lastSpokenPhrase() });
  }
  await sleep(1_500);
  result.log = await reader.spokenPhraseLog();
} catch (error) {
  result.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  writeFileSync(`transcript-${pairing}.json`, JSON.stringify(result, null, 2));
  await reader.stop().catch(() => undefined);
}
