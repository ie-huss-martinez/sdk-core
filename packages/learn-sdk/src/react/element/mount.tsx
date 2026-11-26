import type { EditorElementContext, MountedEditor } from "@hussmartinez/sdk-core/element";
import type { EditorPreferences, HeadingLevel } from "@hussmartinez/ui";
import type { RefCallback } from "react";
import { createRoot } from "react-dom/client";
import { LearnError } from "../../core/errors/learn-error.js";
import type { LearnIssue } from "../../core/errors/learn-issues.js";
import type { LearnLimitOverrides } from "../../core/errors/learn-limits.js";
import type { ContentDraft } from "../../core/model/commands.js";
import type { Content } from "../../core/model/content.js";
import type { ExerciseTypes } from "../../core/model/exercise-type.js";
import type { LanguageProfile } from "../../core/model/language-profile.js";
import type { EditorBlock } from "../../features/editor/editor-block.js";
import type { LearnEditorMessageOverrides } from "../../features/editor/editor-messages.js";
import { LearnEditor, type LearnEditorHandle } from "../LearnEditor.js";

/**
 * The properties of `<hm-learn-editor>` (ADR 0009). `theme`, `locale`,
 * `headingLevel` and `single` are also attributes (`heading-level`, and
 * `single` as a boolean attribute); the others are set from script.
 *
 * Setting `initialContent`, `single`, `types`, `limits` or `newId` to
 * another value loads the editor afresh, with that content and no history, as a new React `key`
 * does. `preferences` and `defaultPreferences` are the frame's (sdk-core
 * ADR 0067): set `preferences` again from the `hm-learn-editor-preferences`
 * event to keep them, or leave it unset and the element keeps its own.
 *
 * @public
 */
export interface LearnEditorElementProps {
  /** The colour mode the host forces: `"light"`, `"dark"` or `"system"`. */
  theme?: string;
  /** The language of the editor's own text, such as `"en"`. */
  locale?: string;
  /** The level of the exercise's heading, `2` to `6` (sdk-core ADR 0058). */
  headingLevel?: HeadingLevel;
  /** Edit a document of exactly one exercise: no outline, and no adding, removing or moving. */
  single?: boolean;
  /** `hm-learn-content` to edit, as parsed JSON. */
  initialContent?: unknown;
  /** The exercise types content may use. Defaults to the built-in ones. */
  types?: ExerciseTypes;
  /** An editor block per host type, by type name, beside the built-in ones. */
  blocks?: Readonly<Record<string, EditorBlock>>;
  /** The language being taught: `lang` and `dir` for its fields. */
  profile?: LanguageProfile;
  /** Lower limits than the defaults, for content and its parts (ADR 0002). */
  limits?: LearnLimitOverrides;
  /** New exercises' ids. Defaults to random UUIDs. */
  newId?: () => string;
  /** Overrides of the editor's text (sdk-core ADR 0059). */
  messages?: LearnEditorMessageOverrides;
  /** The person's preferences, for a host that keeps them. */
  preferences?: EditorPreferences;
  /** Preferences to start with, when `preferences` isn't set. */
  defaultPreferences?: Partial<EditorPreferences>;
}

/**
 * The methods of `<hm-learn-editor>`. `flush()`, `undo()` and `redo()` act
 * on the editor there is, and do nothing before its first render, when there's
 * no typing or history yet.
 *
 * @public
 */
export interface LearnEditorElementMethods {
  /**
   * Commits typing, then resolves with the content, once the editor has
   * rendered. Rejects with `INVALID_DOCUMENT` or a limit's code while the
   * draft isn't valid content, with the error that kept the content from
   * opening, and with `ABORTED` if the element is removed before its first
   * render.
   */
  getContent(): Promise<Content>;
  /** Commits typing that's waiting for a pause. */
  flush(): void;
  /** Commits typing, then undoes the last edit. */
  undo(): void;
  /** Commits typing, then redoes the last undone edit. */
  redo(): void;
}

/**
 * The events of `<hm-learn-editor>`, each dispatched as
 * `hm-learn-editor-<name>` with its value as `detail`: `change`, with
 * `{ draft, issues, valid }` after every edit, undo and redo; `event`, the
 * anonymous usage events; `error`, with `{ code, details }` for an error the
 * editor can't show itself, such as a refused command; and `preferences`,
 * with the whole preferences when the person changes one.
 *
 * @public
 */
export type LearnEditorElementEvent = "change" | "event" | "error" | "preferences";

/**
 * The `detail` of `hm-learn-editor-change`: the draft, its problems, and
 * whether it's valid content now.
 *
 * @public
 */
export interface LearnEditorChangeDetail {
  /** The content as edited, which may not be valid yet. */
  readonly draft: ContentDraft;
  /** The draft's problems, each with its path. */
  readonly issues: readonly LearnIssue[];
  /** Whether `getContent()` would resolve now. */
  readonly valid: boolean;
}

const MODES = new Set(["light", "dark", "system"]);

const removed = (): LearnError =>
  new LearnError("ABORTED", "The element was removed before its editor was ready.", {
    details: { reason: "removed" },
  });

/**
 * Renders `<LearnEditor>` into the element's light DOM (sdk-core ADR 0040,
 * ADR 0009). It renders without `flushSync`, since the element may connect
 * during a host's React commit; so `getContent()` waits for the first render.
 */
export function mountLearnEditor(
  host: HTMLElement,
  initial: Partial<LearnEditorElementProps>,
  context: EditorElementContext<LearnEditorElementEvent>,
): MountedEditor<Partial<LearnEditorElementProps>, LearnEditorElementMethods> {
  const root = createRoot(host);
  const handle: { current: LearnEditorHandle | null } = { current: null };
  // Calls waiting for an editor: before the first render, and while a new
  // one replaces the old under a new key.
  const waiting = new Set<{
    readonly resolve: (editor: LearnEditorHandle) => void;
    readonly reject: (reason: LearnError) => void;
  }>();
  let gone = false;
  const setHandle: RefCallback<LearnEditorHandle> = (editor) => {
    handle.current = editor;
    if (!editor) return;
    for (const waiter of waiting) waiter.resolve(editor);
    waiting.clear();
  };
  const editorNow = (): Promise<LearnEditorHandle> => {
    if (handle.current) return Promise.resolve(handle.current);
    if (gone) return Promise.reject(removed());
    return new Promise((resolve, reject) => {
      waiting.add({ resolve, reject });
    });
  };
  const { dispatch } = context;

  // The editor reads its content, `single`, `types`, `limits` and `newId`
  // once, when its session opens: another value of any of them opens a new
  // editor, under a new key.
  let opened: Partial<LearnEditorElementProps> = initial;
  let key = 0;

  const render = (values: Partial<LearnEditorElementProps>) => {
    if (
      values.initialContent !== opened.initialContent ||
      values.single !== opened.single ||
      values.types !== opened.types ||
      values.limits !== opened.limits ||
      values.newId !== opened.newId
    ) {
      opened = values;
      key += 1;
      // The old editor's handle is stale from now: calls wait for the new one.
      handle.current = null;
    }
    // The colour mode is ui's attribute on the element itself, so the host's
    // CSS and the editor agree on it.
    const { theme, ...props } = values;
    const mode = theme && MODES.has(theme) ? (theme as EditorPreferences["theme"]) : undefined;
    if (mode) host.setAttribute("data-hm-theme", mode);
    else host.removeAttribute("data-hm-theme");
    root.render(
      <LearnEditor
        key={key}
        ref={setHandle}
        {...props}
        // A theme the host set hides the editor's own theme toggle.
        {...(mode ? { theme: mode } : {})}
        onChange={(draft, { issues, valid }) =>
          dispatch("change", { draft, issues, valid } satisfies LearnEditorChangeDetail)
        }
        onEvent={(event) => dispatch("event", event)}
        onError={(error) => dispatch("error", { code: error.code, details: error.details ?? {} })}
        onPreferencesChange={(preferences) => dispatch("preferences", preferences)}
      />,
    );
  };
  render(initial);

  return {
    update: render,
    unmount: () => {
      root.unmount();
      host.removeAttribute("data-hm-theme");
      gone = true;
      for (const waiter of waiting) waiter.reject(removed());
      waiting.clear();
    },
    handle: {
      getContent: async () => {
        // The element applies property changes a microtask after they're set:
        // waiting one first means content set just before the call is what
        // it reads, not the editor that content replaces.
        await Promise.resolve();
        return (await editorNow()).getContent();
      },
      flush: () => handle.current?.flush(),
      undo: () => handle.current?.undo(),
      redo: () => handle.current?.redo(),
    },
  };
}
