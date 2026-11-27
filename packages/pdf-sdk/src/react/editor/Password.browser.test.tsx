import { startScreenReader } from "@hussmartinez/sdk-config/testing/screen-reader";
import { act, createRef, type ReactNode, useState } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { decodeFakePdf, encodeFakePdf } from "../../../test/fakes/fake-pdf.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import { everythingIn } from "../../../test/secrets.js";
import { isPdfError } from "../../core/errors/pdf-error.js";
import type { PdfEngine } from "../../core/ports/pdf-engine.js";
import type { PdfSessionEvent } from "../../core/session/session.js";
import { SAY_CHECKING_AFTER } from "./PasswordDialog.js";
import { PdfEditor } from "./PdfEditor.js";
import type { PdfEditorChange, PdfEditorHandle, PdfEditorProps } from "./types.js";

// Password-protected PDFs in the editor (docs/adr/0013): the dialog that
// asks for the password, with the keyboard and as a screen reader says it,
// what the download tool asks, and where the password never shows up.

afterEach(cleanUp);

const PASSWORD = "open-PASSWORD-sentinel";
const WRONG = "wrong-PASSWORD-sentinel";

const pages = (count: number) => Array.from({ length: count }, () => ({ width: 600, height: 800 }));
const plain = (count: number, name = "report.pdf") =>
  new File([encodeFakePdf({ pages: pages(count) })], name, { type: "application/pdf" });
const locked = (count: number, name = "locked.pdf") =>
  new File([encodeFakePdf({ pages: pages(count), password: PASSWORD })], name, {
    type: "application/pdf",
  });

const HOST = "width: 1000px; height: 600px; display: grid; grid-template-rows: minmax(0, 1fr);";

function setUp(props: Partial<PdfEditorProps> = {}) {
  const changes: PdfEditorChange[] = [];
  const events: PdfSessionEvent[] = [];
  const handle = createRef<PdfEditorHandle>();
  const render = (extra: Partial<PdfEditorProps> = {}) => (
    <PdfEditor
      ref={handle}
      engine={engine}
      processor={processor}
      onChange={(change) => changes.push(change)}
      onEvent={(event) => events.push(event)}
      {...props}
      {...extra}
    />
  );
  const engine = createFakeEngine();
  const processor = createFakeProcessor();
  return { changes, events, handle, mounted: mount(render(), HOST) };
}

const editor = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('section[aria-label="PDF editor"]') as HTMLElement;
const status = (container: HTMLElement, value: string, timeout?: number) =>
  waitFor(() => expect(editor(container).dataset["hmStatus"]).toBe(value), {
    ...(timeout === undefined ? {} : { timeout }),
  });
const fileInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>(
    'input[type="file"]:not([data-hm-insert])',
  ) as HTMLInputElement;
const insertInput = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>("input[data-hm-insert]") as HTMLInputElement;
const startButton = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>(".hm-pdf-editor-start button") as HTMLButtonElement;
const tool = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(
    `[data-hm-tool-id="${id}"], [data-tool="${id}"]`,
  ) as HTMLButtonElement;
const alerts = (container: HTMLElement) =>
  [...container.querySelectorAll(".hm-pdf-editor-alert")].map((alert) => alert.textContent);

const passwordDialog = (container: HTMLElement) =>
  container.querySelector<HTMLDialogElement>("dialog.hm-pdf-password") as HTMLDialogElement;
const saveDialog = (container: HTMLElement) =>
  container.querySelector<HTMLDialogElement>("dialog.hm-pdf-save") as HTMLDialogElement;
const field = (container: HTMLElement) =>
  passwordDialog(container).querySelector<HTMLInputElement>("input") as HTMLInputElement;
const buttonNamed = (dialog: HTMLElement, name: string) =>
  [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === name,
  ) as HTMLButtonElement;
/** What the dialog's own announcer said last, politely or at once. */
const said = (dialog: HTMLElement, politeness: "polite" | "assertive") =>
  dialog.querySelector(`.hm-announcer [aria-live="${politeness}"]`)?.textContent ?? "";

/**
 * What the editor's own announcer says, the one outside every dialog. ui
 * empties the region, then fills it in an animation frame, and frames run
 * in the order they're asked for: two more guarantee it has run, however
 * slowly a busy browser schedules them, where a wait by the clock wouldn't.
 */
async function announcedByEditor(container: HTMLElement): Promise<string> {
  for (let frame = 0; frame < 2; frame += 1) {
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  }
  return (
    container.querySelector('.hm-pdf-editor > .hm-announcer [aria-live="polite"]')?.textContent ??
    ""
  );
}

/** How long the file's first open may take: see PdfEditor.browser.test.tsx. */
const FIRST_OPEN = 30_000;

/** Chooses a protected file, and waits for the dialog that asks for its password. */
async function ask(container: HTMLElement, file = locked(3)) {
  startButton(container).focus();
  await act(() => userEvent.upload(fileInput(container), file));
  await waitFor(() => expect(passwordDialog(container).open).toBe(true), { timeout: FIRST_OPEN });
}

const type = (text: string) => act(() => userEvent.keyboard(text));

/** A host that passes the editor a file, and lets a test change it. */
function FileHost(props: {
  readonly engine: PdfEngine;
  readonly changes: PdfEditorChange[];
  readonly control: { setFile: (file: File | null) => void };
}): ReactNode {
  const [file, setFile] = useState<File | null>(() => locked(3));
  props.control.setFile = setFile;
  return (
    <PdfEditor
      engine={props.engine}
      file={file}
      onChange={(change) => props.changes.push(change)}
    />
  );
}

describe("the password dialog", () => {
  it("asks for the password of a file that needs one, with focus in its field", async () => {
    const { mounted, changes } = setUp();
    const container = await mounted;
    await ask(container);

    const dialog = passwordDialog(container);
    expect(dialog.matches(":modal")).toBe(true);
    expect(dialog.querySelector("h2")?.textContent).toBe("This PDF needs a password");
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("The password stays on this device.");
    const input = field(container);
    expect(document.activeElement).toBe(input);
    expect(input.type).toBe("password");
    // The attribute: Firefox's `autocomplete` property is empty for this value.
    expect(input.getAttribute("autocomplete")).toBe("current-password");
    expect(input.labels?.[0]?.textContent).toBe("Password");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    // Nothing behind the dialog says the open failed: it hasn't, yet.
    expect(alerts(container)).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("opens the document with the right password, and moves focus to it", async () => {
    const { mounted, changes } = setUp();
    const container = await mounted;
    await ask(container);
    await type(`${PASSWORD}{Enter}`);
    await status(container, "ready");

    await waitFor(() => expect(passwordDialog(container).open).toBe(false));
    expect(changes).toEqual([{ reason: "open", pageCount: 3, fileName: "locked.pdf" }]);
    // Said by the editor's own announcer, once the dialog has closed.
    expect(await announcedByEditor(container)).toBe("Opened a PDF with 3 pages.");
    expect(container.querySelectorAll(".hm-pdf-page")).toHaveLength(3);
    expect(document.activeElement).toBe(container.querySelector(".hm-pdf-viewer"));
    expect(alerts(container)).toEqual([]);
    // Nothing typed outlives the dialog.
    expect(field(container).value).toBe("");
  });

  it("says when a password is wrong, each time, and lets the person try again", async () => {
    const { mounted } = setUp();
    const container = await mounted;
    await ask(container);
    const dialog = passwordDialog(container);
    const input = field(container);

    for (const attempt of [WRONG, `${WRONG} again`]) {
      await type(attempt);
      await act(() => userEvent.click(buttonNamed(dialog, "Unlock")));
      await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"));
      const error = document.getElementById(input.getAttribute("aria-describedby") ?? "");
      expect(error?.textContent).toBe("That password didn't open this PDF.");
      await waitFor(() =>
        expect(said(dialog, "assertive")).toBe("That password didn't open this PDF."),
      );
      // Ready for another: still open, emptied, with focus in the field.
      expect(dialog.open).toBe(true);
      expect(input.value).toBe("");
      expect(document.activeElement).toBe(input);
      expect(alerts(container)).toEqual([]);
    }

    await type(`${PASSWORD}{Enter}`);
    await status(container, "ready");
    await waitFor(() => expect(dialog.open).toBe(false));
  });

  it("says that it's checking only when the check takes a while", async () => {
    // An engine whose opens with a password wait until the test lets them through.
    const fake = createFakeEngine();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: PdfEngine = {
      open: async (source, options) => {
        if (options?.password) await gate;
        return fake.open(source, options);
      },
      destroy: () => fake.destroy(),
    };
    const { mounted } = setUp({ engine });
    const container = await mounted;
    await ask(container);
    const dialog = passwordDialog(container);
    await type(`${PASSWORD}{Enter}`);

    // At once: shown, the button disabled with focus kept in the field, and not said.
    expect(dialog.querySelector(".hm-pdf-password-status")?.textContent).toBe(
      "Checking the password…",
    );
    expect(buttonNamed(dialog, "Unlock").getAttribute("aria-disabled")).toBe("true");
    expect(field(container).readOnly).toBe(true);
    expect(said(dialog, "polite")).toBe("");
    await waitFor(() => expect(said(dialog, "polite")).toBe("Checking the password…"), {
      timeout: SAY_CHECKING_AFTER + 2_000,
    });

    release();
    await status(container, "ready");
    await waitFor(() => expect(dialog.open).toBe(false));
  });

  it("does nothing with an empty password", async () => {
    const { mounted } = setUp();
    const container = await mounted;
    await ask(container);
    await type("{Enter}");
    await act(() => userEvent.click(buttonNamed(passwordDialog(container), "Unlock")));
    expect(passwordDialog(container).open).toBe(true);
    expect(field(container).getAttribute("aria-invalid")).toBeNull();
    expect(document.activeElement).toBe(field(container));
  });

  it.each([
    ["Escape", (_: HTMLElement) => type("{Escape}")],
    ["Cancel", (dialog: HTMLElement) => act(() => userEvent.click(buttonNamed(dialog, "Cancel")))],
  ])("cancels with %s: nothing opens, and the start says why", async (_name, cancel) => {
    const { mounted, changes } = setUp();
    const container = await mounted;
    await ask(container);
    await type(WRONG);
    await cancel(passwordDialog(container));

    await waitFor(() => expect(passwordDialog(container).open).toBe(false));
    expect(editor(container).dataset["hmStatus"]).toBe("error");
    expect(alerts(container)).toEqual(["This PDF is protected with a password."]);
    expect(document.activeElement).toBe(startButton(container));
    expect(startButton(container).textContent).toBe("Choose another PDF");
    expect(field(container).value).toBe("");
    expect(changes).toEqual([]);
  });

  it("keeps the open document when the person cancels another's password", async () => {
    const { mounted, handle } = setUp();
    const container = await mounted;
    await act(() => handle.current?.open(plain(2)));
    await status(container, "ready", FIRST_OPEN);
    await act(() => userEvent.upload(fileInput(container), locked(3)));
    await waitFor(() => expect(passwordDialog(container).open).toBe(true));
    expect(alerts(container)).toEqual([]);
    await type("{Escape}");

    await waitFor(() => expect(passwordDialog(container).open).toBe(false));
    expect(editor(container).dataset["hmStatus"]).toBe("ready");
    expect(container.querySelectorAll(".hm-pdf-page")).toHaveLength(2);
    expect(alerts(container)).toEqual(["This PDF is protected with a password."]);
  });

  it("asks for the host's file too, and stops asking when the host passes another", async () => {
    const changes: PdfEditorChange[] = [];
    const engine = createFakeEngine();
    const control = { setFile: (_: File | null) => {} };
    const { setFile } = { setFile: (file: File | null) => control.setFile(file) };
    const container = await mount(
      <FileHost engine={engine} changes={changes} control={control} />,
      HOST,
    );
    await waitFor(() => expect(passwordDialog(container).open).toBe(true), { timeout: FIRST_OPEN });
    expect(alerts(container)).toEqual([]);

    await act(async () => setFile(plain(1)));
    await status(container, "ready");
    expect(passwordDialog(container).open).toBe(false);
    expect(changes).toEqual([{ reason: "open", pageCount: 1, fileName: "report.pdf" }]);

    // Asking again, then no file at all: the dialog goes with it.
    await act(async () => setFile(locked(2)));
    await waitFor(() => expect(passwordDialog(container).open).toBe(true));
    await act(async () => setFile(null));
    await waitFor(() => expect(passwordDialog(container).open).toBe(false));
    await status(container, "empty");
    expect(alerts(container)).toEqual([]);
  });

  it("settles the handle's open() once the person has answered", async () => {
    const { mounted, handle } = setUp();
    const container = await mounted;

    // Unlocked: it resolves, as an open without a password does.
    let outcome: unknown = "pending";
    let opening: Promise<void> | undefined;
    await act(async () => {
      opening = handle.current?.open(locked(2)).then(
        () => {
          outcome = "opened";
        },
        (error: unknown) => {
          outcome = error;
        },
      );
    });
    await waitFor(() => expect(passwordDialog(container).open).toBe(true), { timeout: FIRST_OPEN });
    expect(outcome).toBe("pending");
    await type(`${WRONG}{Enter}`);
    await waitFor(() => expect(field(container).getAttribute("aria-invalid")).toBe("true"));
    expect(outcome).toBe("pending");
    await type(`${PASSWORD}{Enter}`);
    await act(() => opening);
    expect(outcome).toBe("opened");

    // Cancelled: it rejects with the reason nothing opened.
    let cancelled: Promise<unknown> | undefined;
    await act(async () => {
      cancelled = handle.current?.open(locked(2)).catch((error: unknown) => error);
    });
    await waitFor(() => expect(passwordDialog(container).open).toBe(true));
    await type("{Escape}");
    expect(isPdfError(await cancelled, "PASSWORD_REQUIRED")).toBe(true);

    // Given by the host: nobody is asked.
    await act(() => handle.current?.open(locked(4), { password: PASSWORD }));
    expect(passwordDialog(container).open).toBe(false);
    expect(container.querySelectorAll(".hm-pdf-page")).toHaveLength(4);
  });

  it("stops asking when the host closes the editor's document", async () => {
    const { mounted, handle } = setUp();
    const container = await mounted;
    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = handle.current?.open(locked(2)).catch((error: unknown) => error);
    });
    await waitFor(() => expect(passwordDialog(container).open).toBe(true), { timeout: FIRST_OPEN });
    await act(() => handle.current?.close());

    expect(isPdfError(await pending, "PASSWORD_REQUIRED")).toBe(true);
    await waitFor(() => expect(passwordDialog(container).open).toBe(false));
    expect(editor(container).dataset["hmStatus"]).toBe("empty");
  });

  it("asks before inserting a protected file, then inserts its pages", async () => {
    const { mounted, handle } = setUp();
    const container = await mounted;
    await act(() => handle.current?.open(plain(2)));
    await status(container, "ready", FIRST_OPEN);

    await act(() => userEvent.upload(insertInput(container), locked(3, "appendix.pdf")));
    await waitFor(() => expect(passwordDialog(container).open).toBe(true));
    expect(alerts(container)).toEqual([]);
    await type(`${PASSWORD}{Enter}`);

    await waitFor(() => expect(container.querySelectorAll(".hm-pdf-page")).toHaveLength(5));
    await waitFor(() => expect(passwordDialog(container).open).toBe(false));
    expect(handle.current?.session.getSnapshot().passwordProtected).toBe(false);
    expect(alerts(container)).toEqual([]);
    // Said by the editor's own announcer, once the dialog has closed: said
    // from inside it, the words would go with it.
    expect(await announcedByEditor(container)).toBe("Inserted 3 pages after page 1.");
  });

  it("never shows the password to the host's events, the page or a snapshot", async () => {
    const onExport = vi.fn();
    const { mounted, events, handle } = setUp({ onExport });
    const container = await mounted;
    await ask(container);
    await type(`${WRONG}{Enter}`);
    await waitFor(() => expect(field(container).getAttribute("aria-invalid")).toBe("true"));
    await type(`${PASSWORD}{Enter}`);
    await status(container, "ready");
    await act(() => userEvent.click(tool(container, "pdf.rotate-right")));
    await act(() => userEvent.click(tool(container, "pdf.download")));
    await waitFor(() => expect(saveDialog(container).open).toBe(true));
    await act(() => userEvent.click(buttonNamed(saveDialog(container), "Download")));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["failed", "document_opened", "command", "document_exported"]),
    );
    const seen = everythingIn({
      events,
      snapshot: handle.current?.session.getSnapshot(),
      page: document.documentElement.outerHTML,
      fields: [...document.querySelectorAll("input")].map((input) => input.value),
    });
    expect(seen).not.toContain("-PASSWORD-sentinel");
  });
});

describe("downloading a document that needed a password", () => {
  async function opened(props: Partial<PdfEditorProps> = {}) {
    const onExport = vi.fn<(bytes: Uint8Array) => void>();
    const set = setUp({ onExport, ...props });
    const container = await set.mounted;
    await act(() => set.handle.current?.open(locked(2), { password: PASSWORD }));
    await status(container, "ready", FIRST_OPEN);
    // An edit, so the copy is built rather than the file handed back.
    await act(() => userEvent.click(tool(container, "pdf.rotate-right")));
    return { ...set, container, onExport };
  }
  const exported = (onExport: { mock: { calls: unknown[][] } }) =>
    decodeFakePdf(onExport.mock.calls[0]?.[0] as Uint8Array);

  it("asks whether the copy keeps the password, and keeps it unless told otherwise", async () => {
    const { container, onExport } = await opened();
    const download = tool(container, "pdf.download");
    await act(() => userEvent.click(download));

    const dialog = saveDialog(container);
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.querySelector("h2")?.textContent).toBe("This PDF has a password");
    const group = dialog.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.getAttribute("aria-label")).toBe("Password");
    const checked = () => group.querySelector('[aria-checked="true"]')?.textContent;
    expect(checked()).toBe("Keep the password");
    const summary = document.getElementById(group.getAttribute("aria-describedby") ?? "");
    expect(summary?.textContent).toBe("The copy will open with the same password.");
    // The safe choice is one key press away.
    expect(document.activeElement).toBe(buttonNamed(dialog, "Download"));
    expect(onExport).not.toHaveBeenCalled();

    await type("{Enter}");
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    expect(dialog.open).toBe(false);
    expect(exported(onExport)).toMatchObject({ password: PASSWORD });
    expect(document.activeElement).toBe(download);
  });

  it("removes the password when the person chooses to", async () => {
    const { container, onExport } = await opened();
    await act(() => userEvent.click(tool(container, "pdf.download")));
    const dialog = saveDialog(container);
    await waitFor(() => expect(dialog.open).toBe(true));
    await act(() => userEvent.click(buttonNamed(dialog, "Remove the password")));
    expect(dialog.querySelector(".hm-pdf-save-summary")?.textContent).toBe(
      "Anyone will be able to open the copy.",
    );
    await act(() => userEvent.click(buttonNamed(dialog, "Download")));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    expect(exported(onExport)).not.toHaveProperty("password");

    // The next download starts from keeping it again.
    await act(() => userEvent.click(tool(container, "pdf.download")));
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.querySelector('[aria-checked="true"]')?.textContent).toBe("Keep the password");
  });

  it("asks again for another document, rather than keeping a choice made for the last", async () => {
    const { container, onExport, handle } = await opened();
    await act(() => userEvent.click(tool(container, "pdf.download")));
    const dialog = saveDialog(container);
    await waitFor(() => expect(dialog.open).toBe(true));
    await act(() => userEvent.click(buttonNamed(dialog, "Remove the password")));

    // The host replaces the document, with another protected one.
    await act(() => handle.current?.open(locked(3), { password: PASSWORD }));
    await waitFor(() => expect(dialog.open).toBe(false));
    expect(onExport).not.toHaveBeenCalled();
    await act(() => userEvent.click(tool(container, "pdf.download")));
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.querySelector('[aria-checked="true"]')?.textContent).toBe("Keep the password");
  });

  it("saves nothing when the person cancels", async () => {
    const { container, onExport } = await opened();
    const download = tool(container, "pdf.download");
    await act(() => userEvent.click(download));
    await waitFor(() => expect(saveDialog(container).open).toBe(true));
    await type("{Escape}");
    await waitFor(() => expect(saveDialog(container).open).toBe(false));
    expect(onExport).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(download);
  });

  it("says that an edited copy won't keep the original's restrictions, before it saves", async () => {
    const onExport = vi.fn();
    const { mounted, handle } = setUp({ onExport });
    const container = await mounted;
    const restricted = new File(
      [encodeFakePdf({ pages: pages(2), ownerPassword: "owner", restricted: true })],
      "restricted.pdf",
    );
    await act(() => handle.current?.open(restricted));
    await status(container, "ready", FIRST_OPEN);
    const download = tool(container, "pdf.download");
    const dialog = saveDialog(container);

    // Unchanged, it's the original file, restrictions and all: nothing to say.
    await act(() => userEvent.click(download));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    expect(dialog.open).toBe(false);

    await act(() => userEvent.click(tool(container, "pdf.rotate-right")));
    await act(() => userEvent.click(download));
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(dialog.querySelector("h2")?.textContent).toBe("This PDF has restrictions");
    expect(
      document.getElementById(dialog.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe(
      "The original's restrictions, such as on printing or copying, aren't kept in this copy.",
    );
    // Nothing to choose: only Cancel and Download, which has focus.
    expect(dialog.querySelector('[role="radiogroup"]')).toBeNull();
    expect(document.activeElement).toBe(buttonNamed(dialog, "Download"));
    expect(onExport).toHaveBeenCalledOnce();

    await type("{Enter}");
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(2));
    expect(dialog.open).toBe(false);
  });

  it("says so beside the password's choice too, when the copy is built", async () => {
    const onExport = vi.fn();
    const { mounted, handle } = setUp({ onExport });
    const container = await mounted;
    const both = new File(
      [encodeFakePdf({ pages: pages(2), password: PASSWORD, restricted: true })],
      "both.pdf",
    );
    await act(() => handle.current?.open(both, { password: PASSWORD }));
    await status(container, "ready", FIRST_OPEN);
    await act(() => userEvent.click(tool(container, "pdf.download")));
    const dialog = saveDialog(container);
    await waitFor(() => expect(dialog.open).toBe(true));
    const summary = () => dialog.querySelector(".hm-pdf-save-summary")?.textContent;

    // Kept and unchanged, the copy is the original file.
    expect(summary()).toBe("The copy will open with the same password.");
    await act(() => userEvent.click(buttonNamed(dialog, "Remove the password")));
    expect(summary()).toBe(
      "Anyone will be able to open the copy. The original's restrictions, such as on printing or copying, aren't kept in this copy.",
    );
  });

  it("asks nothing for a document without a password", async () => {
    const onExport = vi.fn();
    const { mounted, handle } = setUp({ onExport });
    const container = await mounted;
    await act(() => handle.current?.open(plain(2)));
    await status(container, "ready", FIRST_OPEN);
    await act(() => userEvent.click(tool(container, "pdf.download")));
    await waitFor(() => expect(onExport).toHaveBeenCalledOnce());
    expect(saveDialog(container).open).toBe(false);
  });
});

describe("the password dialog, as a screen reader says it (sdk-core ADR 0065)", () => {
  it("names the dialog and its field, says a wrong password at once, and the document once it opens", async () => {
    const { mounted } = setUp();
    const container = await mounted;
    startButton(container).focus();
    const reader = await startScreenReader();
    onTestFinished(() => reader.stop());

    // The dialog and what it's for, then where focus lands. ui's dialog puts
    // focus on its first control, the close button, for a moment before the
    // field. A real screen reader also says that the field is a password
    // field, and that what's typed is hidden.
    expect(
      await reader.spoken(async () => {
        await act(() => userEvent.upload(fileInput(container), locked(3)));
        await waitFor(() => expect(passwordDialog(container).open).toBe(true), {
          timeout: FIRST_OPEN,
        });
      }),
    ).toEqual([
      "button, Choose a PDF, Or drop one here. Your file stays on this device and is never uploaded.",
      "dialog, This PDF needs a password, The password stays on this device.",
      "button, Close",
      "Password",
    ]);

    // A wrong password interrupts, from inside the dialog: everything
    // outside a modal dialog is inert, the editor's own announcer included.
    expect(
      await reader.spoken(async () => {
        await type(`${WRONG}{Enter}`);
        await waitFor(() => expect(field(container).getAttribute("aria-invalid")).toBe("true"));
      }),
    ).toEqual(["assertive: That password didn't open this PDF."]);

    // The right one closes the dialog: focus goes to the document, and the
    // editor says what opened.
    expect(
      await reader.spoken(async () => {
        await type(`${PASSWORD}{Enter}`);
        await status(container, "ready");
      }),
    ).toEqual(["region, Document", "polite: Opened a PDF with 3 pages."]);
  });
});
