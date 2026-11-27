import { describe, expect, it, vi } from "vitest";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { decodeFakePdf, encodeFakePdf, type FakePdf } from "../../../test/fakes/fake-pdf.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { everythingIn } from "../../../test/secrets.js";
import { isPdfError, PdfError } from "../errors/pdf-error.js";
import type { PdfEngine } from "../ports/pdf-engine.js";
import {
  createPdfSession,
  type PdfSessionEvent,
  type PdfSessionOptions,
  type PdfSessionSnapshot,
} from "./session.js";

// Password-protected documents in the session (docs/adr/0013): opening them,
// what an export does with the password, and where the password never goes.

const PASSWORD = "user-PASSWORD-sentinel";
const OWNER = "owner-PASSWORD-sentinel";

function pdf(pageCount: number, extra: Partial<FakePdf> = {}): Uint8Array<ArrayBuffer> {
  return encodeFakePdf({
    pages: Array.from({ length: pageCount }, (_, index) => ({ width: 600 + index, height: 800 })),
    ...extra,
  });
}
const locked = (pageCount = 2) => pdf(pageCount, { password: PASSWORD, ownerPassword: OWNER });

function setup(options: Partial<PdfSessionOptions> = {}) {
  const events: PdfSessionEvent[] = [];
  const snapshots: PdfSessionSnapshot[] = [];
  const processor = createFakeProcessor();
  const build = vi.spyOn(processor, "build");
  const session = createPdfSession({
    engine: createFakeEngine(),
    processor,
    onEvent: (event) => events.push(event),
    ...options,
  });
  snapshots.push(session.getSnapshot());
  session.subscribe(() => snapshots.push(session.getSnapshot()));
  const rotate = () =>
    session.execute({
      type: "pdf.rotatePages",
      pages: [session.getSnapshot().plan.pages[0]?.key as string],
      angle: 90,
    });
  return { session, events, snapshots, build, rotate };
}

describe("opening a password-protected document", () => {
  it("rejects with PASSWORD_REQUIRED and no reason until a password is given", async () => {
    const { session, events } = setup();
    const failure = await session.open(locked()).catch((error: unknown) => error);
    expect(isPdfError(failure, "PASSWORD_REQUIRED")).toBe(true);
    expect((failure as PdfError).details).toBeUndefined();
    expect(session.getSnapshot()).toMatchObject({ status: "error", passwordProtected: false });
    expect(events).toEqual([{ type: "failed", operation: "open", code: "PASSWORD_REQUIRED" }]);
  });

  it("rejects a wrong password with the reason incorrect-password, as often as it's wrong", async () => {
    const { session } = setup();
    for (const password of ["nope", "still nope"]) {
      const failure = await session.open(locked(), { password }).catch((error: unknown) => error);
      expect(isPdfError(failure, "PASSWORD_REQUIRED")).toBe(true);
      expect((failure as PdfError).details).toEqual({ reason: "incorrect-password" });
      expect(session.getSnapshot().error).toBe(failure);
    }
    await session.open(locked(), { password: PASSWORD });
    expect(session.getSnapshot()).toMatchObject({
      status: "ready",
      error: undefined,
      passwordProtected: true,
    });
  });

  it("opens with the owner password too", async () => {
    const { session } = setup();
    await session.open(locked(3), { password: OWNER });
    expect(session.getSnapshot()).toMatchObject({ status: "ready", passwordProtected: true });
    expect(session.getSnapshot().plan.pages).toHaveLength(3);
  });

  it("treats an empty password as none", async () => {
    const { session } = setup();
    const failure = await session.open(locked(), { password: "" }).catch((error: unknown) => error);
    expect((failure as PdfError).code).toBe("PASSWORD_REQUIRED");
    expect((failure as PdfError).details).toBeUndefined();
  });

  it("keeps the open document when another's password is missing or wrong", async () => {
    const { session, rotate } = setup();
    await session.open(pdf(2));
    rotate();
    await expect(session.open(locked())).rejects.toBeDefined();
    await expect(session.open(locked(), { password: "nope" })).rejects.toBeDefined();
    expect(session.getSnapshot()).toMatchObject({ status: "ready", canUndo: true });
    expect(session.getSnapshot().error?.details).toEqual({ reason: "incorrect-password" });
  });

  it("calls a wrong password wrong even when the engine doesn't say so", async () => {
    // A host's engine that only knows PASSWORD_REQUIRED.
    const fake = createFakeEngine();
    const engine: PdfEngine = {
      open: (source, options) =>
        fake.open(source, options).catch((error: unknown) => {
          throw isPdfError(error, "PASSWORD_REQUIRED")
            ? new PdfError("PASSWORD_REQUIRED", "Encrypted.")
            : error;
        }),
      destroy: () => fake.destroy(),
    };
    const { session } = setup({ engine });
    const failure = await session.open(locked(), { password: "nope" }).catch((error) => error);
    expect((failure as PdfError).details).toEqual({ reason: "incorrect-password" });
  });

  it("limits the whole open, both attempts together, to the processing time", async () => {
    // Each attempt takes 60 ms of a 100 ms limit: either alone would pass.
    const fake = createFakeEngine();
    const engine: PdfEngine = {
      open: async (source, options) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        if (options?.signal?.aborted) throw options.signal.reason;
        return fake.open(source, options);
      },
      destroy: () => fake.destroy(),
    };
    const { session } = setup({ engine, filePolicy: { maxProcessingTime: 100 } });
    await expect(session.open(locked(), { password: PASSWORD })).rejects.toSatisfy((error) =>
      isPdfError(error, "PROCESSING_TIME_EXCEEDED"),
    );
  });

  it("doesn't keep a password the document didn't need", async () => {
    const { session, build, rotate } = setup();
    // No password to open, with or without an owner password of its own.
    for (const bytes of [pdf(2), pdf(2, { ownerPassword: OWNER })]) {
      await session.open(bytes, { password: PASSWORD });
      expect(session.getSnapshot().passwordProtected).toBe(false);
      rotate();
      await session.export();
      expect(build.mock.lastCall?.[0]).not.toHaveProperty("encrypt");
      expect(build.mock.lastCall?.[0].sources[0]).not.toHaveProperty("password");
    }
  });
});

describe("exporting a password-protected document", () => {
  it("returns it unchanged as its original bytes, still protected, without the processor", async () => {
    const { session, events, build } = setup();
    const bytes = locked();
    await session.open(bytes, { password: PASSWORD });
    const output = await session.export();
    expect([...output]).toEqual([...bytes]);
    expect(build).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "document_exported", encrypted: true });
  });

  it("keeps the password by default: the build reads with it and encrypts with it", async () => {
    const { session, events, build, rotate } = setup();
    await session.open(locked(), { password: PASSWORD });
    rotate();
    const output = await session.export();
    expect(build.mock.lastCall?.[0]).toMatchObject({
      sources: [{ id: "s1", password: PASSWORD }],
      encrypt: { userPassword: PASSWORD },
    });
    expect(decodeFakePdf(output)).toMatchObject({ password: PASSWORD });
    expect(events.at(-1)).toMatchObject({ type: "document_exported", encrypted: true });
  });

  it("opens with the password that was typed, when that was the owner's", async () => {
    const { session, build, rotate } = setup();
    await session.open(locked(), { password: OWNER });
    rotate();
    await session.export();
    expect(build.mock.lastCall?.[0].encrypt).toEqual({ userPassword: OWNER });
  });

  it("removes the password when asked, for an unchanged document too", async () => {
    const { session, events, build, rotate } = setup();
    await session.open(locked(), { password: PASSWORD });
    const unchanged = await session.export({ keepPassword: false });
    expect(decodeFakePdf(unchanged)).not.toHaveProperty("password");
    expect(build.mock.lastCall?.[0]).toMatchObject({ sources: [{ password: PASSWORD }] });
    expect(build.mock.lastCall?.[0]).not.toHaveProperty("encrypt");
    expect(events.at(-1)).toMatchObject({ type: "document_exported", encrypted: false });

    rotate();
    expect(decodeFakePdf(await session.export({ keepPassword: false }))).not.toHaveProperty(
      "password",
    );
  });

  it("lets the caller's own passwords win, whatever keepPassword says", async () => {
    const { session, build } = setup();
    await session.open(locked(), { password: PASSWORD });
    const encrypt = { userPassword: "another", ownerPassword: "and another" };
    for (const keepPassword of [true, false]) {
      const output = await session.export({ encrypt, keepPassword });
      expect(build.mock.lastCall?.[0].encrypt).toEqual(encrypt);
      expect(decodeFakePdf(output)).toMatchObject({ password: "another" });
    }
  });

  it("reads an inserted document with its password, which protects nothing", async () => {
    const { session, build } = setup();
    await session.open(pdf(1));
    await expect(session.insert(locked())).rejects.toSatisfy((error) =>
      isPdfError(error, "PASSWORD_REQUIRED"),
    );
    await session.insert(locked(), { password: PASSWORD });
    expect(session.getSnapshot().passwordProtected).toBe(false);
    const output = await session.export();
    expect(build.mock.lastCall?.[0]).toMatchObject({
      sources: [{ id: "s1" }, { id: "s2", password: PASSWORD }],
    });
    expect(build.mock.lastCall?.[0]).not.toHaveProperty("encrypt");
    expect(decodeFakePdf(output)?.pages).toHaveLength(3);
  });

  it("keeps the opened document's password over pages inserted from another", async () => {
    const { session, build } = setup();
    await session.open(locked(1), { password: PASSWORD });
    await session.insert(pdf(1, { password: "the other one" }), { password: "the other one" });
    await session.export();
    expect(build.mock.lastCall?.[0]).toMatchObject({
      sources: [{ password: PASSWORD }, { password: "the other one" }],
      encrypt: { userPassword: PASSWORD },
    });
  });

  it("drops the password when the document closes, and when another replaces it", async () => {
    const { session, build, rotate } = setup();
    await session.open(locked(), { password: PASSWORD });
    await session.open(pdf(2));
    expect(session.getSnapshot().passwordProtected).toBe(false);
    rotate();
    await session.export();
    expect(everythingIn(build.mock.lastCall)).not.toContain(PASSWORD);

    await session.open(locked(), { password: PASSWORD });
    await session.close();
    expect(session.getSnapshot().passwordProtected).toBe(false);
    await session.open(pdf(2));
    rotate();
    await session.export();
    expect(everythingIn(build.mock.lastCall)).not.toContain(PASSWORD);
  });
});

describe("a document with restrictions of its own", () => {
  const restrictedPdf = () => pdf(2, { ownerPassword: OWNER, restricted: true });

  it("says so in the snapshot, until it closes or another replaces it", async () => {
    const { session } = setup();
    expect(session.getSnapshot().restricted).toBe(false);
    await session.open(restrictedPdf());
    expect(session.getSnapshot()).toMatchObject({ restricted: true, passwordProtected: false });
    await session.open(pdf(1));
    expect(session.getSnapshot().restricted).toBe(false);
    await session.open(restrictedPdf());
    await session.close();
    expect(session.getSnapshot().restricted).toBe(false);
  });

  it("says whether an export is the original file, or a copy built without them", async () => {
    const { session, build, rotate } = setup();
    expect(session.exportsOriginal()).toBe(false);
    const bytes = restrictedPdf();
    await session.open(bytes);
    expect(session.exportsOriginal()).toBe(true);
    expect(session.exportsOriginal({ compress: {} })).toBe(false);
    expect([...(await session.export())]).toEqual([...bytes]);
    expect(build).not.toHaveBeenCalled();

    rotate();
    expect(session.exportsOriginal()).toBe(false);
    expect(decodeFakePdf(await session.export())).not.toHaveProperty("restricted");
    session.undo();
    expect(session.exportsOriginal()).toBe(true);
  });

  it("follows the password's choice for a document that needed one", async () => {
    const { session } = setup();
    await session.open(pdf(2, { password: PASSWORD, restricted: true }), { password: PASSWORD });
    expect(session.getSnapshot()).toMatchObject({ restricted: true, passwordProtected: true });
    expect(session.exportsOriginal()).toBe(true);
    expect(session.exportsOriginal({ keepPassword: false })).toBe(false);
    expect(session.exportsOriginal({ encrypt: { userPassword: "another" } })).toBe(false);
  });
});

describe("where a password never goes (docs/adr/0013)", () => {
  it("is in no event, snapshot or error, through a whole session", async () => {
    const { session, events, snapshots, rotate } = setup();
    const errors: unknown[] = [];
    const attempt = (work: Promise<unknown>) => work.catch((error: unknown) => errors.push(error));

    await attempt(session.open(locked()));
    await attempt(session.open(locked(), { password: "wrong-PASSWORD-sentinel" }));
    await session.open(locked(), { name: "locked.pdf", password: PASSWORD });
    rotate();
    await session.export();
    await session.export({ keepPassword: false });
    await session.export({ encrypt: { userPassword: "new-PASSWORD-sentinel" } });
    await attempt(session.export({ signal: AbortSignal.abort() }));
    await attempt(session.insert(locked(), { password: "wrong-PASSWORD-sentinel" }));
    await session.insert(locked(), { password: OWNER });
    session.undo();
    session.redo();
    await session.close();

    expect(errors).toHaveLength(4);
    expect(events.map((event) => event.type)).toContain("document_exported");
    const everything = everythingIn({ events, snapshots, errors });
    expect(everything).toContain("locked.pdf");
    expect(everything).not.toContain("-PASSWORD-sentinel");
  });

  it("is in no error of a failed export", async () => {
    const processor = createFakeProcessor();
    vi.spyOn(processor, "build").mockRejectedValue(new PdfError("PROCESSING_FAILED", "Failed."));
    const { session, events, rotate } = setup({ processor });
    await session.open(locked(), { password: PASSWORD });
    rotate();
    const failure = await session.export().catch((error: unknown) => error);
    expect(isPdfError(failure, "PROCESSING_FAILED")).toBe(true);
    expect(everythingIn({ failure, events })).not.toContain("-PASSWORD-sentinel");
  });
});
