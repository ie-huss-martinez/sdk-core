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
  useToast,
} from "@hussmartinez/ui/react";
import {
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
import type { VideoPlan } from "../core/model/plan.js";
import { planFrames } from "../core/model/plan.js";
import type { VideoSourceInfo } from "../core/model/source.js";
import type { VideoExportResult } from "../core/ports/video-processor.js";
import type { VideoSessionExportOptions } from "../core/session/session.js";
import type { VideoTool } from "../features/tools/tools.js";
import {
  PALETTE,
  useVideoEditor,
  useVideoSession,
  VideoEditorProvider,
  type VideoEditorProviderProps,
} from "./context.js";
import { START_CARDS, type StartCard, StartCards } from "./editor/StartCards.js";
import { toolLists } from "./editor/tool-lists.js";
import { ElementBridge } from "./element/bridge.js";
import { ACCEPT } from "./files.js";
import { ICONS } from "./icons.js";
import { useVideoTools, type VideoToolResult } from "./tools.js";
import { VideoExportDialog, type VideoExportDialogProps } from "./VideoExportDialog.js";
import { VideoInspector } from "./VideoInspector.js";
import { VideoStage } from "./VideoStage.js";
import { VideoTimeline } from "./VideoTimeline.js";
import { Transport } from "./VideoTransport.js";

/**
 * Props of {@link VideoEditor}.
 *
 * @public
 */
export interface VideoEditorProps extends Omit<VideoEditorProviderProps, "children"> {
  /** Files inserted when the editor mounts, in order. */
  readonly initialFiles?: readonly Blob[];
  /** Extra classes on the root. */
  readonly className?: string;
  /**
   * The name an export is downloaded under, without its extension, such as
   * the name of the file being edited. Without it, the video's title is
   * used, or else `video`. See {@link VideoExportDialogProps.fileName}. The
   * top bar shows it beside the editor's name.
   */
  readonly fileName?: string;
  /**
   * Takes an export's file instead of the download, such as to upload it or
   * save it the host's own way. The export dialog closes once it's called.
   * See {@link VideoExportDialogProps.onExport}.
   */
  readonly onExport?: (blob: Blob, result: VideoExportResult) => void;
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
export interface VideoEditorHandle {
  /**
   * Opens a file in place of everything open, as one clip: the sources open
   * before are closed and the history is cleared, so it can't be undone. A
   * failed open keeps what was open, as the session's `open` does.
   */
  open(file: Blob): Promise<VideoSourceInfo>;
  /** Inserts a file at the end of the plan, or at a frame. */
  insert(file: Blob, at?: number): Promise<VideoSourceInfo>;
  undo(): boolean;
  redo(): boolean;
  play(): Promise<void>;
  pause(): void;
  seek(frame: number): void;
  /**
   * Exports the plan as it is now, for a host's own export button, without
   * the editor's dialog (ADR 0005): through the editor's processor, or the
   * host's `processor`. It resolves with the file and what clamping did to
   * its sound, and never downloads anything or calls `onExport`. It fails as
   * `session.export` does, such as with `UNSUPPORTED_CODEC` and
   * `details.track: "audio"` where the browser can't encode the sound, and
   * `audio: "omit"` exports without it. It throws `TypeError` when there's
   * no processor, as with a host's engine and none of its own.
   */
  export(options?: VideoSessionExportOptions): Promise<VideoExportResult>;
}

/** The root's props: the editor's own, without the provider's. */
type RootProps = Pick<
  VideoEditorProps,
  | "className"
  | "fileName"
  | "onExport"
  | "preferences"
  | "defaultPreferences"
  | "onPreferencesChange"
>;

const Shell = /* @__PURE__ */ forwardRef<
  VideoEditorHandle,
  RootProps & { readonly initialFiles?: readonly Blob[] }
>(function Shell({ initialFiles, ...props }, ref) {
  const { session, messages, output } = useVideoEditor();
  const inserted = useRef(false);

  useImperativeHandle(
    ref,
    () => ({
      open: (file) => session.open(file),
      insert: (file, at) => session.insert(file, at === undefined ? {} : { at }),
      undo: () => session.undo(),
      redo: () => session.redo(),
      play: async () => output?.play(),
      pause: () => output?.pause(),
      seek: (frame) => output?.seek(frame),
      export: (options) => session.export(options),
    }),
    [session, output],
  );

  useEffect(() => {
    if (inserted.current || !initialFiles?.length) return;
    inserted.current = true;
    void (async () => {
      for (const file of initialFiles) await session.insert(file).catch(() => {});
    })();
  }, [initialFiles, session]);

  return (
    // One Messages object for the SDK's text and ui's (sdk-core ADR 0046).
    <UiMessagesProvider messages={messages}>
      <AnnouncerProvider>
        <Root {...props} />
      </AnnouncerProvider>
    </UiMessagesProvider>
  );
});

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

/** Where focus goes when the start cards are skipped: the timeline's clip, or the stage. */
const DOCUMENT = '.hm-video-editor-bottom [role="option"][tabindex="0"], .hm-video-stage';

/**
 * The editor's root, on ui's frame (docs/adr/0010). Its tools' shortcuts
 * are matched here, on the root and never on `window`, so they apply only
 * while focus is in the editor, as WCAG 2.1.4 requires of single-key
 * shortcuts (sdk-core ADR 0030).
 */
function Root(props: RootProps): ReactNode {
  const { className, fileName, onExport } = props;
  const editor = useVideoEditor();
  const {
    messages,
    shortcuts,
    tools: registry,
    registerFileChooser,
    insertFiles,
    subscribeEvents,
  } = editor;
  const { session, snapshot } = useVideoSession();
  // Tool labels and group names are keys of the catalogue.
  const t = messages.t as (key: string, values?: Record<string, unknown>) => string;
  const root = useRef<HTMLElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  // ui's toasts live inside the root, below this component.
  const toastTo = useRef<ToastApi>(NO_TOASTS);
  const takeToasts = useCallback((toast: ToastApi) => {
    toastTo.current = toast;
  }, []);
  // The last edit's toast, and the plan it left: once the plan moves on, by
  // another edit, an undo or the host, its Undo would undo something else,
  // so it goes. One edit's toast shows at a time.
  const editToast = useRef<{ readonly id: string; readonly plan: VideoPlan | null } | null>(null);
  const undoPresent = registry.get("video.undo") !== undefined;
  const runRef = useRef<(id: string) => boolean>(() => false);
  const showEdit = useCallback(
    (message: string) => {
      const toast = toastTo.current;
      if (editToast.current) toast.dismiss(editToast.current.id);
      const id = toast.show({
        message,
        ...(undoPresent
          ? { action: { label: t("tools.undo"), onAction: () => runRef.current("video.undo") } }
          : {}),
      });
      editToast.current = { id, plan: session.getSnapshot().plan };
    },
    [session, t, undoPresent],
  );
  const onResult = (result: VideoToolResult) => {
    if (result.edit) showEdit(result.message);
    else toastTo.current.show({ message: result.message });
  };
  const { flags, run, ariaKeyShortcuts, keysText } = useVideoTools(onResult);
  // The toast's Undo runs the latest, as each commit leaves it.
  useEffect(() => {
    runRef.current = run;
  }, [run]);

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
  const frames = snapshot.plan ? planFrames(snapshot.plan) : 0;
  // The video a start card or the cards belong to: the first one added.
  const sourceId = frames > 0 ? snapshot.sources[0]?.id : undefined;
  // Easy mode's start cards show once per video, until one is chosen,
  // skipped, or a tool runs.
  const [startShownFor, setStartShownFor] = useState<string | null>(null);
  // The card chosen for a video: its tools stay listed in Easy mode, even
  // those of a higher level, and it may show the properties, for that video only.
  const [chosen, setChosen] = useState<{
    readonly source: string;
    readonly card: StartCard;
  } | null>(null);
  const chosenNow = chosen !== null && chosen.source === sourceId ? chosen.card : null;
  const extra = useMemo(
    () => new Set(mode === "easy" && chosenNow ? chosenNow.tools : []),
    [mode, chosenNow],
  );
  const lists = toolLists({
    registry,
    flags,
    mode,
    t,
    keysText,
    ariaKeyShortcuts,
    extra,
  });
  // What takes focus once the next render commits, by selector.
  const pendingFocus = useRef<string | null>(null);

  // A tool that ran closes the start cards; one that couldn't leaves them.
  const runTool = (id: string): boolean => {
    const ran = run(id);
    if (ran && sourceId !== undefined) setStartShownFor(sourceId);
    return ran;
  };

  // The tools panel's file picker, for the insert tool.
  useEffect(() => registerFileChooser(() => picker.current?.click()), [registerFileChooser]);

  // Opening and adding videos show a toast, which screen readers hear too;
  // an added video's offers Undo. The session tells of them before its
  // snapshot has the new plan, so they wait for it.
  useEffect(
    () =>
      subscribeEvents((event) => {
        if (event.outcome !== "done") return;
        if (event.type === "insert") {
          queueMicrotask(() => showEdit(t("editor.added", { count: 1 })));
        } else if (event.type === "open") {
          queueMicrotask(() => toastTo.current.show({ message: t("editor.opened") }));
        }
      }),
    [subscribeEvents, showEdit, t],
  );

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
  //
  // A card that leads to a row needs its tool in the host's toolbar, where
  // the row is; one that runs its tool, opening the picker, needs it present.
  const present = (id: string) => lists.palette.some((item) => item.id === id);
  const placed = (id: string) =>
    registry.toolbar.some((group) => group.some((tool) => tool.id === id));
  const reachable = (card: StartCard) => (card.run ? present : placed);
  const cards = START_CARDS.filter((card) => card.tools.some(reachable(card)));
  const startShown =
    cards.length > 0 && mode === "easy" && sourceId !== undefined && startShownFor !== sourceId;

  // The cards cover the stage, so the first takes focus as they appear,
  // while focus is the editor's. A clip added while they show, as when
  // several files are chosen at once, takes focus in the timeline; it comes
  // back to the cards, which still cover the stage. Either way it waits for
  // the timeline's own move, an animation frame after the clip renders.
  const clipCount = snapshot.plan?.clips.length ?? 0;
  useEffect(() => {
    if (!startShown || clipCount === 0) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      const ours = active === null || active === document.body || root.current?.contains(active);
      if (!ours || active?.closest(".hm-video-start")) return;
      root.current?.querySelector<HTMLElement>(".hm-video-start-card")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [startShown, clipCount]);

  // A start card's tool, or the document, takes focus once it's rendered:
  // the match that's shown, such as the row in a group's sheet rather than
  // the one in the tools panel a phone hides, or else the document.
  useEffect(() => {
    const selector = pendingFocus.current;
    if (selector === null) return;
    pendingFocus.current = null;
    const shown = (query: string) =>
      [...(root.current?.querySelectorAll<HTMLElement>(query) ?? [])].find((element) =>
        element.checkVisibility(),
      );
    (shown(selector) ?? shown(DOCUMENT))?.focus();
  });

  /**
   * Leads into the editor with a card's tools: listed, and the first that
   * can run focused. Its row is always there to focus: in the tools panel,
   * shown again as it was last if it was hidden, or, on a phone, where the
   * tab bar replaces the panel, in its group's sheet. Joining runs its tool,
   * which asks for files; on a phone, focus then goes to its group's tab,
   * rather than a sheet over the picker.
   */
  const chooseCard = (card: StartCard) => {
    if (sourceId === undefined) return;
    const usable = card.tools.filter(reachable(card));
    const target =
      usable.find((id) => lists.palette.some((item) => item.id === id && !item.disabled)) ??
      usable[0];
    if (target === undefined) return;
    // The picker opens within the click, as browsers require. A tool that
    // can't run leaves the cards open, with focus on the card.
    if (card.run && !run(target)) return;
    setStartShownFor(sourceId);
    setChosen({ source: sourceId, card });
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
      prefs.change({ ...preferences, tools: lastTools.current });
    }
    pendingFocus.current = `[data-hm-tool-id="${target}"]`;
  };

  const skipCards = () => {
    if (sourceId !== undefined) setStartShownFor(sourceId);
    pendingFocus.current = DOCUMENT;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // The registry skips handled keys, fields, and a control's own keys.
    // The root is this section, not React's container: a host's modal
    // dialog around the editor then doesn't silence it (sdk-core 0.4.2).
    const id = shortcuts.match(event.nativeEvent, { root: event.currentTarget });
    if (id === PALETTE) {
      event.preventDefault();
      setPaletteOpen(true);
      return;
    }
    if (id && runTool(id)) event.preventDefault();
  };

  // The bars' tools, where the host's toolbar keeps them; `toolbar={[]}`
  // shows no tool, keeping the shortcuts and the palette.
  const shown = new Set(registry.toolbar.flat().map((tool) => tool.id));
  const barTool = (id: string) => (shown.has(id) ? registry.get(id) : undefined);
  const enabled = (tool: VideoTool) => flags.get(tool.id)?.enabled ?? true;
  const barButton = (tool: VideoTool | undefined) => {
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
  const exportTool = barTool("video.export");
  const ExportIcon = exportTool ? ICONS[exportTool.icon] : undefined;
  const zoom = ["video.zoom-out", "video.zoom-in", "video.zoom-fit"]
    .map(barTool)
    .filter((tool) => tool !== undefined);
  const tabGroup = lists.groups.find((group) => group.id === tab);
  const hasTools = lists.groups.length > 0;
  // Easy mode shows the properties only when a card asked, for that video.
  const propertiesWanted =
    snapshot.plan !== null && (mode !== "easy" || chosenNow?.properties === true);

  return (
    // A named section is a region landmark, so the editor is easy to find on
    // a host's page, and the frame's top bar isn't the page's banner.
    <section
      ref={root}
      // hm-text gives the editor's own text ui's type and colour, whatever
      // the host page sets around it (ui ADR 0010).
      className={["hm-text", "hm-video-editor", className].filter(Boolean).join(" ")}
      aria-label={messages.t("editor.label")}
      // ui's colour mode, density and motion for the editor alone (sdk-core ADR 0067).
      {...prefs.rootAttributes}
      onKeyDown={onKeyDown}
    >
      {/* Outside the frame's toolbars, so it's no toolbar item; the insert tool opens it. */}
      <input
        ref={picker}
        className="hm-video-toolbar-picker"
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = "";
          if (files.length > 0) insertFiles(files);
        }}
      />
      <EditorFrame
        className="hm-video-editor-frame"
        toolsState={preferences.tools}
        onToolsStateChange={(tools) => prefs.change({ ...preferences, tools })}
        propertiesState={
          mode === "easy" && chosenNow?.properties ? "shown" : preferences.properties
        }
        onPropertiesStateChange={(properties) => {
          // Hiding them leaves the card's choice behind, for this video.
          if (mode === "easy") setChosen(null);
          prefs.change({ ...preferences, properties });
        }}
        toolsLayout={preferences.toolsLayout}
        topBar={
          <>
            <span className="hm-video-editor-title">
              {messages.t("editor.label")}
              {fileName ? <span className="hm-video-editor-file">{fileName}</span> : null}
            </span>
            <ModeSwitch
              className="hm-video-editor-mode"
              size="small"
              value={mode}
              onValueChange={(next) => prefs.change({ ...preferences, mode: next })}
            />
            <Toolbar label={t("toolbar.bar")} className="hm-video-editor-bar">
              {barButton(barTool("video.undo"))}
              {barButton(barTool("video.redo"))}
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
              className="hm-video-editor-toolbar"
              groups={lists.groups}
              descriptions={mode === "easy" && preferences.tips}
              shortcuts={mode === "expert"}
              onRun={runTool}
            />
          ) : undefined
        }
        properties={
          propertiesWanted ? <VideoInspector className="hm-video-editor-inspector" /> : undefined
        }
        bottom={
          <div className="hm-video-editor-bottom">
            <div className="hm-video-editor-controls">
              <Transport mode={mode} />
              {zoom.length > 0 ? (
                <Toolbar label={t("toolbar.view")} className="hm-video-editor-zoom">
                  {zoom.map(barButton)}
                </Toolbar>
              ) : null}
            </div>
            <VideoTimeline />
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
        <VideoStage />
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
      <SettingsPanel {...prefs.settings} />
      <VideoExportDialog
        {...(fileName === undefined ? {} : { fileName })}
        {...(onExport ? { onExport } : {})}
      />
      <ElementBridge />
      <ToastProvider>
        <ToastBridge onToast={takeToasts} />
      </ToastProvider>
    </section>
  );
}

/**
 * The video editor, on ui's editor frame (docs/adr/0010, sdk-core ADR
 * 0067): a top bar with the mode switch, Undo, Redo, the theme toggle,
 * Settings and Export; a tools panel of the editing tools, by mode; the
 * preview; the inspector as the properties panel; and the transport, the
 * zoom and the timeline across the foot, over one editing session. The
 * tools' shortcuts work while focus is in it, and the command palette, on
 * `Mod+K`, reaches every tool in every mode. The `tools` and `toolbar`
 * props choose the tools, as plain data. Preferences, such as the mode and
 * theme, are the host's to keep: see `preferences` and
 * `onPreferencesChange`.
 *
 * Give the editor a bounded height, such as a grid row or a fixed height:
 * the preview takes what the bars leave.
 *
 * @example
 * ```tsx
 * import "@hussmartinez/ui/styles.css";
 * import "@hussmartinez/video-sdk/styles.css";
 * import { VideoEditor } from "@hussmartinez/video-sdk/react";
 *
 * <VideoEditor initialFiles={[file]} onEvent={(event) => console.log(event.type)} />
 * ```
 *
 * @public
 */
export const VideoEditor = /* @__PURE__ */ forwardRef<VideoEditorHandle, VideoEditorProps>(
  function VideoEditor(
    {
      initialFiles,
      className,
      fileName,
      onExport,
      preferences,
      defaultPreferences,
      onPreferencesChange,
      ...provider
    },
    ref,
  ): ReactNode {
    return (
      <VideoEditorProvider {...provider}>
        <Shell
          ref={ref}
          {...(initialFiles ? { initialFiles } : {})}
          {...(className ? { className } : {})}
          {...(fileName === undefined ? {} : { fileName })}
          {...(onExport ? { onExport } : {})}
          {...(preferences ? { preferences } : {})}
          {...(defaultPreferences ? { defaultPreferences } : {})}
          {...(onPreferencesChange ? { onPreferencesChange } : {})}
        />
      </VideoEditorProvider>
    );
  },
);
