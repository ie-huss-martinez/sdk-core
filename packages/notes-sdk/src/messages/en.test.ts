import { createMessages, sdkCoreMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import { describe, expect, it } from "vitest";
import { NotesError, type NotesErrorCode } from "../core/errors/notes-error.js";
import { notesLimitDefinitions, notesLimits } from "../core/errors/notes-limits.js";
import { notesEditorMessages } from "../react/editor-messages.js";
import { notesEditorText } from "./editor-en.js";
import { notesMessages } from "./en.js";

// Listing every code here makes the type checker fail when a code is added
// to NotesErrorCode without being listed, and the test fail when its text is
// missing from the catalogue.
const ALL_CODES: Record<NotesErrorCode, true> = {
  UNKNOWN: true,
  ABORTED: true,
  TIMEOUT: true,
  WORKER_START_FAILED: true,
  WORKER_PROTOCOL_MISMATCH: true,
  WORKER_CRASHED: true,
  WORKER_TERMINATED: true,
  WORKER_METHOD_NOT_FOUND: true,
  WORKER_DATA_NOT_CLONEABLE: true,
  UNSUPPORTED_ENVIRONMENT: true,
  FILE_TOO_LARGE: true,
  TOO_MANY_FILES: true,
  DECODED_SIZE_TOO_LARGE: true,
  PROCESSING_TIME_EXCEEDED: true,
  INVALID_DOCUMENT: true,
  UNSUPPORTED_FORMAT: true,
  INVALID_COMMAND: true,
  NOT_FOUND: true,
  NOTEBOOK_IN_USE: true,
  STORAGE_FAILED: true,
  INVALID_PDF: true,
  PASSWORD_REQUIRED: true,
  UNSUPPORTED_FILE: true,
  EXPORT_FAILED: true,
  RECORDING_FAILED: true,
  TOO_MANY_PAGES: true,
  TOO_MANY_ITEMS: true,
  IMAGE_TOO_LARGE: true,
  BACKUP_TOO_LARGE: true,
  TOO_MANY_BACKUP_ENTRIES: true,
};

describe("notesMessages", () => {
  it("has text for every NotesError code and every limit's warning", () => {
    for (const code of Object.keys(ALL_CODES)) {
      expect(notesMessages, code).toHaveProperty([`errors.${code}`]);
    }
    for (const limit of Object.keys(notesLimitDefinitions)) {
      expect(notesMessages, limit).toHaveProperty([`warnings.${limit}`]);
    }
  });

  it("holds only sdk-core's text, errors and warnings: no interface text (sdk-core ADR 0059)", () => {
    // The server-safe entry exports this catalogue, so interface text added
    // here would ship to every host, server included. It belongs in
    // src/messages/editor-en.ts, which only the React entry loads.
    const core = new Set(Object.keys(sdkCoreMessages));
    const stray = Object.keys(notesMessages).filter(
      (key) => !core.has(key) && !key.startsWith("errors.") && !key.startsWith("warnings."),
    );
    expect(stray).toEqual([]);
  });

  it("is a valid catalogue", () => {
    // createMessages throws on a malformed message in the SDK's own catalogue.
    expect(() => createMessages(notesMessages)).not.toThrow();
    expect(() => createMessages(notesEditorMessages)).not.toThrow();
  });

  it("describes a limit violation with its details, never its message", () => {
    const messages = createMessages(notesMessages);
    let thrown: unknown;
    try {
      notesLimits.resolve().check("maxPages", 6_200);
    } catch (error) {
      thrown = error;
    }
    expect(messages.error(thrown)).toBe(
      "That would make 6,200 pages, which is over the 5,000-page limit.",
    );
    expect(messages.error(new NotesError("INVALID_PDF", "<script>from the file</script>"))).toBe(
      "This file isn't a PDF, or it's too damaged to open.",
    );
  });

  it("has text of its own for a failure's reason, where the reason changes what to do", () => {
    const messages = createMessages(notesMessages);
    const quota = new NotesError("STORAGE_FAILED", "full", { details: { reason: "quota" } });
    expect(messages.error(quota)).toContain("out of space");
    const denied = new NotesError("RECORDING_FAILED", "no", { details: { reason: "denied" } });
    expect(messages.error(denied)).toContain("microphone is blocked");
    expect(messages.error(new NotesError("STORAGE_FAILED", "other"))).toContain(
      "couldn't be saved",
    );
  });
});

describe("notesEditorMessages", () => {
  it("joins the three catalogues without one key hiding another (sdk-core ADR 0046)", () => {
    const own = Object.keys(notesEditorText);
    const others = new Set([...Object.keys(notesMessages), ...Object.keys(uiMessages)]);
    expect(own.filter((key) => others.has(key))).toEqual([]);
    expect(Object.keys(notesEditorMessages)).toHaveLength(own.length + others.size);
  });

  it("names every tool, toolbar group, paper and cover the interface shows", async () => {
    const { notesTools } = await import("../features/tools.js");
    for (const tool of notesTools) {
      expect(notesEditorMessages, tool.id).toHaveProperty([tool.label]);
      expect(notesEditorMessages, tool.id).toHaveProperty([`toolbar.groups.${tool.group}`]);
    }
    for (const template of ["blank", "lined", "grid", "dotted"]) {
      expect(notesEditorMessages).toHaveProperty([`templates.${template}`]);
    }
    for (const cover of ["blue", "green", "amber", "red", "gray"]) {
      expect(notesEditorMessages).toHaveProperty([`covers.${cover}`]);
    }
  });

  it("formats plurals and durations for the locale", () => {
    const en = createMessages(notesEditorMessages);
    expect(en.t("library.pages", { count: 1 })).toBe("1 page");
    expect(en.t("library.pages", { count: 12 })).toBe("12 pages");
    expect(en.t("search.count", { count: 3 })).toBe("3 pages match.");
    // A duration is in milliseconds, and reads as the locale writes one.
    expect(en.t("recordings.item", { number: 2, duration: 83_000 })).toBe(
      "Recording 2, 1 min, 23 sec",
    );
  });
});
