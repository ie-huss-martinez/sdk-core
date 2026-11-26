import { type AnchorHTMLAttributes, forwardRef, type ReactNode, useId } from "react";
import { warnInDevelopment } from "../../internal/development.js";
import { uiLinkText } from "../../messages/link.js";
import { useUiPartText } from "../messages/UiMessagesProvider.js";
import { isScriptUrl } from "../shared/link.js";
import { cx, type StyleProps, unstyledAttribute } from "../shared/style-props.js";
import { type ButtonPart, type ButtonSize, type ButtonVariant, Icon } from "./Button.js";

declare const process: { readonly env: { readonly NODE_ENV?: string } };

/**
 * Props of {@link ButtonLink}. Native link props are passed through.
 *
 * @public
 */
export interface ButtonLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className" | "href">,
    StyleProps<ButtonPart> {
  /**
   * Where the link goes. A `javascript:` URL is refused: the link renders
   * without an `href`, so it does nothing, with a development warning.
   */
  readonly href: string;
  /** Defaults to `secondary`. */
  readonly variant?: ButtonVariant | undefined;
  /** Defaults to `medium`. */
  readonly size?: ButtonSize | undefined;
  /** An icon before the label. It's decorative, and draws with `currentColor`. */
  readonly startIcon?: ReactNode;
  /** An icon after the label, such as `ExternalLinkIcon` on a link that opens a new tab. */
  readonly endIcon?: ReactNode;
  /**
   * What a link with `target="_blank"` adds to its accessible name, hidden on
   * screen: after its text, or after its `aria-label` or `aria-labelledby`
   * when it has one. Defaults to `buttonLink.newTab` from the messages
   * ("(opens in a new tab)"). Pass `""` when the link's own name already
   * says it.
   */
  readonly newTabHint?: string | undefined;
}

/**
 * A link that looks like a {@link Button}, for navigation: a native
 * `<a href>`, so it's a link to assistive technology, Enter follows it, and
 * the browser's own link behaviour stays, such as opening in a new tab from
 * the context menu. Use a `Button` for an action.
 *
 * With `target="_blank"`, `rel` defaults to `noopener noreferrer`, and the
 * link says that it opens a new tab.
 *
 * @example
 * ```tsx
 * <ButtonLink variant="primary" href="/guides" endIcon={<ArrowRightIcon />}>
 *   {messages.t("home.browseGuides")}
 * </ButtonLink>
 * ```
 *
 * @public
 */
export const ButtonLink = /* @__PURE__ */ forwardRef<HTMLAnchorElement, ButtonLinkProps>(
  function ButtonLink(
    {
      href,
      variant = "secondary",
      size = "medium",
      startIcon,
      endIcon,
      newTabHint,
      target,
      rel,
      className,
      classNames,
      unstyled,
      children,
      "aria-label": label,
      "aria-labelledby": labelledBy,
      ...props
    },
    ref,
  ) {
    const defaultHint = useUiPartText(uiLinkText, "buttonLink.newTab");
    const hintId = useId();
    const refused = isScriptUrl(href);
    if (refused) {
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        warnInDevelopment(
          "ButtonLink refused a javascript: URL, and rendered the link without an href. Use a Button with onClick for an action.",
        );
      }
    }
    // HTML matches the keyword in any case.
    const newTab = target?.toLowerCase() === "_blank";
    const hint = newTab ? (newTabHint ?? defaultHint) : "";
    // A name the caller gives replaces the link's text, hint and all, so the
    // hint joins that name instead. An empty one names nothing, and the
    // link's text stays its name.
    const labelled = hint !== "" && label !== undefined && label.trim() !== "";
    const named = hint !== "" && labelledBy !== undefined && labelledBy.trim() !== "";
    return (
      <a
        {...props}
        ref={ref}
        href={refused ? undefined : href}
        target={target}
        rel={rel ?? (newTab ? "noopener noreferrer" : undefined)}
        aria-label={labelled ? `${label} ${hint}` : label}
        aria-labelledby={named ? `${labelledBy} ${hintId}` : labelledBy}
        className={cx(
          "hm-button",
          `hm-button--${variant}`,
          size === "small" && "hm-button--small",
          "hm-button-link",
          classNames?.root,
          className,
        )}
        data-hm-unstyled={unstyledAttribute(unstyled)}
      >
        {startIcon == null ? null : <Icon className={classNames?.icon}>{startIcon}</Icon>}
        {children == null ? null : (
          <span className={cx("hm-button-label", classNames?.label)}>{children}</span>
        )}
        {endIcon == null ? null : <Icon className={classNames?.icon}>{endIcon}</Icon>}
        {/* One text node, space included, so static markup holds no comment between two. */}
        {hint === "" ? null : (
          <span id={named ? hintId : undefined} className="hm-visually-hidden">{` ${hint}`}</span>
        )}
      </a>
    );
  },
);
