import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runInBareRealm } from "./bare-realm.js";

/** @type {string[]} */
const folders = [];

/**
 * Writes modules into a scratch folder inside the package, so a bare import
 * in them resolves as one in a package's built entry would.
 *
 * @param {Record<string, string>} files
 * @returns {Promise<string>} The path of `entry.js`.
 */
async function entry(files) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const folder = await mkdtemp(join(root, ".tmp-bare-realm-"));
  folders.push(folder);
  for (const [name, source] of Object.entries(files)) {
    await mkdir(join(folder, name, ".."), { recursive: true });
    await writeFile(join(folder, name), source);
  }
  return join(folder, "entry.js");
}

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});

describe("runInBareRealm", () => {
  it("runs the probe on the entry's exports, with what it imports bundled in", async () => {
    const path = await entry({
      "entry.js": 'export { double } from "./shared/maths.js";\nexport const name = "entry";\n',
      "shared/maths.js": "export const double = (value) => value * 2;\n",
    });
    expect(
      await runInBareRealm({
        entry: path,
        probe: "(sdk) => ({ name: sdk.name, four: sdk.double(2) })",
      }),
    ).toEqual({ name: "entry", four: 4 });
  });

  it("has the language, and nothing a browser, Node or ICU adds", async () => {
    const path = await entry({ "entry.js": "export const ok = true;\n" });
    const probe = `() => ({
      language: [typeof Map, typeof Promise, typeof JSON, typeof Array.from, typeof Object.hasOwn],
      missing: [typeof Intl, typeof "".normalize, typeof document, typeof localStorage, typeof Blob,
        typeof TextEncoder, typeof URL, typeof structuredClone, typeof crypto, typeof setTimeout, typeof process],
    })`;
    expect(await runInBareRealm({ entry: path, probe })).toEqual({
      language: ["function", "function", "object", "function", "function"],
      missing: Array.from({ length: 11 }, () => "undefined"),
    });
  });

  it.each([
    ["Intl", "new Intl.NumberFormat('en')", /Intl is not defined/],
    ["normalize", "'a'.normalize('NFC')", /normalize is not a function/],
    ["a DOM global", "document.title", /document is not defined/],
    ["structuredClone", "structuredClone({})", /structuredClone is not defined/],
  ])("fails an entry that needs %s when it loads", async (_what, expression, message) => {
    const path = await entry({ "entry.js": `export const value = ${expression};\n` });
    await expect(runInBareRealm({ entry: path, probe: "() => 1" })).rejects.toThrow(message);
  });

  it("keeps what a bundler would drop: unused and marked pure still loads", async () => {
    const path = await entry({
      "entry.js": 'import "./unused.js";\nexport const ok = true;\n',
      "unused.js": "const formatter = /* @__PURE__ */ new Intl.NumberFormat('en');\n",
    });
    await expect(runInBareRealm({ entry: path, probe: "(sdk) => sdk.ok" })).rejects.toThrow(
      /Intl is not defined/,
    );
  });

  it("fails a probe that calls what needs one, and passes one that's guarded", async () => {
    const path = await entry({
      "entry.js": [
        "export const unguarded = (text) => text.normalize('NFC');",
        "export const guarded = (text) => (typeof text.normalize === 'function' ? text.normalize('NFC') : text);",
        "",
      ].join("\n"),
    });
    await expect(
      runInBareRealm({ entry: path, probe: "(sdk) => sdk.unguarded('a')" }),
    ).rejects.toThrow(/normalize is not a function/);
    expect(await runInBareRealm({ entry: path, probe: "(sdk) => sdk.guarded('a')" })).toBe("a");
  });

  it("replaces a stubbed package with exports that do nothing, and leaves the rest real", async () => {
    const path = await entry({
      "entry.js": [
        'import { View, Platform } from "react-native";',
        "export const kinds = [typeof View, typeof Platform, View()];",
        "",
      ].join("\n"),
    });
    expect(
      await runInBareRealm({ entry: path, stubs: ["react-native"], probe: "(sdk) => sdk.kinds" }),
    ).toEqual(["function", "function", null]);
    // Without the stub, the package isn't there to bundle.
    await expect(runInBareRealm({ entry: path, probe: "(sdk) => sdk.kinds" })).rejects.toThrow();
  });

  it("waits for a probe that returns a promise", async () => {
    const path = await entry({
      "entry.js": "export const later = async (value) => (await Promise.resolve(value)) + 1;\n",
    });
    expect(await runInBareRealm({ entry: path, probe: "(sdk) => sdk.later(1)" })).toBe(2);
    await expect(
      runInBareRealm({ entry: path, probe: "async () => { throw new TypeError('no'); }" }),
    ).rejects.toThrow("no");
  });

  it("provides only the globals a test names, for what React Native sets up itself", async () => {
    const path = await entry({
      "entry.js":
        "export const aborted = () => { const c = new AbortController(); c.abort(); return c.signal.aborted; };\n",
    });
    const probe = "(sdk) => [sdk.aborted(), typeof setTimeout]";
    await expect(runInBareRealm({ entry: path, probe })).rejects.toThrow(
      /AbortController is not defined/,
    );
    expect(await runInBareRealm({ entry: path, probe, provided: ["AbortController"] })).toEqual([
      true,
      "undefined",
    ]);
    await expect(
      runInBareRealm({ entry: path, probe, provided: ["NoSuchGlobal"] }),
    ).rejects.toThrow(/no NoSuchGlobal here/);
  });

  it("gives the probe nothing of the test's own realm", async () => {
    const path = await entry({ "entry.js": "export const ok = true;\n" });
    const realm = /** @type {{ __leak?: string }} */ (globalThis);
    realm.__leak = "from the test";
    try {
      expect(await runInBareRealm({ entry: path, probe: "() => typeof __leak" })).toBe("undefined");
    } finally {
      delete realm.__leak;
    }
  });
});
