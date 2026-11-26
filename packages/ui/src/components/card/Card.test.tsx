import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeadingLevelProvider } from "../heading/Heading.js";
import { Card } from "./Card.js";

describe("Card on the server", () => {
  it("is an article labelled by its title, with media after the title in the source", () => {
    const html = renderToString(
      <Card
        title={<a href="/notebooks/1">Travel</a>}
        eyebrow="Notebook"
        media={<img src="/cover.png" alt="" />}
        footer={<button type="button">Delete</button>}
      >
        12 notes
      </Card>,
    );
    // React 19 puts an image preload link first.
    const [, titleId] = /<article aria-labelledby="([^"]+)" class="hm-card">/.exec(html) ?? [];
    expect(titleId).toBeTruthy();
    expect(html).toContain(
      `<h2 id="${titleId}" class="hm-card-title"><a href="/notebooks/1">Travel</a></h2>` +
        '<p class="hm-card-eyebrow">Notebook</p>' +
        '<div class="hm-card-media"><img src="/cover.png" alt=""/></div>' +
        '<div class="hm-card-body">12 notes</div>' +
        '<div class="hm-card-footer"><button type="button">Delete</button></div>',
    );
  });

  it("renders only the parts it's given", () => {
    const html = renderToString(<Card title="Travel" />);
    expect(html).not.toContain("hm-card-eyebrow");
    expect(html).not.toContain("hm-card-media");
    expect(html).not.toContain("hm-card-body");
    expect(html).not.toContain("hm-card-footer");
  });

  it("takes its heading level from the provider, or from headingLevel", () => {
    expect(
      renderToString(
        <HeadingLevelProvider level={4}>
          <Card title="Travel" />
        </HeadingLevelProvider>,
      ),
    ).toMatch(/<h4 [^>]*class="hm-card-title"/);
    expect(
      renderToString(
        <HeadingLevelProvider level={4}>
          <Card title="Travel" headingLevel={3} />
        </HeadingLevelProvider>,
      ),
    ).toMatch(/<h3 [^>]*class="hm-card-title"/);
  });

  it("takes classNames for each part, unstyled, and native props", () => {
    const html = renderToString(
      <Card
        title="Travel"
        eyebrow="e"
        media="m"
        footer="f"
        className="mine"
        classNames={{ root: "r", title: "t", eyebrow: "e", media: "m", body: "b", footer: "f" }}
        unstyled
        data-testid="card"
        aria-labelledby="elsewhere"
      >
        body
      </Card>,
    );
    expect(html).toMatch(
      /^<article aria-labelledby="elsewhere" data-testid="card" class="hm-card r mine" data-hm-unstyled="">/,
    );
    expect(html).toContain('class="hm-card-title t"');
    expect(html).toContain('class="hm-card-eyebrow e"');
    expect(html).toContain('class="hm-card-media m"');
    expect(html).toContain('class="hm-card-body b"');
    expect(html).toContain('class="hm-card-footer f"');
  });
});
