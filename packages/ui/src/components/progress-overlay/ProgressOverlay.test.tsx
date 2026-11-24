import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressOverlay } from "./ProgressOverlay.js";

describe("ProgressOverlay on the server", () => {
  it("renders only its content and an empty status when closed", () => {
    expect(
      renderToString(
        <ProgressOverlay open={false} title="Exporting">
          Stage
        </ProgressOverlay>,
      ),
    ).toBe(
      '<div class="hm-progress-overlay"><div class="hm-progress-overlay-content">Stage</div><div role="status" class="hm-visually-hidden"></div></div>',
    );
  });

  it("renders a labelled card with a bar, detail and Cancel when open", () => {
    const html = renderToString(
      <ProgressOverlay
        open
        title="Exporting"
        detail="Encoding on this device"
        value={40}
        onCancel={() => {}}
      >
        Stage
      </ProgressOverlay>,
    );
    expect(html).toContain('<div class="hm-progress-overlay-content" aria-busy="true">');
    expect(html).toContain(
      '<div role="status" class="hm-visually-hidden">Exporting. Encoding on this device</div>',
    );
    const [, titleId] = /role="group" aria-labelledby="([^"]+)"/.exec(html) ?? [];
    expect(html).toContain(`<p id="${titleId}" class="hm-progress-overlay-title">Exporting</p>`);
    expect(html).toMatch(/<progress[^>]*value="40"[^>]*aria-label="Exporting"/);
    expect(html).toContain("Encoding on this device");
    expect(html).toMatch(/<button[^>]*>(<span[^>]*>)?Cancel/);
  });

  it("has no Cancel button without onCancel, and an indeterminate bar without a value", () => {
    const html = renderToString(<ProgressOverlay open title="Opening" value={null} />);
    expect(html).not.toContain("Cancel");
    expect(html).not.toMatch(/<progress[^>]*value=/);
  });
});
