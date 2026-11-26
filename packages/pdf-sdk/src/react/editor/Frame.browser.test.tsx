import type { EditorPreferences } from "@hussmartinez/ui";
import { act, createRef, type ReactNode, type RefObject, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createFakeEngine } from "../../../test/fakes/fake-engine.js";
import { encodeFakePdf } from "../../../test/fakes/fake-pdf.js";
import { createFakeProcessor } from "../../../test/fakes/fake-processor.js";
import { cleanUp, mount, waitFor } from "../../../test/react.js";
import type { PdfSession } from "../../core/session/session.js";
import { PdfEditor } from "./PdfEditor.js";
import type { PdfEditorHandle, PdfEditorProps } from "./types.js";

/**
 * The editor on ui's frame (docs/adr/0012, sdk-core ADR 0067): modes, the
 * command palette, Easy's start cards, toasts with Undo, preferences the
 * host keeps, and the tab bar on a phone.
 */

afterEach(cleanUp);

/** Wide enough for the frame's desktop layout, with the tools beside the document. */
const DESKTOP = "width: 1000px; height: 600px; display: grid; grid-template-rows: minmax(0, 1fr);";
/** A phone's width: the tab bar holds the tools (below 45 rem). */
const PHONE = "width: 390px; height: 700px; display: grid; grid-template-rows: minmax(0, 1fr);";

const fakePdf = (pageCount: number) =>
  encodeFakePdf({
    pages: Array.from({ length: pageCount }, () => ({ width: 600, height: 800 })),
  });

interface HostProps {
  readonly props: Partial<PdfEditorProps>;
  readonly handle: RefObject<PdfEditorHandle | null>;
  readonly control: { setProps: (props: Partial<PdfEditorProps>) => void };
}

/** Renders the editor with fakes, and lets a test pass it new props. */
function Host({ props: initial, handle, control }: HostProps): ReactNode {
  const [props, setProps] = useState(initial);
  // Created once, so new props never replace the session.
  const [engine] = useState(createFakeEngine);
  const [processor] = useState(createFakeProcessor);
  control.setProps = setProps;
  return <PdfEditor ref={handle} engine={engine} processor={processor} {...props} />;
}

async function setUp(props: Partial<PdfEditorProps> = {}, css = DESKTOP) {
  const handle = createRef<PdfEditorHandle>();
  const control = { setProps: (_: Partial<PdfEditorProps>) => {} };
  const container = await mount(<Host props={props} handle={handle} control={control} />, css);
  const session = () => {
    if (!handle.current) throw new Error("no handle");
    return handle.current.session;
  };
  return {
    container,
    session,
    open: (pageCount: number) => act(() => handle.current?.open(fakePdf(pageCount))),
    render: (next: Partial<PdfEditorProps>) => act(async () => control.setProps(next)),
  };
}

const root = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('section[aria-label="PDF editor"]') as HTMLElement;
/** The tools panel's rows, by their visible labels. */
const rows = (container: HTMLElement) =>
  [...container.querySelectorAll("nav .hm-tool-list-label")].map((label) => label.textContent);
const row = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`nav [data-hm-tool-id="${id}"]`);
/** A button by its accessible name: its label, or else its text. */
const named = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => (button.getAttribute("aria-label") ?? button.textContent)?.trim() === text,
  );
const cards = (container: HTMLElement) =>
  [...container.querySelectorAll(".hm-pdf-start-card-title")].map((title) => title.textContent);
const card = (container: HTMLElement, id: string) =>
  container.querySelector<HTMLButtonElement>(`[data-hm-card="${id}"]`) as HTMLButtonElement;
const toasts = (container: HTMLElement) =>
  [...container.querySelectorAll(".hm-toast-message")].map((message) => message.textContent);
/** The toasts' Undo buttons. */
const undos = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLButtonElement>(".hm-toast-action")].filter(
    (button) => button.textContent === "Undo",
  );
const pageKeys = (session: () => PdfSession) =>
  session()
    .getSnapshot()
    .plan.pages.map((page) => page.key);
const rotations = (session: () => PdfSession) =>
  session()
    .getSnapshot()
    .plan.pages.map((page) => page.rotation);

describe("the editor's modes (sdk-core ADR 0067)", () => {
  it("lists only Easy's page tools in Easy, with descriptions, and every one in Expert, with shortcuts", async () => {
    const easy = await setUp({ defaultPreferences: { mode: "easy" } });
    expect(rows(easy.container)).toEqual([
      "Rotate left",
      "Rotate right",
      "Delete pages",
      "Insert pages",
    ]);
    expect(
      row(easy.container, "pdf.delete-pages")?.querySelector(".hm-tool-list-description")
        ?.textContent,
    ).toBe("Remove the selected pages, or this one");
    expect(row(easy.container, "pdf.rotate-left")?.querySelector("kbd")).toBeNull();
    // No command palette button outside Expert mode, though its key works.
    expect(named(easy.container, "Commands")).toBeUndefined();
    await cleanUp();

    const expert = await setUp({ defaultPreferences: { mode: "expert" } });
    expect(rows(expert.container)).toEqual([
      "Rotate left",
      "Rotate right",
      "Delete pages",
      "Insert pages",
      "Move earlier",
      "Move later",
    ]);
    expect(
      row(expert.container, "pdf.rotate-left")?.querySelector(".hm-tool-list-description"),
    ).toBeNull();
    expect(row(expert.container, "pdf.rotate-left")?.querySelector("kbd")?.textContent).toBe("[");
    expect(named(expert.container, "Commands")?.getAttribute("aria-keyshortcuts")).toBe(
      "Control+K",
    );
  });

  it("reaches a tool Easy doesn't list from the command palette, with Ctrl+K", async () => {
    const { container, open, session } = await setUp({ defaultPreferences: { mode: "easy" } });
    await open(3);
    await act(() => userEvent.click(named(container, "Just show me the editor") as HTMLElement));
    expect(row(container, "pdf.move-later")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector(".hm-pdf-viewer"));

    await act(() => userEvent.keyboard("{Control>}k{/Control}"));
    const search = container.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(document.activeElement).toBe(search);
    await act(() => userEvent.keyboard("later"));
    await act(() => userEvent.keyboard("{Enter}"));
    expect(pageKeys(session)).toEqual(["p2", "p1", "p3"]);
    await waitFor(() => expect(toasts(container)).toContain("Moved 1 page to position 2."));
  });

  it("changes mode from the settings, telling the host, and follows the host's preferences when it keeps them", async () => {
    const onPreferencesChange = vi.fn<(preferences: EditorPreferences) => void>();
    const { container, render } = await setUp({ onPreferencesChange });
    // Advanced with no preferences: the editor as hosts embedded it before.
    expect(rows(container)).toContain("Move earlier");
    await act(() => userEvent.click(named(container, "Settings") as HTMLElement));
    const easy = [...container.querySelectorAll<HTMLElement>('dialog[open] [role="radio"]')].find(
      (radio) => radio.textContent === "Easy",
    );
    await act(() => userEvent.click(easy as HTMLElement));
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "easy" }));
    expect(rows(container)).not.toContain("Move earlier");
    await waitFor(() => expect(toasts(container)).toContain("Easy mode"));
    // The editor has no properties panel, so its settings don't offer one.
    expect(container.querySelector("dialog[open]")?.textContent).not.toContain("Properties panel");
    await act(() => userEvent.keyboard("{Escape}"));

    // Controlled: the host's preferences win until it passes new ones.
    const kept: EditorPreferences = {
      theme: "system",
      mode: "advanced",
      toolsLayout: "sidebar",
      tools: "full",
      properties: "shown",
      density: "comfortable",
      motion: "system",
      tips: true,
    };
    onPreferencesChange.mockClear();
    await render({ preferences: kept, onPreferencesChange });
    expect(rows(container)).toContain("Move earlier");
    const switchEasy = [
      ...container.querySelectorAll<HTMLElement>('.hm-pdf-editor-mode [role="radio"]'),
    ].find((radio) => radio.textContent === "Easy");
    await act(() => userEvent.click(switchEasy as HTMLElement));
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "easy" }));
    expect(rows(container)).toContain("Move earlier");
    await render({ preferences: { ...kept, mode: "easy" }, onPreferencesChange });
    expect(rows(container)).not.toContain("Move earlier");
  });

  it("inherits the page's theme, density and motion until the person or the host picks them", async () => {
    // A page that sets its own: dark, compact and reduced.
    const html = document.documentElement;
    html.setAttribute("data-hm-theme", "dark");
    html.setAttribute("data-hm-density", "compact");
    html.setAttribute("data-hm-motion", "reduced");
    try {
      const onPreferencesChange = vi.fn<(preferences: EditorPreferences) => void>();
      const first = await setUp({ onPreferencesChange });
      const editorRoot = root(first.container);
      for (const name of ["data-hm-theme", "data-hm-density", "data-hm-motion"]) {
        expect(editorRoot.hasAttribute(name), name).toBe(false);
      }
      // The toggle shows the theme the editor inherits, the page's dark one.
      const toggle = first.container.querySelector(".hm-theme-toggle") as HTMLElement;
      await waitFor(() => expect(toggle.getAttribute("aria-pressed")).toBe("true"));

      // The settings show what's in effect: the page's values.
      await act(() => userEvent.click(named(first.container, "Settings") as HTMLElement));
      const option = (setting: string, text: string) =>
        [
          ...first.container.querySelectorAll<HTMLElement>(
            `dialog[open] [aria-label="${setting}"] [role="radio"]`,
          ),
        ].find((radio) => radio.textContent === text) as HTMLElement;
      const checked = (setting: string) =>
        first.container.querySelector(
          `dialog[open] [aria-label="${setting}"] [role="radio"][aria-checked="true"]`,
        )?.textContent;
      expect(checked("Density")).toBe("Compact");
      expect(checked("Motion")).toBe("Reduced");
      expect(checked("Appearance")).toBe("Dark");
      // Choosing the one shown changes nothing: it's already in effect.
      await act(() => userEvent.click(option("Density", "Compact")));
      expect(editorRoot.hasAttribute("data-hm-density")).toBe(false);
      expect(onPreferencesChange).not.toHaveBeenCalled();
      // Choosing another makes it the editor's own, even the preference's default.
      await act(() => userEvent.click(option("Density", "Comfortable")));
      expect(editorRoot.dataset["hmDensity"]).toBe("comfortable");
      expect(checked("Density")).toBe("Comfortable");
      expect(editorRoot.hasAttribute("data-hm-motion")).toBe(false);
      await act(() => userEvent.click(option("Motion", "Full")));
      expect(editorRoot.dataset["hmMotion"]).toBe("full");
      expect(editorRoot.hasAttribute("data-hm-theme")).toBe(false);
      // The page's values never become the host's preferences.
      expect(onPreferencesChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: "system", density: "comfortable", motion: "full" }),
      );
      await act(() => userEvent.keyboard("{Escape}"));

      // Pressing the toggle chooses the other theme from the one shown.
      await act(() => userEvent.click(toggle));
      expect(editorRoot.dataset["hmTheme"]).toBe("light");
      expect(onPreferencesChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ theme: "light", density: "comfortable", motion: "full" }),
      );
      await waitFor(() => expect(toasts(first.container)).toContain("Light theme"));
      await cleanUp();

      // A host's default for a field sets it; the others still inherit.
      const second = await setUp({ defaultPreferences: { theme: "light", density: "compact" } });
      expect(root(second.container).dataset["hmTheme"]).toBe("light");
      expect(root(second.container).dataset["hmDensity"]).toBe("compact");
      expect(root(second.container).hasAttribute("data-hm-motion")).toBe(false);
      await cleanUp();

      // A host that keeps the preferences sets all three.
      const third = await setUp({
        preferences: {
          theme: "system",
          mode: "advanced",
          toolsLayout: "sidebar",
          tools: "full",
          properties: "shown",
          density: "comfortable",
          motion: "system",
          tips: true,
        },
      });
      expect(root(third.container).dataset["hmTheme"]).toBe("system");
      expect(root(third.container).dataset["hmDensity"]).toBe("comfortable");
      expect(root(third.container).dataset["hmMotion"]).toBe("system");
    } finally {
      html.removeAttribute("data-hm-theme");
      html.removeAttribute("data-hm-density");
      html.removeAttribute("data-hm-motion");
    }
  });
});

describe("Easy mode's start cards (sdk-core ADR 0067)", () => {
  it("shows once per document, takes focus, and leads to a card's tools", async () => {
    const { container, open } = await setUp({ defaultPreferences: { mode: "easy" } });
    // Before a document, the editor's own empty state, without cards.
    expect(cards(container)).toEqual([]);
    await open(3);
    expect(cards(container)).toEqual([
      "Rotate pages",
      "Remove pages",
      "Add pages from another PDF",
      "Reorder pages",
    ]);
    expect(container.querySelector("section[aria-labelledby] p[id]")?.textContent).toBe(
      "What would you like to do?",
    );
    // The cards cover the document, so focus goes to them rather than behind them.
    expect(document.activeElement).toBe(card(container, "rotate"));
    // A card closes them and leads to its first tool, with focus on its row.
    await act(() => userEvent.click(card(container, "rotate")));
    expect(cards(container)).toEqual([]);
    expect(document.activeElement).toBe(row(container, "pdf.rotate-left"));

    // Another document: the cards again, until skipped, which leaves focus on it.
    await open(2);
    expect(cards(container)).not.toEqual([]);
    await act(() => userEvent.click(named(container, "Just show me the editor") as HTMLElement));
    expect(cards(container)).toEqual([]);
    expect(document.activeElement).toBe(container.querySelector(".hm-pdf-viewer"));
  });

  it("lists the reordering card's tools in Easy mode, for that document only", async () => {
    const { container, open, session } = await setUp({ defaultPreferences: { mode: "easy" } });
    await open(3);
    await act(() => userEvent.click(card(container, "reorder")));
    expect(rows(container)).toContain("Move earlier");
    // The current page is the first, so Move later is the one that can run.
    expect(document.activeElement).toBe(row(container, "pdf.move-later"));
    await act(() => userEvent.keyboard("{Enter}"));
    expect(pageKeys(session)).toEqual(["p2", "p1", "p3"]);

    await open(2);
    await act(() => userEvent.click(named(container, "Just show me the editor") as HTMLElement));
    expect(rows(container)).not.toContain("Move earlier");
  });

  it("runs the adding card's tool, which asks for a file", async () => {
    const { container, open } = await setUp({ defaultPreferences: { mode: "easy" } });
    await open(2);
    const picker = container.querySelector("input[data-hm-insert]") as HTMLInputElement;
    const asked = vi.fn();
    picker.addEventListener("click", (event) => {
      // The test answers for the person, so no system picker opens.
      event.preventDefault();
      asked();
    });
    await act(() => userEvent.click(card(container, "add")));
    expect(asked).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(row(container, "pdf.insert-pages"));
  });

  it("shows hidden tools again, as they were last shown, to focus a card's tool", async () => {
    const onPreferencesChange = vi.fn<(preferences: EditorPreferences) => void>();
    const { container, open } = await setUp({
      defaultPreferences: { mode: "easy", tools: "hidden" },
      onPreferencesChange,
    });
    await open(3);
    expect((container.querySelector("nav") as HTMLElement).hidden).toBe(true);
    await act(() => userEvent.click(card(container, "remove")));
    expect((container.querySelector("nav") as HTMLElement).hidden).toBe(false);
    expect(onPreferencesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ tools: "full" }),
    );
    expect(document.activeElement).toBe(row(container, "pdf.delete-pages"));
  });

  it("on a phone, opens a card's group in a sheet with its tool focused", async () => {
    const { container, open } = await setUp({ defaultPreferences: { mode: "easy" } }, PHONE);
    await open(3);
    await act(() => userEvent.click(card(container, "rotate")));
    const sheet = container.querySelector<HTMLDialogElement>("dialog[open]") as HTMLDialogElement;
    expect(sheet).not.toBeNull();
    const target = sheet.querySelector('[data-hm-tool-id="pdf.rotate-left"]');
    expect(document.activeElement).toBe(target);
    await act(() => userEvent.keyboard("{Escape}"));

    // Adding pages asks for a file, so focus goes to its group's tab, not a sheet.
    await open(2);
    const picker = container.querySelector("input[data-hm-insert]") as HTMLInputElement;
    picker.addEventListener("click", (event) => event.preventDefault());
    await act(() => userEvent.click(card(container, "add")));
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Remove and add");
    expect(document.activeElement?.closest(".hm-tab-bar")).not.toBeNull();
  });

  it("offers only the cards whose tools the host kept and that can run", async () => {
    const kept = await setUp({
      defaultPreferences: { mode: "easy" },
      tools: ["pdf.open", "pdf.undo", "pdf.redo", "pdf.rotate-left", "pdf.rotate-right"],
    });
    await kept.open(3);
    expect(cards(kept.container)).toEqual(["Rotate pages"]);
    await cleanUp();

    // One page can't be removed or reordered.
    const single = await setUp({ defaultPreferences: { mode: "easy" } });
    await single.open(1);
    expect(cards(single.container)).toEqual(["Rotate pages", "Add pages from another PDF"]);
  });

  it("closes when a tool runs, and never shows in Advanced mode", async () => {
    const easy = await setUp({ defaultPreferences: { mode: "easy" } });
    await easy.open(2);
    await act(() => userEvent.click(row(easy.container, "pdf.rotate-right") as HTMLElement));
    expect(cards(easy.container)).toEqual([]);
    expect(rotations(easy.session)).toEqual([90, 0]);
    await cleanUp();

    const advanced = await setUp();
    await advanced.open(2);
    expect(cards(advanced.container)).toEqual([]);
  });
});

describe("toasts (sdk-core ADR 0067)", () => {
  it("says what opening and an edit did, and the edit's Undo undoes it", async () => {
    const { container, open, session } = await setUp();
    await open(2);
    await waitFor(() => expect(toasts(container)).toContain("Opened a PDF with 2 pages."));
    await act(() => userEvent.click(row(container, "pdf.rotate-right") as HTMLElement));
    await waitFor(() => expect(toasts(container)).toContain("Rotated 1 page."));
    const [undo] = undos(container);
    await act(() => userEvent.click(undo as HTMLElement));
    expect(rotations(session)).toEqual([0, 0]);
    await waitFor(() => expect(toasts(container)).toContain("Undone."));
    // Undone, the edit's toast goes with its Undo.
    expect(undos(container)).toEqual([]);
  });

  it("keeps one edit's toast at a time, and drops it once the plan moves on", async () => {
    const { container, open } = await setUp();
    await open(3);
    await act(() => userEvent.click(row(container, "pdf.rotate-right") as HTMLElement));
    await act(() => userEvent.click(row(container, "pdf.delete-pages") as HTMLElement));
    await waitFor(() => expect(toasts(container)).toContain("Deleted 1 page."));
    expect(toasts(container)).not.toContain("Rotated 1 page.");
    expect(undos(container)).toHaveLength(1);

    // Undone from its key, not the toast: the toast goes too.
    (container.querySelector(".hm-pdf-viewer") as HTMLElement).focus();
    await act(() => userEvent.keyboard("{Control>}z{/Control}"));
    await waitFor(() => expect(undos(container)).toEqual([]));
  });

  it("offers no Undo when the host leaves the undo tool out", async () => {
    const { container, open } = await setUp({
      tools: ["pdf.open", "pdf.rotate-left", "pdf.rotate-right"],
    });
    await open(2);
    await act(() => userEvent.click(row(container, "pdf.rotate-right") as HTMLElement));
    await waitFor(() => expect(toasts(container)).toContain("Rotated 1 page."));
    expect(undos(container)).toEqual([]);
  });
});

describe("on a phone (sdk-core ADR 0067)", () => {
  it("puts the tool groups in a tab bar, each opening its tools in a sheet", async () => {
    const { container, open, session } = await setUp({}, PHONE);
    await open(2);
    const nav = container.querySelector("nav") as HTMLElement;
    expect(getComputedStyle(nav).display).toBe("none");
    const tabs = [...container.querySelectorAll<HTMLButtonElement>(".hm-tab-bar button")];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Rotate", "Remove and add", "Reorder"]);
    // The mode moves into the settings; the bar keeps Undo and Download.
    expect(
      getComputedStyle(container.querySelector(".hm-pdf-editor-mode") as Element).display,
    ).toBe("none");

    await act(() => userEvent.click(tabs[0] as HTMLElement));
    const sheet = container.querySelector<HTMLDialogElement>("dialog[open]") as HTMLDialogElement;
    expect(sheet.textContent).toContain("Rotate left");
    await act(() =>
      userEvent.click(sheet.querySelector('[data-hm-tool-id="pdf.rotate-left"]') as HTMLElement),
    );
    expect(rotations(session)).toEqual([270, 0]);
    await waitFor(() => expect(container.querySelector("dialog[open]")).toBeNull());
  });
});
