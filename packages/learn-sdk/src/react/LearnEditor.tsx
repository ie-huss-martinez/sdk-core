import {
  createMessages,
  createShortcutRegistry,
  createToolRegistry,
  isToolInMode,
} from "@hussmartinez/sdk-core";
import type { EditorPreferences } from "@hussmartinez/ui";
import { toHeadingLevel } from "@hussmartinez/ui";
import {
  AddIcon,
  AnnouncerProvider,
  Button,
  CommandIcon,
  CommandPalette,
  type CommandPaletteItem,
  DeleteIcon,
  EditorFrame,
  Heading,
  type HeadingLevel,
  HeadingLevelProvider,
  IconButton,
  ModeSwitch,
  MoveDownIcon,
  MoveUpIcon,
  RedoIcon,
  ReorderableList,
  ReorderableListItem,
  SettingsIcon,
  SettingsPanel,
  Sheet,
  TabBar,
  ThemeToggle,
  ToastProvider,
  Toolbar,
  ToolList,
  type ToolListGroup,
  UiMessagesProvider,
  UndoIcon,
  useAnnounce,
  useEditorPreferences,
  useLatest,
  usePlatform,
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
  useSyncExternalStore,
} from "react";
import { isLearnError, LearnError } from "../core/errors/learn-error.js";
import type { LearnIssue } from "../core/errors/learn-issues.js";
import type { LearnLimitOverrides } from "../core/errors/learn-limits.js";
import type { ContentDraft } from "../core/model/commands.js";
import type { Content, Exercise } from "../core/model/content.js";
import { createExerciseTypes, type ExerciseTypes } from "../core/model/exercise-type.js";
import { defaultLanguageProfile, type LanguageProfile } from "../core/model/language-profile.js";
import { parseContent } from "../core/operations/parse-content.js";
import {
  createLearnEditor,
  type LearnEditorEvent,
  type LearnEditor as LearnEditorSession,
  type LearnEditorSnapshot,
} from "../core/session/editor.js";
import {
  createPendingText,
  DraftContext,
  type PendingText,
  PendingTextContext,
} from "../features/editor/committed-text.js";
import { EditorField } from "../features/editor/EditorField.js";
import type { EditorBlock } from "../features/editor/editor-block.js";
import {
  type LearnEditorMessageOverrides,
  type LearnEditorMessages,
  learnEditorMessages,
} from "../features/editor/editor-messages.js";
import {
  addExerciseTool,
  type LearnEditorTool,
  learnEditorTools,
} from "../features/editor/editor-tools.js";
import { IssueList } from "../features/editor/IssueList.js";
import { issueAt, issuesOfExercise, issuesUnder, unclaimed } from "../features/editor/issues.js";
import { gapFillEditor } from "../features/gap-fill/GapFillEditor.js";
import { gapFill } from "../features/gap-fill/gap-fill.js";
import { multipleChoiceEditor } from "../features/multiple-choice/MultipleChoiceEditor.js";
import { multipleChoice } from "../features/multiple-choice/multiple-choice.js";
import { classes } from "../features/player/roving.js";
import { wordOrderEditor } from "../features/word-order/WordOrderEditor.js";
import { wordOrder } from "../features/word-order/word-order.js";

const builtInTypes = /* @__PURE__ */ createExerciseTypes([multipleChoice, gapFill, wordOrder]);
const builtInBlocks: Readonly<Record<string, EditorBlock>> = {
  "multiple-choice": multipleChoiceEditor,
  "gap-fill": gapFillEditor,
  "word-order": wordOrderEditor,
};
const PALETTE = "command-palette";
const ICONS: Readonly<Record<string, ReactNode>> = {
  add: <AddIcon />,
  delete: <DeleteIcon />,
  "move-up": <MoveUpIcon />,
  "move-down": <MoveDownIcon />,
  undo: <UndoIcon />,
  redo: <RedoIcon />,
};

/**
 * The props of {@link LearnEditor} (ADR 0008).
 *
 * @public
 */
export interface LearnEditorProps {
  /** `hm-learn-content` to edit. Read once; give the editor a new `key` to load other content. */
  readonly initialContent?: unknown;
  /**
   * Edit a document of exactly one exercise: no outline, and no adding,
   * removing or moving. Content with more than one exercise is refused. Read
   * once, like `initialContent`: give the editor a new `key` to change it.
   */
  readonly single?: boolean | undefined;
  /** The exercise types content may use. Defaults to the built-in ones. */
  readonly types?: ExerciseTypes | undefined;
  /** An editor block per host type, by type name, beside the built-in ones. */
  readonly blocks?: Readonly<Record<string, EditorBlock>> | undefined;
  /** The language being taught: `lang` and `dir` for its fields. */
  readonly profile?: LanguageProfile | undefined;
  readonly limits?: LearnLimitOverrides | undefined;
  /** New exercises' ids. Defaults to random UUIDs. */
  readonly newId?: (() => string) | undefined;
  /** The draft after every edit, undo and redo, and whether it's valid content now. */
  readonly onChange?:
    | ((
        draft: ContentDraft,
        problems: { readonly issues: readonly LearnIssue[]; readonly valid: boolean },
      ) => void)
    | undefined;
  readonly onEvent?: ((event: LearnEditorEvent) => void) | undefined;
  /** Errors the editor can't show itself, such as a refused command. */
  readonly onError?: ((error: LearnError) => void) | undefined;
  /** The frame's preferences, controlled (sdk-core ADR 0067). */
  readonly preferences?: EditorPreferences | undefined;
  readonly defaultPreferences?: Partial<EditorPreferences> | undefined;
  readonly onPreferencesChange?: ((preferences: EditorPreferences) => void) | undefined;
  /** A theme the host forces. The editor then offers no theme toggle. */
  readonly theme?: EditorPreferences["theme"] | undefined;
  readonly messages?: LearnEditorMessageOverrides | undefined;
  readonly locale?: string | undefined;
  readonly className?: string | undefined;
  /** The level of the exercise's heading, `2` to `6` (sdk-core ADR 0058). */
  readonly headingLevel?: HeadingLevel | undefined;
}

/**
 * What a ref to {@link LearnEditor} can do.
 *
 * @public
 */
export interface LearnEditorHandle {
  /**
   * The draft as validated `hm-learn-content`, after committing any typing.
   * Save through it: rather than return content that isn't valid, it throws a
   * `LearnError`: `INVALID_DOCUMENT` with every issue, a limit's code such as
   * `TOO_MANY_CHOICES` for a draft over a limit, or the error that kept the
   * editor from opening its content.
   */
  getContent(): Content;
  /** Commits typing that's waiting for a pause. */
  flush(): void;
  undo(): void;
  redo(): void;
}

/**
 * Calls a host's callback. An error it throws is thrown again in a
 * microtask, so it's still reported, but never taken for the session's own,
 * such as a refused command (ADR 0008).
 */
function hostCallback(call: () => void): void {
  try {
    call();
  } catch (error) {
    queueMicrotask(() => {
      throw error;
    });
  }
}

/** Opens the session, refusing more than one exercise in `single`. */
function openEditor(
  props: LearnEditorProps,
  types: ExerciseTypes,
  onChange: (draft: ContentDraft, problems: { readonly issues: readonly LearnIssue[] }) => void,
  onEvent: (event: LearnEditorEvent) => void,
): LearnEditorSession {
  const limits = props.limits ? { limits: props.limits } : {};
  if (props.single && props.initialContent !== undefined) {
    const content = parseContent(props.initialContent, { types, ...limits });
    if (content.exercises.length > 1) {
      throw new LearnError(
        "INVALID_DOCUMENT",
        "A single-exercise editor was given more than one exercise.",
        {
          details: {
            reason: "malformed-document",
            count: 1,
            issues: [{ path: ["exercises"], code: "out-of-range" }],
          },
        },
      );
    }
  }
  return createLearnEditor({
    ...(props.initialContent === undefined ? {} : { initialContent: props.initialContent }),
    types,
    ...limits,
    ...(props.newId ? { newId: props.newId } : {}),
    onChange,
    onEvent,
  });
}

const typeLabel = (t: LearnEditorMessages, type: string): string =>
  type === "multiple-choice" || type === "gap-fill" || type === "word-order"
    ? t.t(`types.${type}`)
    : t.t("types.other", { type });

/** Listeners for the session's events, beside the host's. */
type EditorEvents = Set<(event: LearnEditorEvent) => void>;

function Editor({
  props,
  editor,
  types,
  messages,
  pendingText,
  events,
}: {
  readonly props: LearnEditorProps;
  readonly editor: LearnEditorSession;
  readonly types: ExerciseTypes;
  readonly messages: LearnEditorMessages;
  readonly pendingText: PendingText;
  readonly events: EditorEvents;
}): ReactNode {
  const snapshot: LearnEditorSnapshot = useSyncExternalStore(
    editor.subscribe,
    editor.getSnapshot,
    editor.getSnapshot,
  );
  const announce = useAnnounce();
  const toast = useToast();
  const platform = usePlatform();
  const t = messages;
  const profile = props.profile ?? defaultLanguageProfile;
  // LearnEditor passes the first render's `single`, which the session was opened for.
  const single = props.single === true;
  const blocks = useMemo(() => ({ ...builtInBlocks, ...props.blocks }), [props.blocks]);
  // Own properties only: a type named like an Object property, such as
  // `constructor`, has a block only if one was given.
  const blockFor = (type: string): EditorBlock | undefined =>
    Object.hasOwn(blocks, type) ? blocks[type] : undefined;
  const exercises = snapshot.draft.exercises;
  const [selected, setSelected] = useState<string | null>(() => exercises[0]?.id ?? null);
  const current = single
    ? exercises[0]
    : (exercises.find((exercise) => exercise.id === selected) ?? exercises[0]);
  // The selected exercise for the session's events, which arrive outside a render.
  const selectedRef = useLatest(current?.id ?? null);
  // The exercise the last move moved: the outline can move a row it hasn't
  // selected, so a move's position is the moved exercise's, not the selection's.
  const movedRef = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const focusWanted = useRef<"title" | "outline" | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tab, setTab] = useState<string | null>(null);
  const [startSkipped, setStartSkipped] = useState(false);

  const prefs = useEditorPreferences({
    preferences: props.preferences,
    defaultPreferences: props.defaultPreferences,
    onPreferencesChange: props.onPreferencesChange,
    theme: props.theme,
    // The editor's own toasts for what changed, in its messages (sdk-core ADR 0067).
    onChange: ({ previous, preferences: next, chosen }) => {
      if (next.mode !== previous.mode) toast.show({ message: t.t(`editor.mode.${next.mode}`) });
      if (chosen.includes("theme")) toast.show({ message: t.t(`editor.theme.${next.theme}`) });
    },
  });
  const { preferences } = prefs;
  const mode = preferences.mode;

  // The tools: structural ones only with an outline, and an add tool per type with a block.
  const registry = useMemo(() => {
    const adds = [...types.keys()]
      .filter((type) => Object.hasOwn(blocks, type))
      .map((type) => addExerciseTool(type, (blocks[type] as EditorBlock).create));
    // With `single`, adding is only for the empty document's start cards, and
    // nothing removes or moves the one exercise (ADR 0008).
    const tools: LearnEditorTool[] = single
      ? [...adds, ...learnEditorTools.filter((tool) => tool.group === "history")]
      : [...adds, ...learnEditorTools];
    return createToolRegistry(tools);
  }, [types, blocks, single]);
  const shortcuts = useMemo(
    () =>
      createShortcutRegistry({
        platform,
        tools: [...registry.tools, { id: PALETTE, shortcuts: "command-palette" as const }],
      }),
    [platform, registry],
  );

  const toolLabel = (tool: LearnEditorTool): string => {
    if (tool.id.startsWith("learn.add-")) {
      const type = tool.id.slice("learn.add-".length);
      return type === "multiple-choice" || type === "gap-fill" || type === "word-order"
        ? t.t(`tools.add.${type}`)
        : t.t("tools.add.other", { type });
    }
    return t.t(tool.label as "tools.undo");
  };
  const state = { snapshot, selected: current?.id ?? null };
  /** With `single`, an add tool only fills the empty document. */
  const allowed = (tool: LearnEditorTool, exerciseCount: number) =>
    !(single && tool.group === "add" && exerciseCount > 0);
  const enabled = (tool: LearnEditorTool) =>
    allowed(tool, exercises.length) && (tool.isEnabled?.(state) ?? true);

  // Runs a tool after committing typing, then follows what it did (ADR 0008).
  // `target` is the exercise to act on, when it isn't the selected one, such as
  // a row the outline's Delete key was pressed on.
  const run = (id: string, target: string | null = current?.id ?? null) => {
    const tool = registry.get(id);
    if (!tool) return;
    pendingText.flush();
    const before = editor.getSnapshot();
    const live = { snapshot: before, selected: target };
    if (!allowed(tool, before.draft.exercises.length) || !(tool.isEnabled?.(live) ?? true)) return;
    try {
      if (tool.group === "exercises") movedRef.current = target;
      void tool.run({ editor, selected: target });
    } catch (error) {
      if (!isLearnError(error)) throw error;
      announce(t.error(error), { politeness: "assertive" });
      props.onError?.(error);
      return;
    }
    const after = editor.getSnapshot().draft.exercises;
    const ids = new Set(before.draft.exercises.map((exercise) => exercise.id));
    const added = after.find((exercise) => !ids.has(exercise.id));
    if (added) {
      setSelected(added.id);
      focusWanted.current = "title";
    } else if (id === "learn.remove-exercise" && target !== null) {
      const index = before.draft.exercises.findIndex((exercise) => exercise.id === target);
      setSelected(after[Math.min(index, after.length - 1)]?.id ?? null);
      focusWanted.current = "outline";
    }
  };

  // The history's steps, as tokens that mirror the session's undo and redo
  // stacks, so a toast's Undo undoes the step it announced and nothing else.
  const steps = useRef<{ undo: number[]; redo: number[]; next: number }>({
    undo: [],
    redo: [],
    next: 0,
  });
  /** Undoes `step` if it's still the latest edit, with no typing waiting after it. */
  const undoStep = (step: number) => {
    const { undo } = steps.current;
    if (undo[undo.length - 1] !== step || pendingText.hasPending()) return;
    editor.undo();
  };

  // Toasts for structural edits, undo and redo (ADR 0008), straight from the
  // session's events: a toast is shown, not rendered from the snapshot.
  const onEditorEvent = useLatest((event: LearnEditorEvent) => {
    const history = steps.current;
    let step: number | undefined;
    if (event.type === "content_edited") {
      step = history.next++;
      history.undo.push(step);
      history.redo = [];
    } else if (event.type === "edit_undone") {
      const undone = history.undo.pop();
      if (undone !== undefined) history.redo.push(undone);
    } else {
      const redone = history.redo.pop();
      if (redone !== undefined) history.undo.push(redone);
    }
    const now = editor.getSnapshot().draft.exercises;
    const position =
      Math.max(
        0,
        now.findIndex((exercise) => exercise.id === (movedRef.current ?? selectedRef.current)),
      ) + 1;
    const message =
      event.type === "edit_undone"
        ? t.t("editor.undone")
        : event.type === "edit_redone"
          ? t.t("editor.redone")
          : event.command === "learn.addExercise"
            ? t.t("editor.added")
            : event.command === "learn.removeExercise"
              ? t.t("editor.removed")
              : event.command === "learn.moveExercise"
                ? t.t("editor.moved", { position, count: now.length })
                : null;
    if (!message) return;
    toast.show({
      message,
      ...(step !== undefined
        ? { action: { label: t.t("editor.undoAction"), onAction: () => undoStep(step) } }
        : {}),
    });
  });
  useEffect(() => {
    const listener = (event: LearnEditorEvent) => onEditorEvent.current(event);
    events.add(listener);
    return () => {
      events.delete(listener);
    };
  }, [events, onEditorEvent]);

  // The number of problems, announced when an edit changes it, never per keystroke.
  const problemCount = snapshot.issues.length;
  const announcedCount = useRef(problemCount);
  useEffect(() => {
    if (announcedCount.current === problemCount) return;
    announcedCount.current = problemCount;
    announce(
      problemCount === 0
        ? t.t("editor.announceNoProblems")
        : t.t("editor.announceProblems", { count: problemCount }),
    );
  }, [problemCount, announce, t]);

  // Focus after adding (the new exercise's title) or removing (the outline).
  useEffect(() => {
    const wanted = focusWanted.current;
    if (!wanted) return;
    focusWanted.current = null;
    const scope = root.current;
    if (!scope) return;
    if (wanted === "title") {
      scope
        .querySelector<HTMLElement>(".hm-learn-editor-stage input, .hm-learn-editor-stage textarea")
        ?.focus();
    } else {
      // The selected row's tab stop, and only without one the first row.
      (
        scope.querySelector<HTMLElement>(
          ".hm-learn-editor-outline [role=gridcell][tabindex='0']",
        ) ?? scope.querySelector<HTMLElement>(".hm-learn-editor-outline [role=gridcell]")
      )?.focus();
    }
  });

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const id = shortcuts.match(event.nativeEvent, { root: event.currentTarget });
    if (!id) return;
    if (id === PALETTE) {
      event.preventDefault();
      setPaletteOpen(true);
      return;
    }
    const tool = registry.get(id);
    if (!tool || !enabled(tool)) return;
    event.preventDefault();
    run(id);
  };

  // The tool list's groups, and the palette's items: every tool, in every mode.
  const groupLabel = (group: string) => t.t(`tools.groups.${group as "add"}`);
  const groups: ToolListGroup[] = [];
  const palette: CommandPaletteItem[] = [];
  for (const group of ["add", "exercises", "history"]) {
    const inGroup = registry.tools.filter((tool) => tool.group === group);
    const item = (tool: LearnEditorTool) => ({
      id: tool.id,
      label: toolLabel(tool),
      icon: ICONS[tool.icon] ?? null,
      ariaKeyShortcuts: shortcuts.ariaKeyShortcuts(tool.id) || undefined,
      disabled: !enabled(tool),
    });
    const shown = inGroup.filter((tool) => group !== "history" && isToolInMode(tool, mode));
    if (shown.length > 0)
      groups.push({ id: group, label: groupLabel(group), items: shown.map(item) });
    palette.push(
      ...inGroup
        .filter((tool) => allowed(tool, exercises.length))
        .map((tool) => ({ ...item(tool), group: groupLabel(group) })),
    );
  }
  const tabGroup = groups.find((group) => group.id === tab);

  const barButton = (id: string) => {
    const tool = registry.get(id);
    if (!tool) return null;
    return (
      <IconButton
        key={id}
        variant="quiet"
        label={toolLabel(tool)}
        icon={ICONS[tool.icon] ?? null}
        disabled={!enabled(tool)}
        focusableWhenDisabled
        aria-keyshortcuts={shortcuts.ariaKeyShortcuts(id) || undefined}
        onClick={() => run(id)}
      />
    );
  };

  const addTypes = [...types.keys()].filter((type) => blockFor(type) !== undefined);
  const startShown = exercises.length === 0 && (single || (mode === "easy" && !startSkipped));
  const exerciseIndex = current ? exercises.indexOf(current) : -1;
  const exerciseIssues = issuesOfExercise(snapshot.issues, exerciseIndex);

  return (
    <PendingTextContext.Provider value={pendingText}>
      <DraftContext.Provider value={snapshot.draft}>
        {/* The root takes the editor's shortcuts while focus is inside it (sdk-core ADR 0030). */}
        <section
          ref={root}
          className={classes("hm-learn-editor", props.className)}
          aria-label={t.t("editor.label")}
          onKeyDown={onKeyDown}
          {...prefs.rootAttributes}
        >
          <EditorFrame
            toolsState={single ? "hidden" : preferences.tools}
            onToolsStateChange={(tools) => prefs.change({ ...preferences, tools })}
            propertiesState={single ? "hidden" : preferences.properties}
            onPropertiesStateChange={(properties) => prefs.change({ ...preferences, properties })}
            toolsLayout={preferences.toolsLayout}
            propertiesLabel={t.t("editor.outline")}
            topBar={
              <>
                <span className="hm-learn-editor-name">{t.t("editor.label")}</span>
                {single ? null : (
                  <ModeSwitch
                    size="small"
                    value={mode}
                    onValueChange={(next) => prefs.change({ ...preferences, mode: next })}
                  />
                )}
                <Toolbar label={t.t("tools.groups.history")} className="hm-learn-editor-bar">
                  {barButton("learn.undo")}
                  {barButton("learn.redo")}
                  {mode === "expert" ? (
                    <IconButton
                      variant="quiet"
                      label={t.t("editor.commands")}
                      icon={<CommandIcon />}
                      aria-keyshortcuts={shortcuts.ariaKeyShortcuts(PALETTE) || undefined}
                      onClick={() => setPaletteOpen(true)}
                    />
                  ) : null}
                  {props.theme ? null : (
                    <ThemeToggle
                      value={prefs.themeToggleValue}
                      onValueChange={(theme) => prefs.change({ ...preferences, theme })}
                    />
                  )}
                  <IconButton
                    variant="quiet"
                    label={t.t("editor.settings")}
                    icon={<SettingsIcon />}
                    aria-haspopup="dialog"
                    onClick={() => prefs.openSettings(root.current)}
                  />
                </Toolbar>
              </>
            }
            tools={
              single ? undefined : (
                <ToolList
                  label={t.t("editor.tools")}
                  groups={groups}
                  descriptions={mode === "easy" && preferences.tips}
                  shortcuts={mode === "expert"}
                  onRun={run}
                />
              )
            }
            properties={
              single ? undefined : (
                <div className="hm-learn-editor-outline">
                  {exercises.length === 0 ? (
                    <p className="hm-learn-editor-empty">{t.t("editor.empty")}</p>
                  ) : (
                    <ReorderableList
                      label={t.t("editor.outline")}
                      selectedId={current?.id ?? null}
                      onSelectedChange={setSelected}
                      announceMoves={false}
                      onMove={(id, to) => {
                        pendingText.flush();
                        movedRef.current = id;
                        editor.execute({ type: "learn.moveExercise", exerciseId: id, to });
                      }}
                      onRemove={(id) => run("learn.remove-exercise", id)}
                    >
                      {exercises.map((exercise, index) => {
                        const count = issuesOfExercise(snapshot.issues, index).length;
                        const label = t.t("editor.outlineItem", {
                          title: exercise.title ?? t.t("editor.untitled"),
                          type: typeLabel(t, exercise.type),
                        });
                        const problems =
                          count === 0
                            ? t.t("editor.noProblems")
                            : t.t("editor.problems", { count });
                        return (
                          <ReorderableListItem
                            key={exercise.id}
                            id={exercise.id}
                            label={`${label}, ${problems}`}
                          >
                            <span className="hm-learn-editor-outline-entry">
                              <span className="hm-learn-editor-outline-title">
                                {exercise.title ?? t.t("editor.untitled")}
                              </span>
                              {/* The name holds the visible text, in the same words (WCAG 2.5.3);
                              the space keeps the two apart in the text. */}{" "}
                              <span className="hm-learn-editor-outline-meta">
                                {`${typeLabel(t, exercise.type)}, ${problems}`}
                              </span>
                            </span>
                          </ReorderableListItem>
                        );
                      })}
                    </ReorderableList>
                  )}
                </div>
              )
            }
            tabBar={
              single ? undefined : (
                <TabBar
                  label={t.t("editor.tools")}
                  items={groups.map((group) => ({
                    id: group.id,
                    label: group.label,
                    icon: group.items[0]?.icon ?? null,
                  }))}
                  value={tab}
                  onValueChange={(id) => setTab(id === tab ? null : id)}
                />
              )
            }
          >
            <div className="hm-learn-editor-stage">
              {startShown ? (
                <div className="hm-learn-editor-start">
                  <Heading>{t.t("editor.start")}</Heading>
                  <ul className="hm-learn-editor-cards">
                    {addTypes.map((type) => (
                      <li key={type}>
                        <button
                          type="button"
                          className="hm-learn-editor-card"
                          onClick={() => run(`learn.add-${type}`)}
                        >
                          <span className="hm-learn-editor-card-title">
                            {type === "multiple-choice" ||
                            type === "gap-fill" ||
                            type === "word-order"
                              ? t.t(`start.${type}`)
                              : t.t("tools.add.other", { type })}
                          </span>
                          {type === "multiple-choice" ||
                          type === "gap-fill" ||
                          type === "word-order" ? (
                            <span className="hm-learn-editor-card-description">
                              {t.t(`start.${type}.description`)}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {single ? null : (
                    <Button variant="quiet" onClick={() => setStartSkipped(true)}>
                      {t.t("editor.start.skip")}
                    </Button>
                  )}
                </div>
              ) : current ? (
                <ExerciseForm
                  key={current.id}
                  exercise={current}
                  position={exerciseIndex}
                  count={exercises.length}
                  single={single}
                  issues={exerciseIssues}
                  block={blockFor(current.type)}
                  editor={editor}
                  profile={profile}
                  messages={t}
                  announce={announce}
                />
              ) : (
                <p className="hm-learn-editor-empty">{t.t("editor.empty")}</p>
              )}
              {/* A limit the draft passed, such as too many choices, has no field (ADR 0008). */}
              {snapshot.error ? (
                <p role="status" className="hm-learn-editor-limit">
                  {t.error(snapshot.error)}
                </p>
              ) : null}
              {snapshot.trimmed ? (
                <p className="hm-learn-editor-note">{t.t("editor.trimmed")}</p>
              ) : null}
            </div>
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
                onRun={(id) => {
                  setTab(null);
                  run(id);
                }}
              />
            ) : null}
          </Sheet>
          <SettingsPanel {...prefs.settings} />
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            items={palette}
            onRun={(id) => {
              setPaletteOpen(false);
              run(id);
            }}
          />
        </section>
      </DraftContext.Provider>
    </PendingTextContext.Provider>
  );
}

/** The selected exercise: its title, instructions and its type's block. */
function ExerciseForm({
  exercise,
  position,
  count,
  single,
  issues,
  block,
  editor,
  profile,
  messages,
  announce,
}: {
  readonly exercise: Exercise;
  readonly position: number;
  readonly count: number;
  readonly single: boolean;
  readonly issues: readonly LearnIssue[];
  readonly block: EditorBlock | undefined;
  readonly editor: LearnEditorSession;
  readonly profile: LanguageProfile;
  readonly messages: LearnEditorMessages;
  readonly announce: ReturnType<typeof useAnnounce>;
}): ReactNode {
  const t = messages;
  const setText = (field: "title" | "instructions") => (value: string) =>
    editor.execute({
      type: "learn.setExerciseText",
      exerciseId: exercise.id,
      field,
      value: value === "" ? null : value,
    });
  const pendingText = useContext(PendingTextContext);
  const onPayload = useCallback(
    (next: unknown) => {
      // Typing waiting in other fields goes first, so a structural edit, such
      // as a list's move, never leaves it to land on another entry (ADR 0008).
      pendingText?.flush();
      const latest = editor.getSnapshot().draft.exercises.find((each) => each.id === exercise.id);
      if (!latest) return;
      const payload =
        typeof next === "function" ? (next as (current: unknown) => unknown)(latest.payload) : next;
      editor.execute({
        type: "learn.setPayload",
        exerciseId: exercise.id,
        payload: payload as object,
      });
    },
    [editor, exercise.id, pendingText],
  );
  const Edit = block?.edit;
  return (
    <article className="hm-learn-editor-exercise">
      {single ? null : (
        <p className="hm-learn-editor-position">
          {t.t("editor.position", { position: position + 1, count })}
        </p>
      )}
      <Heading className="hm-learn-editor-heading">
        {exercise.title ?? t.t("editor.untitled")}
      </Heading>
      <IssueList
        issues={unclaimed(
          issues.filter((issue) => issue.path[0] !== "payload"),
          [["title"], ["instructions"]],
        )}
        messages={t}
      />
      <EditorField
        label={t.t("editor.title")}
        description={t.t("editor.titleHelp")}
        value={exercise.title ?? ""}
        onCommit={setText("title")}
        issue={issueAt(issues, ["title"])}
        messages={t}
      />
      <EditorField
        label={t.t("editor.instructions")}
        description={t.t("editor.instructionsHelp")}
        value={exercise.instructions ?? ""}
        onCommit={setText("instructions")}
        issue={issueAt(issues, ["instructions"])}
        messages={t}
        multiline
      />
      {Edit ? (
        <Edit
          exercise={exercise}
          onPayload={onPayload}
          issues={issuesUnder(issues, ["payload"])}
          profile={profile}
          messages={t}
          announce={announce}
        />
      ) : (
        <p className="hm-learn-editor-unsupported">{t.t("editor.unsupported")}</p>
      )}
    </article>
  );
}

/**
 * The teacher's editor (ADR 0008): exercises in an outline, the selected one
 * in the stage with its type's editor block, tools to add, remove and move
 * exercises, undo and redo, and every problem at its field. It renders
 * through `ui`'s `EditorFrame`, and keeps nothing: the host saves through
 * `onChange` and the handle's `getContent()`.
 *
 * @example
 * ```tsx
 * import "@hussmartinez/ui/styles.css";
 * import "@hussmartinez/learn-sdk/styles.css";
 * import { isLearnError } from "@hussmartinez/learn-sdk";
 * import { LearnEditor, type LearnEditorHandle } from "@hussmartinez/learn-sdk/react";
 *
 * const editor = useRef<LearnEditorHandle>(null);
 * // It opens valid content only, so Save starts on; onChange reports each edit after.
 * const [canSave, setCanSave] = useState(true);
 * <LearnEditor ref={editor} initialContent={content} profile={thai} onChange={(_, { valid }) => setCanSave(valid)} />
 *
 * async function onSave() {
 *   let content;
 *   try {
 *     content = editor.current?.getContent();
 *   } catch (error) {
 *     if (isLearnError(error)) return; // the editor shows the problem
 *     throw error;
 *   }
 *   await save(content); // your storage: report its failure yourself
 * }
 * ```
 *
 * @public
 */
export const LearnEditor = /* @__PURE__ */ forwardRef<LearnEditorHandle, LearnEditorProps>(
  function LearnEditor(props, ref): ReactNode {
    const types = props.types ?? builtInTypes;
    const messages = useMemo(
      () =>
        createMessages(learnEditorMessages, {
          ...(props.locale ? { locale: props.locale } : {}),
          ...(props.messages ? { overrides: props.messages } : {}),
        }),
      [props.locale, props.messages],
    );
    // The host's latest callbacks, taken as each render commits (sdk-core ADR 0063).
    const latest = useLatest(props);
    const [pendingText] = useState(createPendingText);
    const [events] = useState((): EditorEvents => new Set());
    // The session is made once, from the first render's content (ADR 0008).
    const [opened] = useState((): { editor: LearnEditorSession | null; error: unknown } => {
      try {
        const editor: LearnEditorSession = openEditor(
          props,
          types,
          (draft, { issues }) => {
            const valid = issues.length === 0 && editor.getSnapshot().error === null;
            hostCallback(() => latest.current.onChange?.(draft, { issues, valid }));
          },
          (event) => {
            for (const listener of events) listener(event);
            hostCallback(() => latest.current.onEvent?.(event));
          },
        );
        return { editor, error: null };
      } catch (error) {
        return { editor: null, error };
      }
    });
    const { editor, error } = opened;
    // `single` is read once, like `initialContent`: the session was opened for it.
    const [single] = useState(props.single === true);
    useImperativeHandle(
      ref,
      () => ({
        getContent: () => {
          pendingText.flush();
          if (!editor) throw error;
          return editor.getContent();
        },
        flush: () => pendingText.flush(),
        undo: () => {
          pendingText.flush();
          editor?.undo();
        },
        redo: () => {
          pendingText.flush();
          editor?.redo();
        },
      }),
      [editor, error, pendingText],
    );
    return (
      <UiMessagesProvider messages={messages}>
        <AnnouncerProvider>
          <ToastProvider>
            <HeadingLevelProvider level={toHeadingLevel(props.headingLevel)}>
              {editor ? (
                <Editor
                  props={{ ...props, single }}
                  editor={editor}
                  types={types}
                  messages={messages}
                  pendingText={pendingText}
                  events={events}
                />
              ) : (
                <section
                  className={classes("hm-learn-editor", props.className)}
                  aria-label={messages.t("editor.label")}
                >
                  <p role="alert" className="hm-learn-error">
                    {isLearnError(error) ? messages.error(error) : messages.t("errors.UNKNOWN")}
                  </p>
                </section>
              )}
            </HeadingLevelProvider>
          </ToastProvider>
        </AnnouncerProvider>
      </UiMessagesProvider>
    );
  },
);
