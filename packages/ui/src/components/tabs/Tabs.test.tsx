import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeadingLevelProvider } from "../heading/Heading.js";
import { Tabs } from "./Tabs.js";

const tabs = [
  { id: "next", label: "Next.js", content: <p>Server Components</p> },
  { id: "astro", label: "Astro", content: <p>Islands</p> },
];

describe("Tabs on the server", () => {
  it("renders every panel under a heading with its tab's label, and nothing that says tab", () => {
    const html = renderToString(<Tabs label="Implementations" tabs={tabs} />);
    expect(html).toMatch(
      /^<div class="hm-tabs">(<div id="[^"]+" class="hm-tabs-panel"><h2 class="hm-heading hm-tabs-title">[^<]+<\/h2><p>[^<]+<\/p><\/div>){2}<\/div>$/,
    );
    expect(html).toContain(
      '<h2 class="hm-heading hm-tabs-title">Next.js</h2><p>Server Components</p>',
    );
    expect(html).toContain('<h2 class="hm-heading hm-tabs-title">Astro</h2><p>Islands</p>');
    // Nothing is announced as a tab, hidden or taken out of reading order
    // until the keys work.
    expect(html).not.toMatch(/role=|aria-|tabindex=|hidden|data-hm-ready/);
  });

  it("needs no client JavaScript: static markup is complete, with every panel", () => {
    // What an Astro page without a `client:` directive writes.
    const page = <Tabs label="Implementations" tabs={tabs} />;
    expect(renderToStaticMarkup(page)).toBe(renderToString(page));
  });

  it("takes its headings' level from headingLevel, or from the provider", () => {
    expect(renderToString(<Tabs label="Stack" tabs={tabs} headingLevel={4} />)).toContain(
      '<h4 class="hm-heading hm-tabs-title">Astro</h4>',
    );
    expect(
      renderToString(
        <HeadingLevelProvider level={3}>
          <Tabs label="Stack" tabs={tabs} />
        </HeadingLevelProvider>,
      ),
    ).toContain('<h3 class="hm-heading hm-tabs-title">Astro</h3>');
  });

  it("adds className and classNames per part, marks unstyled and passes native props", () => {
    const html = renderToString(
      <Tabs
        label="Stack"
        tabs={tabs}
        className="app"
        classNames={{ root: "root", panel: "panel", title: "title" }}
        unstyled
        data-testid="stack"
      />,
    );
    expect(html).toContain('class="hm-tabs root app"');
    expect(html).toContain('data-hm-unstyled=""');
    expect(html).toContain('data-testid="stack"');
    expect(html).toContain('class="hm-tabs-panel panel"');
    expect(html).toContain('class="hm-heading hm-tabs-title title"');
  });

  it("renders an empty root without tabs", () => {
    expect(renderToString(<Tabs label="Stack" tabs={[]} />)).toBe('<div class="hm-tabs"></div>');
  });
});
