import { writeFileSync } from "node:fs";
import { voiceOverTest as test } from "@guidepup/playwright";

test("VoiceOver hears the probe page", async ({ page, voiceOver }, info) => {
  await page.goto(new URL("./page.html", import.meta.url).href);
  await page.locator("h1").waitFor();
  await voiceOver.interact();
  await voiceOver.clearSpokenPhraseLog();
  for (let i = 0; i < 5; i += 1) {
    await voiceOver.press("Tab");
  }
  await voiceOver.press("Shift+Tab");
  await voiceOver.press("Enter");
  await page.waitForTimeout(1500);
  const log = await voiceOver.spokenPhraseLog();
  writeFileSync(`transcript-voiceover-${info.project.name}.json`, JSON.stringify(log, null, 2));
});
