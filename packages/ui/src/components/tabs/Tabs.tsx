import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { HeadingLevel } from "../../heading/heading-level.js";
import { Heading } from "../heading/Heading.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";

/**
 * One tab of {@link Tabs}, with the panel it shows.
 *
 * @public
 */
export interface TabsItem {
  /** Unique among the tabs. It's what `value` and `onValueChange` carry. */
  readonly id: string;
  /** The tab's text, and the heading over its panel before the tabs are ready. */
  readonly label: string;
  /** An icon before the label. It's decorative, and draws with `currentColor`. */
  readonly icon?: ReactNode;
  /** The panel's content. */
  readonly content: ReactNode;
}

/**
 * The parts of tabs that `classNames` can target.
 *
 * @public
 */
export type TabsPart = "root" | "list" | "tab" | "icon" | "label" | "panel" | "title";

/**
 * Props of {@link Tabs}. Native props are passed through to the root.
 *
 * @public
 */
export interface TabsProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "className" | "defaultValue" | "onChange">,
    StyleProps<TabsPart> {
  /** The tab list's accessible name, such as "Implementations". Required. */
  readonly label: string;
  readonly tabs: readonly TabsItem[];
  /** The selected tab's id, when you control it. */
  readonly value?: string | undefined;
  /** The tab selected at first, when you don't. Defaults to the first tab. */
  readonly defaultValue?: string | undefined;
  /** Called with a tab's id when the user selects it. */
  readonly onValueChange?: ((id: string) => void) | undefined;
  /**
   * `automatic`, the default, selects a tab as the arrow keys reach it.
   * `manual` only moves focus, and Enter or Space selects: use it when
   * showing a panel is slow, such as one that loads.
   */
  readonly activation?: "automatic" | "manual" | undefined;
  /**
   * The level of the headings shown over each panel before the tabs are
   * ready, `2` to `6`. Defaults to the closest `HeadingLevelProvider`'s, or
   * `2`.
   */
  readonly headingLevel?: HeadingLevel | undefined;
}

// Whether the component runs in a browser doesn't change, so nothing to subscribe to.
const tabsNeverChange = (): (() => void) => () => undefined;
const tabsInBrowser = (): boolean => true;
const tabsOnServer = (): boolean => false;

/**
 * Sections of content of which one shows at a time, chosen from a row of
 * tabs: the WAI-ARIA tabs pattern, with one Tab stop for the row, the arrow
 * keys, Home and End between tabs, and each panel reachable with Tab.
 *
 * **It's complete before JavaScript runs.** On the server, and on a static
 * page that never hydrates it, every panel is shown, one after another, each
 * under a heading with its tab's label. Once it runs in the browser it
 * becomes tabs. Nothing is announced as a tab until the keys work.
 *
 * It's one component, with no context between parts, so it works as a single
 * island in a framework that renders each component on its own.
 *
 * @example
 * ```tsx
 * <Tabs
 *   label={messages.t("explainer.implementations")}
 *   tabs={implementations.map((implementation) => ({
 *     id: implementation.id,
 *     label: implementation.framework,
 *     content: <Implementation {...implementation} />,
 *   }))}
 * />
 * ```
 *
 * @public
 */
export const Tabs = /* @__PURE__ */ forwardRef(function Tabs(
  {
    label,
    tabs,
    value,
    defaultValue,
    onValueChange,
    activation = "automatic",
    headingLevel,
    className,
    classNames,
    unstyled,
    ...props
  }: TabsProps,
  ref: ForwardedRef<HTMLDivElement>,
): ReactElement {
  const id = useId();
  // False on the server and while hydrating, so both render the same markup;
  // true in the render right after, and at once when rendered in the browser.
  const ready = useSyncExternalStore(tabsNeverChange, tabsInBrowser, tabsOnServer);
  const [own, setOwn] = useState(defaultValue);
  const wanted = value ?? own;
  // An id that names no tab, or none at all, selects the first.
  const selected = tabs.find((tab) => tab.id === wanted)?.id ?? tabs[0]?.id;

  // A row that scrolls shows its selected tab: at first, when the owner
  // changes it, and when the row gets its size, which it has none of while an
  // ancestor is hidden. Only the row moves, never the page, as scrollIntoView
  // would.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = list.current;
    if (!ready || !row || selected === undefined) {
      return;
    }
    // An observer reports once when it starts, then on every change of size.
    const observer = new ResizeObserver(() => {
      const tab = row.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!tab) {
        return;
      }
      const visible = row.getBoundingClientRect();
      const box = tab.getBoundingClientRect();
      if (box.left < visible.left) {
        row.scrollLeft += box.left - visible.left;
      } else if (box.right > visible.right) {
        row.scrollLeft += box.right - visible.right;
      }
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [ready, selected]);

  const select = (next: string): void => {
    if (next !== selected) {
      setOwn(next);
      onValueChange?.(next);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const row = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = row.indexOf(event.target as HTMLElement);
    if (current < 0 || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    // The arrows follow the row as it's drawn, so they swap in right-to-left text.
    const forward = getComputedStyle(event.currentTarget).direction === "rtl" ? -1 : 1;
    const last = row.length - 1;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const step = event.key === "ArrowRight" ? forward : -forward;
      next = (current + step + row.length) % row.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    } else {
      return;
    }
    event.preventDefault();
    row[next]?.focus();
    const tab = tabs[next];
    if (tab && activation === "automatic") {
      select(tab.id);
    }
  };

  return (
    <div
      {...props}
      ref={ref}
      className={cx("hm-tabs", classNames?.root, className)}
      data-hm-unstyled={unstyledAttribute(unstyled)}
      data-hm-ready={ready ? "" : undefined}
    >
      {ready ? (
        <div
          key="list"
          ref={list}
          role="tablist"
          aria-label={label}
          // Firefox makes a row that scrolls a Tab stop of its own, before its
          // tabs. The selected tab is the row's one stop.
          tabIndex={-1}
          className={cx("hm-tabs-list", classNames?.list)}
          onKeyDown={handleKeyDown}
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${id}-tab-${index}`}
              aria-selected={tab.id === selected}
              aria-controls={`${id}-panel-${index}`}
              tabIndex={tab.id === selected ? 0 : -1}
              className={cx("hm-tabs-tab", classNames?.tab)}
              onClick={() => select(tab.id)}
            >
              {tab.icon == null ? null : (
                <span className={cx("hm-tabs-icon", classNames?.icon)} aria-hidden="true">
                  {tab.icon}
                </span>
              )}
              <span className={cx("hm-tabs-label", classNames?.label)}>{tab.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {tabs.map((tab, index) => (
        // The same element before and after the tabs are ready, with its
        // content in the same place among its children, after the title or
        // the gap it leaves, so what's inside a panel is kept, not made
        // again, when the tabs take over.
        <div
          key={tab.id}
          id={`${id}-panel-${index}`}
          // A panel only once there are tabs to name it. It's reachable with
          // Tab, so a panel of plain text can be read and scrolled from the
          // keyboard.
          {...(ready
            ? { role: "tabpanel", "aria-labelledby": `${id}-tab-${index}`, tabIndex: 0 }
            : undefined)}
          hidden={ready && tab.id !== selected}
          className={cx("hm-tabs-panel", classNames?.panel)}
        >
          {ready ? null : (
            <Heading
              level={headingLevel}
              unstyled={unstyled}
              className={cx("hm-tabs-title", classNames?.title)}
            >
              {tab.label}
            </Heading>
          )}
          {tab.content}
        </div>
      ))}
    </div>
  );
});
