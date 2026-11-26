import type { EditorPreferences } from "@hussmartinez/ui";
import {
  AnnouncerProvider,
  Button,
  CommandIcon,
  CommandPalette,
  EditorFrame,
  type HeadingLevel,
  HeadingLevelProvider,
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
  useToast,
} from "@hussmartinez/ui/react";
import {
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AudioPlan } from "../core/model/plan.js";
import type { AudioRenderResult } from "../core/ports/audio-processor.js";
import type { AudioInsertOptions, AudioSessionExportOptions } from "../core/session/session.js";
import type { AudioTool } from "../features/tools/tools.js";
import { AudioExportDialog, type AudioExportDialogProps } from "./AudioExportDialog.js";
import { EditorInspector } from "./AudioInspector.js";
import { Notices } from "./AudioNotices.js";
import { AudioRenameDialog } from "./AudioRenameDialog.js";
import { ACCEPT, Stage } from "./AudioStage.js";
import { Transport } from "./AudioTransport.js";
import {
  AudioEditorProvider,
  type AudioEditorProviderProps,
  type AudioToolResult,
  PALETTE,
  useAudioEditorContext,
  useAudioSession,
} from "./context.js";
import {
  fromSettings,
  INHERITED,
  type Inherited,
  type InheritedValues,
  inheritedValues,
  settingsValue,
} from "./editor/inherited.js";
import { useEditorPreferences } from "./editor/preferences.js";
import { START_CARDS, type StartCard, StartCards } from "./editor/StartCards.js";
import { toolLists } from "./editor/tool-lists.js";
import { ElementListenersContext } from "./element/listeners.js";
import { ICONS } from "./icons.js";
import { type AudioEditorPart, classes, type PartClassNames } from "./parts.js";
import { useAudioTools } from "./tools.js";

/** Tools whose keys are also a focused control's own, as Home and End are a list's. */
const CONTROL_KEYS: ReadonlySet<string> = new Set(["audio.start", "audio.end"]);

/** Whether a key's target is a control that uses Home and End itself. */
function ownsHomeAndEnd(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="listbox"],[role="toolbar"],[role="slider"],input,textarea,select') !==
      null
  );
}

/**
 * Props of {@link AudioEditor}: the provider's, and the editor's own.
 *
 * @public
 */
export interface AudioEditorProps extends Omit<AudioEditorProviderProps, "children"> {
  /** A recording opened when the editor mounts. */
  readonly initialFile?: Blob;
  /**
   * Called with the plan whenever it changes: when a recording opens or is
   * added, after every edit, and after undo and redo.
   */
  readonly onChange?: (plan: AudioPlan) => void;
  /**
   * The colour scheme, as `ui`'s `data-hm-theme`: `"light"`, `"dark"`, or
   * `"system"` to follow the device. It wins over the preferences' theme,
   * and the top bar then has no theme toggle. Without it, the editor follows
   * the page's theme until the person or the preferences choose one.
   */
  readonly theme?: "light" | "dark" | "system";
  /**
   * The level of the editor's headings, from 2 to 6, so they fit the
   * host's outline: the inspector's title, its one level of heading for now
   * (sdk-core ADR 0058). Defaults to 2. A value that isn't one of the five
   * is treated as 2, with a development warning.
   */
  readonly headingLevel?: HeadingLevel;
  /**
   * The name an export is downloaded under, without its extension, such as
   * the name of the file being edited. Without it, the recording's title is
   * used, or else `recording`. See {@link AudioExportDialogProps.fileName}.
   */
  readonly fileName?: string;
  /**
   * Takes an export's file instead of the download, such as to upload it or
   * save it the host's own way. The export dialog closes once it's called.
   * See {@link AudioExportDialogProps.onExport}.
   */
  readonly onExport?: (blob: Blob, result: AudioRenderResult) => void;
  /** Extra classes on the root. */
  readonly className?: string;
  /** Extra classes on the editor's parts. */
  readonly classNames?: Readonly<Partial<Record<AudioEditorPart, string>>>;
  /**
   * Leaves out the editor's own look: its layout and colours, and `ui`'s
   * `hm-text` on the root. `ui`'s components keep theirs.
   */
  readonly unstyled?: boolean;
  /**
   * The person's preferences (sdk-core ADR 0067): mode, theme, the tools and
   * properties panels, density, motion and tips. Controlled with
   * `onPreferencesChange`; the editor never stores them, so the host decides
   * where they're kept, such as `localStorage`.
   */
  readonly preferences?: EditorPreferences;
  /**
   * Preferences to start with when `preferences` isn't given. Fields left
   * out take ui's defaults, except the mode, which is Advanced, so every tool
   * is listed until the host or the person chooses otherwise. The theme,
   * density and motion are the page's until the host sets them here or the
   * person picks them.
   */
  readonly defaultPreferences?: Partial<EditorPreferences>;
  /** Called with the whole preferences when the person changes one. */
  readonly onPreferencesChange?: (preferences: EditorPreferences) => void;
}

/**
 * What a host can do with the editor through its ref.
 *
 * @public
 */
export interface AudioEditorHandle {
  /** Opens a recording, replacing the current one once it has opened. */
  open(file: Blob): Promise<void>;
  /** Adds a recording on a new track, or on `options.track`. */
  insert(file: Blob, options?: AudioInsertOptions): Promise<void>;
  undo(): void;
  redo(): void;
  play(): Promise<void>;
  pause(): void;
  /** Moves the playhead to a timeline frame. */
  seek(frame: number): void;
  /**
   * Exports the plan as it is now, for a host's own export button, without
   * the editor's dialog: through the editor's processor, or the host's
   * `processor`. It resolves with the file, the mix's peak and how many
   * frames were clamped, and never downloads anything or calls `onExport`.
   * It fails as `session.export` does, and throws `TypeError` when there's
   * no processor.
   */
  export(options?: AudioSessionExportOptions): Promise<AudioRenderResult>;
}

interface ShellProps
  extends Pick<AudioEditorProps, "preferences" | "defaultPreferences" | "onPreferencesChange"> {
  readonly initialFile: Blob | undefined;
  readonly fileName: string | undefined;
  readonly onChange: ((plan: AudioPlan) => void) | undefined;
  readonly theme: AudioEditorProps["theme"];
  readonly headingLevel: HeadingLevel | undefined;
  readonly onExport: ((blob: Blob, result: AudioRenderResult) => void) | undefined;
  readonly className: string | undefined;
  readonly classNames: PartClassNames | undefined;
  readonly unstyled: boolean;
}

const Shell = /* @__PURE__ */ forwardRef<AudioEditorHandle, ShellProps>(
  function Shell(props, ref): ReactNode {
    const { session, output, messages, open, insert } = useAudioEditorContext();

    useImperativeHandle(
      ref,
      () => ({
        open,
        insert,
        undo: () => session.undo(),
        redo: () => session.redo(),
        play: () => output.play(),
        pause: () => output.pause(),
        seek: (frame) => output.seek(frame),
        export: (options) => session.export(options),
      }),
      [session, output, open, insert],
    );

    // The recording given on mount opens once, StrictMode's second mount included.
    const opened = useRef(false);
    useEffect(() => {
      if (opened.current || !props.initialFile) return;
      opened.current = true;
      // A failure is in the snapshot, which the stage shows.
      open(props.initialFile).catch(() => {});
    }, [props.initialFile, open]);

    return (
      // One Messages object for the SDK's text and ui's (sdk-core ADR 0046).
      <UiMessagesProvider messages={messages}>
        <AnnouncerProvider>
          <Root {...props} />
        </AnnouncerProvider>
      </UiMessagesProvider>
    );
  },
);

/** Toasts before ui's provider has mounted: nothing to show them in yet. */
const NO_TOASTS: ToastApi = { show: () => "", dismiss: () => {} };

/**
 * Hands ui's toasts to the root, which renders their provider inside
 * itself, so they take the editor's theme.
 */
function ToastBridge({ onToast }: { readonly onToast: (toast: ToastApi) => void }): null {
  const toast = useToast();
  useEffect(() => onToast(toast), [onToast, toast]);
  return null;
}

/** The settings without the theme's, when the host's `theme` prop sets it. */
const SETTINGS_WITHOUT_THEME = [
  "mode",
  "toolsLayout",
  "tools",
  "properties",
  "density",
  "motion",
  "tips",
] as const;

/**
 * The editor's root, on ui's frame (docs/adr/0007). Its tools' shortcuts
 * are matched here, on the root and never on `window`, so they apply only
 * while focus is in the editor, as WCAG 2.1.4 requires of single-key
 * shortcuts (sdk-core ADR 0030).
 */
function Root(props: ShellProps): ReactNode {
  const { onChange, theme, headingLevel, fileName, onExport, className, classNames, unstyled } =
    props;
  const editor = useAudioEditorContext();
  const { messages, playhead, shortcuts, tools: registry, fileChooser, feedback } = editor;
  const { session, snapshot } = useAudioSession();
  // Tool labels and group names are keys of the catalogue.
  const t = messages.t as (key: string, values?: Record<string, unknown>) => string;
  const root = useRef<HTMLElement>(null);
  const play = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const purpose = useRef<"open" | "insert">("open");
  const { plan, sources } = snapshot;

  // ui's toasts live inside the root, below this component.
  const toastTo = useRef<ToastApi>(NO_TOASTS);
  const takeToasts = useCallback((toast: ToastApi) => {
    toastTo.current = toast;
  }, []);
  // The last edit's toast, and the plan it left: once the plan moves on, by
  // another edit, an undo or the host, its Undo would undo something else,
  // so it goes. One edit's toast shows at a time.
  const editToast = useRef<{ readonly id: string; readonly plan: AudioPlan | undefined } | null>(
    null,
  );
  const undoPresent = registry.get("audio.undo") !== undefined;
  const runRef = useRef<(id: string) => boolean>(() => false);
  const showEdit = useCallback(
    (message: string) => {
      const toast = toastTo.current;
      if (editToast.current) toast.dismiss(editToast.current.id);
      const id = toast.show({
        message,
        ...(undoPresent
          ? { action: { label: t("tools.undo"), onAction: () => runRef.current("audio.undo") } }
          : {}),
      });
      editToast.current = { id, plan: session.getSnapshot().plan };
    },
    [session, t, undoPresent],
  );
  // What the tools say, the timeline's edits included, comes as toasts.
  useEffect(() => {
    feedback.current = (result: AudioToolResult) => {
      if (result.edit) showEdit(result.message);
      else toastTo.current.show({ message: result.message });
    };
    return () => {
      feedback.current = null;
    };
  }, [feedback, showEdit]);
  const { flags, run, ariaKeyShortcuts, keysText } = useAudioTools();
  // The toast's Undo runs the latest, as each commit leaves it.
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const [preferences, setPreferences] = useEditorPreferences(
    props.preferences,
    props.defaultPreferences,
    props.onPreferencesChange,
  );
  // An embedded editor inherits the page's theme, density and motion until
  // someone chooses them: the host, through its preferences or a default for
  // that field, or the person, through the toggle or the settings.
  const [picked, setPicked] = useState<ReadonlySet<Inherited>>(() => new Set());
  const isChosen = (field: Inherited): boolean =>
    picked.has(field) ||
    props.preferences !== undefined ||
    props.defaultPreferences?.[field] !== undefined;
  // How the tools were last shown, to show them that way again for a start card.
  const lastTools = useRef<"full" | "icons">("full");
  useEffect(() => {
    if (preferences.tools !== "hidden") lastTools.current = preferences.tools;
  }, [preferences.tools]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The page's values for the fields the editor inherits, read as the settings open.
  const [inheritedAtOpen, setInheritedAtOpen] = useState<InheritedValues | null>(null);
  const shownSettings = settingsValue(preferences, isChosen, inheritedAtOpen);
  const [tab, setTab] = useState<string | null>(null);
  const { mode } = preferences;
  // The recording a start card or the cards belong to: the one opened.
  const sourceId = plan ? sources[0]?.id : undefined;
  // Easy mode's start cards show once per recording, until one is chosen,
  // skipped, or a tool runs.
  const [startShownFor, setStartShownFor] = useState<string | null>(null);
  // The card chosen for a recording: its tools stay listed in Easy mode,
  // even those of a higher level, and it may show the properties, for that
  // recording only.
  const [chosen, setChosen] = useState<{
    readonly source: string;
    readonly card: StartCard;
  } | null>(null);
  const chosenNow = chosen !== null && chosen.source === sourceId ? chosen.card : null;
  const extra = useMemo(
    () => new Set(mode === "easy" && chosenNow ? chosenNow.tools : []),
    [mode, chosenNow],
  );
  const lists = toolLists({ registry, flags, mode, t, keysText, ariaKeyShortcuts, extra });
  // What takes focus once the next render commits.
  const focusNext = useRef<string | "document" | null>(null);

  const runTool = (id: string): boolean => {
    if (sourceId !== undefined) setStartShownFor(sourceId);
    return run(id);
  };

  // The file picker, for the open and insert tools.
  useEffect(() => {
    const chooser = (next: "open" | "insert") => {
      purpose.current = next;
      picker.current?.click();
    };
    fileChooser.current = chooser;
    return () => {
      if (fileChooser.current === chooser) fileChooser.current = null;
    };
  }, [fileChooser]);

  /**
   * Applies a change of preferences, and says what changed that isn't on
   * screen. `changed` are the inherited fields the person chose, which are
   * the editor's own from then on: by default, those that differ from the
   * preferences.
   */
  const changePreferences = (
    next: EditorPreferences,
    changed: readonly Inherited[] = INHERITED.filter((field) => next[field] !== preferences[field]),
  ) => {
    if (next.mode !== preferences.mode) {
      toastTo.current.show({ message: t(`editor.mode.${next.mode}`) });
    }
    if (changed.includes("theme")) {
      toastTo.current.show({ message: t(`editor.theme.${next.theme}`) });
    }
    if (changed.some((field) => !picked.has(field))) {
      setPicked(new Set([...picked, ...changed]));
    }
    setPreferences(next);
  };

  // The host hears of every plan: an open, an insert, an edit, undo and redo.
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  });
  useEffect(() => {
    if (plan) change.current?.(plan);
  }, [plan]);

  // A failure reaches the element's error event once.
  const { onError } = useContext(ElementListenersContext);
  const { error } = snapshot;
  useEffect(() => {
    if (error) onError?.({ code: error.code, details: error.details ?? {} });
  }, [error, onError]);

  // An open shows a toast and moves focus to the playhead, or the play
  // button; an added recording shows an edit's toast, with Undo.
  const first = sources[0]?.id;
  const count = sources.length;
  const seen = useRef({ first, count });
  useEffect(() => {
    const before = seen.current;
    seen.current = { first, count };
    if (first !== undefined && first !== before.first) {
      toastTo.current.show({ message: messages.t("editor.opened") });
      (playhead.current ?? play.current)?.focus();
    } else if (first !== undefined && count > before.count) {
      showEdit(messages.t("editor.inserted"));
    }
  }, [first, count, messages, playhead, showEdit]);

  // An edit's toast goes once the plan moves on.
  useEffect(
    () =>
      session.subscribe(() => {
        const last = editToast.current;
        if (last && session.getSnapshot().plan !== last.plan) {
          toastTo.current.dismiss(last.id);
          editToast.current = null;
        }
      }),
    [session],
  );

  // Only the cards whose tools the host kept. Their tools act on the
  // playhead and the selection, so they're shown whether or not they can
  // run yet.
  const present = (id: string) => lists.palette.some((item) => item.id === id);
  const cards = START_CARDS.filter((card) => card.tools.some(present));
  const startShown =
    cards.length > 0 && mode === "easy" && sourceId !== undefined && startShownFor !== sourceId;

  // The cards cover the stage, so the first takes focus as they appear,
  // after the open has put it on the playhead, while focus is the editor's.
  const shownBefore = useRef(false);
  useEffect(() => {
    const appeared = startShown && !shownBefore.current;
    shownBefore.current = startShown;
    if (!appeared) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      const ours = active === null || active === document.body || root.current?.contains(active);
      if (ours) root.current?.querySelector<HTMLElement>(".hm-audio-start-card")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [startShown]);

  // A start card's tool, or the document, takes focus once it's rendered:
  // the match that's shown, such as the row in a group's sheet rather than
  // the one in the tools panel a phone hides, or else the playhead.
  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const shown =
      target === "document"
        ? undefined
        : [...(root.current?.querySelectorAll<HTMLElement>(target) ?? [])].find((element) =>
            element.checkVisibility(),
          );
    (shown ?? playhead.current ?? play.current)?.focus();
  });

  /**
   * Leads into the editor with a card's tools: listed, and the first that
   * can run focused. Its row is always there to focus: in the tools panel,
   * shown again as it was last if it was hidden, or, on a phone, where the
   * tab bar replaces the panel, in its group's sheet. Combining runs its
   * tool, which asks for a file; on a phone, focus then goes to its group's
   * tab, rather than a sheet over the picker.
   */
  const chooseCard = (card: StartCard) => {
    if (sourceId === undefined) return;
    setStartShownFor(sourceId);
    setChosen({ source: sourceId, card });
    const target =
      card.tools.find((id) => lists.palette.some((item) => item.id === id && !item.disabled)) ??
      card.tools.find(present);
    if (target === undefined) return;
    // The picker opens within the click, as browsers require.
    if (card.run) run(target);
    const group = registry.toolbar.find((tools) => tools.some((tool) => tool.id === target));
    const tabs = root.current?.querySelector<HTMLElement>(".hm-tab-bar");
    if (tabs?.checkVisibility()) {
      if (card.run) {
        const label = group ? lists.groups.find((each) => each.id === group[0]?.id)?.label : "";
        const button = [...tabs.querySelectorAll<HTMLElement>("button")].find(
          (each) => each.textContent === label,
        );
        button?.focus();
        return;
      }
      setTab(group?.[0]?.id ?? null);
    } else if (preferences.tools === "hidden") {
      changePreferences({ ...preferences, tools: lastTools.current });
    }
    focusNext.current = `[data-hm-tool-id="${target}"]`;
  };

  const skipCards = () => {
    if (sourceId !== undefined) setStartShownFor(sourceId);
    focusNext.current = "document";
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // The registry leaves handled keys, fields, dialogs and controls' own
    // keys alone; Home and End are a list's and a toolbar's own too
    // (docs/adr/0005).
    const id = shortcuts.match(event.nativeEvent, { root: event.currentTarget });
    if (id === PALETTE) {
      event.preventDefault();
      setPaletteOpen(true);
      return;
    }
    if (!id || (CONTROL_KEYS.has(id) && ownsHomeAndEnd(event.target))) return;
    if (runTool(id)) event.preventDefault();
  };

  // The bars' tools, where the host's toolbar keeps them; `toolbar={[]}`
  // shows no tool, keeping the shortcuts and the palette.
  const shown = new Set(registry.toolbar.flat().map((tool) => tool.id));
  const barTool = (id: string) => (shown.has(id) ? registry.get(id) : undefined);
  const enabled = (tool: AudioTool) => flags.get(tool.id)?.enabled ?? true;
  const barButton = (tool: AudioTool | undefined) => {
    if (!tool) return null;
    const Icon = ICONS[tool.icon];
    return (
      <Tooltip key={tool.id} type="label" content={t(tool.label)}>
        <IconButton
          variant="quiet"
          data-tool={tool.id}
          label={t(tool.label)}
          icon={Icon ? <Icon /> : null}
          disabled={!enabled(tool)}
          // A button that becomes disabled keeps focus, so keyboard users
          // stay where they were.
          focusableWhenDisabled
          aria-keyshortcuts={ariaKeyShortcuts(tool.id)}
          onClick={() => runTool(tool.id)}
        />
      </Tooltip>
    );
  };
  const exportTool = barTool("audio.export");
  const ExportIcon = exportTool ? ICONS[exportTool.icon] : undefined;
  const zoom = ["audio.zoom-out", "audio.zoom-in", "audio.zoom-fit"]
    .map(barTool)
    .filter((tool) => tool !== undefined);
  const tabGroup = lists.groups.find((group) => group.id === tab);
  const hasTools = lists.groups.length > 0;
  // Easy mode shows the properties only when a card asked, for that recording.
  const propertiesWanted =
    plan !== undefined && (mode !== "easy" || chosenNow?.properties === true);
  // The host's theme wins over the preferences', and takes the toggle's place.
  const rootTheme = theme ?? (isChosen("theme") ? preferences.theme : undefined);

  return (
    // A named section is a region landmark, so the editor is easy to find on
    // a host's page, and the frame's top bar isn't the page's banner.
    <section
      ref={root}
      className={classes(
        unstyled ? undefined : "hm-text",
        "hm-audio-editor",
        className,
        classNames?.root,
      )}
      aria-label={messages.t("editor.label")}
      // ui's colour mode, density and motion for the editor alone (sdk-core ADR 0067).
      data-hm-theme={rootTheme}
      data-hm-density={isChosen("density") ? preferences.density : undefined}
      data-hm-motion={isChosen("motion") ? preferences.motion : undefined}
      data-hm-unstyled={unstyled ? "" : undefined}
      onKeyDown={onKeyDown}
    >
      {/* Outside the frame's toolbars, so it's no toolbar item; the open and insert tools open it. */}
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        className="hm-audio-editor-picker"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          // The same file can be chosen again.
          event.currentTarget.value = "";
          if (!file) return;
          // A failure is in the snapshot, which the stage shows.
          (purpose.current === "open" ? editor.open(file) : editor.insert(file)).catch(() => {});
        }}
      />
      <EditorFrame
        className="hm-audio-editor-frame"
        unstyled={unstyled}
        toolsState={preferences.tools}
        onToolsStateChange={(tools) => changePreferences({ ...preferences, tools })}
        propertiesState={
          mode === "easy" && chosenNow?.properties ? "shown" : preferences.properties
        }
        onPropertiesStateChange={(properties) => {
          // Hiding them leaves the card's choice behind, for this recording.
          if (mode === "easy") setChosen(null);
          changePreferences({ ...preferences, properties });
        }}
        toolsLayout={preferences.toolsLayout}
        topBar={
          <>
            <span className="hm-audio-editor-title">
              {messages.t("editor.label")}
              {fileName ? <span className="hm-audio-editor-file">{fileName}</span> : null}
            </span>
            <ModeSwitch
              className="hm-audio-editor-mode"
              size="small"
              value={mode}
              onValueChange={(next) => changePreferences({ ...preferences, mode: next })}
            />
            <Toolbar label={t("toolbar.bar")} className="hm-audio-editor-bar">
              {barButton(barTool("audio.open"))}
              {barButton(barTool("audio.undo"))}
              {barButton(barTool("audio.redo"))}
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
              {theme ? null : (
                <ThemeToggle
                  // Until a theme is chosen, the toggle shows the page's.
                  value={isChosen("theme") ? preferences.theme : "inherit"}
                  onValueChange={(next) => changePreferences({ ...preferences, theme: next })}
                />
              )}
              <Tooltip type="label" content={t("editor.settings")}>
                <IconButton
                  variant="quiet"
                  label={t("editor.settings")}
                  icon={<SettingsIcon />}
                  aria-haspopup="dialog"
                  onClick={() => {
                    // The settings show what's in effect, the page's values
                    // included, as they are when they open.
                    setInheritedAtOpen(inheritedValues(root.current));
                    setSettingsOpen(true);
                  }}
                />
              </Tooltip>
            </Toolbar>
            {exportTool ? (
              <Button
                variant="primary"
                data-tool={exportTool.id}
                startIcon={ExportIcon ? <ExportIcon /> : null}
                disabled={!enabled(exportTool)}
                focusableWhenDisabled
                onClick={() => runTool(exportTool.id)}
              >
                {t(exportTool.label)}
              </Button>
            ) : null}
          </>
        }
        tools={
          hasTools ? (
            <ToolList
              label={messages.t("toolbar.label")}
              className={classes("hm-audio-editor-tools", classNames?.toolbar)}
              groups={lists.groups}
              descriptions={mode === "easy" && preferences.tips}
              shortcuts={mode === "expert"}
              onRun={runTool}
            />
          ) : undefined
        }
        properties={
          propertiesWanted ? (
            // The editor's headings take their level from here (sdk-core ADR 0058).
            <HeadingLevelProvider level={headingLevel ?? 2}>
              <EditorInspector classNames={classNames} />
            </HeadingLevelProvider>
          ) : undefined
        }
        bottom={
          <div className="hm-audio-editor-bottom">
            <Transport ref={play} classNames={classNames} mode={mode} />
            {zoom.length > 0 ? (
              <Toolbar label={t("toolbar.view")} className="hm-audio-editor-zoom">
                {zoom.map(barButton)}
              </Toolbar>
            ) : null}
          </div>
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
        <Notices classNames={classNames} />
        <Stage classNames={classNames} />
        {startShown ? <StartCards cards={cards} onChoose={chooseCard} onSkip={skipCards} /> : null}
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
              runTool(id);
            }}
          />
        ) : null}
      </Sheet>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={lists.palette}
        onRun={runTool}
      />
      <SettingsPanel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={shownSettings}
        onValueChange={(next) => {
          const choice = fromSettings(next, shownSettings, preferences, isChosen);
          changePreferences(choice.preferences, choice.chosen);
        }}
        {...(theme ? { settings: SETTINGS_WITHOUT_THEME } : {})}
      />
      <AudioRenameDialog />
      <AudioExportDialog
        {...(fileName === undefined ? {} : { fileName })}
        {...(onExport === undefined ? {} : { onExport })}
      />
      <ToastProvider>
        <ToastBridge onToast={takeToasts} />
      </ToastProvider>
    </section>
  );
}

/**
 * The audio editor (docs/adr/0005, docs/adr/0006), on ui's editor frame
 * (docs/adr/0007, sdk-core ADR 0067): a recording's tracks on a timeline,
 * with playback, over one editing session, entirely on the device. A top
 * bar holds the mode switch, Open, Undo, Redo, the theme toggle, Settings
 * and Export; a tools panel the editing tools, by mode; the inspector is
 * the properties panel; and the transport and the zoom run across the
 * foot. Every tool is in the command palette, on `Mod+K`, in every mode.
 * Preferences, such as the mode and theme, are the host's to keep: see
 * `preferences` and `onPreferencesChange`. It makes the SDK's own engine,
 * processor and output for any you don't pass.
 *
 * Give the editor a bounded height, such as a grid row or a fixed height:
 * the timeline takes what the bars leave, and scrolls.
 *
 * Load `ui`'s stylesheet, then this package's, once:
 *
 * @example
 * ```tsx
 * import "@hussmartinez/ui/styles.css";
 * import "@hussmartinez/audio-sdk/styles.css";
 * import { AudioEditor } from "@hussmartinez/audio-sdk/react";
 *
 * <AudioEditor initialFile={file} onChange={(plan) => save(plan)} />
 * ```
 *
 * @public
 */
export const AudioEditor = /* @__PURE__ */ forwardRef<AudioEditorHandle, AudioEditorProps>(
  function AudioEditor(
    {
      initialFile,
      onChange,
      theme,
      headingLevel,
      fileName,
      onExport,
      className,
      classNames,
      unstyled = false,
      preferences,
      defaultPreferences,
      onPreferencesChange,
      ...provider
    },
    ref,
  ): ReactNode {
    return (
      <AudioEditorProvider {...provider}>
        <Shell
          ref={ref}
          initialFile={initialFile}
          onChange={onChange}
          theme={theme}
          headingLevel={headingLevel}
          fileName={fileName}
          onExport={onExport}
          className={className}
          classNames={classNames}
          unstyled={unstyled}
          {...(preferences ? { preferences } : {})}
          {...(defaultPreferences ? { defaultPreferences } : {})}
          {...(onPreferencesChange ? { onPreferencesChange } : {})}
        />
      </AudioEditorProvider>
    );
  },
);
