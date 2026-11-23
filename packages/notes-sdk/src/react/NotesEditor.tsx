import {
  AnnouncerProvider,
  type HeadingLevel,
  HeadingLevelProvider,
  Spinner,
  UiMessagesProvider,
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
import { NotesNotebook } from "./notebook/NotesNotebook.js";

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
export interface NotesEditorProps extends Omit<NotesProviderProps, "children"> {
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
   * The notebook toolbar's groups, as tool ids. Defaults to the present
   * tools in their usual groups; `[]` hides the toolbar, keeping the
   * shortcuts. An unknown id throws.
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

type Shell = Omit<NotesEditorProps, keyof NotesProviderProps>;

const NotesEditorShell = /* @__PURE__ */ forwardRef<NotesEditorHandle, Shell>(
  function NotesEditorShell(props, handle): ReactNode {
    const { onViewChange, onSettingsChange, classNames = {}, unstyled = false } = props;
    const { library, messages } = useNotes();
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

    const openNotebook = useCallback(
      (notebook: string, page?: string) =>
        inTurn(async () => {
          setError(undefined);
          setOpening(true);
          try {
            if (current.current) {
              // If its save fails it stays open, and this call rejects.
              await current.current.close();
              show(undefined);
            }
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
      [inTurn, library, show],
    );

    const closeNotebook = useCallback(
      () =>
        inTurn(async () => {
          await current.current?.close();
          show(undefined);
        }),
      [inTurn, show],
    );

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
      >
        {open ? (
          <div className={join("hm-notes-editor-view", classNames.notebook)}>
            <NotesNotebook
              key={open.session.getSnapshot().notebook.id}
              session={open.session}
              settings={settings}
              onSettingsChange={changeSettings}
              onClose={() => show(undefined)}
              initialPage={open.page}
              tools={props.tools}
              toolbar={props.toolbar}
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
      </div>
    );
  },
);

/**
 * The whole notes editor: a library of notebooks kept on the device and,
 * once one is open, the pages to write on, with their toolbar and sidebar.
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
