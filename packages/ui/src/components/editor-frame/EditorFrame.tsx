import { createShortcutRegistry, type ShortcutPart } from "@hussmartinez/sdk-core";
import {
  createContext,
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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
import { Tooltip } from "../tooltip/Tooltip.js";

/**
 * The tools panel's state: labels, icons only, or hidden (sdk-core ADR 0067).
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
  | "propertiesFooter"
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
  /**
   * The top bar's content, such as a {@link Toolbar} with the file's name,
   * undo and Export. The frame adds each panel's toggle around it.
   */
  readonly topBar?: ReactNode;
  /** The tools, usually a {@link ToolList}. Without them there's no tools panel. */
  readonly tools?: ReactNode;
  /** The properties of the selected tool or object. Without them there's no properties panel. */
  readonly properties?: ReactNode;
  /**
   * Host content under the properties panel, in the same column, such as an
   * app's ad slot. What goes in it, and any landmark or name it needs, is
   * the host's; the frame adds no landmark or tab stop of its own.
   *
   * The panel is on top, with its full content, and the footer sits at the
   * foot of the column at its own size, never stretched or shrunk. It's no
   * wider than the panel. It shows only when there's room for both, and
   * otherwise hides, with `hidden`, rather than squeeze the panel, which
   * then has the whole column and scrolls as it does without a footer. It
   * hides whenever:
   *
   * - there's no properties panel: `properties` isn't given, or
   *   `propertiesState` is `hidden`;
   * - the frame is narrower than 45 rem, where the properties sit under the
   *   stage;
   * - the panel's content, at its full height, and the footer don't both fit
   *   in the column's height.
   *
   * Its content stays mounted while it's hidden, so an ad isn't requested
   * again each time the panel comes back.
   */
  readonly propertiesFooter?: ReactNode;
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
 *   shown or hidden, both controlled. With a top bar, the frame puts one
 *   toggle for each panel in it: ☰ at its start for the tools, and one at
 *   its end for the properties, each with `aria-expanded`. Without a top bar,
 *   a hidden panel leaves an edge tab instead. `Mod+\` hides or shows the
 *   tools while focus is in the frame (sdk-core ADR 0067, amended).
 * - **Sizes are container queries:** below 60 rem full tools float over the
 *   stage instead of pushing it, and below 45 rem the {@link TabBar} replaces
 *   the tools and the properties sit under the stage.
 * - **Landmarks:** the top bar is a `header`, the tools a `nav` and the
 *   properties a `complementary` region. The stage is the SDK's own.
 * - **A host's footer** under the properties, such as an app's ad slot,
 *   shows only while both fit in the column (`propertiesFooter`).
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
    propertiesFooter,
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
  const hasFooter = propertiesFooter != null;
  const panelShown = hasProperties && propertiesState !== "hidden";

  // The footer under the properties shows only while the panel's content at
  // its full height and the footer both fit in the column.
  const [footerFits, setFooterFits] = useState(true);
  const panel = useRef<HTMLElement>(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  // Its last height, kept while it's hidden and has none.
  const footerHeight = useRef<number | undefined>(undefined);
  // Stops watching the column, set while it's watched.
  const columnObserver = useRef<(() => void) | undefined>(undefined);
  // A ref callback, not a layout effect: React calls it again whenever
  // whether there's a footer to fit changes, and it measures before the
  // browser paints, so a footer with no room never shows for a frame. A
  // layout effect would too, but React 18 warns about one on the server.
  const measureColumn = useCallback(
    (column: HTMLDivElement | null): void => {
      columnObserver.current?.();
      columnObserver.current = undefined;
      const body = panelBody.current;
      if (!column || !body || !hasFooter || !panelShown) {
        return;
      }
      const measure = (): void => {
        const fits = footerFitsIn(column, panel.current, body, footer.current, footerHeight);
        if (fits !== undefined) {
          setFooterFits(fits);
        }
      };
      measure();
      if (typeof ResizeObserver === "undefined") {
        return;
      }
      // What decides is the column's height, the panel's content and the
      // footer's own size, none of which change when the footer hides, so
      // hiding it can't undo the reason it hid. The content is the body's
      // children, which the properties can replace, so new ones are watched
      // too. The body itself isn't: its size follows the footer's.
      const resizes = new ResizeObserver(measure);
      for (const element of [column, footer.current, ...body.children]) {
        if (element) {
          resizes.observe(element);
        }
      }
      const children = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element) {
              resizes.observe(node);
            }
          }
        }
        measure();
      });
      children.observe(body, { childList: true });
      columnObserver.current = () => {
        resizes.disconnect();
        children.disconnect();
      };
    },
    [hasFooter, panelShown],
  );

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
          <header className={cx("hm-editor-frame-top", classNames?.top)}>
            {hasTools ? (
              <PanelToggle
                className="hm-editor-frame-tools-button"
                label={toolsState === "hidden" ? text.showTools : text.hideTools}
                icon={<MenuIcon />}
                controls={toolsId}
                expanded={toolsState !== "hidden"}
                shortcut={shortcuts.describe("toggle-tools")[0]}
                ariaKeyShortcuts={shortcuts.ariaKeyShortcuts("toggle-tools")}
                unstyled={unstyled}
                onClick={toggleTools}
              />
            ) : null}
            {topBar}
            {hasProperties ? (
              <PanelToggle
                className="hm-editor-frame-properties-button"
                label={propertiesState === "hidden" ? text.showProperties : text.hideProperties}
                icon={<PropertiesIcon />}
                controls={propertiesId}
                expanded={propertiesState !== "hidden"}
                unstyled={unstyled}
                onClick={() =>
                  setPropertiesState(propertiesState === "hidden" ? "shown" : "hidden")
                }
              />
            ) : null}
          </header>
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
                {/* With a top bar, its ☰ is the one control that hides the tools. */}
                {topBar == null ? (
                  <IconButton
                    variant="quiet"
                    size="small"
                    label={text.hideTools}
                    icon={<CloseIcon />}
                    aria-controls={toolsId}
                    unstyled={unstyled}
                    onClick={() => setToolsState("hidden")}
                  />
                ) : null}
              </div>
            </nav>
          ) : null}
          {hasTools && toolsState === "hidden" && topBar == null ? (
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
          {hasProperties || hasFooter ? (
            <div
              ref={measureColumn}
              className="hm-editor-frame-properties-column"
              hidden={!panelShown}
            >
              {hasProperties ? (
                <aside
                  ref={panel}
                  id={propertiesId}
                  aria-label={propertiesLabel ?? text.properties}
                  className={cx("hm-editor-frame-properties", classNames?.properties)}
                  hidden={propertiesState === "hidden"}
                >
                  {/* With a top bar, its toggle is the one control that hides the properties. */}
                  {topBar == null ? (
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
                  ) : null}
                  <div ref={panelBody} className="hm-editor-frame-properties-body">
                    {properties}
                  </div>
                </aside>
              ) : null}
              {hasFooter ? (
                <div
                  ref={footer}
                  className={cx("hm-editor-frame-properties-footer", classNames?.propertiesFooter)}
                  hidden={!(panelShown && footerFits)}
                >
                  {propertiesFooter}
                </div>
              ) : null}
            </div>
          ) : null}
          {hasProperties && propertiesState === "hidden" && topBar == null ? (
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
 * Whether the footer fits under the properties panel, with all of the
 * panel's content in view, in the column; or `undefined` while that can't
 * be told, before the column or the footer has been laid out once.
 */
function footerFitsIn(
  column: HTMLElement,
  panel: HTMLElement | null,
  body: HTMLElement,
  footer: HTMLElement | null,
  footerHeight: { current: number | undefined },
): boolean | undefined {
  if (!panel || !footer || column.getClientRects().length === 0) {
    return undefined;
  }
  // A footer that's hidden has no box, so it's measured while it shows.
  if (footer.getClientRects().length > 0) {
    footerHeight.current = footer.getBoundingClientRect().height;
  }
  if (footerHeight.current === undefined) {
    return undefined;
  }
  // The body as tall as its content: from its top, as if it weren't
  // scrolled, to its last child's margin edge, and its padding under that.
  // The content isn't wrapped to be measured, so properties that fill the
  // body, with a percentage height, still can; they need the whole column.
  const box = body.getBoundingClientRect();
  let end = box.top + Number.parseFloat(getComputedStyle(body).paddingBlockStart);
  if (body.children.length === 0 && body.firstChild) {
    const range = document.createRange();
    range.selectNodeContents(body);
    end = range.getBoundingClientRect().bottom;
  }
  for (const child of body.children) {
    const margin = Number.parseFloat(getComputedStyle(child).marginBlockEnd) || 0;
    end = Math.max(end, child.getBoundingClientRect().bottom + margin);
  }
  const content =
    end - box.top + body.scrollTop + Number.parseFloat(getComputedStyle(body).paddingBlockEnd);
  const panelHeight = panel.getBoundingClientRect().height - box.height + content;
  // A pixel to spare, so rounding never leaves the panel a scroll bar.
  return panelHeight + footerHeight.current + 1 <= column.getBoundingClientRect().height;
}

/**
 * The top bar's toggle for one panel: one control for one action, always in
 * the same place, with its state as `aria-expanded` and its name saying
 * what pressing it does (sdk-core ADR 0067, amended).
 */
function PanelToggle(props: {
  readonly className: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly controls: string;
  readonly expanded: boolean;
  readonly shortcut?: readonly ShortcutPart[] | undefined;
  readonly ariaKeyShortcuts?: string | undefined;
  readonly unstyled: boolean | undefined;
  readonly onClick: () => void;
}): ReactElement {
  return (
    <Tooltip type="label" content={props.label} shortcut={props.shortcut}>
      <IconButton
        variant="quiet"
        className={props.className}
        label={props.label}
        icon={props.icon}
        aria-controls={props.controls}
        aria-expanded={props.expanded}
        aria-keyshortcuts={props.ariaKeyShortcuts || undefined}
        unstyled={props.unstyled}
        onClick={props.onClick}
      />
    </Tooltip>
  );
}
