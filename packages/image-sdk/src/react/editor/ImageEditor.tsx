import { createShortcutRegistry, createToolRegistry } from "@hussmartinez/sdk-core";
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
  ToastProvider,
  Toolbar,
  ToolList,
  Tooltip,
  useLatest,
  usePlatform,
  useToast,
} from "@hussmartinez/ui/react";
import {
  type ForwardedRef,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useInsertionEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { engineInternals } from "../../adapters/image-engine.js";
import type { ImageSessionEvent } from "../../core/session/session.js";
import { NO_TOOL, PAUSED } from "../../features/editor-state.js";
import type { ImageTool, ImageToolContext } from "../../features/tool-types.js";
import { DEFAULT_TOOLBAR, imageTools } from "../../features/tools.js";
import { EngineBoundary } from "../EngineBoundary.js";
import { ImageExportDialog } from "../export/ExportDialog.js";
import { useImageDocument, useImageEditorState, useImageInternals } from "../hooks.js";
import { ImageProvider } from "../ImageEditorProvider.js";
import { ImageInspector } from "../panels/Inspector.js";
import { ImageStage } from "../stage/ImageStage.js";
import { AnimationBar } from "../timeline/AnimationBar.js";
import { imageIcons } from "../toolbar/icons.js";
import { useEditorPreferences } from "./preferences.js";
import { START_CARDS, type StartCard, StartCards } from "./StartCards.js";
import { toolLists } from "./tool-lists.js";
import type { ImageEditorHandle, ImageEditorProps } from "./types.js";

/** Preferences the editor's root inherits from the page until they're chosen (sdk-core ADR 0067). */
const INHERITED = ["theme", "density", "motion"] as const;
type Inherited = (typeof INHERITED)[number];

/** The command palette's place in the shortcut registry: a family action, not a tool. */
const PALETTE = "image.command-palette";

const join = (...names: (string | undefined | false)[]) => names.filter(Boolean).join(" ");

interface BodyProps
  extends Pick<
    ImageEditorProps,
    | "initialFile"
    | "plan"
    | "onChange"
    | "tools"
    | "toolbar"
    | "icons"
    | "className"
    | "classNames"
    | "unstyled"
    | "onExport"
    | "features"
    | "theme"
    | "preferences"
    | "defaultPreferences"
    | "onPreferencesChange"
  > {
  readonly handle: ForwardedRef<ImageEditorHandle>;
  /** Listens to the session's events until the returned function is called. */
  readonly listen: (listener: (event: ImageSessionEvent) => void) => () => void;
}

function ImageEditorBody(props: BodyProps): ReactNode {
  const { initialFile, onChange, classNames = {}, unstyled = false, handle, listen } = props;
  const { engine, session, messages, view, editor, opener, inserter } = useImageInternals();
  const snapshot = useImageDocument();
  const toast = useToast();
  // The last edit's toast: a new edit replaces it, so only one Undo is shown,
  // and it undoes the edit it names.
  const editToast = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const layerInput = useRef<HTMLInputElement>(null);
  // The host's latest onChange, taken as each render commits, never during it.
  const latestOnChange = useLatest(onChange);

  // Export off takes its tool out of the registry, so no button or key runs it.
  const exportOn = props.features?.export !== false;
  const registry = useMemo(() => {
    const wanted = (id: string) =>
      (!props.tools || props.tools.includes(id)) && (exportOn || id !== "image.export");
    const tools = props.tools ?? imageTools.map((tool) => tool.id);
    return createToolRegistry(imageTools, {
      tools: tools.filter(wanted),
      toolbar: (props.toolbar ?? DEFAULT_TOOLBAR)
        .map((group) => group.filter(wanted))
        .filter((group) => group.length > 0),
    });
  }, [props.tools, props.toolbar, exportOn]);
  // "other" on the server and during hydration, then the device's own keys.
  const platform = usePlatform();
  const shortcuts = useMemo(
    () =>
      createShortcutRegistry({
        platform,
        tools: [...registry.tools, { id: PALETTE, shortcuts: "command-palette" as const }],
      }),
    [platform, registry],
  );
  const context: ImageToolContext = useMemo(
    () => ({
      session,
      view,
      editor,
      chooseFile: () => input.current?.click(),
      chooseLayerImage: () => layerInput.current?.click(),
    }),
    [session, view, editor],
  );
  const icons = useMemo(() => ({ ...imageIcons, ...props.icons }), [props.icons]);

  useImperativeHandle(
    handle,
    () => ({
      session,
      open: async (file) => {
        engineInternals(engine)?.check();
        await opener.open(file);
      },
      insertImage: async (file) => {
        engineInternals(engine)?.check();
        await inserter.insert(file);
      },
      execute: (commands) => session.execute(commands),
      export: (format) => session.export(format),
      undo: () => {
        session.undo();
      },
      redo: () => {
        session.redo();
      },
    }),
    [engine, session, opener, inserter],
  );

  // The host's first image opens on mount; a later one replaces it.
  const initial = useRef(initialFile);
  useEffect(() => {
    if (initial.current) void opener.open(initial.current);
  }, [opener]);

  // Committed changes reach the host, never a gesture's transient plans.
  useEffect(() => {
    let before = session.getSnapshot().plan;
    return session.subscribe(() => {
      const after = session.getSnapshot().plan;
      if (after === before) return;
      before = after;
      if (after) latestOnChange.current?.(after);
    });
  }, [session, latestOnChange]);

  // Every edit, undo and redo shows a toast, which screen readers hear too;
  // an edit's toast undoes it (sdk-core ADR 0067). An open is said politely.
  const t = messages.t as (key: string, values?: Record<string, unknown>) => string;
  useEffect(
    () =>
      listen((event) => {
        if (event.outcome !== "done") return;
        const action = event.commands[0];
        const name = action ? t(`actions.${action}`) : "";
        if (event.type === "execute" && action) {
          if (editToast.current) toast.dismiss(editToast.current);
          editToast.current = toast.show({
            message: t("editor.applied", { action: name }),
            action: { label: t("tools.undo"), onAction: () => session.undo() },
          });
        }
        if (event.type === "undo" || event.type === "redo") {
          // Undo and redo change what the last edit's Undo would do.
          if (editToast.current) toast.dismiss(editToast.current);
          editToast.current = null;
        }
        if (event.type === "undo") toast.show({ message: t("editor.undid", { action: name }) });
        if (event.type === "redo") toast.show({ message: t("editor.redid", { action: name }) });
        if (event.type === "download")
          toast.show({ message: t("editor.downloaded"), tone: "success" });
        if (event.type === "open") {
          const source = session.getSnapshot().source;
          if (source)
            toast.show({
              message: t("editor.opened", { width: source.width, height: source.height }),
            });
        }
      }),
    [toast, listen, t, session],
  );

  // After an open, focus moves to the first tool it enabled, when focus was
  // in the editor or nowhere; focus elsewhere on the host's page stays.
  const previous = useRef(snapshot.source?.id);
  useEffect(() => {
    const id = snapshot.source?.id;
    if (id === previous.current) return;
    previous.current = id;
    if (!id) return;
    const active = document.activeElement;
    const ours = active === null || active === document.body || root.current?.contains(active);
    if (!ours) return;
    // The first tool that's shown: a row of the tools panel, or on a phone,
    // where the tab bar replaces the panel, the first tab.
    const candidates = root.current?.querySelectorAll<HTMLButtonElement>(
      ".hm-image-editor-toolbar button:not([disabled]):not([aria-disabled='true']), .hm-tab-bar button",
    );
    const next = [...(candidates ?? [])].find((button) => button.checkVisibility());
    next?.focus();
  }, [snapshot.source?.id]);

  // A host's plan is applied when it changes: one undoable step of the
  // commands that reach it. A plan for another image waits for that image.
  const hostPlan = props.plan;
  const openSource = snapshot.plan?.base.source;
  useEffect(() => {
    if (!hostPlan || openSource !== hostPlan.base.source) return;
    try {
      session.applyPlan(hostPlan);
    } catch {
      // In the snapshot: the stage shows it.
    }
  }, [hostPlan, session, openSource]);

  // Cropping and the export dialog end when another image opens, and an
  // animation starts again from its first frame, paused.
  const sourceId = snapshot.source?.id;
  useEffect(() => {
    if (sourceId === undefined) return;
    editor.set((state) =>
      state.tool === null &&
      state.dialog === null &&
      state.error === null &&
      state.playback === PAUSED
        ? state
        : {
            ...state,
            ...NO_TOOL,
            preview: null,
            dialog: null,
            error: null,
            playback: PAUSED,
          },
    );
  }, [editor, sourceId]);

  // Focus returns to where it was when a tool took the stage: its button, or
  // whatever had focus when its shortcut was pressed (docs/adr/0007).
  const [editorState] = useImageEditorState();
  const { tool } = editorState;
  const returnTo = useRef<HTMLElement | null>(null);
  const previousTool = useRef(tool);
  useEffect(
    () =>
      editor.subscribe(() => {
        const next = editor.getSnapshot().tool;
        if (next !== null && previousTool.current !== next) {
          const active = document.activeElement;
          returnTo.current =
            active instanceof HTMLElement && root.current?.contains(active) ? active : null;
        }
      }),
    [editor],
  );
  useEffect(() => {
    if (previousTool.current === tool) return;
    const was = previousTool.current;
    previousTool.current = tool;
    if (tool === "redact") {
      // Redacting starts on the button that adds an area without dragging;
      // cropping starts on its frame, which focuses itself.
      root.current?.querySelector<HTMLElement>(".hm-image-redact-add")?.focus();
      return;
    }
    // The layers' panel takes focus itself, when its tool asks: adding a
    // shape or an image leaves focus where it was.
    if (tool === "layers") return;
    if (was === null || tool !== null) return;
    const target = returnTo.current?.isConnected
      ? returnTo.current
      : root.current?.querySelector<HTMLElement>(`[data-hm-tool-id="image.${was}"]`);
    target?.focus();
  }, [tool]);

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  // Easy mode's start cards show once per image, until one is chosen or skipped.
  const [startShownFor, setStartShownFor] = useState<string | null>(null);
  // A start card can show the properties in Easy mode, which otherwise hides them.
  // It's for the image the card was chosen on: another image starts without it.
  const [easyPropertiesFor, setEasyPropertiesFor] = useState<string | null>(null);
  const easyProperties = easyPropertiesFor !== null && easyPropertiesFor === snapshot.source?.id;
  const setEasyProperties = (on: boolean) =>
    setEasyPropertiesFor(on ? (snapshot.source?.id ?? null) : null);
  const { mode } = preferences;
  const toolState = { snapshot, editor: editorState };
  const lists = toolLists(registry, shortcuts, toolState, mode, icons, t);

  const run = (id: string) => {
    const tool = registry.get(id);
    if (!tool) return;
    setStartShownFor(snapshot.source?.id ?? null);
    if (!(tool.isEnabled?.(toolState) ?? true)) return;
    void tool.run(context);
  };

  /** Applies a change of preferences, and says what changed that isn't on screen. */
  const changePreferences = (next: EditorPreferences) => {
    if (next.mode !== preferences.mode) toast.show({ message: t(`editor.mode.${next.mode}`) });
    if (next.theme !== preferences.theme) {
      toast.show({ message: t(`editor.theme.${next.theme}`) });
    }
    const changed = INHERITED.filter((field) => next[field] !== preferences[field]);
    if (changed.some((field) => !picked.has(field))) {
      setPicked(new Set([...picked, ...changed]));
    }
    if (next.mode !== "easy") setEasyProperties(false);
    setPreferences(next);
  };

  const chooseCard = (card: StartCard) => {
    setStartShownFor(snapshot.source?.id ?? null);
    if (card.properties) setEasyProperties(true);
    if (card.tool) run(card.tool);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (engineInternals(engine)?.getSnapshot()) return;
    // The root bounds the search for a modal dialog: keys from one inside the
    // editor, such as export's, stay its own, while a host's dialog holding
    // the whole editor doesn't stop its shortcuts (sdk-core 0.4.2).
    const id = shortcuts.match(event.nativeEvent, { root: event.currentTarget });
    if (id === PALETTE) {
      event.preventDefault();
      setPaletteOpen(true);
      return;
    }
    const tool = id ? registry.get(id) : undefined;
    if (!tool) return;
    const state = { snapshot: session.getSnapshot(), editor: editor.getSnapshot() };
    if (!(tool.isEnabled?.(state) ?? true)) return;
    event.preventDefault();
    void tool.run(context);
  };

  const animated = snapshot.status === "ready" && Boolean(snapshot.plan?.animation);
  // Only the cards whose tool the host kept, and the adjustments' card only
  // with adjustments or filters on.
  const cards = START_CARDS.filter((card) =>
    card.tool
      ? lists.palette.some((item) => item.id === card.tool && !item.disabled)
      : props.features?.adjust !== false || props.features?.filters !== false,
  );
  const startShown =
    cards.length > 0 && mode === "easy" && sourceId !== undefined && startShownFor !== sourceId;
  // Easy mode shows the properties only while a tool needs them, or a card asked.
  const propertiesWanted =
    snapshot.plan !== null && (mode !== "easy" || editorState.tool !== null || easyProperties);
  const bar = (id: string) => registry.get(id);
  const undo = bar("image.undo");
  const redo = bar("image.redo");
  const open = bar("image.open");
  const exportTool = bar("image.export");
  const zoom = ["image.zoom-out", "image.zoom-fit", "image.zoom-in"]
    .map(bar)
    .filter((tool) => tool !== undefined);
  const barButton = (tool: ImageTool | undefined) => {
    if (!tool) return null;
    const Icon = icons[tool.icon];
    const disabled = !(tool.isEnabled?.(toolState) ?? true);
    return (
      <Tooltip key={tool.id} type="label" content={t(tool.label)}>
        <IconButton
          variant="quiet"
          data-tool={tool.id}
          label={t(tool.label)}
          icon={Icon ? <Icon /> : null}
          disabled={disabled}
          aria-keyshortcuts={shortcuts.ariaKeyShortcuts(tool.id) || undefined}
          onClick={() => run(tool.id)}
        />
      </Tooltip>
    );
  };
  const exportButton = (() => {
    if (!exportTool) return null;
    const disabled = !(exportTool.isEnabled?.(toolState) ?? true);
    const reason = disabled ? exportTool.unavailable?.(toolState) : undefined;
    const ExportIcon = icons[exportTool.icon];
    const button = (
      <Button
        variant="primary"
        data-tool={exportTool.id}
        startIcon={ExportIcon ? <ExportIcon /> : null}
        disabled={disabled}
        focusableWhenDisabled={reason !== undefined}
        aria-keyshortcuts={shortcuts.ariaKeyShortcuts(exportTool.id) || undefined}
        onClick={() => run(exportTool.id)}
      >
        {t(exportTool.label)}
      </Button>
    );
    return reason ? <Tooltip content={t(reason)}>{button}</Tooltip> : button;
  })();
  const tabGroup = lists.groups.find((group) => group.id === tab);

  return (
    // The root takes the editor's shortcuts while focus is inside it, never
    // on window (WCAG 2.1.4, sdk-core ADR 0030). A named section is a region
    // landmark, so the editor is easy to find on a host's page.
    <section
      ref={root}
      className={join(
        "hm-image-editor",
        !unstyled && "hm-image-editor--styled",
        props.className,
        classNames.root,
      )}
      onKeyDown={onKeyDown}
      aria-label={messages.t("editor.label")}
      // ui's colour mode, density and motion for the editor alone (sdk-core ADR 0067).
      data-hm-theme={props.theme ?? (isChosen("theme") ? preferences.theme : undefined)}
      data-hm-density={isChosen("density") ? preferences.density : undefined}
      data-hm-motion={isChosen("motion") ? preferences.motion : undefined}
    >
      <EngineBoundary>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void opener.open(file);
          }}
        />
        <input
          ref={layerInput}
          type="file"
          accept="image/*"
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void inserter.insert(file);
          }}
        />
        <EditorFrame
          className="hm-image-editor-frame"
          unstyled={unstyled}
          toolsState={preferences.tools}
          onToolsStateChange={(tools) => changePreferences({ ...preferences, tools })}
          // A start card can show the properties for now, in Easy mode, without
          // changing the person's preference for them.
          propertiesState={mode === "easy" && easyProperties ? "shown" : preferences.properties}
          onPropertiesStateChange={(properties) => {
            setEasyProperties(false);
            changePreferences({ ...preferences, properties });
          }}
          toolsLayout={preferences.toolsLayout}
          topBar={
            <>
              <span className="hm-image-editor-title">
                {messages.t("editor.label")}
                {snapshot.source ? (
                  <span className="hm-image-editor-size">
                    {t("editor.size", {
                      width: snapshot.source.width,
                      height: snapshot.source.height,
                    })}
                  </span>
                ) : null}
              </span>
              <ModeSwitch
                className="hm-image-editor-mode"
                size="small"
                value={mode}
                onValueChange={(next) => changePreferences({ ...preferences, mode: next })}
              />
              <Toolbar label={t("toolbar.groups.history")} className="hm-image-editor-bar">
                {barButton(open)}
                {barButton(undo)}
                {barButton(redo)}
                {mode === "expert" ? (
                  <Tooltip type="label" content={t("editor.commands")}>
                    <IconButton
                      variant="quiet"
                      label={t("editor.commands")}
                      icon={<CommandIcon />}
                      aria-keyshortcuts={shortcuts.ariaKeyShortcuts(PALETTE) || undefined}
                      onClick={() => setPaletteOpen(true)}
                    />
                  </Tooltip>
                ) : null}
                {props.theme ? null : (
                  <ThemeToggle
                    // Until a theme is chosen, the toggle shows the page's.
                    value={isChosen("theme") ? preferences.theme : "inherit"}
                    onValueChange={(theme) => changePreferences({ ...preferences, theme })}
                  />
                )}
                <Tooltip type="label" content={t("editor.settings")}>
                  <IconButton
                    variant="quiet"
                    label={t("editor.settings")}
                    icon={<SettingsIcon />}
                    aria-haspopup="dialog"
                    onClick={() => setSettingsOpen(true)}
                  />
                </Tooltip>
              </Toolbar>
              {exportButton}
            </>
          }
          tools={
            <ToolList
              label={messages.t("toolbar.label")}
              className={join("hm-image-editor-toolbar", classNames.toolbar)}
              groups={lists.groups}
              descriptions={mode === "easy" && preferences.tips}
              shortcuts={mode === "expert"}
              onRun={run}
            />
          }
          properties={
            propertiesWanted ? (
              <div className={join("hm-image-editor-inspector", classNames.inspector)}>
                <ImageInspector {...(props.features ? { features: props.features } : {})} />
              </div>
            ) : undefined
          }
          bottom={animated ? <AnimationBar className="hm-image-editor-timeline" /> : undefined}
          tabBar={
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
          }
        >
          <ImageStage className={join("hm-image-editor-stage", classNames.stage)} />
          {zoom.length > 0 && snapshot.plan ? (
            <Toolbar label={t("toolbar.groups.zoom")} className="hm-image-editor-zoom">
              {zoom.map(barButton)}
            </Toolbar>
          ) : null}
          {startShown ? (
            <StartCards
              cards={cards}
              icons={icons}
              onChoose={chooseCard}
              onSkip={() => setStartShownFor(sourceId ?? null)}
            />
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
        <SettingsPanel
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          value={preferences}
          onValueChange={changePreferences}
          settings={
            props.theme
              ? ["mode", "toolsLayout", "tools", "properties", "density", "motion", "tips"]
              : undefined
          }
        />
        {exportOn ? (
          <ImageExportDialog {...(props.onExport ? { onExport: props.onExport } : {})} />
        ) : null}
      </EngineBoundary>
    </section>
  );
}

/**
 * The image editor (docs/adr/0007): a toolbar and a stage over an image
 * session, with the family's shortcuts while focus is inside it. It creates
 * its engine, processor and session unless you pass them, and destroys only
 * what it created. Import `@hussmartinez/ui/styles.css` once, then this
 * package's `styles.css`: ui's stylesheet carries the focus rings and target
 * sizes the editor's accessibility relies on (sdk-core ADR 0036).
 *
 * @example
 * ```tsx
 * <ImageEditor initialFile={file} onChange={(plan) => save(plan)} />
 * ```
 *
 * @public
 */
export const ImageEditor = /* @__PURE__ */ forwardRef(function ImageEditor(
  props: ImageEditorProps,
  ref: ForwardedRef<ImageEditorHandle>,
): ReactNode {
  const {
    initialFile,
    plan,
    onChange,
    tools,
    toolbar,
    icons,
    className,
    classNames,
    unstyled,
    onEvent,
    onExport,
    features,
    theme,
    preferences,
    defaultPreferences,
    onPreferencesChange,
    ...provider
  } = props;
  // The editor listens to the session's events for its announcements, and
  // passes them on to the host's handler.
  const events = useRef<((event: ImageSessionEvent) => void) | undefined>(undefined);
  // Set when the render commits, never during it, as the provider does.
  const latestOnEvent = useRef(onEvent);
  useInsertionEffect(() => {
    latestOnEvent.current = onEvent;
  }, [onEvent]);
  const [onSessionEvent, listen] = useMemo(
    () =>
      [
        (event: ImageSessionEvent) => {
          events.current?.(event);
          latestOnEvent.current?.(event);
        },
        (listener: (event: ImageSessionEvent) => void) => {
          events.current = listener;
          return () => {
            if (events.current === listener) events.current = undefined;
          };
        },
      ] as const,
    [],
  );
  return (
    <ImageProvider {...provider} onEvent={onSessionEvent} boundary={false}>
      <AnnouncerProvider>
        <ToastProvider>
          <ImageEditorBody
            handle={ref}
            listen={listen}
            {...(initialFile ? { initialFile } : {})}
            {...(onChange ? { onChange } : {})}
            {...(plan ? { plan } : {})}
            {...(tools ? { tools } : {})}
            {...(toolbar ? { toolbar } : {})}
            {...(icons ? { icons } : {})}
            {...(className ? { className } : {})}
            {...(classNames ? { classNames } : {})}
            {...(unstyled === undefined ? {} : { unstyled })}
            {...(onExport ? { onExport } : {})}
            {...(features ? { features } : {})}
            {...(theme ? { theme } : {})}
            {...(preferences ? { preferences } : {})}
            {...(defaultPreferences ? { defaultPreferences } : {})}
            {...(onPreferencesChange ? { onPreferencesChange } : {})}
          />
        </ToastProvider>
      </AnnouncerProvider>
    </ImageProvider>
  );
});
