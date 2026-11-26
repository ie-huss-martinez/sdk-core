import {
  AnnouncerProvider,
  type HeadingLevel,
  HeadingLevelProvider,
  Spinner,
  type ToastApi,
  ToastProvider,
  UiMessagesProvider,
  useToast,
} from "@hussmartinez/ui/react";
import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { asNotesError } from "../core/errors/abort.js";
import type { NotesError } from "../core/errors/notes-error.js";
import type { NotesLibrary } from "../core/session/library.js";
import type { NotesSession } from "../core/session/notebook-session.js";
import { DEFAULT_INK_SETTINGS, type NotesInkSettings } from "../features/tool-types.js";
import { useNotes } from "./context.js";
import { NotesLibraryView } from "./library/NotesLibraryView.js";
import { NotesProvider, type NotesProviderProps } from "./NotesProvider.js";
import { NotesNotebook, type NotesNotebookHandle } from "./notebook/NotesNotebook.js";
import {
  NotesFrameContext,
  type NotesFrameShared,
  type NotesPreferenceProps,
  useNotesPreferences,
} from "./notebook/notebook-frame.js";

/**
 * What the editor shows: the library, or an open notebook.
 *
 * @public
 */
export type NotesEditorView =
  | { readonly view: "library" }
  | { readonly view: "notebook"; readonly notebook: string };

/**
 * The parts of the editor that `classNames` can target.
 *
 * @public
 */
export type NotesEditorPart = "root" | "library" | "notebook";

/**
 * Props for {@link NotesEditor}: the provider's, and the editor's own.
 *
 * The editor has no `file` or `onChange`: its documents are the notebooks of
 * its library, which it keeps itself and saves as you write (docs/adr/0003).
 *
 * @public
 */
export interface NotesEditorProps
  extends Omit<NotesProviderProps, "children">,
    NotesPreferenceProps {
  /**
   * Called when the editor goes from the library to a notebook or back, so
   * a host can change what's around it, such as its own header.
   */
  readonly onViewChange?: (view: NotesEditorView) => void;
  /** The writing settings to start with: the tool in hand, colours and sizes. */
  readonly initialSettings?: Partial<NotesInkSettings>;
  /** Called when the user changes a writing setting, so a host can keep them. */
  readonly onSettingsChange?: (settings: NotesInkSettings) => void;
  /**
   * Which notebook tools are present, by id, in order, such as
   * `["notes.pen", "notes.eraser", "notes.undo"]`. All of `notesTools` by
   * default. Their shortcuts work only while they're present.
   */
  readonly tools?: readonly string[];
  /**
   * The notebook's tool groups, as tool ids. They place the tools: the bar's
   * (back to the library, undo, redo, the sidebar, search, the zoom and
   * Export as PDF) in the top bar and over the pages, and the rest in the
   * tools panel (docs/adr/0008). Defaults to the present tools in their usual
   * groups; `[]` shows no tool, and keeps the shortcuts and the command
   * palette. An unknown id throws.
   */
  readonly toolbar?: readonly (readonly string[])[];
  /**
   * The level of the editor's own heading: the library's title, or the open
   * notebook's. From 2 to 6, and 2 by default (sdk-core ADR 0058).
   */
  readonly headingLevel?: HeadingLevel;
  /** Extra classes on the root. */
  readonly className?: string;
  /** Extra classes on each part. */
  readonly classNames?: Readonly<Partial<Record<NotesEditorPart, string>>>;
  /** Drop the visual styles, keeping layout and accessibility. */
  readonly unstyled?: boolean;
}

/**
 * What a ref to {@link NotesEditor} gives the host.
 *
 * @public
 */
export interface NotesEditorHandle {
  /** The editor's library, for anything beyond the handle's own methods. */
  readonly library: NotesLibrary;
  /**
   * Opens a notebook, saving and closing the one that's open. If that one
   * can't be saved, it stays open and the call rejects.
   */
  open(notebook: string): Promise<void>;
  /**
   * Saves the open notebook and goes back to the library. If it can't be
   * saved, it stays open and the call rejects.
   */
  close(): Promise<void>;
}

const join = (...names: (string | undefined)[]) => names.filter(Boolean).join(" ");

/** Hands ui's toasts to the shell, which renders their provider inside its root. */
function ToastBridge({ onToast }: { readonly onToast: (toast: ToastApi) => void }): null {
  const toast = useToast();
  useEffect(() => onToast(toast), [onToast, toast]);
  return null;
}

type Shell = Omit<NotesEditorProps, keyof NotesProviderProps>;

const NotesEditorShell = /* @__PURE__ */ forwardRef<NotesEditorHandle, Shell>(
  function NotesEditorShell(props, handle): ReactNode {
    const { onViewChange, onSettingsChange, classNames = {}, unstyled = false } = props;
    const { library, messages } = useNotes();
    // ui's toasts live inside the root, below this component.
    const toastTo = useRef<ToastApi | undefined>(undefined);
    const takeToasts = useCallback((toast: ToastApi) => {
      toastTo.current = toast;
    }, []);
    // One set of preferences for both views, so a theme or a mode chosen in
    // one notebook holds in the library and the next notebook (sdk-core ADR 0067).
    const t = messages.t as (key: string) => string;
    const preferences = useNotesPreferences(props, (key) =>
      toastTo.current?.show({ message: t(key) }),
    );
    const shared: NotesFrameShared = { preferences, theme: props.theme, unstyled };
    const [open, setOpen] = useState<
      { session: NotesSession; page: string | undefined } | undefined
    >(undefined);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState<NotesError | undefined>(undefined);
    const [settings, setSettings] = useState<NotesInkSettings>(() => ({
      ...DEFAULT_INK_SETTINGS,
      ...props.initialSettings,
    }));
    const current = useRef<NotesSession | undefined>(undefined);
    /** The view of an open notebook, with the session it shows. */
    const notebookView = useRef<{ session: NotesSession; handle: NotesNotebookHandle } | undefined>(
      undefined,
    );
    const viewChanged = useRef(onViewChange);
    /** Whether the editor is on the page: a notebook that opens after it left is closed again. */
    const mounted = useRef(false);
    /** The last change of notebook asked for: each waits for the one before. */
    const transitions = useRef<Promise<unknown>>(Promise.resolve());

    useEffect(() => {
      viewChanged.current = onViewChange;
    }, [onViewChange]);

    useEffect(() => {
      void library.load().catch(() => {
        // The library view shows why, and offers to try again.
      });
    }, [library]);

    // A notebook left open when the editor goes away is saved and released,
    // even if the save fails: nothing is left on the page to try it again.
    useEffect(() => {
      mounted.current = true;
      return () => {
        mounted.current = false;
        void current.current?.close({ discard: true }).catch(() => undefined);
        current.current = undefined;
      };
    }, []);

    /** Runs one change of notebook after the ones asked for before it, so two never overlap. */
    const inTurn = useCallback(<Result,>(work: () => Promise<Result>): Promise<Result> => {
      const run = transitions.current.then(work);
      transitions.current = run.catch(() => undefined);
      return run;
    }, []);

    const show = useCallback((session: NotesSession | undefined, page?: string) => {
      const before = current.current;
      current.current = session;
      setOpen(session ? { session, page } : undefined);
      // Only a change of view is reported: the library already showed before the first notebook.
      if (session) {
        viewChanged.current?.({ view: "notebook", notebook: session.getSnapshot().notebook.id });
      } else if (before) {
        viewChanged.current?.({ view: "library" });
      }
    }, []);

    /**
     * Closes the open notebook through its view, which first commits what's
     * being typed and stores a recording, then saves and gives the notebook
     * back. The view tells `show` once it's closed.
     */
    const closeCurrent = useCallback(async () => {
      const session = current.current;
      if (!session) return;
      const view = notebookView.current;
      // Only the view of the notebook that's current: just after an open,
      // the view on the screen may still be the one before, or none yet.
      if (view?.session === session) {
        await view.handle.close();
      } else {
        await session.close();
        show(undefined);
      }
    }, [show]);

    const openNotebook = useCallback(
      (notebook: string, page?: string) =>
        inTurn(async () => {
          setError(undefined);
          setOpening(true);
          try {
            // If it can't be saved it stays open, and this call rejects.
            await closeCurrent();
            const session = await library.open(notebook);
            if (!mounted.current) {
              // The editor went away meanwhile: nobody is left to close it.
              await session.close({ discard: true }).catch(() => undefined);
              return;
            }
            show(session, page);
          } catch (reason) {
            setError(asNotesError(reason));
            throw reason;
          } finally {
            setOpening(false);
          }
        }),
      [closeCurrent, inTurn, library, show],
    );

    const closeNotebook = useCallback(() => inTurn(() => closeCurrent()), [closeCurrent, inTurn]);

    useImperativeHandle(
      handle,
      () => ({ library, open: (notebook) => openNotebook(notebook), close: closeNotebook }),
      [library, openNotebook, closeNotebook],
    );

    const changeSettings = (next: NotesInkSettings) => {
      setSettings(next);
      onSettingsChange?.(next);
    };

    return (
      // biome-ignore lint/a11y/useSemanticElements: a labelled group of the editor's regions, not a fieldset
      <div
        role="group"
        aria-label={messages.t("editor.label")}
        aria-busy={opening}
        // ui's text root (ui ADR 0010), unless the host styles the editor itself.
        className={join(
          unstyled ? undefined : "hm-text",
          "hm-notes-editor",
          props.className,
          classNames.root,
        )}
        data-hm-view={open ? "notebook" : "library"}
        {...(unstyled ? { "data-hm-unstyled": "" } : {})}
        // ui's colour mode, density and motion for the editor alone (sdk-core ADR 0067).
        {...preferences.rootAttributes}
      >
        <ToastProvider className="hm-notes-toast-region">
          <ToastBridge onToast={takeToasts} />
          <NotesFrameContext.Provider value={shared}>
            {open ? (
              <div className={join("hm-notes-editor-view", classNames.notebook)}>
                <NotesNotebook
                  ref={(handle) => {
                    notebookView.current = handle ? { session: open.session, handle } : undefined;
                  }}
                  key={open.session.getSnapshot().notebook.id}
                  session={open.session}
                  settings={settings}
                  onSettingsChange={changeSettings}
                  onClose={() => show(undefined)}
                  initialPage={open.page}
                  tools={props.tools}
                  toolbar={props.toolbar}
                  onOpenNotebook={(notebook) => void openNotebook(notebook).catch(() => undefined)}
                />
              </div>
            ) : (
              <div className={join("hm-notes-editor-view", classNames.library)}>
                {error ? (
                  <p className="hm-notes-alert" role="alert">
                    {messages.error(error)}
                  </p>
                ) : null}
                {opening ? (
                  <div className="hm-notes-library-state" role="status">
                    <Spinner label={messages.t("editor.opening")} />
                    <p>{messages.t("editor.opening")}</p>
                  </div>
                ) : (
                  <NotesLibraryView
                    onOpen={(notebook, page) =>
                      void openNotebook(notebook, page).catch(() => undefined)
                    }
                  />
                )}
              </div>
            )}
          </NotesFrameContext.Provider>
        </ToastProvider>
      </div>
    );
  },
);

/**
 * The whole notes editor: a library of notebooks kept on the device and,
 * once one is open, the pages to write on, on ui's editor frame (sdk-core
 * ADR 0067, docs/adr/0008): the tools in a dock over the foot of the page,
 * or in a sidebar, the tool's options in the properties panel, and the
 * page sidebar beside the pages. It takes the person's preferences as
 * `preferences` and `onPreferencesChange`, and never stores them.
 *
 * It renders nothing that needs the browser until it has mounted, so it can
 * be rendered on a server (sdk-core ADR 0007). Import
 * `@hussmartinez/ui/styles.css`, then `@hussmartinez/notes-sdk/styles.css`,
 * and give the editor a height: it fills its container.
 *
 * @example
 * ```tsx
 * import { NotesEditor } from "@hussmartinez/notes-sdk/react";
 * import "@hussmartinez/ui/styles.css";
 * import "@hussmartinez/notes-sdk/styles.css";
 *
 * <NotesEditor onViewChange={({ view }) => setFullScreen(view === "notebook")} />;
 * ```
 *
 * @public
 */
export const NotesEditor = /* @__PURE__ */ forwardRef<NotesEditorHandle, NotesEditorProps>(
  function NotesEditor(props, handle): ReactNode {
    const {
      store,
      pdfEngine,
      recorder,
      assetsUrl,
      filePolicy,
      onEvent,
      onSaveFile,
      messages,
      locale,
      icons,
      headingLevel = 2,
      ...shell
    } = props;
    return (
      <NotesProvider
        {...(store ? { store } : {})}
        {...(pdfEngine ? { pdfEngine } : {})}
        {...(recorder ? { recorder } : {})}
        {...(assetsUrl === undefined ? {} : { assetsUrl })}
        {...(filePolicy ? { filePolicy } : {})}
        {...(onEvent ? { onEvent } : {})}
        {...(onSaveFile ? { onSaveFile } : {})}
        {...(messages ? { messages } : {})}
        {...(locale === undefined ? {} : { locale })}
        {...(icons ? { icons } : {})}
      >
        <Provided headingLevel={headingLevel}>
          <NotesEditorShell ref={handle} {...shell} />
        </Provided>
      </NotesProvider>
    );
  },
);

/** ui's providers, given the editor's own messages so a host's overrides reach ui's text too. */
function Provided(props: { headingLevel: HeadingLevel; children: ReactNode }): ReactNode {
  const { messages } = useNotes();
  return (
    <UiMessagesProvider messages={messages}>
      <AnnouncerProvider>
        <HeadingLevelProvider level={props.headingLevel}>{props.children}</HeadingLevelProvider>
      </AnnouncerProvider>
    </UiMessagesProvider>
  );
}
