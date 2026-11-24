import { createShortcutRegistry } from "@hussmartinez/sdk-core";
import {
  createContext,
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import {
  CloseIcon,
  MenuIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
  PropertiesIcon,
} from "../../icons/icons.generated.js";
import { uiEditorText } from "../../messages/editor.js";
import { usePlatform } from "../../react/use-platform.js";
import { IconButton } from "../button/IconButton.js";
import { useUiText } from "../messages/UiMessagesProvider.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";

/**
 * The tools panel's state: labels, icons only, or hidden behind an edge tab
 * (sdk-core ADR 0067).
 *
 * @public
 */
export type EditorFrameToolsState = "full" | "icons" | "hidden";

/**
 * The properties panel's state.
 *
 * @public
 */
export type EditorFramePropertiesState = "shown" | "hidden";

/**
 * The parts of an editor frame that `classNames` can target.
 *
 * @public
 */
export type EditorFramePart =
  | "root"
  | "top"
  | "body"
  | "tools"
  | "stage"
  | "properties"
  | "bottom"
  | "tabBar"
  | "edge";

/**
 * Props of {@link EditorFrame}.
 *
 * @public
 */
export interface EditorFrameProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className">,
    StyleProps<EditorFramePart> {
  /** The top bar's content, such as a {@link Toolbar} with the file's name, undo and Export. */
  readonly topBar?: ReactNode;
  /** The tools, usually a {@link ToolList}. Without them there's no tools panel. */
  readonly tools?: ReactNode;
  /** The properties of the selected tool or object. Without them there's no properties panel. */
  readonly properties?: ReactNode;
  /** Full width under the stage, such as a timeline and transport. */
  readonly bottom?: ReactNode;
  /**
   * A {@link TabBar} for narrow frames. When given, it replaces the tools
   * panel below 45 rem.
   */
  readonly tabBar?: ReactNode;
  /** Defaults to `full`. Controlled with `onToolsStateChange`. */
  readonly toolsState?: EditorFrameToolsState | undefined;
  readonly onToolsStateChange?: ((state: EditorFrameToolsState) => void) | undefined;
  /** Defaults to `shown`. Controlled with `onPropertiesStateChange`. */
  readonly propertiesState?: EditorFramePropertiesState | undefined;
  readonly onPropertiesStateChange?: ((state: EditorFramePropertiesState) => void) | undefined;
  /** `sidebar` (the default) at the inline start, or `dock`, floating over the foot of the stage. */
  readonly toolsLayout?: "sidebar" | "dock" | undefined;
  /** The tools panel's accessible name. Defaults to `editorFrame.tools`. */
  readonly toolsLabel?: string | undefined;
  /** The properties panel's accessible name. Defaults to `editorFrame.properties`. */
  readonly propertiesLabel?: string | undefined;
}

/**
 * What {@link useEditorFrame} returns.
 *
 * @public
 */
export interface EditorFrameControls {
  readonly toolsState: EditorFrameToolsState;
  /** Where the tools are: a sidebar, or a dock over the stage. */
  readonly layout: "sidebar" | "dock";
  readonly propertiesState: EditorFramePropertiesState;
  /** The tools panel's `id`, for `aria-controls`. */
  readonly toolsId: string;
  /** Shows the tools as they were last shown, or hides them. */
  readonly toggleTools: () => void;
  readonly setToolsState: (state: EditorFrameToolsState) => void;
  readonly setPropertiesState: (state: EditorFramePropertiesState) => void;
}

const EditorFrameContext = /* @__PURE__ */ createContext<EditorFrameControls | null>(null);

/**
 * The frame's state and actions, for controls inside it, such as a ☰ button
 * in the top bar. `null` outside a frame.
 *
 * @public
 */
export function useEditorFrame(): EditorFrameControls | null {
  return useContext(EditorFrameContext);
}

const TOGGLE_TOOLS = [{ id: "toggle-tools", shortcuts: "toggle-tools" as const }];

/**
 * The layout every SDK editor renders through (sdk-core ADR 0067): a top bar,
 * a tools panel, the stage, a properties panel and a bottom region.
 *
 * - **Panels:** the tools are full, icons only or hidden, and the properties
 *   shown or hidden, both controlled. A hidden panel leaves an edge tab that
 *   brings it back, and `Mod+\` hides or shows the tools while focus is in
 *   the frame.
 * - **Sizes are container queries:** below 60 rem full tools float over the
 *   stage instead of pushing it, and below 45 rem the {@link TabBar} replaces
 *   the tools and the properties sit under the stage.
 * - **Landmarks:** the top bar is a `header`, the tools a `nav` and the
 *   properties a `complementary` region. The stage is the SDK's own.
 *
 * The host gives the frame its height; it fills it.
 *
 * @example
 * ```tsx
 * <EditorFrame
 *   topBar={<Toolbar label={t("bar")}>…</Toolbar>}
 *   tools={<ToolList label={t("tools")} groups={groups} onRun={run} />}
 *   properties={<CropPanel />}
 *   toolsState={preferences.tools}
 *   onToolsStateChange={(tools) => onPreferencesChange({ ...preferences, tools })}
 * >
 *   <Stage />
 * </EditorFrame>
 * ```
 *
 * @public
 */
export const EditorFrame = /* @__PURE__ */ forwardRef(function EditorFrame(
  {
    topBar,
    tools,
    properties,
    bottom,
    tabBar,
    toolsState = "full",
    onToolsStateChange,
    propertiesState = "shown",
    onPropertiesStateChange,
    toolsLayout = "sidebar",
    toolsLabel,
    propertiesLabel,
    className,
    classNames,
    unstyled,
    children,
    onKeyDown,
    ...props
  }: EditorFrameProps,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const text = {
    tools: useUiText("editorFrame.tools", uiEditorText),
    properties: useUiText("editorFrame.properties", uiEditorText),
    showTools: useUiText("editorFrame.showTools", uiEditorText),
    hideTools: useUiText("editorFrame.hideTools", uiEditorText),
    toolsIcons: useUiText("editorFrame.toolsIcons", uiEditorText),
    toolsFull: useUiText("editorFrame.toolsFull", uiEditorText),
    showProperties: useUiText("editorFrame.showProperties", uiEditorText),
    hideProperties: useUiText("editorFrame.hideProperties", uiEditorText),
  };
  const toolsId = useId();
  const propertiesId = useId();
  const platform = usePlatform();
  const shortcuts = useMemo(
    () => createShortcutRegistry({ platform, tools: TOGGLE_TOOLS }),
    [platform],
  );
  // The state to come back to when the tools are shown again.
  const lastShown = useRef<"full" | "icons">("full");
  useEffect(() => {
    if (toolsState !== "hidden") {
      lastShown.current = toolsState;
    }
  }, [toolsState]);

  const setToolsState = (state: EditorFrameToolsState): void => onToolsStateChange?.(state);
  const setPropertiesState = (state: EditorFramePropertiesState): void =>
    onPropertiesStateChange?.(state);
  const toggleTools = (): void =>
    setToolsState(toolsState === "hidden" ? lastShown.current : "hidden");

  const controls: EditorFrameControls = {
    toolsState,
    layout: toolsLayout,
    propertiesState,
    toolsId,
    toggleTools,
    setToolsState,
    setPropertiesState,
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (
      tools != null &&
      shortcuts.match(event.nativeEvent, { root: event.currentTarget }) === "toggle-tools"
    ) {
      event.preventDefault();
      toggleTools();
    }
  };

  const hasTools = tools != null;
  const hasProperties = properties != null;

  return (
    <EditorFrameContext.Provider value={controls}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keys bubble up from the controls inside, and the frame takes only Mod+\ (ADR 0030). */}
      <div
        {...props}
        ref={ref}
        className={cx("hm-editor-frame", classNames?.root, className)}
        data-hm-unstyled={unstyledAttribute(unstyled)}
        data-hm-tools={hasTools ? toolsState : undefined}
        data-hm-properties={hasProperties ? propertiesState : undefined}
        data-hm-layout={toolsLayout}
        data-hm-tab-bar={tabBar == null ? undefined : ""}
        onKeyDown={handleKeyDown}
      >
        {topBar == null ? null : (
          <header className={cx("hm-editor-frame-top", classNames?.top)}>{topBar}</header>
        )}
        <div className={cx("hm-editor-frame-body", classNames?.body)}>
          {hasTools ? (
            <nav
              id={toolsId}
              aria-label={toolsLabel ?? text.tools}
              className={cx("hm-editor-frame-tools", classNames?.tools)}
              hidden={toolsState === "hidden"}
            >
              <div className="hm-editor-frame-tools-list">{tools}</div>
              <div className="hm-editor-frame-tools-foot">
                <IconButton
                  variant="quiet"
                  size="small"
                  label={toolsState === "full" ? text.toolsIcons : text.toolsFull}
                  icon={toolsState === "full" ? <PanelCollapseIcon /> : <PanelExpandIcon />}
                  unstyled={unstyled}
                  onClick={() => setToolsState(toolsState === "full" ? "icons" : "full")}
                />
                <IconButton
                  variant="quiet"
                  size="small"
                  label={text.hideTools}
                  icon={<CloseIcon />}
                  aria-controls={toolsId}
                  unstyled={unstyled}
                  onClick={() => setToolsState("hidden")}
                />
              </div>
            </nav>
          ) : null}
          {hasTools && toolsState === "hidden" ? (
            <button
              type="button"
              className={cx(
                "hm-editor-frame-edge",
                "hm-editor-frame-edge--tools",
                classNames?.edge,
              )}
              aria-controls={toolsId}
              aria-expanded={false}
              onClick={() => setToolsState(lastShown.current)}
            >
              <span className="hm-editor-frame-edge-icon" aria-hidden="true">
                <MenuIcon />
              </span>
              {toolsLabel ?? text.tools}
            </button>
          ) : null}
          <div className={cx("hm-editor-frame-stage", classNames?.stage)}>{children}</div>
          {hasProperties ? (
            <aside
              id={propertiesId}
              aria-label={propertiesLabel ?? text.properties}
              className={cx("hm-editor-frame-properties", classNames?.properties)}
              hidden={propertiesState === "hidden"}
            >
              <div className="hm-editor-frame-properties-head">
                <IconButton
                  variant="quiet"
                  size="small"
                  label={text.hideProperties}
                  icon={<CloseIcon />}
                  aria-controls={propertiesId}
                  unstyled={unstyled}
                  onClick={() => setPropertiesState("hidden")}
                />
              </div>
              <div className="hm-editor-frame-properties-body">{properties}</div>
            </aside>
          ) : null}
          {hasProperties && propertiesState === "hidden" ? (
            <button
              type="button"
              className={cx(
                "hm-editor-frame-edge",
                "hm-editor-frame-edge--properties",
                classNames?.edge,
              )}
              aria-controls={propertiesId}
              aria-expanded={false}
              onClick={() => setPropertiesState("shown")}
            >
              <span className="hm-editor-frame-edge-icon" aria-hidden="true">
                <PropertiesIcon />
              </span>
              {propertiesLabel ?? text.properties}
            </button>
          ) : null}
        </div>
        {bottom == null ? null : (
          <div className={cx("hm-editor-frame-bottom", classNames?.bottom)}>{bottom}</div>
        )}
        {tabBar == null ? null : (
          <div className={cx("hm-editor-frame-tab-bar", classNames?.tabBar)}>{tabBar}</div>
        )}
      </div>
    </EditorFrameContext.Provider>
  );
});

/**
 * Props of {@link EditorFrameToolsButton}.
 *
 * @public
 */
export interface EditorFrameToolsButtonProps
  extends Omit<HTMLAttributes<HTMLButtonElement>, "className" | "children">,
    StyleProps<"root" | "icon"> {
  /** Defaults to `editorFrame.showTools` or `editorFrame.hideTools`. */
  readonly label?: string | undefined;
}

/**
 * The top bar's ☰ button: shows or hides the frame's tools panel, with
 * `aria-expanded`. Renders nothing outside an {@link EditorFrame}.
 *
 * @public
 */
export function EditorFrameToolsButton({
  label,
  ...props
}: EditorFrameToolsButtonProps): ReactElement | null {
  const frame = useEditorFrame();
  const show = useUiText("editorFrame.showTools", uiEditorText);
  const hide = useUiText("editorFrame.hideTools", uiEditorText);
  if (!frame) {
    return null;
  }
  const shown = frame.toolsState !== "hidden";
  return (
    <IconButton
      {...props}
      variant="quiet"
      label={label ?? (shown ? hide : show)}
      icon={<MenuIcon />}
      aria-controls={frame.toolsId}
      aria-expanded={shown}
      onClick={frame.toggleTools}
    />
  );
}
