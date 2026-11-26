import { createMessages, sdkCoreMessages } from "@hussmartinez/sdk-core";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiMessages } from "../../messages/en.js";
import { UiMessagesProvider } from "../messages/UiMessagesProvider.js";
import { ButtonLink } from "./ButtonLink.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ButtonLink on the server", () => {
  it("renders a native link with the button's classes", () => {
    expect(renderToString(<ButtonLink href="/guides">Guides</ButtonLink>)).toBe(
      '<a href="/guides" class="hm-button hm-button--secondary hm-button-link"><span class="hm-button-label">Guides</span></a>',
    );
  });

  it("stays a link: no button role, type or state", () => {
    const html = renderToString(
      <ButtonLink href="/guides" variant="primary">
        Guides
      </ButtonLink>,
    );
    expect(html).not.toMatch(/role=|type=|aria-pressed|aria-disabled|tabindex=/);
  });

  it("renders variants, sizes and icons as Button does", () => {
    const html = renderToString(
      <ButtonLink
        href="/guides"
        variant="primary"
        size="small"
        startIcon={<svg />}
        endIcon={<svg />}
      >
        Guides
      </ButtonLink>,
    );
    expect(html).toContain('class="hm-button hm-button--primary hm-button--small hm-button-link"');
    expect(html.match(/<span class="hm-button-icon" aria-hidden="true">/g)).toHaveLength(2);
  });

  it("adds className and classNames per part, marks unstyled and passes native props", () => {
    const html = renderToString(
      <ButtonLink
        href="/report.pdf"
        className="app"
        classNames={{ root: "root", icon: "icon", label: "label" }}
        startIcon={<svg />}
        unstyled
        download
        aria-current="page"
      >
        Report
      </ButtonLink>,
    );
    expect(html).toContain('class="hm-button hm-button--secondary hm-button-link root app"');
    expect(html).toContain('data-hm-unstyled=""');
    expect(html).toContain('class="hm-button-icon icon"');
    expect(html).toContain('class="hm-button-label label"');
    expect(html).toContain('download=""');
    expect(html).toContain('aria-current="page"');
  });

  it("needs no client JavaScript: static markup is the whole component", () => {
    const link = (
      <ButtonLink href="https://example.com" target="_blank" startIcon={<svg />}>
        Example
      </ButtonLink>
    );
    expect(renderToStaticMarkup(link)).toBe(renderToString(link));
  });
});

describe("ButtonLink that opens a new tab", () => {
  it("says so in its name, and keeps the opener and the referrer from the other site", () => {
    const html = renderToString(
      <ButtonLink href="https://example.com" target="_blank">
        Example
      </ButtonLink>,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(
      '<span class="hm-button-label">Example</span><span class="hm-visually-hidden"> (opens in a new tab)</span>',
    );
  });

  it("keeps a rel the host chose", () => {
    const html = renderToString(
      <ButtonLink href="https://example.com" target="_blank" rel="noopener me">
        Example
      </ButtonLink>,
    );
    expect(html).toContain('rel="noopener me"');
    expect(html).not.toContain("noreferrer");
  });

  it("takes the hint from newTabHint, then from the messages, and drops an empty one", () => {
    const link = (hint?: string) => (
      <ButtonLink href="https://example.com" target="_blank" newTabHint={hint}>
        Example
      </ButtonLink>
    );
    expect(renderToString(link("(neuer Tab)"))).toContain("> (neuer Tab)</span>");
    expect(renderToString(link(""))).not.toContain("hm-visually-hidden");
    const messages = createMessages(
      { ...sdkCoreMessages, ...uiMessages },
      { overrides: { "buttonLink.newTab": "(nueva pestaña)" } },
    );
    expect(
      renderToString(<UiMessagesProvider messages={messages}>{link()}</UiMessagesProvider>),
    ).toContain("> (nueva pestaña)</span>");
  });

  it("adds neither to a link that stays in its tab", () => {
    const html = renderToString(<ButtonLink href="https://example.com">Example</ButtonLink>);
    expect(html).not.toMatch(/rel=|target=|hm-visually-hidden/);
  });
});

describe("ButtonLink with a javascript: URL", () => {
  it("renders without an href, so nothing runs, and warns in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // As data would bring it: mixed case, after a space.
    const fromData = [" JavaScript", "alert(1)"].join(":");
    const html = renderToString(<ButtonLink href={fromData}>Run</ButtonLink>);
    expect(html).not.toContain("href");
    expect(html).not.toContain("alert");
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/ButtonLink refused a javascript: URL/),
    );
  });

  it("leaves other addresses alone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const href of ["/guides", "#top", "mailto:someone@example.com", "https://example.com"]) {
      expect(renderToString(<ButtonLink href={href}>Go</ButtonLink>)).toContain(`href="${href}"`);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
