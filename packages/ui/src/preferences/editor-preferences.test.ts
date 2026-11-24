import { describe, expect, it } from "vitest";
import { defaultEditorPreferences, readEditorPreferences } from "./editor-preferences.js";

describe("readEditorPreferences", () => {
  it("gives the defaults for anything that isn't an object", () => {
    for (const value of [null, undefined, "dark", 3, []]) {
      expect(readEditorPreferences(value)).toEqual(defaultEditorPreferences);
    }
  });

  it("keeps valid fields, defaults invalid ones and drops unknown ones", () => {
    const read = readEditorPreferences({
      theme: "dark",
      mode: "wizard",
      tools: "icons",
      tips: "yes",
      motion: "reduced",
      colour: "red",
    });

    expect(read).toEqual({
      ...defaultEditorPreferences,
      theme: "dark",
      tools: "icons",
      motion: "reduced",
    });
    expect(Object.isFrozen(read)).toBe(true);
  });

  it("takes defaults of the host's own, ignoring invalid ones", () => {
    expect(readEditorPreferences({}, { mode: "advanced", density: "tiny" as never })).toEqual({
      ...defaultEditorPreferences,
      mode: "advanced",
    });
  });

  it("ignores inherited and hostile keys", () => {
    const hostile = JSON.parse('{"__proto__": {"theme": "dark"}, "constructor": 1}');
    expect(readEditorPreferences(hostile)).toEqual(defaultEditorPreferences);
    expect(readEditorPreferences(Object.create({ theme: "dark" }))).toEqual(
      defaultEditorPreferences,
    );
  });

  it("never throws, whatever reading the object does", () => {
    const throwing = {
      mode: "expert",
      get theme(): string {
        throw new Error("unavailable");
      },
    };
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();

    expect(readEditorPreferences(throwing)).toEqual({
      ...defaultEditorPreferences,
      mode: "expert",
    });
    expect(readEditorPreferences(proxy)).toEqual(defaultEditorPreferences);
    expect(readEditorPreferences({}, throwing as Partial<typeof defaultEditorPreferences>)).toEqual(
      {
        ...defaultEditorPreferences,
        mode: "expert",
      },
    );
  });
});
