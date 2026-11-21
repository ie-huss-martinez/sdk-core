import { describe, expect, it } from "vitest";
import { defineConfig } from "vitest/config";
import { browserTimeouts, endToEndTimeouts, unitTimeouts } from "./timeouts.js";

describe("the family's test timeouts (ADR 0057)", () => {
  it("gives unit tests 30 s, for a test and for a hook", () => {
    expect(unitTimeouts).toEqual({ testTimeout: 30_000, hookTimeout: 30_000 });
  });

  it("gives browser tests 60 s, for a test and for a hook", () => {
    expect(browserTimeouts).toEqual({ testTimeout: 60_000, hookTimeout: 60_000 });
  });

  it("gives Playwright tests 60 s, and their waiting assertions 10 s", () => {
    expect(endToEndTimeouts).toEqual({ timeout: 60_000, expect: { timeout: 10_000 } });
  });

  it("can't be changed by a repository that imports them", () => {
    expect(Object.isFrozen(unitTimeouts)).toBe(true);
    expect(Object.isFrozen(browserTimeouts)).toBe(true);
    expect(Object.isFrozen(endToEndTimeouts) && Object.isFrozen(endToEndTimeouts.expect)).toBe(
      true,
    );
  });

  it("spreads into a Vitest project's test options, with its other options", () => {
    const config = defineConfig({
      test: {
        projects: [{ test: { name: "unit", include: ["src/**/*.test.ts"], ...unitTimeouts } }],
      },
    });

    expect(config).toMatchObject({
      test: { projects: [{ test: { name: "unit", testTimeout: 30_000, hookTimeout: 30_000 } }] },
    });
  });

  it("applies to this package's own unit tests", ({ task }) => {
    expect(task.timeout).toBe(unitTimeouts.testTimeout);
  });
});
