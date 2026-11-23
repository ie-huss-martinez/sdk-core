import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Rolldown } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { externalPackages } from "./vite.config.js";

/**
 * Builds the package in memory with its real Vite config, so these checks see
 * exactly what dist/ would contain without writing to it.
 */
async function buildInMemory(): Promise<Array<Rolldown.OutputChunk | Rolldown.OutputAsset>> {
  const result = await build({
    configFile: new URL("vite.config.ts", import.meta.url).pathname,
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => ("output" in output ? output.output : []));
}

const files = await buildInMemory();

function chunk(fileName: string): Rolldown.OutputChunk {
  const found = files.find((file) => file.fileName === fileName);
  if (found?.type !== "chunk") {
    throw new Error(`${fileName} wasn't built as a JavaScript chunk`);
  }
  return found;
}

describe("the built package", () => {
  it('starts the React entry with "use client" (ADR 0007)', () => {
    expect(chunk("react.js").code).toMatch(/^"use client";\n/);
  });

  it('keeps "use client" out of the core and element entries (ADR 0004)', () => {
    expect(chunk("index.js").code).not.toContain("use client");
    expect(chunk("element.js").code).not.toContain("use client");
  });

  it("emits the stylesheet as its own file", () => {
    const styles = files.find((file) => file.fileName === "styles.css");
    expect(styles?.type).toBe("asset");
  });

  it("imports sdk-core and React instead of bundling them", () => {
    expect(externalPackages).toEqual(
      expect.arrayContaining(["@hussmartinez/sdk-core", "react", "react-dom"]),
    );
    // The core's code is in a chunk the entries share, so the import is looked for in every chunk.
    const imported = files.flatMap((file) => (file.type === "chunk" ? file.imports : []));
    expect(imported).toContain("@hussmartinez/sdk-core");
    for (const file of files) {
      if (file.type === "chunk") {
        // Bundled React or sdk-core would bring their own copies of these, and
        // a page with several SDKs would load sdk-core more than once.
        expect(file.code, file.fileName).not.toContain("react.transitional.element");
        expect(file.code, file.fileName).not.toContain("class SdkError");
      }
    }
  });

  it("keeps pdf-sdk, ui and perfect-freehand as imports, never bundled", () => {
    expect(externalPackages).toEqual(
      expect.arrayContaining(["@hussmartinez/pdf-sdk", "@hussmartinez/ui", "perfect-freehand"]),
    );
    for (const file of files) {
      if (file.type === "chunk") {
        // pdf-sdk's own error class and perfect-freehand's entry would be here if bundled.
        expect(file.code, file.fileName).not.toContain("class PdfError");
        expect(file.code, file.fileName).not.toContain("function getStrokeOutlinePoints");
      }
    }
  });

  it("depends on no test framework", () => {
    for (const file of files) {
      if (file.type === "chunk") {
        expect(
          file.imports.filter((name) => /^(?:vitest|jest|@jest\/|node:test)/.test(name)),
          file.fileName,
        ).toEqual([]);
      }
    }
  });

  it("generates no code from data: no eval and no Function constructor (ADR 0028)", () => {
    for (const file of files) {
      if (file.type === "chunk") {
        expect(file.code, file.fileName).not.toMatch(/\beval\(/);
        expect(file.code, file.fileName).not.toMatch(/new Function\b/);
      }
    }
  });

  it("uses the production JSX runtime and leaks no local paths", () => {
    const code = files.flatMap((file) => (file.type === "chunk" ? [file.code] : [])).join("\n");
    expect(code).not.toContain("jsx-dev-runtime");
    expect(code).not.toContain(process.cwd());
  });

  it("never imports CSS from JavaScript (ADR 0004)", () => {
    const javascript = files.filter((file) => file.type === "chunk");
    expect(javascript.length).toBeGreaterThan(0);
    for (const file of javascript) {
      expect(file.imports.filter((name) => name.endsWith(".css"))).toEqual([]);
      expect(file.code).not.toMatch(/import\s*["'][^"']+\.css["']/);
    }
  });
});

/**
 * Builds the package to a temporary folder inside the repository, so the
 * built files resolve their external imports from its node_modules, as they
 * would in an application.
 */
const temporaryBuild = (async () => {
  const parent = join(process.cwd(), "temp");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "build-test-"));
  await build({
    configFile: new URL("vite.config.ts", import.meta.url).pathname,
    logLevel: "silent",
    build: { outDir: directory, emptyOutDir: true },
  });
  return directory;
})();

afterAll(async () => {
  await rm(await temporaryBuild, { recursive: true, force: true });
});

describe("importing on a server", () => {
  // The unit project runs in Node, without a DOM, as a server would.
  it.each(["index.js", "element.js"])(
    "imports %s without touching browser APIs (ADR 0004, ADR 0007)",
    async (entry) => {
      expect(globalThis).not.toHaveProperty("window");
      expect(globalThis).not.toHaveProperty("customElements");
      const url = pathToFileURL(join(await temporaryBuild, entry)).href;
      await expect(import(url)).resolves.toBeTypeOf("object");
    },
  );
});

describe("the core on a server", () => {
  // Browser globals the core must never need to read documents and apply
  // commands. Instead of assuming they're absent, the test replaces each with
  // a getter that records the access and throws, for as long as the core is
  // imported and used.
  const BROWSER_GLOBALS = [
    "window",
    "document",
    "navigator",
    "localStorage",
    "indexedDB",
    "customElements",
    "HTMLElement",
    "MediaRecorder",
  ];

  it("reads a notebook, applies a command and writes a PDF with the built core, touching no browser global", async () => {
    const touched: string[] = [];
    const saved = new Map<string, PropertyDescriptor | undefined>();
    for (const name of BROWSER_GLOBALS) {
      saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          touched.push(name);
          throw new Error(`The core touched ${name}`);
        },
      });
    }
    try {
      // A fresh copy, so evaluating the module counts as well as calling it.
      const url = `${pathToFileURL(join(await temporaryBuild, "index.js")).href}?server`;
      const core = (await import(url)) as typeof import("./src/index.js");
      // The stores and adapters are created, but nothing of the browser is touched until they're used.
      core.createOpfsNotesStore();
      core.createNotesPdfEngine();
      core.createMediaNotesRecorder();
      const notebook = core.readNotesNotebookDocument({
        format: "hm-notes-notebook",
        version: 1,
        id: "book",
        title: "Physics",
        cover: "blue",
        createdAt: 0,
        updatedAt: 0,
        pages: [{ id: "page", width: 59_500, height: 84_200, template: "lined" }],
        outline: [],
        recordings: [],
      });
      const stroke = {
        id: "stroke",
        type: "stroke",
        tool: "pen",
        color: "#1f2937",
        size: 220,
        points: [1_000, 1_000, 500, 9_000, 5_000, 500],
      } as const;
      const applied = core.applyNotesCommand(
        { notebook, pages: new Map([["page", { id: "page", items: [] }]]) },
        core.readNotesCommandDocument({ type: "notes.addItems", page: "page", items: [stroke] }),
      );
      expect(applied.state.pages.get("page")?.items).toHaveLength(1);
      expect(applied.inverse).toEqual({ type: "notes.removeItems", page: "page", ids: ["stroke"] });
      const pdf = await core.writeNotesPdf([
        {
          info: notebook.pages[0] as (typeof notebook.pages)[number],
          items: [stroke],
          paper: true,
        },
      ]);
      expect(new TextDecoder().decode(pdf.slice(0, 8))).toBe("%PDF-1.7");
      expect(() =>
        core.readNotesNotebookDocument({ format: "something-else", version: 1 }),
      ).toThrow(expect.objectContaining({ name: "NotesError", code: "UNSUPPORTED_FORMAT" }));
    } finally {
      for (const [name, descriptor] of saved) {
        if (descriptor) {
          Object.defineProperty(globalThis, name, descriptor);
        } else {
          delete (globalThis as Record<string, unknown>)[name];
        }
      }
    }
    expect(touched).toEqual([]);
  });
});
