import { createContext, forwardRef, type HTMLAttributes, type ReactNode, useContext } from "react";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";

/**
 * What a tag's colours say: `neutral` (the default) for a plain label,
 * `accent` to draw the eye, and `success`, `warning` and `danger` for a
 * state. Colour never says it alone: the tag's text does (docs/adr/0015).
 *
 * @public
 */
export type TagTone = "neutral" | "accent" | "success" | "warning" | "danger";

/**
 * The parts of a tag that `classNames` can target.
 *
 * @public
 */
export type TagPart = "root" | "icon" | "label";

/**
 * Props of {@link Tag}. Native props are passed through.
 *
 * @public
 */
export interface TagProps
  extends Omit<HTMLAttributes<HTMLElement>, "className">,
    StyleProps<TagPart> {
  /** Defaults to `neutral`. */
  readonly tone?: TagTone | undefined;
  /** An icon before the text. It's decorative, and draws with `currentColor`. */
  readonly icon?: ReactNode;
}

/** Whether a tag is a direct item of a {@link TagList}, and so its `<li>`. */
const TagListContext = /* @__PURE__ */ createContext(false);

/**
 * A short, static label, such as a category, a technology or a state. It's
 * text, not a control: it takes no focus and does nothing when pressed. A
 * `<span>` on its own, and an `<li>` inside a {@link TagList}.
 *
 * @example
 * ```tsx
 * <Tag tone="warning" icon={<WarningIcon />}>{messages.t("guide.deprecated")}</Tag>
 * ```
 *
 * @public
 */
export const Tag = /* @__PURE__ */ forwardRef<HTMLElement, TagProps>(function Tag(
  { tone = "neutral", icon, className, classNames, unstyled, children, ...props },
  ref,
) {
  const Element = useContext(TagListContext) ? "li" : "span";
  return (
    <Element
      {...props}
      ref={ref as never}
      className={cx("hm-tag", `hm-tag--${tone}`, classNames?.root, className)}
      data-hm-unstyled={unstyledAttribute(unstyled)}
    >
      {icon == null ? null : (
        <span className={cx("hm-tag-icon", classNames?.icon)} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={cx("hm-tag-label", classNames?.label)}>{children}</span>
    </Element>
  );
});

/**
 * Props of {@link TagList}. Native list props are passed through.
 *
 * @public
 */
export type TagListProps = Omit<HTMLAttributes<HTMLUListElement>, "role">;

/**
 * A list of tags that wraps onto as many lines as it needs: a `<ul>` whose
 * {@link Tag}s are its `<li>`s, so a screen reader says how many there are.
 * Name it with `aria-label` or `aria-labelledby` when nothing beside it says
 * what the tags are. It has no `unstyled` prop, because it only lays out.
 *
 * @example
 * ```tsx
 * <TagList aria-label={messages.t("guide.stack")}>
 *   {stack.map((name) => (
 *     <Tag key={name}>{name}</Tag>
 *   ))}
 * </TagList>
 * ```
 *
 * @public
 */
export const TagList = /* @__PURE__ */ forwardRef<HTMLUListElement, TagListProps>(function TagList(
  { className, children, ...props },
  ref,
) {
  return (
    // Safari takes a list without markers for no list at all, and VoiceOver
    // then says nothing of it, unless the role is written out.
    // biome-ignore lint/a11y/noRedundantRoles: see above.
    <ul {...props} ref={ref} role="list" className={cx("hm-tag-list", className)}>
      <TagListContext.Provider value={true}>{children}</TagListContext.Provider>
    </ul>
  );
});
