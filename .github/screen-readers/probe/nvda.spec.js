import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { nvdaTest as test } from "@guidepup/playwright";

test.use({ screenReaderStartOptions: { capture: "initial" } });

test("NVDA hears the probe page", async ({ page, nvda }, info) => {
  await page.goto(
    pathToFileURL(new URL("./page.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
      .href,
  );
  await page.locator("h1").waitFor();
  await nvda.navigateToWebContent();
  await nvda.clearSpokenPhraseLog();
  for (let i = 0; i < 5; i += 1) {
    await nvda.press("Tab");
  }
  await nvda.press("Shift+Tab");
  await nvda.press("Enter");
  await page.waitForTimeout(1500);
  const log = await nvda.spokenPhraseLog();
  writeFileSync(`transcript-nvda-${info.project.name}.json`, JSON.stringify(log, null, 2));
});
