import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// What every example page is checked for: no console error or warning (a
// Content Security Policy violation or a hydration mismatch is reported
// there), no page error, no request to another origin, and no axe finding.

export interface Problems {
  console: string[];
  errors: string[];
  foreignRequests: string[];
}

export function watch(page: Page, origin: string): Problems {
  const problems: Problems = { console: [], errors: [], foreignRequests: [] };
  page.on("console", (message) => {
    // A Content Security Policy violation or a hydration mismatch is reported here.
    if (message.type() === "error" || message.type() === "warning") {
      problems.console.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin)
      problems.foreignRequests.push(url.href);
  });
  return problems;
}

/** Waits until React owns the component, so keys and clicks reach it. */
export async function hydrated(page: Page, selector = ".hm-learn-player"): Promise<void> {
  await page.waitForFunction((root) => {
    const element = document.querySelector(root);
    return element !== null && Object.keys(element).some((key) => key.startsWith("__react"));
  }, selector);
}

export async function noViolations(page: Page, selector = ".hm-learn-player"): Promise<void> {
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map(
      (v) => `${v.id}: ${v.help} at ${v.nodes.map((n) => n.target.join(" ")).join("; ")}`,
    ),
  ).toEqual([]);
}
