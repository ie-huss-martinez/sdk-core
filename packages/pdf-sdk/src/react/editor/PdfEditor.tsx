import {
  createMessages,
  createShortcutRegistry,
  createToolRegistry,
  type Messages,
} from "@hussmartinez/sdk-core";
import type { EditorPreferences } from "@hussmartinez/ui";
import {
  AnnouncerProvider,
  Button,
  CommandIcon,
  CommandPalette,
  EditorFrame,
  IconButton,
  ModeSwitch,
  SettingsIcon,
  SettingsPanel,
  Sheet,
  TabBar,
  ThemeToggle,
  type ToastApi,
  ToastProvider,
  Toolbar,
  ToolList,
  Tooltip,
  UiMessagesProvider,
  useEditorPreferences,
  useLatest,
  usePlatform,
  useToast,
} from "@hussmartinez/ui/react";
import {
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PdfLimitName } from "../../core/errors/pdf-limits.js";
import type { PdfBytes } from "../../core/model/document.js";
import type { PdfPlan } from "../../core/model/plan.js";
import type { PdfOpenOptions, PdfSessionSnapshot, PdfWarning } from "../../core/session/session.js";
import { targetPages } from "../../features/pages/rotate-tools.js";
import type { PdfTool, PdfToolContext } from "../../features/tool-types.js";
import { DEFAULT_TOOLBAR, pdfTools } from "../../features/tools.js";
import { PdfContext } from "../context.js";
import { type PdfEditorMessageCatalogue, pdfEditorMessages } from "../editor-messages.js";
import { usePdfDocument, usePdfMessages, usePdfSession } from "../hooks.js";
import { useProvidedSession } from "../PdfSessionProvider.js";
import { PdfThumbnails } from "../thumbnails/PdfThumbnails.js";
import { pdfIcons } from "../toolbar/icons.js";
import { PdfViewer } from "../viewer/PdfViewer.js";
import { PasswordDialog } from "./PasswordDialog.js";
import { PdfEditorStart } from "./PdfEditorStart.js";
import { SaveDialog } from "./SaveDialog.js";
import { START_CARDS, type StartCard, StartCards } from "./StartCards.js";
import { toolLists } from "./tool-lists.js";
import type { PdfEditorChange, PdfEditorHandle, PdfEditorProps } from "./types.js";
import { usePasswordPrompt } from "./use-password-prompt.js";
import { useSave } from "./use-save.js";

/** The command palette's place in the shortcut registry: a family action, not a tool. */
const PALETTE = "pdf.command-palette";

/** The settings the editor offers: all of ui's but the properties panel's, which it has none of. */
const SETTINGS: readonly (keyof EditorPreferences)[] = [
  "theme",
  "mode",
  "toolsLayout",
  "tools",
  "density",
  "motion",
  "tips",
];

/**
 * A warning's text. Each one is passed `actual`; texts that don't show it
 * ignore it, which the catalogue's per-key types can't express for a union.
 */
function warningText(messages: Messages<PdfEditorMessageCatalogue>, warning: PdfWarning): string {
  const t = messages.t as (key: `warnings.${PdfLimitName}`, params: { actual: number }) => string;
  return t(`warnings.${warning.limit}`, { actual: warning.actual });
}

const join = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");

/**
 * What a tool's toast says after it ran from the tools, the bar, a shortcut
 * or the thumbnails' keys: the text the editor announced before the frame.
 * Tools whose result shows otherwise, such as opening, have none.
 */
function resultOf(
  tool: PdfTool,
  messages: Messages<PdfEditorMessageCatalogue>,
  before: PdfSessionSnapshot,
  after: PdfSessionSnapshot,
): string | undefined {
  switch (tool.id) {
    case "pdf.undo":
      return messages.t("editor.undone");
    case "pdf.redo":
      return messages.t("editor.redone");
    case "pdf.rotate-left":
    case "pdf.rotate-right":
      return messages.t("editor.rotated", { count: targetPages(before).length });
    case "pdf.delete-pages":
      return messages.t("editor.deleted", { count: targetPages(before).length });
    case "pdf.move-earlier":
    case "pdf.move-later": {
      // The move selects the moved pages; it says where the first one went.
      if (after.plan === before.plan) return undefined;
      const [first] = after.selection;
      const position = after.plan.pages.findIndex((page) => page.key === first) + 1;
      return messages.t("editor.moved", { count: after.selection.length, position });
    }
    default:
      return undefined;
  }
}

/** Whether a tool's result is an edit, which its toast offers to undo. */
const isEdit = (tool: PdfTool): boolean => tool.id !== "pdf.undo" && tool.id !== "pdf.redo";

/** What changed between two snapshots, if the host should hear about it. */
function changeBetween(
  before: PdfSessionSnapshot,
  after: PdfSessionSnapshot,
): PdfEditorChange | undefined {
  const pageCount = after.plan.pages.length;
  const opened = after.sources[0];
  if (after.status === "ready" && opened?.id !== before.sources[0]?.id) {
    return { reason: "open", pageCount, ...(opened?.name ? { fileName: opened.name } : {}) };
  }
  if (before.sources.length > 0 && after.sources.length === 0) {
    return { reason: "close", pageCount: 0 };
  }
  if (after.status === "ready" && after.plan !== before.plan) {
    return { reason: "edit", pageCount };
  }
  return undefined;
}

/** Toasts before ui's provider has mounted: nothing to show them in yet. */
const NO_TOASTS: ToastApi = { show: () => "", dismiss: () => {} };

/**
 * Hands ui's toasts to the editor's body, which renders the providers
 * inside its own root: ui's live regions follow the announcer's children,
 * and inside the root they never land in the host's layout.
 */
function ToastBridge({ onToast }: { onToast: (toast: ToastApi) => void }): null {
  const toast = useToast();
  useEffect(() => onToast(toast), [onToast, toast]);
  return null;
}

interface BodyProps
  extends Pick<
    PdfEditorProps,
    | "file"
    | "onChange"
    | "onExport"
    | "downloadName"
    | "className"
    | "classNames"
    | "unstyled"
    | "tools"
    | "toolbar"
    | "icons"
    | "preferences"
    | "defaultPreferences"
    | "onPreferencesChange"
    | "propertiesFooter"
  > {
  readonly handle: ForwardedRef<PdfEditorHandle>;
}

function PdfEditorBody(props: BodyProps): ReactNode {
  const { file, onChange, className, classNames = {}, unstyled = false, handle } = props;
  const session = usePdfSession();
  const snapshot = usePdfDocument();
  const messages = usePdfMessages();
  // Tool labels, group names and the editor's own keys are keys of the
  // catalogue; custom keys a host adds fall back to the key itself.
  const t = messages.t as (key: string, values?: Record<string, unknown>) => string;
  // ui's toasts live inside the root, below this component.
  const toastTo = useRef<ToastApi>(NO_TOASTS);
  const takeToasts = useCallback((toast: ToastApi) => {
    toastTo.current = toast;
  }, []);
  // The last edit's toast, and the plan it left: once the plan moves on, by
  // another edit, an undo or the host, its Undo would undo something else,
  // so it goes. One edit's toast shows at a time.
  const editToast = useRef<{ readonly id: string; readonly plan: PdfPlan } | null>(null);
  const done = useCallback(
    (message: string) => toastTo.current.show({ message, tone: "success" }),
    [],
  );
  const platform = usePlatform();
  const root = useRef<HTMLElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const insertInput = useRef<HTMLInputElement>(null);
  const [inserting, setInserting] = useState(false);
  // What takes focus once the next render commits, by selector: a start
  // card's tool, or the document once the cards are skipped.
  const pendingFocus = useRef<string | null>(null);
  // The host's latest props, taken as each render commits, never during it.
  const latestOnChange = useLatest(onChange);
  const saveProps = useLatest(props);
  const saving = useSave({ session, messages, done, props: saveProps });
  // Before it saves, a document that needed a password asks whether the copy
  // keeps it, and one whose restrictions the copy would lose says so
  // (docs/adr/0013).
  // By the document it's about, so the question never outlives it: another
  // document, even a protected one, starts from its own.
  const [choosingSaveFor, setChoosingSaveFor] = useState<string | null>(null);
  const { save: saveNow } = saving;
  const chooseOrSave = useLatest(() => {
    const now = session.getSnapshot();
    if (now.passwordProtected || (now.restricted && !session.exportsOriginal())) {
      setChoosingSaveFor(now.sources[0]?.id ?? null);
    } else saveNow();
  });
  const save = useCallback(() => chooseOrSave.current(), [chooseOrSave]);
  // Asks for the password of a file that needs one, and tries again with it.
  const prompt = usePasswordPrompt();
  const { run: runWithPassword, cancel: cancelPrompt } = prompt;
  // What to say once the password dialog has closed. A toast shown while a
  // modal dialog is open speaks from inside it, and this dialog closes the
  // moment the document opens, which would take the words with it.
  const asking = useLatest(prompt.asking);
  const afterPrompt = useRef<(() => void)[]>([]);
  const oncePromptCloses = useLatest((say: () => void) => {
    if (asking.current) afterPrompt.current.push(say);
    else say();
  });
  useEffect(() => {
    if (prompt.asking) return;
    for (const say of afterPrompt.current.splice(0)) say();
  }, [prompt.asking]);
  /**
   * Opens a file, asking for its password if it needs one. Settles once it
   * has opened, or failed for good, the person cancelling included. After a
   * prompt, focus goes to what replaced the start: the dialog gave it back
   * to something that's gone.
   */
  const openFile = useCallback(
    (next: Blob | PdfBytes, options: PdfOpenOptions = {}) =>
      runWithPassword(
        (password) =>
          session.open(next, { ...options, ...(password === undefined ? {} : { password }) }),
        () => {
          pendingFocus.current = ".hm-pdf-start-card";
        },
      ),
    [session, runWithPassword],
  );

  // Mistakes in `tools` or `toolbar`, such as an unknown id, throw here, when
  // the editor renders, rather than leaving a tool silently missing.
  const registry = useMemo(
    () =>
      createToolRegistry(pdfTools, {
        ...(props.tools ? { tools: props.tools } : {}),
        toolbar:
          props.toolbar ??
          DEFAULT_TOOLBAR.map((group) =>
            group.filter((id) => !props.tools || props.tools.includes(id)),
          ).filter((group) => group.length > 0),
      }),
    [props.tools, props.toolbar],
  );
  const shortcuts = useMemo(
    () =>
      createShortcutRegistry({
        platform,
        tools: [...registry.tools, { id: PALETTE, shortcuts: "command-palette" as const }],
      }),
    [platform, registry],
  );
  const context: PdfToolContext = useMemo(
    () => ({
      session,
      chooseFile: () => input.current?.click(),
      chooseInsertFile: () => insertInput.current?.click(),
      save,
    }),
    [session, save],
  );
  const icons = useMemo(() => ({ ...pdfIcons, ...props.icons }), [props.icons]);

  // Keys that only work in the thumbnails, for tools the host kept (docs/adr/0008).
  const deleteTool = registry.get("pdf.delete-pages");
  const moveTools = {
    earlier: registry.get("pdf.move-earlier"),
    later: registry.get("pdf.move-later"),
  };
  const undoTool = registry.get("pdf.undo");

  // The host's preferences, or the editor's own; an embedded editor inherits
  // the page's theme, density and motion until someone chooses them
  // (sdk-core ADR 0067).
  const prefs = useEditorPreferences({
    preferences: props.preferences,
    defaultPreferences: props.defaultPreferences,
    onPreferencesChange: props.onPreferencesChange,
    // Says what changed that isn't on screen.
    onChange: ({ previous, preferences: next, chosen }) => {
      if (next.mode !== previous.mode) {
        toastTo.current.show({ message: t(`editor.mode.${next.mode}`) });
      }
      if (chosen.includes("theme")) {
        toastTo.current.show({ message: t(`editor.theme.${next.theme}`) });
      }
    },
  });
  const { preferences } = prefs;
  // How the tools were last shown, to show them that way again for a start card.
  const lastTools = useRef<"full" | "icons">("full");
  useEffect(() => {
    if (preferences.tools !== "hidden") lastTools.current = preferences.tools;
  }, [preferences.tools]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const { mode } = preferences;
  const { status } = snapshot;
  const sourceId = status === "ready" ? snapshot.sources[0]?.id : undefined;
  // Easy mode's start cards show once per document, until one is chosen,
  // skipped, or a tool runs.
  const [startShownFor, setStartShownFor] = useState<string | null>(null);
  // The card chosen for a document: its tools stay listed in Easy mode,
  // even those of a higher level, for that document only.
  const [chosen, setChosen] = useState<{
    readonly source: string;
    readonly card: StartCard;
  } | null>(null);
  const extra = useMemo(
    () =>
      new Set(
        mode === "easy" && chosen !== null && chosen.source === sourceId ? chosen.card.tools : [],
      ),
    [mode, chosen, sourceId],
  );
  const toolState = { snapshot, saving: saving.saving, inserting };
  const lists = toolLists(registry, shortcuts, toolState, mode, icons, t, extra);

  /** Shows an edit's toast, with Undo, in place of the last edit's. */
  const showEdit = (message: string) => {
    const toast = toastTo.current;
    if (editToast.current) toast.dismiss(editToast.current.id);
    const id = toast.show({
      message,
      ...(undoTool
        ? { action: { label: t("tools.undo"), onAction: () => runTool(undoTool) } }
        : {}),
    });
    editToast.current = { id, plan: session.getSnapshot().plan };
  };

  /** Runs a tool that can run now, and says whether it did. */
  const runTool = (tool: PdfTool): boolean => {
    const before = session.getSnapshot();
    const state = { snapshot: before, saving: saving.saving, inserting };
    if (!(tool.isEnabled?.(state) ?? true)) return false;
    // A tool that ran closes the start cards; one that couldn't leaves them.
    if (sourceId !== undefined) setStartShownFor(sourceId);
    void Promise.resolve(tool.run(context)).then(() => {
      const result = resultOf(tool, messages, before, session.getSnapshot());
      if (!result) return;
      if (isEdit(tool)) showEdit(result);
      else toastTo.current.show({ message: result });
    });
    return true;
  };

  const run = (id: string): boolean => {
    const tool = registry.get(id);
    return tool ? runTool(tool) : false;
  };

  // Shortcuts work while focus is inside the editor, never on the whole page
  // (WCAG 2.1.4, sdk-core ADR 0030). The root bounds the search for a modal
  // dialog: keys in the editor's own, such as the palette's, stay its own.
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const id = shortcuts.match(event.nativeEvent, { root: event.currentTarget });
    if (id === PALETTE) {
      event.preventDefault();
      setPaletteOpen(true);
      return;
    }
    const tool = id ? registry.get(id) : undefined;
    if (!tool) return;
    event.preventDefault();
    runTool(tool);
  };

  useImperativeHandle(
    handle,
    () => ({
      session,
      open: openFile,
      export: (options) => session.export(options),
      undo: () => session.undo(),
      redo: () => session.redo(),
      close: () => {
        // Whatever was being asked goes with the document: a pending open
        // rejects, and can't open its file after the close.
        cancelPrompt();
        return session.close();
      },
    }),
    [session, openFile, cancelPrompt],
  );

  // The host's file opens when its identity changes; a newer one cancels it,
  // and whatever was being asked about the last one.
  useEffect(() => {
    if (file === undefined) return;
    if (file === null) {
      cancelPrompt();
      void session.close();
      return;
    }
    const controller = new AbortController();
    // A failure is in the snapshot, which the editor shows.
    openFile(file, { signal: controller.signal }).catch(() => {});
    return () => {
      controller.abort();
      cancelPrompt();
    };
  }, [session, file, openFile, cancelPrompt]);

  // Changes reach the host, and opening and closing show a toast, which
  // screen readers hear too. An edit's toast goes once the plan moves on.
  useEffect(() => {
    let before = session.getSnapshot();
    return session.subscribe(() => {
      const after = session.getSnapshot();
      const change = changeBetween(before, after);
      before = after;
      const last = editToast.current;
      if (last && after.plan !== last.plan) {
        toastTo.current.dismiss(last.id);
        editToast.current = null;
      }
      if (!change) return;
      if (change.reason === "open") {
        const message = messages.t("editor.opened", { count: change.pageCount });
        oncePromptCloses.current(() => toastTo.current.show({ message }));
      } else if (change.reason === "close") {
        toastTo.current.show({ message: messages.t("editor.closed") });
      }
      latestOnChange.current?.(change);
    });
  }, [session, messages, latestOnChange, oncePromptCloses]);

  // Focus follows the content that replaced what had it: Easy mode's first
  // start card, or else the document, once it opens; or the button to try
  // again after a failure. Focus elsewhere on the host's page is left alone.
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    const active = document.activeElement;
    const ours = active === null || active === document.body || root.current?.contains(active);
    if (!ours) return;
    if (status === "ready") {
      const target =
        root.current?.querySelector<HTMLElement>(".hm-pdf-start-card") ??
        root.current?.querySelector<HTMLElement>(".hm-pdf-viewer");
      target?.focus();
    }
    if (status === "error") startButton.current?.focus();
  }, [status]);

  // A start card's tool, or the document, takes focus once it's rendered:
  // the match that's shown, such as the row in a group's sheet rather than
  // the one in the tools panel a phone hides, or else the document.
  useEffect(() => {
    const selector = pendingFocus.current;
    if (selector === null) return;
    pendingFocus.current = null;
    const shown = [...(root.current?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
      (element) => element.checkVisibility(),
    );
    (shown ?? root.current?.querySelector<HTMLElement>(".hm-pdf-viewer"))?.focus();
  });

  const open = (chosenFile: File) => {
    // A failure is in the snapshot, which the editor shows.
    openFile(chosenFile).catch(() => {});
  };

  /**
   * Inserts every page of another file after the current page, then selects
   * the inserted pages and shows the first (docs/adr/0008). A failure is in
   * the snapshot, which the alert above the document shows, and changes
   * nothing. A file that needs a password is asked for it first.
   */
  const insert = async (chosenFile: File) => {
    const before = session.getSnapshot();
    const current = before.plan.pages.findIndex((page) => page.key === before.currentPage);
    const at = current >= 0 ? current + 1 : before.plan.pages.length;
    setInserting(true);
    try {
      await runWithPassword((password) =>
        session.insert(chosenFile, { at, ...(password === undefined ? {} : { password }) }),
      );
    } catch {
      return;
    } finally {
      setInserting(false);
    }
    const had = new Set(before.plan.pages.map((page) => page.key));
    const added = session
      .getSnapshot()
      .plan.pages.filter((page) => !had.has(page.key))
      .map((page) => page.key);
    const [first] = added;
    if (!first) return;
    session.select(added);
    session.goToPage(first);
    oncePromptCloses.current(() =>
      showEdit(messages.t("editor.inserted", { count: added.length, page: at })),
    );
  };

  // Only the cards whose tools the host kept and that can run now, such as
  // no removing or reordering a document of one page.
  const cards = START_CARDS.filter((card) =>
    card.tools.some((id) => lists.palette.some((item) => item.id === id && !item.disabled)),
  );
  const startShown =
    cards.length > 0 && mode === "easy" && sourceId !== undefined && startShownFor !== sourceId;

  /**
   * Leads into the editor with a card's tools: listed, and the first that
   * can run focused. Its row is always there to focus: in the tools panel,
   * shown again as it was last if it was hidden, or, on a phone, where the
   * tab bar replaces the panel, in its group's sheet. Adding pages runs its
   * tool, which asks for a file; on a phone, focus then goes to its group's
   * tab, rather than a sheet over the picker.
   */
  const chooseCard = (card: StartCard) => {
    if (sourceId === undefined) return;
    const target =
      card.tools.find((id) => lists.palette.some((item) => item.id === id && !item.disabled)) ??
      card.tools[0];
    if (target === undefined) return;
    // The picker opens within the click, as browsers require. A tool that
    // can't run leaves the cards open, with focus on the card.
    if (card.run && !run(target)) return;
    setStartShownFor(sourceId);
    setChosen({ source: sourceId, card });
    const group = registry.toolbar.find((tools) => tools.some((tool) => tool.id === target));
    const tab = root.current?.querySelector<HTMLElement>(".hm-tab-bar");
    if (tab?.checkVisibility()) {
      if (card.run) {
        const label = group ? lists.groups.find((each) => each.id === group[0]?.id)?.label : "";
        const button = [...tab.querySelectorAll<HTMLElement>("button")].find(
          (each) => each.textContent === label,
        );
        button?.focus();
        return;
      }
      setTab(group?.[0]?.id ?? null);
    } else if (preferences.tools === "hidden") {
      prefs.change({ ...preferences, tools: lastTools.current });
    }
    pendingFocus.current = `[data-hm-tool-id="${target}"]`;
  };

  const skipCards = () => {
    if (sourceId !== undefined) setStartShownFor(sourceId);
    pendingFocus.current = ".hm-pdf-viewer";
  };

  const { error, warnings } = snapshot;
  // A missing or wrong password is the password dialog's to say, while it
  // asks. Once the person cancels, it's the reason nothing opened.
  const showError =
    error !== undefined &&
    error.code !== "ABORTED" &&
    !(prompt.pending && error.code === "PASSWORD_REQUIRED");
  let content: ReactNode;
  if (status === "ready") {
    content = (
      <>
        <PdfThumbnails
          className={join("hm-pdf-editor-sidebar", classNames.sidebar)}
          unstyled={unstyled}
          {...(deleteTool ? { onDelete: () => runTool(deleteTool) } : {})}
          {...(moveTools.earlier || moveTools.later
            ? {
                onMove: (direction: "earlier" | "later") => {
                  const tool = moveTools[direction];
                  if (tool) runTool(tool);
                },
              }
            : {})}
        />
        <PdfViewer unstyled={unstyled} />
      </>
    );
  } else if (status === "opening") {
    content = (
      <div role="status" className={join("hm-pdf-editor-loading", classNames.status)}>
        {/* Indeterminate: the engine reports no progress while it opens. */}
        <progress className="hm-pdf-editor-progress" aria-hidden="true" />
        <p>{messages.t("editor.opening")}</p>
      </div>
    );
  } else {
    content = (
      <PdfEditorStart
        error={showError ? error : undefined}
        onFile={open}
        button={startButton}
        className={join("hm-pdf-editor-start", classNames.start)}
        alertClassName={join("hm-pdf-editor-alert", classNames.alert)}
      />
    );
  }

  // The bar's tools, where the host's toolbar keeps them; `toolbar={[]}`
  // hides every tool, keeping the shortcuts and the palette.
  const shown = new Set(registry.toolbar.flat().map((tool) => tool.id));
  const barTool = (id: string) => (shown.has(id) ? registry.get(id) : undefined);
  const enabled = (tool: PdfTool) => tool.isEnabled?.(toolState) ?? true;
  const barButton = (tool: PdfTool | undefined) => {
    if (!tool) return null;
    const Icon = icons[tool.icon];
    return (
      <Tooltip key={tool.id} type="label" content={t(tool.label)}>
        <IconButton
          variant="quiet"
          data-tool={tool.id}
          label={t(tool.label)}
          icon={Icon ? <Icon /> : null}
          disabled={!enabled(tool)}
          // A button that becomes disabled keeps focus, so keyboard users
          // stay where they were (docs/adr/0008).
          focusableWhenDisabled
          aria-keyshortcuts={shortcuts.ariaKeyShortcuts(tool.id)}
          onClick={() => runTool(tool)}
        />
      </Tooltip>
    );
  };
  const download = barTool("pdf.download");
  const DownloadIcon = download ? icons[download.icon] : undefined;
  const tabGroup = lists.groups.find((group) => group.id === tab);
  const hasTools = lists.groups.length > 0;
  const fileName = status === "ready" ? snapshot.sources[0]?.name : undefined;

  return (
    // The root takes the editor's shortcuts while focus is inside it. A named
    // section is a region landmark, so the editor is easy to find on a
    // host's page, and the frame's top bar isn't the page's banner.
    <section
      ref={root}
      aria-label={messages.t("editor.label")}
      aria-busy={status === "opening" || snapshot.busy || saving.saving}
      // ui's text root (ui ADR 0010), unless the host styles the editor itself.
      className={join(
        unstyled ? undefined : "hm-text",
        "hm-pdf-editor",
        className,
        classNames.root,
      )}
      data-hm-status={status}
      // ui's colour mode, density and motion for the editor alone (sdk-core ADR 0067).
      {...prefs.rootAttributes}
      onKeyDown={onKeyDown}
      {...(unstyled ? { "data-hm-unstyled": "" } : {})}
    >
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        // The open tool is the control; this input only opens the picker.
        tabIndex={-1}
        aria-hidden="true"
        hidden
        onChange={(event) => {
          const [chosenFile] = event.target.files ?? [];
          event.target.value = "";
          if (chosenFile) open(chosenFile);
        }}
      />
      <input
        ref={insertInput}
        type="file"
        accept="application/pdf,.pdf"
        // The insert tool is the control; this input only opens the picker.
        tabIndex={-1}
        aria-hidden="true"
        hidden
        data-hm-insert=""
        onChange={(event) => {
          const [chosenFile] = event.target.files ?? [];
          event.target.value = "";
          if (chosenFile) void insert(chosenFile);
        }}
      />
      <EditorFrame
        className="hm-pdf-editor-frame"
        unstyled={unstyled}
        toolsState={preferences.tools}
        onToolsStateChange={(tools) => prefs.change({ ...preferences, tools })}
        toolsLayout={preferences.toolsLayout}
        propertiesFooter={props.propertiesFooter}
        topBar={
          <>
            <span className="hm-pdf-editor-title">
              {messages.t("editor.label")}
              {fileName ? <span className="hm-pdf-editor-file">{fileName}</span> : null}
            </span>
            <ModeSwitch
              className="hm-pdf-editor-mode"
              size="small"
              value={mode}
              onValueChange={(next) => prefs.change({ ...preferences, mode: next })}
            />
            <Toolbar label={t("toolbar.bar")} className="hm-pdf-editor-bar">
              {barButton(barTool("pdf.open"))}
              {barButton(barTool("pdf.undo"))}
              {barButton(barTool("pdf.redo"))}
              {mode === "expert" ? (
                <Tooltip type="label" content={t("editor.commands")}>
                  <IconButton
                    variant="quiet"
                    label={t("editor.commands")}
                    icon={<CommandIcon />}
                    aria-haspopup="dialog"
                    aria-keyshortcuts={shortcuts.ariaKeyShortcuts(PALETTE)}
                    onClick={() => setPaletteOpen(true)}
                  />
                </Tooltip>
              ) : null}
              <ThemeToggle
                // Until a theme is chosen, the toggle shows the page's.
                value={prefs.themeToggleValue}
                onValueChange={(theme) => prefs.change({ ...preferences, theme })}
              />
              <Tooltip type="label" content={t("editor.settings")}>
                <IconButton
                  variant="quiet"
                  label={t("editor.settings")}
                  icon={<SettingsIcon />}
                  aria-haspopup="dialog"
                  // The settings show what's in effect, the page's values
                  // included, as they are when they open.
                  onClick={() => prefs.openSettings(root.current)}
                />
              </Tooltip>
            </Toolbar>
            {download ? (
              <Button
                variant="primary"
                data-tool={download.id}
                startIcon={DownloadIcon ? <DownloadIcon /> : null}
                disabled={!enabled(download)}
                // It keeps focus while it saves (docs/adr/0009).
                focusableWhenDisabled
                onClick={() => runTool(download)}
              >
                {t(download.label)}
              </Button>
            ) : null}
          </>
        }
        tools={
          hasTools ? (
            <ToolList
              label={messages.t("toolbar.label")}
              className={join("hm-pdf-editor-toolbar", classNames.toolbar)}
              groups={lists.groups}
              descriptions={mode === "easy" && preferences.tips}
              shortcuts={mode === "expert"}
              onRun={run}
            />
          ) : undefined
        }
        tabBar={
          hasTools ? (
            <TabBar
              label={messages.t("toolbar.label")}
              items={lists.groups.map((group) => ({
                id: group.id,
                label: group.label,
                icon: group.items[0]?.icon ?? null,
              }))}
              value={tab}
              onValueChange={(id) => setTab(id === tab ? null : id)}
            />
          ) : undefined
        }
      >
        <div className={join("hm-pdf-editor-header", classNames.header)}>
          {saving.saving ? (
            <div className={join("hm-pdf-editor-saving", classNames.status)}>
              <p role="status">{messages.t("editor.saving")}</p>
              {saving.cancellable ? (
                <Button size="small" onClick={saving.cancel}>
                  {messages.t("editor.cancelSave")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {saving.failure ? (
            <p role="alert" className={join("hm-pdf-editor-alert", classNames.alert)}>
              {saving.failure}
            </p>
          ) : null}
          {status === "ready" && showError ? (
            <p role="alert" className={join("hm-pdf-editor-alert", classNames.alert)}>
              {messages.error(error)}
            </p>
          ) : null}
          {status === "ready" && (warnings.length > 0 || snapshot.historyTrimmed) ? (
            <div role="status" className={join("hm-pdf-editor-warnings", classNames.status)}>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning.limit}>{warningText(messages, warning)}</li>
                ))}
                {snapshot.historyTrimmed ? <li>{messages.t("editor.historyTrimmed")}</li> : null}
              </ul>
            </div>
          ) : null}
        </div>
        <div className={join("hm-pdf-editor-body", classNames.body)}>{content}</div>
        {startShown ? (
          <StartCards cards={cards} icons={icons} onChoose={chooseCard} onSkip={skipCards} />
        ) : null}
      </EditorFrame>
      <Sheet
        placement="bottom"
        open={tabGroup !== undefined}
        onOpenChange={(next) => {
          if (!next) setTab(null);
        }}
        title={tabGroup?.label ?? ""}
      >
        {tabGroup ? (
          <ToolList
            label={tabGroup.label}
            groups={[tabGroup]}
            display="full"
            orientation="vertical"
            groupLabels={false}
            descriptions={preferences.tips}
            onRun={(id) => {
              setTab(null);
              run(id);
            }}
          />
        ) : null}
      </Sheet>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={lists.palette}
        onRun={run}
      />
      <SettingsPanel {...prefs.settings} settings={SETTINGS} />
      <PasswordDialog
        asking={prompt.asking}
        checking={prompt.checking}
        incorrect={prompt.incorrect}
        onSubmit={prompt.submit}
        onCancel={prompt.cancel}
      />
      <SaveDialog
        open={
          choosingSaveFor !== null &&
          choosingSaveFor === sourceId &&
          (snapshot.passwordProtected || snapshot.restricted)
        }
        passwordProtected={snapshot.passwordProtected}
        losesRestrictions={(keepPassword) =>
          snapshot.restricted && !session.exportsOriginal({ keepPassword })
        }
        onSave={(choice) => {
          setChoosingSaveFor(null);
          saveNow(choice);
        }}
        onCancel={() => setChoosingSaveFor(null)}
      />
      <AnnouncerProvider>
        <ToastProvider>
          <ToastBridge onToast={takeToasts} />
        </ToastProvider>
      </AnnouncerProvider>
    </section>
  );
}

/**
 * The complete editor, on ui's editor frame (docs/adr/0012, sdk-core ADR
 * 0067): a top bar with Open, Undo, Redo, the mode switch, the theme
 * toggle, Settings and Download; a tools panel of the page tools, by mode;
 * and the document's pages beside it as thumbnails, with designed states
 * for no document, opening and a failed open (ADR 0014). It creates its own
 * session, through `PdfSessionProvider`, unless one is passed, and releases
 * what it created when it unmounts.
 *
 * Users open a PDF with the button, which keyboard and screen reader users
 * reach like any other, or by dropping it on the editor. Focus moves to the
 * document once it opens, or to the button to try again if it couldn't.
 * Opening, each edit, undo, redo and saving show a toast, which screen
 * readers hear too; an edit's toast offers Undo.
 *
 * Its tools are {@link pdfTools}: choose them with `tools` and arrange them
 * with `toolbar`. Each tool's shortcut works while focus is in the editor,
 * and the command palette, on `Mod+K`, reaches every tool in every mode.
 * Preferences, such as the mode and theme, are the host's to keep: see
 * `preferences` and `onPreferencesChange`.
 *
 * Load `@hussmartinez/ui/styles.css` once, before the SDK's stylesheet: the
 * frame, and the focus rings and target sizes, are in it (sdk-core ADR 0036).
 *
 * Give the editor a bounded height, such as a grid row or a fixed height:
 * it fills it, and its viewer and thumbnails scroll within it.
 *
 * @example
 * ```tsx
 * const editor = useRef<PdfEditorHandle>(null);
 * <PdfEditor ref={editor} file={file} onChange={({ reason }) => setDirty(reason === "edit")} />;
 * const bytes = await editor.current?.export();
 * ```
 *
 * @public
 */
export const PdfEditor = /* @__PURE__ */ forwardRef(function PdfEditor(
  props: PdfEditorProps,
  handle: ForwardedRef<PdfEditorHandle>,
): ReactNode {
  const {
    file,
    onChange,
    onExport,
    downloadName,
    className,
    classNames,
    unstyled,
    tools,
    toolbar,
    icons,
    preferences,
    defaultPreferences,
    onPreferencesChange,
    propertiesFooter,
    messages: overrides,
    locale = "en",
    ...source
  } = props;
  const session = useProvidedSession(source);
  // One Messages object, with the host's locale and overrides, for the
  // editor's components and for ui's (sdk-core ADR 0046).
  const messages = useMemo(
    () =>
      createMessages(pdfEditorMessages, {
        locale,
        ...(overrides ? { overrides } : {}),
      }),
    [locale, overrides],
  );
  const value = useMemo(() => ({ session, messages }), [session, messages]);
  return (
    <PdfContext.Provider value={value}>
      <UiMessagesProvider messages={messages}>
        <PdfEditorBody
          handle={handle}
          {...(file !== undefined ? { file } : {})}
          {...(onChange ? { onChange } : {})}
          {...(onExport ? { onExport } : {})}
          {...(downloadName ? { downloadName } : {})}
          {...(className !== undefined ? { className } : {})}
          {...(classNames ? { classNames } : {})}
          {...(unstyled !== undefined ? { unstyled } : {})}
          {...(tools ? { tools } : {})}
          {...(toolbar ? { toolbar } : {})}
          {...(icons ? { icons } : {})}
          {...(preferences ? { preferences } : {})}
          {...(defaultPreferences ? { defaultPreferences } : {})}
          {...(onPreferencesChange ? { onPreferencesChange } : {})}
          propertiesFooter={propertiesFooter}
        />
      </UiMessagesProvider>
    </PdfContext.Provider>
  );
});
