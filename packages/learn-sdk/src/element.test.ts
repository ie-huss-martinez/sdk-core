import { describe, expect, it } from "vitest";

describe("the element entry on a server (ADR 0009)", () => {
  it("does nothing on import, and can't define the element without custom elements", async () => {
    expect(globalThis.customElements).toBeUndefined();
    const { defineLearnEditorElement } = await import("./element.js");
    expect(globalThis.customElements).toBeUndefined();
    expect(() => defineLearnEditorElement()).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_ENVIRONMENT" }),
    );
  });
});
