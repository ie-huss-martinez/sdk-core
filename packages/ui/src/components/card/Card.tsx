import {
  type ForwardedRef,
  forwardRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import { type HeadingLevel, toHeadingLevel } from "../../heading/heading-level.js";
import { useHeadingLevel } from "../heading/Heading.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";

/**
 * The parts of a card that `classNames` can target.
 *
 * @public
 */
export type CardPart = "root" | "title" | "eyebrow" | "media" | "body" | "footer";

/**
 * Props of {@link Card}.
 *
 * @public
 */
export interface CardProps
  extends Omit<HTMLAttributes<HTMLElement>, "className" | "title">,
    StyleProps<CardPart> {
  /**
   * The card's heading and accessible name. Put the card's main link or
   * button in it: it then covers the whole card, so a click anywhere on the
   * card follows it.
   */
  readonly title: ReactNode;
  /**
   * The heading's level, from `2` to `6`. Defaults to the closest
   * `HeadingLevelProvider`'s, or `2`.
   */
  readonly headingLevel?: HeadingLevel | undefined;
  /**
   * A short label shown above the title, such as a category. It's read after
   * the title, so the heading comes first.
   */
  readonly eyebrow?: ReactNode;
  /**
   * An image or other media, shown at the top of the card and read after the
   * title. Give an image its own `alt`, or `alt=""` when the title says it
   * all.
   */
  readonly media?: ReactNode;
  /**
   * Details or actions at the bottom, such as tags or a delete button. Its
   * buttons and links stay clickable above the card's main action; the rest
   * of it follows the main action like the rest of the card.
   */
  readonly footer?: ReactNode;
}

/**
 * A card for something the user opens, such as a notebook, a lesson or a
 * recent file (ADR 0014): an `<article>` labelled by its title.
 *
 * - **One main action:** the link or button you put in `title` covers the
 *   whole card, and its accessible name is just the title. Use your router's
 *   link, an `<a href>`, or a `<button>`.
 * - **Focus:** the focus ring goes around the whole card.
 * - **Other actions,** such as buttons and links in `footer`, sit above the
 *   main action and keep their own clicks. Text can't be selected with the
 *   mouse, because the main action covers it.
 * - **Server rendering:** a card is static markup with no effects, so a card
 *   whose title is an `<a href>` needs no hydration.
 * - **Opening a dialog:** to grow the card into the dialog it opens, change
 *   state through {@link startMorphTransition}.
 *
 * @example
 * ```tsx
 * <Card
 *   title={<a href={`/notebooks/${notebook.id}`}>{notebook.name}</a>}
 *   media={<img src={notebook.cover} alt="" />}
 *   footer={<IconButton label={messages.t("notebook.delete")} icon={<DeleteIcon />} onClick={remove} />}
 * >
 *   {messages.t("notebook.count", { count: notebook.notes })}
 * </Card>
 * ```
 *
 * @public
 */
export const Card = /* @__PURE__ */ forwardRef(function Card(
  {
    title,
    headingLevel,
    eyebrow,
    media,
    footer,
    className,
    classNames,
    unstyled,
    children,
    ...props
  }: CardProps,
  ref: ForwardedRef<HTMLElement>,
): ReactElement {
  const contextLevel = useHeadingLevel();
  const Title =
    `h${headingLevel === undefined ? contextLevel : toHeadingLevel(headingLevel)}` as const;
  const titleId = useId();
  return (
    <article
      aria-labelledby={titleId}
      {...props}
      ref={ref}
      className={cx("hm-card", classNames?.root, className)}
      data-hm-unstyled={unstyledAttribute(unstyled)}
    >
      <Title id={titleId} className={cx("hm-card-title", classNames?.title)}>
        {title}
      </Title>
      {/* After the title in the source, so they're read after it; CSS shows them above. */}
      {eyebrow == null ? null : (
        <p className={cx("hm-card-eyebrow", classNames?.eyebrow)}>{eyebrow}</p>
      )}
      {media == null ? null : <div className={cx("hm-card-media", classNames?.media)}>{media}</div>}
      {children == null ? null : (
        <div className={cx("hm-card-body", classNames?.body)}>{children}</div>
      )}
      {footer == null ? null : (
        <div className={cx("hm-card-footer", classNames?.footer)}>{footer}</div>
      )}
    </article>
  );
});
